import { describe, expect, it } from "vitest";
import { isPinnedTool } from "./pinned-tools.js";

const mcp = (slug: string, toolName: string) => ({
  name: `mcp__${slug}__${toolName}`,
  route: { connectorId: "mcp", resourceId: "server", toolName, catalogGroup: slug },
});

describe("isPinnedTool", () => {
  it("matches a tool by its listed name", () => {
    expect(isPinnedTool(["cloud_agent_launch"], { name: "cloud_agent_launch" })).toBe(true);
    expect(isPinnedTool(["mcp__t3__t3_thread_read"], mcp("t3", "t3_thread_read"))).toBe(true);
  });

  it("matches an MCP tool by its bare name", () => {
    expect(isPinnedTool(["t3_thread_read"], mcp("t3", "t3_thread_read"))).toBe(true);
  });

  it("keeps the server and tool apart when the slug contains a double underscore", () => {
    expect(isPinnedTool(["search"], mcp("demo__prod", "search"))).toBe(true);
    expect(isPinnedTool(["prod__search"], mcp("demo__prod", "search"))).toBe(false);
  });

  it("matches a bare name under any server, but not a different tool", () => {
    expect(isPinnedTool(["search"], mcp("other", "search"))).toBe(true);
    expect(isPinnedTool(["t3_thread_send"], mcp("t3", "t3_thread_read"))).toBe(false);
  });

  it("does not match a built-in by a prefix, or when nothing is pinned", () => {
    expect(isPinnedTool(["t3_thread_read"], { name: "t3_thread_read_all" })).toBe(false);
    expect(isPinnedTool(undefined, mcp("t3", "t3_thread_read"))).toBe(false);
    expect(isPinnedTool([], mcp("t3", "t3_thread_read"))).toBe(false);
  });
});
