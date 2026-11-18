import type { AdapterContext } from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { T3CloudAgentProvider } from "./t3-cloud-agent.js";
import {
  T3ThreadEventsEmulator,
  t3EmulatedProvider,
  t3EmulatorConnector,
} from "./t3-cloud-agent.test-support.js";
import { t3ThreadClosed } from "./t3-thread-closed.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};

function setup() {
  const emulator = new T3ThreadEventsEmulator();
  let reachable = true;
  const provider = t3EmulatedProvider({
    fetch: async (input, init) => {
      if (!reachable) throw new TypeError("fetch failed");
      return emulator.fetch(input, init);
    },
  });
  return {
    emulator,
    provider,
    unreachable: () => {
      reachable = false;
    },
  };
}

const launched = (emulator: T3ThreadEventsEmulator, tool = "t3_thread_launch") =>
  emulator.calls.filter((call) => call.tool === tool);

describe("T3 cloud agent provider over the T3 MCP emulator (offline)", () => {
  it("launches, reports running, finishes, and replays a launch by its title tag", async () => {
    const { emulator, provider } = setup();
    const request = {
      scratch: true,
      idempotencyKey: "abcdef1234567890",
      prompt: "Add a README\nwith details",
      title: "Add a README",
    };
    const first = await provider.launch(request, context);
    expect(first).toMatchObject({
      status: "running",
      title: "Add a README",
      url: expect.stringMatching(/^t3code:\/\/threads\/env-1\//),
    });
    // T3's own title keeps the tag the replay below looks for.
    expect(launched(emulator)[0]!.args).toMatchObject({ title: "Add a README · abcdef1234567" });
    // No model was asked for: T3's first capable provider is used and nothing is reported.
    expect(launched(emulator)[0]!.args).toMatchObject({
      scratch: true,
      modelSelection: { instanceId: "agent-b", model: "model-a" },
    });
    expect(first).not.toHaveProperty("launchNote");
    // The same request again finds the thread by its title instead of launching a second.
    expect((await provider.launch(request, context)).id).toBe(first.id);
    expect(launched(emulator)).toHaveLength(1);

    // Once polled, the thread is titled as the card is, and the tag is gone.
    expect((await provider.get(first.id, context)).status).toBe("running");
    expect(emulator.threads.get(first.id)!.title).toBe("Add a README");

    emulator.complete(first.id);
    const done = await provider.get(first.id, context);
    expect(done).toMatchObject({ status: "finished", latestRunId: first.latestRunId });
    emulator.complete(first.id, "failed");
  });

  it("says the owner closed a thread only once it is settled or archived with nothing open", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "closed1234567890", prompt: "Fix it", title: "Fix it" },
      context,
    );
    emulator.complete(agent.id, "failed");
    const thread = emulator.threads.get(agent.id)!;
    expect(await provider.ownerClosed(agent.id, context)).toBe(false);
    await provider.settle(agent.id, context);
    expect(await provider.ownerClosed(agent.id, context)).toBe(true);
    thread.pendingRequestCount = 1;
    expect(await provider.ownerClosed(agent.id, context)).toBe(false);
    thread.pendingRequestCount = 0;
    thread.settled = false;
    thread.archived = true;
    expect(await provider.ownerClosed(agent.id, context)).toBe(true);
    // A server that leaves out the count has not said nothing is open.
    const archived = { thread: { archived: true } };
    expect(t3ThreadClosed(archived)).toBe(false);
    expect(t3ThreadClosed({ thread: { ...archived.thread, pendingRequestCount: 0 } })).toBe(true);
    // A thread T3 no longer has says nothing about the owner.
    expect(await provider.ownerClosed("gone", context)).toBe(false);
  });

  it("keeps a job running while its thread only watches a pull request", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "watch-key-1234567", prompt: "Task" },
      context,
    );
    emulator.openPullRequest(agent.id, "https://github.com/example/demo/pull/72");
    emulator.watchPullRequest(agent.id);
    emulator.complete(agent.id, "completed", "Opened the PR; waiting for checks.");
    // The run ended and only the watch is left: not a handback.
    const waiting = await provider.get(agent.id, context);
    expect(waiting.status).toBe("running");
    expect(waiting).not.toHaveProperty("result");
    // The card's pull request line comes from what T3 lists on the thread.
    expect(waiting).toMatchObject({
      prUrl: "https://github.com/example/demo/pull/72",
      prState: "open",
      watching: true,
      watchIdle: true,
    });
    // A PR event wakes the thread: a new run, then a short "still waiting" end. Still no handback.
    for (let wake = 0; wake < 3; wake += 1) {
      emulator.continueRun(agent.id);
      // The wake is work, so the watch's day-long clock does not count it.
      expect(await provider.get(agent.id, context)).toMatchObject({
        status: "running",
        watchIdle: false,
      });
      emulator.complete(agent.id, "completed", "Still waiting.");
      expect(await provider.get(agent.id, context)).toMatchObject({
        status: "running",
        watchIdle: true,
      });
    }
    // The handback: the agent unwatches and its run ends.
    emulator.continueRun(agent.id);
    emulator.watchPullRequest(agent.id, false);
    emulator.complete(agent.id, "completed", "All green; ready to merge.");
    const done = await provider.get(agent.id, context);
    expect(done).toMatchObject({
      status: "finished",
      result: "All green; ready to merge.",
      prState: "open",
      watching: false,
    });
    emulator.landPullRequest(agent.id);
    expect(await provider.get(agent.id, context)).toMatchObject({ prState: "merged" });
  });

  it("reports a thread's background work and every pull request it watches, for the card only", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "work-key-12345678", prompt: "Task" },
      context,
    );
    for (const number of [71, 72, 73])
      emulator.openPullRequest(agent.id, `https://github.com/example/demo/pull/${number}`);
    emulator.watchPullRequest(agent.id);
    emulator.addBackgroundWork(agent.id, {
      taskId: "t1",
      kind: "subagent",
      description: "Review the change\nwith the second pass",
      childThreadId: "child:1",
    });
    emulator.addBackgroundWork(agent.id, {
      taskId: "t2",
      kind: "command",
      description: "pnpm test",
    });
    emulator.addBackgroundWork(agent.id, { taskId: "t3", kind: "mystery" });
    emulator.complete(agent.id, "completed", "Waiting on the subagent and the PRs.");
    const snapshot = await provider.get(agent.id, context);
    // Still working, not handed back: background work and watches hold the job open.
    expect(snapshot.status).toBe("running");
    // A subagent and a command are still going, so this is not a thread only waiting on its pull
    // requests, and the day limit on a lone watch must not stop it.
    expect(snapshot.watching).toBe(true);
    expect(snapshot.watchIdle).toBe(false);
    expect(snapshot.work).toEqual([
      {
        kind: "subagent",
        label: "Review the change",
        url: `t3code://threads/env-1/child%3A1`,
      },
      { kind: "command", label: "pnpm test" },
      { kind: "background_task", label: "" },
    ]);
    // The watched pull requests are listed as pull requests, not also as tasks.
    expect(snapshot.pullRequests?.map((pr) => [pr.number, pr.watching])).toEqual([
      [71, true],
      [72, true],
      [73, true],
    ]);
  });

  it("returns the finished run's final message, bounded, from the thread timeline", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "result-key-123456", prompt: "Task" },
      context,
    );
    expect(await provider.get(agent.id, context)).not.toHaveProperty("result");
    emulator.complete(agent.id, "completed", `Done. ${"x".repeat(5_000)}`);
    const done = await provider.get(agent.id, context);
    expect(done.status).toBe("finished");
    expect(done.result).toHaveLength(5_006);
    expect(done.result).toMatch(/^Done\. x/);
  });

  it("reports the agent's latest message as progress while it works, and only when something new happened", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "progress-key-1234", prompt: "Task" },
      context,
    );
    expect(await provider.get(agent.id, context)).not.toHaveProperty("progress");
    emulator.say(agent.id, "Reading the router");
    const first = await provider.get(agent.id, context);
    expect(first).toMatchObject({ status: "running", progress: "Reading the router" });
    // Nothing new since the cursor: no timeline read, and no progress to overwrite the last line.
    const reads = () =>
      launched(emulator, "t3_thread_read").filter((call) => call.args.limit === 100).length;
    const before = reads();
    const quiet = await provider.get(agent.id, context, undefined, first.cursor);
    expect(quiet).not.toHaveProperty("progress");
    expect(reads()).toBe(before);
    emulator.say(agent.id, "Writing the tests");
    emulator.say(agent.id, `Almost there ${"x".repeat(2_000)}`);
    const later = await provider.get(agent.id, context, undefined, first.cursor);
    expect(later.progress).toMatch(/^Almost there x/);
    expect(later.progress).toHaveLength(1_000);
    emulator.complete(agent.id, "completed", "All done.");
    expect(await provider.get(agent.id, context, undefined, later.cursor)).not.toHaveProperty(
      "progress",
    );
  });

  it("shows no progress rather than a stale older line when the timeline is longer than the read cap", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "progress-long-1234", prompt: "Task" },
      context,
    );
    // The timeline pages 100 at a time and progress reads 3 pages, so 350 items outrun it.
    for (let item = 0; item < 350; item += 1) emulator.say(agent.id, `Step ${item}`);
    expect(await provider.get(agent.id, context)).not.toHaveProperty("progress");
  });

  it("keeps the start and the end of a result longer than the limit", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "long-result-1234", prompt: "Task" },
      context,
    );
    emulator.complete(
      agent.id,
      "completed",
      `START ${"x".repeat(20_000)} CONCLUSION: the app is already gone.`,
    );
    const { result } = await provider.get(agent.id, context);
    expect(result).toHaveLength(8_000 + "\n…\n".length + 3_500);
    expect(result).toMatch(/^START x/);
    expect(result).toMatch(/\n…\n/);
    expect(result).toMatch(/CONCLUSION: the app is already gone\.$/);
  });

  it("finishes without a result when the timeline cannot be read", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "noresult-key-12345", prompt: "Task" },
      context,
    );
    emulator.complete(agent.id, "completed", "Done.");
    emulator.failNext = { invalidParams: true, tool: "t3_thread_read" };
    const done = await provider.get(agent.id, context);
    expect(done.status).toBe("finished");
    expect(done).not.toHaveProperty("result");
  });

  it("finishes without a result when the bot's assignment leaves out the timeline read", async () => {
    const emulator = new T3ThreadEventsEmulator();
    const connector = t3EmulatorConnector(emulator);
    const provider = new T3CloudAgentProvider({
      connector: {
        ...connector,
        resolveCall: async (call, callContext) =>
          call.tool === "mcp__t3__t3_thread_read"
            ? undefined
            : connector.resolveCall!(call, callContext),
      },
      server: "t3",
      holdKey: "hold",
    });
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "unassigned-key-1234", prompt: "Task" },
      context,
    );
    emulator.complete(agent.id, "completed", "Done.");
    const done = await provider.get(agent.id, context);
    expect(done.status).toBe("finished");
    expect(done).not.toHaveProperty("result");
  });

  it("finishes without a result when the timeline runs past the read cap", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "longthread-key-1234", prompt: "Task" },
      context,
    );
    const thread = emulator.threads.get(agent.id)!;
    const runId = thread.runs.at(-1)!.runId;
    // An early message from this run, then more than ten pages of other items.
    thread.timeline.push({ type: "assistant_message", runId, text: "Halfway there." });
    for (let item = 0; item < 1_000; item += 1)
      thread.timeline.push({ type: "tool_call", runId, text: "" });
    emulator.complete(agent.id, "completed", "Done.");
    const done = await provider.get(agent.id, context);
    expect(done.status).toBe("finished");
    expect(done).not.toHaveProperty("result");
  });

  it("reports a failed run as failed", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "failing-key-1", prompt: "Task" },
      context,
    );
    emulator.complete(agent.id, "failed");
    expect((await provider.get(agent.id, context)).status).toBe("failed");
  });

  it("sends a pool named as provider as the instance and says what started", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      {
        scratch: true,
        idempotencyKey: "pool-key-123456",
        prompt: "Task",
        modelSelection: { provider: "claude-pool", model: "claude-model" },
      },
      context,
    );
    expect(launched(emulator)[0]!.args.modelSelection).toEqual({
      instanceId: "claude-pool",
      model: "claude-model",
    });
    expect(agent.launchNote).toBe("Started claude-model on claude-pool.");
  });

  it("says so when T3 started a different model than the one asked for", async () => {
    const { emulator, provider } = setup();
    emulator.startsOn = { model: "fallback-model", providerInstanceId: "agent-b" };
    const agent = await provider.launch(
      {
        scratch: true,
        idempotencyKey: "mismatch-key-1",
        prompt: "Task",
        modelSelection: { instanceId: "claude-pool", model: "claude-model" },
      },
      context,
    );
    expect(agent.launchNote).toBe(
      "Requested claude-model on claude-pool, T3 started fallback-model on agent-b.",
    );
  });

  it("starts the thread under the connection's ceiling when it refuses a broader runtime mode", async () => {
    const { emulator, provider } = setup();
    emulator.runtimeCeiling = "auto";
    const agent = await provider.launch(
      {
        scratch: true,
        idempotencyKey: "ceiling-key-12",
        prompt: "Task",
        runtimeMode: "full-access",
      },
      context,
    );
    const launches = launched(emulator);
    expect(launches.map((call) => call.args.runtimeMode)).toEqual(["full-access", undefined]);
    expect(emulator.threads.has(agent.id)).toBe(true);
    // A mode within the ceiling is passed on as asked.
    await provider.launch(
      { scratch: true, idempotencyKey: "within-key-123", prompt: "Task", runtimeMode: "auto" },
      context,
    );
    expect(launched(emulator).at(-1)!.args.runtimeMode).toBe("auto");
  });

  it("follows a reply up as the next run and cancels", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "reply-key-1234", prompt: "Task" },
      context,
    );
    emulator.complete(agent.id);
    expect((await provider.get(agent.id, context)).status).toBe("finished");
    const followup = await provider.reply(
      agent.id,
      { prompt: "Also add tests", idempotencyKey: "reply-1" },
      context,
    );
    expect(followup).toMatchObject({ status: "running" });
    expect(followup.latestRunId).not.toBe(agent.latestRunId);
    expect(emulator.calls.at(-1)).toMatchObject({
      tool: "t3_thread_send",
      args: { threadId: agent.id, mode: "queue", clientRequestId: "reply-1" },
    });
    expect((await provider.get(agent.id, context)).latestRunId).toBe(followup.latestRunId);

    const cancelled = await provider.cancel(agent.id, context);
    expect(["running", "cancelled"]).toContain(cancelled.status);
    expect((await provider.cancel(agent.id, context)).status).toBe("cancelled");
  });

  it("reads the thread link in T3's web form as well as its deep link", async () => {
    const { emulator, provider } = setup();
    emulator.linkOf = (threadId) =>
      `https://app.example.test/threads/env-1/${encodeURIComponent(threadId)}`;
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "weblink-key-123", prompt: "Task" },
      context,
    );
    const url = `t3code://threads/env-1/${encodeURIComponent(agent.id)}`;
    expect(agent.url).toBe(url);
    expect((await provider.get(agent.id, context)).url).toBe(url);
  });

  it("reports a pending approval as attention", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { scratch: true, idempotencyKey: "attention-key-1", prompt: "Task" },
      context,
    );
    emulator.awaitApproval(agent.id);
    expect((await provider.get(agent.id, context)).attention).toEqual([
      { requestId: "request-1", kind: "approval" },
    ]);
  });

  describe("when T3 cannot be reached or refuses", () => {
    it("asks to retry later when the server is unreachable or fails, on every call", async () => {
      const { emulator, provider, unreachable } = setup();
      const agent = await provider.launch(
        { scratch: true, idempotencyKey: "down-key-12345", prompt: "Task" },
        context,
      );
      // A server error, a refused sign-in and a lost response each leave the call to be retried.
      for (const failNext of [{ status: 503 }, { status: 401 }]) {
        emulator.failNext = failNext;
        await expect(provider.get(agent.id, context)).rejects.toBeInstanceOf(CloudAgentRetryLater);
      }
      unreachable();
      await expect(provider.get(agent.id, context)).rejects.toBeInstanceOf(CloudAgentRetryLater);
      await expect(provider.reply(agent.id, { prompt: "More" }, context)).rejects.toBeInstanceOf(
        CloudAgentRetryLater,
      );
      await expect(provider.cancel(agent.id, context)).rejects.toBeInstanceOf(CloudAgentRetryLater);
      await expect(
        provider.launch(
          { scratch: true, idempotencyKey: "down-key-67890", prompt: "Task" },
          context,
        ),
      ).rejects.toBeInstanceOf(CloudAgentRetryLater);
      expect(launched(emulator)).toHaveLength(1);
    });

    it("rejects as not found for a thread T3 does not know, and as invalid for a refusal", async () => {
      const { emulator, provider } = setup();
      await expect(provider.get("thread-unknown", context)).rejects.toMatchObject({
        reason: "not_found",
      });
      emulator.failNext = { failure: "invalid_request" };
      await expect(
        provider.launch(
          { scratch: true, idempotencyKey: "refused-key-12", prompt: "Task" },
          context,
        ),
      ).rejects.toBeInstanceOf(CloudAgentRequestRejected);
    });

    it("retries T3's codeless internal server error instead of rejecting it", async () => {
      const { emulator, provider } = setup();
      const agent = await provider.launch(
        { scratch: true, idempotencyKey: "internal-key-12", prompt: "Task" },
        context,
      );
      emulator.failNext = { internal: true };
      await expect(provider.get(agent.id, context)).rejects.toBeInstanceOf(CloudAgentRetryLater);
      expect((await provider.get(agent.id, context)).status).toBe("running");
    });

    it("launches without a start note when T3 cannot say what started", async () => {
      const { emulator, provider } = setup();
      emulator.failNext = { failure: "orchestration_error", tool: "t3_thread_read" } as never;
      const agent = await provider.launch(
        {
          scratch: true,
          idempotencyKey: "noread-key-123",
          prompt: "Task",
          modelSelection: { instanceId: "claude-pool", model: "claude-model" },
        },
        context,
      );
      expect(agent).not.toHaveProperty("launchNote");
    });
  });

  describe("model routes", () => {
    const routes = {
      hard: [
        { instanceId: "pool-a", model: "model-1" },
        { instanceId: "pool-b", model: "model-2", options: [{ id: "effort", value: "high" }] },
      ],
    };
    const reset = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const hardRequest = (key: string, extra = {}) => ({
      scratch: true,
      idempotencyKey: key,
      prompt: "Task",
      workKind: "hard" as const,
      ...extra,
    });
    function routed() {
      const { emulator, provider: _plain } = setup();
      emulator.providers = [
        { providerInstanceId: "pool-a", models: [{ id: "model-1" }], constraints: [] },
        { providerInstanceId: "pool-b", models: [{ id: "model-2" }], constraints: [] },
      ];
      return { emulator, provider: t3EmulatedProvider(emulator, routes) };
    }
    const retryAfter = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(CloudAgentRetryLater);
      return error as CloudAgentRetryLater;
    };

    it("picks the first route when it has quota room", async () => {
      const { emulator, provider } = routed();
      const agent = await provider.launch(hardRequest("route-first-123"), context);
      expect(launched(emulator)[0]!.args.modelSelection).toEqual({
        instanceId: "pool-a",
        model: "model-1",
      });
      expect(agent.launchNote).toBe("Picked model-1 on pool-a (hard).");
    });

    it("skips an exhausted model and says so", async () => {
      const { emulator, provider } = routed();
      emulator.providers[0]!.models = [{ id: "model-1", exhausted: true, resetsAt: reset }];
      const agent = await provider.launch(hardRequest("route-skip-1234"), context);
      expect(launched(emulator)[0]!.args.modelSelection).toEqual({
        instanceId: "pool-b",
        model: "model-2",
        options: [{ id: "effort", value: "high" }],
      });
      expect(agent.launchNote).toMatch(
        /^Picked model-2 on pool-b \(hard; model-1 out of quota until \d\d:\d\d UTC; effort high\)\.$|^Picked model-2 on pool-b \(hard; model-1 out of quota until \d{4}-\d\d-\d\d \d\d:\d\d UTC; effort high\)\.$/,
      );
    });

    it("waits for the earliest reset when every route is out, then launches", async () => {
      const { emulator, provider } = routed();
      const soon = new Date(Date.now() + 30 * 60_000).toISOString();
      emulator.providers[0]!.models = [{ id: "model-1", exhausted: true, resetsAt: reset }];
      emulator.providers[1]!.models = [{ id: "model-2", exhausted: true, resetsAt: soon }];
      const waiting = await retryAfter(provider.launch(hardRequest("route-wait-1234"), context));
      expect(waiting.reason).toBe("quota");
      expect(waiting.retryAfterMs).toBeGreaterThan(29 * 60_000);
      expect(waiting.retryAfterMs).toBeLessThanOrEqual(30 * 60_000);
      expect(waiting.note).toMatch(/^Waiting for quota until \d/);
      expect(launched(emulator)).toHaveLength(0);
      // The reset passes: the retry launches on the first route again.
      emulator.providers[0]!.models = [{ id: "model-1" }];
      const agent = await provider.launch(hardRequest("route-wait-1234"), context);
      expect(agent.launchNote).toBe("Picked model-1 on pool-a (hard).");
    });

    it("bounds a wait to six hours and at least a minute", async () => {
      const { emulator, provider } = routed();
      const week = new Date(Date.now() + 7 * 86_400_000).toISOString();
      emulator.providers[0]!.models = [{ id: "model-1", exhausted: true, resetsAt: week }];
      emulator.providers[1]!.models = [{ id: "model-2", exhausted: true, resetsAt: week }];
      expect(
        (await retryAfter(provider.launch(hardRequest("route-cap-12345"), context))).retryAfterMs,
      ).toBe(6 * 3_600_000);
      emulator.providers[0]!.models = [{ id: "model-1", exhausted: true }];
      emulator.providers[1]!.models = [
        { id: "model-2", exhausted: true, resetsAt: new Date(Date.now() + 1_000).toISOString() },
      ];
      expect(
        (await retryAfter(provider.launch(hardRequest("route-min-12345"), context))).retryAfterMs,
      ).toBe(60_000);
    });

    it("reads the reset from the provider's window or T3's earliest when the model has none", async () => {
      const { emulator, provider } = routed();
      emulator.providers[0]!.models = [{ id: "model-1", exhausted: true }];
      emulator.providers[0]!.usage = {
        windows: [{ id: "primary", usedPercent: 100, resetsAt: reset, exhausted: true }],
      };
      emulator.providers[1]!.models = [{ id: "model-2", exhausted: true }];
      emulator.earliestResetAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
      const waiting = await retryAfter(provider.launch(hardRequest("route-window-12"), context));
      expect(waiting.retryAfterMs).toBeGreaterThan(110 * 60_000);
      expect(waiting.retryAfterMs).toBeLessThanOrEqual(120 * 60_000);
    });

    it("honours a named model over the routes", async () => {
      const { emulator, provider } = routed();
      emulator.providers[0]!.models = [{ id: "model-1", exhausted: true, resetsAt: reset }];
      const agent = await provider.launch(
        hardRequest("route-named-123", {
          modelSelection: { instanceId: "pool-b", model: "model-2" },
        }),
        context,
      );
      expect(launched(emulator)[0]!.args.modelSelection).toEqual({
        instanceId: "pool-b",
        model: "model-2",
      });
      expect(agent.launchNote).toBe("Started model-2 on pool-b.");
    });

    it("waits when the named model is out of quota", async () => {
      const { emulator, provider } = routed();
      emulator.providers[1]!.models = [{ id: "model-2", exhausted: true, resetsAt: reset }];
      const waiting = await retryAfter(
        provider.launch(
          hardRequest("route-named-out", {
            modelSelection: { instanceId: "pool-b", model: "model-2" },
          }),
          context,
        ),
      );
      expect(waiting.note).toContain("model-2 is out of quota");
      expect(launched(emulator)).toHaveLength(0);
    });

    it("takes the first route when T3 reports no quota", async () => {
      const { emulator, provider } = routed();
      const agent = await provider.launch(hardRequest("route-nousage-12"), context);
      expect(launched(emulator)[0]!.args.modelSelection).toMatchObject({ model: "model-1" });
      expect(agent.launchNote).toBe("Picked model-1 on pool-a (hard).");
    });

    it("leaves a launch without a work kind, or a kind without routes, as it was", async () => {
      const { emulator, provider } = routed();
      emulator.providers[0]!.models = [{ id: "model-1", exhausted: true, resetsAt: reset }];
      const plain = await provider.launch(
        { scratch: true, idempotencyKey: "route-plain-123", prompt: "Task" },
        context,
      );
      expect(plain).not.toHaveProperty("launchNote");
      const unrouted = await provider.launch(
        { scratch: true, idempotencyKey: "route-simple-12", prompt: "Task", workKind: "simple" },
        context,
      );
      expect(unrouted).not.toHaveProperty("launchNote");
      expect(launched(emulator).map((call) => call.args.modelSelection)).toEqual([
        { instanceId: "pool-a", model: "model-1" },
        { instanceId: "pool-a", model: "model-1" },
      ]);
    });
  });
});

describe("T3 thread placement over the T3 MCP emulator (offline)", () => {
  const launchOn = (
    emulator: T3ThreadEventsEmulator,
    provider: ReturnType<typeof setup>["provider"],
    key: string,
    extra: Record<string, unknown>,
  ) => provider.launch({ idempotencyKey: `${key}-123456789`, prompt: "Task", ...extra }, context);
  const projectOfLaunch = (emulator: T3ThreadEventsEmulator) =>
    launched(emulator).at(-1)!.args.projectId;

  it("finds the project by title, repository name or folder name, ignoring case", async () => {
    const { emulator, provider } = setup();
    emulator.projects.push({
      id: "project-mac",
      title: "Mac",
      workspaceRoot: "/Users/someone/.dotfiles",
      repositoryIdentity: { canonicalKey: "github.com/example/dotfiles" },
    });
    for (const [name, id] of [
      ["DEMO", "project-demo"],
      ["Example/Demo", "project-demo"],
      ["mac", "project-mac"],
      ["Dotfiles", "project-mac"],
      [".dotfiles", "project-mac"],
    ] as const) {
      await launchOn(emulator, provider, name.replace(/\W/g, ""), { project: name });
      expect(projectOfLaunch(emulator)).toBe(id);
    }
  });

  it("refuses an unknown or ambiguous name with the candidates, before launching", async () => {
    const { emulator, provider } = setup();
    emulator.projects.push({
      id: "project-demo-2",
      title: "Demo",
      workspaceRoot: "/srv/demo-copy",
      repositoryIdentity: null,
    });
    const refusals = [
      [{ project: "nothing" }, /No project matches "nothing"\..*Projects: other, demo, Demo/],
      [{ project: "demo" }, /matches several projects\..*Projects: other, demo, Demo/],
    ] as const;
    for (const [extra, detail] of refusals) {
      const error = (await launchOn(emulator, provider, "refused", extra).catch(
        (caught: unknown) => caught,
      )) as CloudAgentRequestRejected;
      expect(error).toBeInstanceOf(CloudAgentRequestRejected);
      expect(error.detail).toMatch(detail);
    }
    expect(launched(emulator)).toHaveLength(0);
  });

  it("refuses a launch with no project unless it asks for scratch", async () => {
    const { emulator, provider } = setup();
    const error = (await launchOn(emulator, provider, "noproject", {}).catch(
      (caught: unknown) => caught,
    )) as CloudAgentRequestRejected;
    expect(error).toBeInstanceOf(CloudAgentRequestRejected);
    expect(error.detail).toMatch(/No project given.*scratch: true.*Projects: other, demo/);
    expect(launched(emulator)).toHaveLength(0);
    await launchOn(emulator, provider, "scratch", { scratch: true });
    expect(launched(emulator).at(-1)!.args).toMatchObject({ scratch: true });
    expect(launched(emulator).at(-1)!.args).not.toHaveProperty("projectId");
  });

  it("keeps an explicit projectId working, and passes over archived projects", async () => {
    const { emulator, provider } = setup();
    await launchOn(emulator, provider, "byid", { projectId: "project-other" });
    expect(projectOfLaunch(emulator)).toBe("project-other");
    emulator.projects.find((project) => project.id === "project-demo")!.archivedAt =
      "2026-01-01T00:00:00.000Z";
    const error = (await launchOn(emulator, provider, "archived", { project: "demo" }).catch(
      (caught: unknown) => caught,
    )) as CloudAgentRequestRejected;
    expect(error.detail).toMatch(/No project matches "demo"\. Projects: other\./);
  });
});
