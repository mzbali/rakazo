import type { AdapterContext, ConnectorCall, ConnectorProvider } from "@rakazo/adapter-kit";
import { T3CloudAgentProvider } from "./t3-cloud-agent.js";
import { T3_TOKEN, T3McpEmulator } from "./t3code-mcp-emulator.test-support.js";

type Args = Record<string, unknown>;
const ACTIVE = ["preparing", "starting", "running", "waiting"];

/**
 * The emulator plus the thread tools the deployment provider polls with: a state read of the
 * thread's runs and requests, and a title search for finding a launch a lost response hid.
 */
export class T3ThreadEventsEmulator extends T3McpEmulator {
  constructor() {
    super();
    this.linkOf = (threadId) => `<t3-thread://v2/env-1/${encodeURIComponent(threadId)}>`;
    for (const name of ["t3_thread_events", "t3_thread_list"])
      this.tools.push({ name, inputSchema: { type: "object", properties: {} } });
  }

  protected override handle(tool: string, args: Args) {
    if (tool === "t3_thread_list") {
      const needle = String(args.titleContains ?? "");
      return {
        result: {
          threads: [...this.threads.values()]
            .filter((thread) => thread.title.includes(needle))
            .map((thread) => ({ threadId: thread.threadId, title: thread.title })),
        },
      };
    }
    if (tool !== "t3_thread_events") return super.handle(tool, args);
    const thread = this.threads.get(String(args.threadId));
    if (!thread) return { failure: "thread_not_found" };
    // A stop has landed by the time the next poll reads.
    this.landInterrupt(thread);
    const latest = thread.runs.at(-1);
    const idle =
      !thread.runs.some((run) => ACTIVE.includes(run.status)) &&
      !thread.runs.some((run) => run.status === "queued" && !run.held);
    return {
      result: {
        contractVersion: 1,
        nextSequence: thread.runs.length,
        hasMore: false,
        gap: null,
        events: [],
        state: {
          idle,
          latestRun: latest ? { runId: latest.runId, status: latest.status } : null,
          pendingRequests:
            thread.pendingRequestCount > 0
              ? [{ threadId: thread.threadId, requestId: "request-1", kind: "approval" }]
              : [],
          link: this.linkOf(thread.threadId),
        },
      },
    };
  }
}

/**
 * A connector that speaks the MCP wire to the emulator's `fetch` as the bot's connection would:
 * a tool's own refusal is a result, an answer that is not one is an error.
 */
export function t3EmulatorConnector(
  emulator: Pick<T3McpEmulator, "fetch">,
  server = "t3",
): ConnectorProvider {
  let session: Promise<string> | undefined;
  let id = 0;
  const nextId = () => {
    id += 1;
    return id;
  };
  const post = (body: Args, sessionId?: string) =>
    emulator.fetch("https://t3.example.test/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${T3_TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
  const open = () =>
    (session ??= post({
      id: nextId(),
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    }).then((response) => response.headers.get("mcp-session-id") ?? ""));
  return {
    describe: () => ({}) as never,
    discoverTools: async () => [],
    resolveCall: async (call: ConnectorCall) => ({ call, tool: { name: call.tool } }),
    async *execute(call: ConnectorCall, _context: AdapterContext) {
      let response: Response;
      try {
        response = await post(
          {
            id: nextId(),
            method: "tools/call",
            params: { name: call.tool.replace(`mcp__${server}__`, ""), arguments: call.args },
          },
          await open(),
        );
      } catch (error) {
        // An unreachable server, as the real connector reports it: worth retrying later.
        yield { type: "error" as const, message: String(error), retryable: true };
        return;
      }
      // A refused sign-in or an outage is the connection's to mend, so it is retryable too.
      if (!response.ok)
        yield { type: "error" as const, message: `HTTP ${response.status}`, retryable: true };
      else {
        const body = (await response.json()) as { result?: unknown; error?: { message: string } };
        if (body.error)
          yield { type: "error" as const, message: body.error.message, retryable: false };
        else yield { type: "result" as const, data: body.result };
      }
    },
  } as unknown as ConnectorProvider;
}

export function t3EmulatedProvider(emulator: Pick<T3McpEmulator, "fetch">) {
  return new T3CloudAgentProvider({
    connector: t3EmulatorConnector(emulator),
    server: "t3",
    holdKey: "hold",
  });
}
