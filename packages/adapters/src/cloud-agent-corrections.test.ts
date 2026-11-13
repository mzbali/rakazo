import type { AdapterContext, ConnectorProvider } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@rakazo/db", async (original) => ({
  ...(await original<typeof import("@rakazo/db")>()),
  createThreadMessageInTransaction: vi.fn(async (_tx, input) => ({
    id: "message",
    blocks: input.blocks,
  })),
  appendEventInTransaction: vi.fn(async () => ({ seq: 1, firstResponse: false })),
  withTransactionRetry: (fn: () => unknown) => fn(),
}));

import { executeCloudAgentTool } from "./cloud-agent-service.js";
import { publishMessage } from "./run-messages.js";
import { T3CloudAgentProvider } from "./t3-cloud-agent.js";

const context: AdapterContext & { botId: string } = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};
const run = { id: "run", threadId: "chat", spaceId: "space", botId: "bot", trigger: "user" };

describe("cloud agent corrections", () => {
  it("clamps the launch intent and reports it", async () => {
    let saved: Record<string, unknown> = {};
    const provider = {
      describe: () => ({ capabilities: { launch: true, reply: true, cancel: true } }),
    };
    const tx = {
      thread: { update: vi.fn() },
      $executeRaw: vi.fn(),
      cloudAgent: {
        findUnique: vi.fn(async () => null),
        count: vi.fn(async () => 0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          saved = data;
          return {
            ...data,
            id: "agent",
            status: "running",
            url: "",
            queuedAt: null,
            nextPollAt: null,
          };
        }),
        update: vi.fn(async () => ({
          ...saved,
          id: "agent",
          status: "running",
          url: "",
          queuedAt: null,
          nextPollAt: null,
        })),
      },
    };
    const deps = {
      prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) },
      cloudAgent: { key: "key", spaceId: "space", provider },
      jobs: {},
      events: { notify: vi.fn(async () => undefined) },
    };
    const result = await executeCloudAgentTool(deps as never, context, run, "cloud_agent_launch", {
      prompt: "Task",
      runtimeMode: "full-access",
    });
    expect(saved.launchRequest).toMatchObject({ runtimeMode: "auto" });
    expect(result).toHaveProperty("note", "Runtime mode clamped to auto.");
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const connector = {
      resolveCall: async (call: unknown) => ({ call, tool: {} }),
      async *execute(call: { tool: string; args: Record<string, unknown> }) {
        calls.push(call);
        const value = call.tool.endsWith("t3_thread_list")
          ? { threads: [] }
          : { threadId: "thread", runId: "run", link: "<t3-thread://v2/env/thread>" };
        yield { type: "result", data: { structuredContent: value } };
      },
    } as unknown as ConnectorProvider;
    const t3 = new T3CloudAgentProvider({ connector, server: "t3", holdKey: "test" });
    await t3.launch(
      {
        ...(saved.launchRequest as { prompt: string; runtimeMode: "auto" }),
        idempotencyKey: "agent",
        modelSelection: { model: "m" },
      },
      context,
    );
    const launches = calls.filter((call) => call.tool.endsWith("t3_thread_launch"));
    expect(launches).toHaveLength(1);
    expect(launches[0]?.args.runtimeMode).toBe("auto");
  });

  it("saves a tracked thread's corrected link and leaves an unknown thread unchanged", async () => {
    const provider = new T3CloudAgentProvider({
      connector: {} as ConnectorProvider,
      server: "t3",
      holdKey: "test",
    });
    const url = "t3code://threads/env/thread%3A1";
    const agent = {
      providerKey: "key",
      spaceId: "space",
      userId: "user",
      botId: "bot",
      remoteId: "thread:1",
      url,
    };
    const deps = {
      cloudAgent: { key: "key", spaceId: "space", provider },
      prisma: {
        run: { findUnique: async () => ({ userId: "user" }) },
        cloudAgent: { findMany: async () => [agent] },
        $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      },
      events: { notify: vi.fn(async () => undefined) },
    };
    const result = await publishMessage(deps as never, run, "bot", [
      {
        kind: "text",
        text: "[known](t3-thread://v2/env/thread%3A1) [unknown](t3-thread://v2/env/other)",
      },
    ]);
    expect(result?.blocks).toEqual([
      { kind: "text", text: `[known](${url}) [unknown](t3-thread://v2/env/other)` },
    ]);
  });

  it("resolves only connections for referenced agents, once per connection", async () => {
    const provider = new T3CloudAgentProvider({
      connector: {} as ConnectorProvider,
      server: "t3",
      holdKey: "test",
    });
    const agents = ["thread:1", "thread:2", "unrelated"].map((remoteId) => ({
      providerKey: "mcp:connection",
      spaceId: "space",
      userId: "user",
      botId: "bot",
      remoteId,
      url: `t3code://threads/env/${encodeURIComponent(remoteId)}`,
    }));
    const forKey = vi.fn(async () => ({ key: "mcp:connection", provider }));
    const deps = {
      userCloudAgents: { forKey },
      prisma: {
        run: { findUnique: async () => ({ userId: "user" }) },
        cloudAgent: { findMany: async () => agents },
        $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      },
      events: { notify: vi.fn(async () => undefined) },
    };
    await publishMessage(deps as never, run, "bot", [
      { kind: "text", text: "See https://example.test/docs" },
    ]);
    expect(forKey).not.toHaveBeenCalled();
    const result = await publishMessage(deps as never, run, "bot", [
      {
        kind: "text",
        text: "[one](t3-thread://v2/env/thread%3A1) [two](t3-thread://v2/env/thread:2)",
      },
    ]);
    expect(forKey).toHaveBeenCalledTimes(1);
    expect(result?.blocks).toEqual([
      {
        kind: "text",
        text: "[one](t3code://threads/env/thread%3A1) [two](t3code://threads/env/thread%3A2)",
      },
    ]);
  });
});
