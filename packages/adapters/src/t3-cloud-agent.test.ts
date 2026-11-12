import type { AdapterContext, ConnectorProvider } from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { T3CloudAgentProvider, t3DirectThread } from "./t3-cloud-agent.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};

type Handler = (args: Record<string, unknown>) => unknown;

/** An offline stand-in for the T3 MCP server: each tool answers from the test's script. */
function server(handlers: Record<string, Handler>, failing: Record<string, string> = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const connector = {
    describe: () => ({}) as never,
    discoverTools: async () => [],
    resolveCall: async (call: { tool: string; args: Record<string, unknown> }) => ({
      call,
      tool: { name: call.tool },
    }),
    async *execute(call: { tool: string; args: Record<string, unknown> }) {
      const tool = call.tool.replace(/^mcp__t3__/, "");
      calls.push({ tool, args: call.args });
      if (failing[tool]) {
        yield {
          type: "result" as const,
          data: { isError: true, structuredContent: { code: failing[tool] } },
        };
        return;
      }
      yield { type: "result" as const, data: { structuredContent: handlers[tool]!(call.args) } };
    },
  } as unknown as ConnectorProvider;
  const provider = new T3CloudAgentProvider({ connector, server: "t3", holdKey: "hold" });
  return { provider, calls };
}

const state = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  nextSequence: 7,
  hasMore: false,
  gap: null,
  events: [] as unknown[],
  state: {
    idle: false,
    latestRun: { runId: "run:1", status: "running" },
    pendingRequests: [],
    link: "https://example.test/thread",
    ...overrides,
  },
});

describe("T3 cloud agent provider (offline conformance)", () => {
  it("launches once per key: a lost response is found by its title tag, not relaunched", async () => {
    const fresh = server({
      t3_thread_list: () => ({ threads: [] }),
      orchestrator_capabilities: () => ({
        providers: [{ providerInstanceId: "codex", canRunChildTask: true, models: [{ id: "m" }] }],
      }),
      t3_thread_launch: () => ({ threadId: "thread:1", runId: "run:1" }),
    });
    const launched = await fresh.provider.launch(
      { idempotencyKey: "abcdef123456", prompt: "Fix it" },
      context,
    );
    expect(launched).toMatchObject({ id: "thread:1", status: "running" });
    expect(fresh.calls.at(-1)!.args).toMatchObject({
      clientRequestId: "abcdef123456",
      scratch: true,
      modelSelection: { instanceId: "codex", model: "m" },
      title: "Fix it · abcdef123456",
    });

    const retried = server({
      t3_thread_list: () => ({
        threads: [{ threadId: "thread:1", title: "Fix it · abcdef123456" }],
      }),
      t3_thread_events: () =>
        state({ idle: true, latestRun: { runId: "run:1", status: "completed" } }),
    });
    // Already finished, it still reads as running until a poll has read its events.
    expect(
      await retried.provider.launch({ idempotencyKey: "abcdef123456", prompt: "Fix it" }, context),
    ).toMatchObject({ id: "thread:1", status: "running" });
    expect(retried.calls.map((call) => call.tool)).not.toContain("t3_thread_launch");
  });

  it("reads status from the thread's state, pages to the end, and holds the cursor", async () => {
    const request = (requestId: string, requestStatus: string) => ({
      kind: "request",
      requestId,
      requestKind: "user_input",
      requestStatus,
    });
    const pages = [
      { ...state(), hasMore: true, nextSequence: 3, events: [request("q0", "pending")] },
      {
        ...state({
          idle: true,
          latestRun: { runId: "run:2", status: "interrupted" },
          pendingRequests: [{ threadId: "child", requestId: "q1", kind: "user_input" }],
        }),
        // A question that opened and expired between polls is still reported.
        events: [request("q0", "expired"), request("q2", "pending"), request("q2", "resolved")],
      },
    ];
    // The last page's state repeats, with nothing new: a finished thread is read twice before it
    // counts as stopped.
    const last = pages.at(-1)!;
    const t3 = server({ t3_thread_events: () => pages.shift() ?? { ...last, events: [] } });
    const snapshot = await t3.provider.get("thread:1", context, undefined, 1);
    expect(snapshot).toMatchObject({
      status: "failed",
      latestRunId: "run:2",
      cursor: 7,
      historyGap: false,
      attention: [{ requestId: "q1", kind: "question", threadId: "child" }],
      missedAttention: [{ requestId: "q0", kind: "question" }],
    });
    expect(t3.calls.map((call) => call.args.afterSequence)).toEqual([1, 3, 7]);
    expect(t3.calls[0]!.args.retain).toEqual({ key: "hold" });

    // A finished thread with more events than one poll reads stays running until they are read.
    const backlog = server({
      t3_thread_events: () => ({
        ...state({ idle: true, latestRun: { runId: "run:2", status: "completed" } }),
        hasMore: true,
      }),
    });
    expect(await backlog.provider.get("thread:1", context, undefined, 1)).toMatchObject({
      status: "running",
    });
    // So does one whose confirming read found new events.
    const lateEvent = { kind: "request", requestId: "q3", requestStatus: "expired" };
    let reads = 0;
    const late = server({
      t3_thread_events: () => {
        reads += 1;
        return {
          ...state({ idle: true, latestRun: { runId: "run:2", status: "completed" } }),
          events: reads > 1 ? [lateEvent] : [],
        };
      },
    });
    expect(await late.provider.get("thread:1", context, undefined, 1)).toMatchObject({
      status: "running",
    });
  });

  it("answers a subagent's question in its own thread, and accepts one already answered", async () => {
    const t3 = server({
      t3_pending_request: (args) =>
        args.action === "read" ? { questions: [{ id: "color" }] } : { sequence: 1 },
      t3_thread_events: () => state(),
    });
    await t3.provider.reply(
      "thread:1",
      { prompt: "Blue", questionId: "q1", questionThreadId: "child" },
      context,
    );
    expect(t3.calls[1]!.args).toEqual({
      action: "respond",
      threadId: "child",
      requestId: "q1",
      answers: { color: "Blue" },
    });

    const answered = server(
      { t3_thread_events: () => state() },
      { t3_pending_request: "invalid_request" },
    );
    await expect(
      answered.provider.reply("thread:1", { prompt: "Blue", questionId: "q1" }, context),
    ).resolves.toMatchObject({ status: "running" });
  });

  it("maps failures: a missing thread is gone, an outage retries, a stopped thread is cancelled", async () => {
    const gone = server({}, { t3_thread_events: "thread_not_found" });
    await expect(gone.provider.get("thread:1", context)).rejects.toBeInstanceOf(
      CloudAgentRequestRejected,
    );
    const down = server({}, { t3_thread_events: "orchestration_error" });
    await expect(down.provider.get("thread:1", context)).rejects.toBeInstanceOf(
      CloudAgentRetryLater,
    );
    const stopped = server(
      {
        t3_thread_events: () =>
          state({ idle: true, latestRun: { runId: "run:1", status: "interrupted" } }),
      },
      { t3_thread_interrupt: "thread_not_interruptible" },
    );
    await expect(stopped.provider.cancel("thread:1", context)).resolves.toMatchObject({
      status: "cancelled",
    });
  });

  it("finds the thread a bot launched or messaged with T3's own tools", () => {
    const launched = { structuredContent: { threadId: "t-new", runId: null } };
    expect(
      t3DirectThread("t3", "mcp__t3__t3_thread_launch", { title: "Fix login" }, launched),
    ).toEqual({ remoteId: "t-new", title: "Fix login" });
    expect(
      t3DirectThread("t3", "mcp__t3__t3_thread_send", { threadId: "t-old", message: "Go on" }, {}),
    ).toEqual({ remoteId: "t-old", title: "Go on" });
    // A failed call, another server or a read starts nothing.
    expect(
      t3DirectThread("t3", "mcp__t3__t3_thread_send", { threadId: "t-old" }, { isError: true }),
    ).toBeUndefined();
    expect(
      t3DirectThread("t3", "mcp__t3__t3_thread_send", { threadId: "t-old" }, { error: "Refused" }),
    ).toBeUndefined();
    expect(t3DirectThread("t3", "mcp__other__t3_thread_launch", {}, launched)).toBeUndefined();
    expect(
      t3DirectThread("t3", "mcp__t3__t3_thread_read", { threadId: "t-old" }, {}),
    ).toBeUndefined();
  });
});
