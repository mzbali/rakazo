import type { AdapterContext, ConnectorEvent } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { XaiXSearchDeps } from "./xai-x-search-connector.js";
import { XaiXSearchConnector } from "./xai-x-search-connector.js";

const context: AdapterContext = {
  operationId: "operation",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};

const credential = {
  id: "credential",
  userId: "user",
  provider: "xai",
  label: "xAI",
  secretId: "secret",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function connector(options: { connected?: boolean; response?: Response } = {}) {
  const fetch = vi.fn(async () => options.response ?? Response.json(sampleResponse));
  const prisma = {
    userModelPreference: { findMany: async () => [] },
    userModelCredential: {
      findMany: async () => (options.connected === false ? [] : [credential]),
    },
    secret: { findFirst: async () => ({ id: "secret", ciphertext: "ciphertext" }) },
    $transaction: async () => {
      throw new Error("an API key never takes the refresh lock");
    },
  } as unknown as XaiXSearchDeps["prisma"];
  // A plain stored string is an API key, so no sign-in refresh runs.
  const secrets = { load: async () => "synthetic-xai-key", put: vi.fn(), delete: vi.fn() };
  return { provider: new XaiXSearchConnector({ prisma, secrets, fetch }), fetch };
}

const sampleResponse = {
  output: [
    { type: "reasoning" },
    { type: "custom_tool_call", name: "x_search" },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "Two posts discuss the release.",
          annotations: [
            { type: "url_citation", url: "https://x.com/a/status/1" },
            { type: "url_citation", url: "https://example.test/elsewhere" },
          ],
        },
      ],
    },
  ],
  citations: ["https://x.com/a/status/1", "https://x.com/b/status/2"],
  usage: { server_side_tool_usage_details: { x_search_calls: 2 } },
};

async function run(provider: XaiXSearchConnector, args: Record<string, unknown>) {
  const events: ConnectorEvent[] = [];
  for await (const event of provider.execute(
    { tool: "x_search", args, executionId: "execution" },
    context,
  )) {
    events.push(event);
  }
  return events;
}

describe("xAI X search connector", () => {
  it("offers x_search only with an xAI connection", async () => {
    const tools = await connector().provider.discoverTools(context);
    expect(tools.map((tool) => [tool.name, tool.readOnly])).toEqual([["x_search", true]]);
    expect(await connector({ connected: false }).provider.discoverTools(context)).toEqual([]);
  });

  it("sends the query and filters to the Responses API", async () => {
    const { provider, fetch } = connector();
    await run(provider, {
      query: " new model releases ",
      handles: ["@xai", "OpenAI"],
      fromDate: "2026-11-01",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-xai-key");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "grok-4.3",
      instructions: expect.stringContaining("always search first"),
      // The model never sees the tool's filters, so the question states them too.
      input: "new model releases\n\nSearch only posts from @xai, @OpenAI, dated from 2026-11-01.",
      tools: [{ type: "x_search", allowed_x_handles: ["xai", "OpenAI"], from_date: "2026-11-01" }],
      store: false,
    });
  });

  it("returns the answer with each X post link once", async () => {
    expect(await run(connector().provider, { query: "release" })).toEqual([
      {
        type: "result",
        data: {
          answer: "Two posts discuss the release.",
          posts: ["https://x.com/a/status/1", "https://x.com/b/status/2"],
          xSearchCalls: 2,
        },
      },
    ]);
  });

  it("rejects bad arguments before calling xAI", async () => {
    const { provider, fetch } = connector();
    for (const args of [
      { query: " " },
      { query: "q", handles: ["not a handle"] },
      { query: "q", handles: ["a"], excludeHandles: ["b"] },
      { query: "q", toDate: "9 Nov" },
    ]) {
      const [event] = await run(provider, args);
      expect(event?.type).toBe("error");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an HTTP failure without the response body", async () => {
    const response = new Response("secret-looking provider text", { status: 500 });
    const [event] = await run(connector({ response }).provider, { query: "q" });
    expect(event).toEqual({ type: "error", message: "X search failed (HTTP 500)." });
  });

  it("reports an unreadable answer as a failure, not an empty result", async () => {
    const response = new Response("{ cut off", { status: 200 });
    const [event] = await run(connector({ response }).provider, { query: "q" });
    expect(event?.type).toBe("error");
  });

  it("asks for a reconnect when xAI refuses the token", async () => {
    const response = new Response("denied", { status: 401 });
    const [event] = await run(connector({ response }).provider, { query: "q" });
    expect(event?.type).toBe("error");
    expect(JSON.stringify(event)).not.toContain("denied");
  });
});
