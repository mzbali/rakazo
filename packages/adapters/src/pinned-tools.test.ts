import { describe, expect, it } from "vitest";
import { isPinnedTool } from "./pinned-tools.js";

describe("isPinnedTool", () => {
  it("matches a tool by its listed name", () => {
    expect(isPinnedTool(["cloud_agent_launch"], "cloud_agent_launch")).toBe(true);
    expect(isPinnedTool(["mcp__t3__t3_thread_read"], "mcp__t3__t3_thread_read")).toBe(true);
  });

  it("matches an MCP tool by its bare name", () => {
    expect(isPinnedTool(["t3_thread_read"], "mcp__t3__t3_thread_read")).toBe(true);
  });

  it("matches a bare name under any server, but not a different tool", () => {
    expect(isPinnedTool(["search"], "mcp__other__search")).toBe(true);
    expect(isPinnedTool(["t3_thread_send"], "mcp__t3__t3_thread_read")).toBe(false);
  });

  it("does not match a built-in tool or nothing pinned", () => {
    expect(isPinnedTool(["t3_thread_read"], "t3_thread_read_all")).toBe(false);
    expect(isPinnedTool(undefined, "mcp__t3__t3_thread_read")).toBe(false);
    expect(isPinnedTool([], "mcp__t3__t3_thread_read")).toBe(false);
  });
});
