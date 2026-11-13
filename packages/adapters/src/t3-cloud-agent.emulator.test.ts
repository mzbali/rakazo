import type { AdapterContext } from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { T3ThreadEventsEmulator, t3EmulatedProvider } from "./t3-cloud-agent.test-support.js";

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
    const request = { idempotencyKey: "abcdef1234567890", prompt: "Add a README\nwith details" };
    const first = await provider.launch(request, context);
    expect(first).toMatchObject({
      status: "running",
      title: "Add a README · abcdef1234567",
      url: expect.stringMatching(/^t3code:\/\/threads\/env-1\//),
    });
    // No model was asked for: T3's first capable provider is used and nothing is reported.
    expect(launched(emulator)[0]!.args).toMatchObject({
      scratch: true,
      modelSelection: { instanceId: "agent-b", model: "model-a" },
    });
    expect(first).not.toHaveProperty("launchNote");
    expect((await provider.get(first.id, context)).status).toBe("running");

    // The same request again finds the thread by its title instead of launching a second.
    expect((await provider.launch(request, context)).id).toBe(first.id);
    expect(launched(emulator)).toHaveLength(1);

    emulator.complete(first.id);
    const done = await provider.get(first.id, context);
    expect(done).toMatchObject({ status: "finished", latestRunId: first.latestRunId });
    emulator.complete(first.id, "failed");
  });

  it("reports a failed run as failed", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { idempotencyKey: "failing-key-1", prompt: "Task" },
      context,
    );
    emulator.complete(agent.id, "failed");
    expect((await provider.get(agent.id, context)).status).toBe("failed");
  });

  it("sends a pool named as provider as the instance and says what started", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      {
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
      { idempotencyKey: "ceiling-key-12", prompt: "Task", runtimeMode: "full-access" },
      context,
    );
    const launches = launched(emulator);
    expect(launches.map((call) => call.args.runtimeMode)).toEqual(["full-access", undefined]);
    expect(emulator.threads.has(agent.id)).toBe(true);
    // A mode within the ceiling is passed on as asked.
    await provider.launch(
      { idempotencyKey: "within-key-123", prompt: "Task", runtimeMode: "auto" },
      context,
    );
    expect(launched(emulator).at(-1)!.args.runtimeMode).toBe("auto");
  });

  it("follows a reply up as the next run and cancels", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { idempotencyKey: "reply-key-1234", prompt: "Task" },
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

  it("reports a pending approval as attention", async () => {
    const { emulator, provider } = setup();
    const agent = await provider.launch(
      { idempotencyKey: "attention-key-1", prompt: "Task" },
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
        { idempotencyKey: "down-key-12345", prompt: "Task" },
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
        provider.launch({ idempotencyKey: "down-key-67890", prompt: "Task" }, context),
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
        provider.launch({ idempotencyKey: "refused-key-12", prompt: "Task" }, context),
      ).rejects.toBeInstanceOf(CloudAgentRequestRejected);
    });

    it("launches without a start note when T3 cannot say what started", async () => {
      const { emulator, provider } = setup();
      emulator.failNext = { failure: "orchestration_error", tool: "t3_thread_read" } as never;
      const agent = await provider.launch(
        {
          idempotencyKey: "noread-key-123",
          prompt: "Task",
          modelSelection: { instanceId: "claude-pool", model: "claude-model" },
        },
        context,
      );
      expect(agent).not.toHaveProperty("launchNote");
    });
  });
});
