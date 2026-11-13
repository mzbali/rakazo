import type { AdapterContext, ConnectorProvider } from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { T3CloudAgentProvider, t3CanonicalLink, t3DirectThread } from "./t3-cloud-agent.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};

type Handler = (args: Record<string, unknown>) => unknown;

/**
 * A refused call exactly as T3's MCP server sends it: the encoded failure is JSON in the one
 * text block, with no structured content.
 */
const T3_MESSAGES: Record<string, string> = {
  runtime_mode_escalation_denied:
    "Child runtime mode full-access is broader than parent mode auto.",
};

function t3Failure(code: string, message: string) {
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ _tag: "OrchestratorMcpFailure", code, message }) },
    ],
  };
}

/**
 * An offline stand-in for the T3 MCP server: each tool answers from the test's script.
 * A string failure repeats. A list is used once each, then the handler answers.
 */
function server(
  handlers: Record<string, Handler>,
  failing: Record<string, string | string[]> = {},
) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const scripted = new Map<string, string[]>();
  for (const [tool, code] of Object.entries(failing)) {
    if (Array.isArray(code)) scripted.set(tool, [...code]);
  }
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
      const queued = scripted.get(tool);
      const code = queued?.length ? queued.shift() : failing[tool];
      if (typeof code === "string") {
        yield {
          type: "result" as const,
          data: t3Failure(code, T3_MESSAGES[code] ?? `Refused: ${code}.`),
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

  it("starts the thread on the named model, project, workspace and modes, else on defaults", async () => {
    const projects = () => ({
      projects: [
        {
          id: "project:1",
          defaultModelSelection: { instanceId: "codex", model: "project-default" },
          repositoryIdentity: { webUrl: "https://github.com/example/demo" },
        },
        { id: "project:2", repositoryIdentity: { webUrl: "https://github.com/example/other" } },
      ],
    });
    const handlers = {
      t3_thread_list: () => ({ threads: [] }),
      t3_project_list: projects,
      orchestrator_capabilities: () => ({
        providers: [{ providerInstanceId: "codex", canRunChildTask: true, models: [{ id: "m" }] }],
      }),
      t3_thread_launch: () => ({ threadId: "thread:1", runId: "run:1" }),
    };
    const named = server(handlers);
    const modelSelection = {
      provider: "claudeAgent",
      instanceId: "claude-pool",
      model: "claude-model",
      options: [{ id: "effort", value: "high" }],
    };
    await named.provider.launch(
      {
        idempotencyKey: "abcdef123456",
        prompt: "Fix it",
        projectId: "project:2",
        modelSelection,
        workspaceStrategy: { type: "existing_worktree", worktreePath: "/work/tree" },
        runtimeMode: "full-access",
        interactionMode: "plan",
      },
      context,
    );
    // The model is in the launch itself, not set by a later call, and no default is looked up.
    expect(named.calls.map((call) => call.tool)).toEqual([
      "t3_thread_list",
      "t3_project_list",
      "t3_thread_launch",
    ]);
    expect(named.calls.at(-1)!.args).toEqual({
      title: "Fix it · abcdef123456",
      message: "Fix it",
      clientRequestId: "abcdef123456",
      modelSelection,
      projectId: "project:2",
      workspaceStrategy: { type: "existing_worktree", worktreePath: "/work/tree" },
      runtimeMode: "full-access",
      interactionMode: "plan",
    });

    // Left out, each keeps today's default: the repository's project, its own model, a new worktree.
    const defaults = server(handlers);
    await defaults.provider.launch(
      {
        idempotencyKey: "abcdef123456",
        prompt: "Fix it",
        repository: "https://github.com/example/demo",
      },
      context,
    );
    expect(defaults.calls.at(-1)!.args).toEqual({
      title: "Fix it · abcdef123456",
      message: "Fix it",
      clientRequestId: "abcdef123456",
      projectId: "project:1",
      workspaceStrategy: { type: "worktree", baseRef: "origin/HEAD", startFromOrigin: true },
    });

    // A workspace without a project, or a project that is not the named repository's, starts nothing.
    for (const request of [
      { workspaceStrategy: { type: "root" as const } },
      { projectId: "project:2", repository: "https://github.com/example/demo" },
    ]) {
      const refused = server(handlers);
      await expect(
        refused.provider.launch(
          { idempotencyKey: "abcdef123456", prompt: "Fix it", ...request },
          context,
        ),
      ).rejects.toBeInstanceOf(CloudAgentRequestRejected);
      expect(refused.calls.map((call) => call.tool)).not.toContain("t3_thread_launch");
    }
  });

  it("relaunches without a mode the connection cannot grant, and stops if that refusal repeats", async () => {
    const handlers = {
      t3_thread_list: () => ({ threads: [] }),
      t3_project_list: () => ({ projects: [{ id: "project:1" }] }),
      t3_thread_launch: () => ({
        threadId: "thread:1",
        link: "[Task](t3-thread://v2/env/thread%3A1)",
        runId: "run:1",
      }),
    };
    const request = {
      idempotencyKey: "abcdef123456",
      prompt: "Fix it",
      projectId: "project:1",
      modelSelection: { provider: "claudeAgent", instanceId: "claude-pool", model: "claude-model" },
      workspaceStrategy: { type: "root" as const },
      runtimeMode: "full-access" as const,
      interactionMode: "plan" as const,
    };
    const narrowed = server(handlers, {
      t3_thread_launch: ["runtime_mode_escalation_denied"],
    });
    expect(await narrowed.provider.launch(request, context)).toMatchObject({
      id: "thread:1",
      url: "t3code://threads/env/thread%3A1",
      status: "running",
    });
    const launches = narrowed.calls.filter((call) => call.tool === "t3_thread_launch");
    expect(launches).toHaveLength(2);
    expect(launches[0]!.args).toMatchObject({
      runtimeMode: "full-access",
      interactionMode: "plan",
    });
    expect(launches[1]!.args).not.toHaveProperty("runtimeMode");
    expect(launches[1]!.args).toMatchObject({ interactionMode: "plan" });

    const both = server(handlers, {
      t3_thread_launch: ["runtime_mode_escalation_denied", "interaction_mode_escalation_denied"],
    });
    await both.provider.launch(request, context);
    const bothLaunches = both.calls.filter((call) => call.tool === "t3_thread_launch");
    expect(bothLaunches).toHaveLength(3);
    expect(bothLaunches[2]!.args).not.toHaveProperty("runtimeMode");
    expect(bothLaunches[2]!.args).not.toHaveProperty("interactionMode");

    const stuck = server(handlers, { t3_thread_launch: "runtime_mode_escalation_denied" });
    const refused = await stuck.provider.launch(request, context).catch((error) => error);
    expect(refused).toBeInstanceOf(CloudAgentRequestRejected);
    expect(refused.detail).toBe("Child runtime mode full-access is broader than parent mode auto.");
    const stuckLaunches = stuck.calls.filter((call) => call.tool === "t3_thread_launch");
    expect(stuckLaunches).toHaveLength(2);
    expect(stuckLaunches[1]!.args).not.toHaveProperty("runtimeMode");
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

  it("keeps T3's reason when a refusal is plain text rather than an encoded failure", async () => {
    const provider = new T3CloudAgentProvider({
      connector: {
        resolveCall: async (call: unknown) => ({ call, tool: {} }),
        async *execute() {
          yield {
            type: "result" as const,
            data: { isError: true, content: [{ type: "text", text: "Project is archived." }] },
          };
        },
      } as unknown as ConnectorProvider,
      server: "t3",
      holdKey: "hold",
    });
    const refused = await provider.get("thread:1", context).catch((error) => error);
    expect(refused).toBeInstanceOf(CloudAgentRequestRejected);
    expect(refused).toMatchObject({ reason: "invalid", detail: "Project is archived." });
  });

  it("finds the thread a bot launched or messaged with T3's own tools", () => {
    const launched = { structuredContent: { threadId: "t-new", runId: null } };
    expect(
      t3DirectThread("t3", "mcp__t3__t3_thread_launch", { title: "Fix login" }, launched),
    ).toEqual({ remoteId: "t-new", title: "Fix login" });
    expect(
      t3DirectThread("t3", "mcp__t3__t3_thread_send", { threadId: "t-old", message: "Go on" }, {}),
    ).toEqual({ remoteId: "t-old", title: "Go on" });
    // Every way of sending is followed; the bot's arguments reach T3 untouched.
    for (const extra of [{ mode: "steer" }, { mode: "restart" }, { freshContext: true }])
      expect(
        t3DirectThread(
          "t3",
          "mcp__t3__t3_thread_send",
          { threadId: "t-old", message: "Go on", ...extra },
          {},
        ),
      ).toEqual({ remoteId: "t-old", title: "Go on" });
    // A failed call, another server, a read or a compaction starts no work.
    expect(
      t3DirectThread(
        "t3",
        "mcp__t3__t3_thread_send",
        { threadId: "t-old", message: " /compact" },
        {},
      ),
    ).toBeUndefined();
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

describe("thread links", () => {
  it("returns canonical links from launch and status", async () => {
    const fixture = server({
      t3_thread_list: () => ({ threads: [] }),
      t3_thread_launch: () => ({
        threadId: "thread:1",
        runId: "r",
        link: "[Task](t3-thread://v2/env/thread%3A1)",
      }),
      t3_thread_events: () => state({ link: "<t3-thread://v2/env/thread%3A1>" }),
    });
    const request = { idempotencyKey: "key", prompt: "task", modelSelection: { model: "m" } };
    expect((await fixture.provider.launch(request, context)).url).toBe(
      "t3code://threads/env/thread%3A1",
    );
    expect((await fixture.provider.get("thread:1", context)).url).toBe(
      "t3code://threads/env/thread%3A1",
    );
  });
  it("extracts the environment from provider links and rewrites only tracked threads", () => {
    const url = t3CanonicalLink("[Task](t3-thread://v2/env-1/thread%3A1)", "thread:1");
    expect(url).toBe("t3code://threads/env-1/thread%3A1");
    expect(t3CanonicalLink("<t3-thread://v2/env-1/thread%3A1>", "thread:1")).toBe(url);
    expect(t3CanonicalLink("<t3-thread://v2/env-1/other>", "thread:1")).toBe("");
    const { provider } = server({});
    const text =
      "[one](t3-thread://v2/env-1/thread%3A1) [two](t3code://threads/project/thread%3A1) [other](t3-thread://v2/env-1/other)";
    expect(provider.canonicalizeLinks(text, "thread:1", url)).toBe(
      `[one](${url}) [two](${url}) [other](t3-thread://v2/env-1/other)`,
    );
    const webLink = "https://app.t3.codes/threads/project/thread%3A1";
    expect(provider.canonicalizeLinks(webLink, "thread:1", url)).toBe(webLink);
  });
});
