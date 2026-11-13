import type { ConnectorTool } from "@rakazo/adapter-kit";

/** A pinned entry names a tool as listed, or an MCP tool by its bare name under any server. */
export function isPinnedTool(
  pinned: readonly string[] | undefined,
  tool: Pick<ConnectorTool, "name" | "route">,
): boolean {
  if (!pinned?.length) return false;
  if (pinned.includes(tool.name)) return true;
  // The route keeps the server's own tool name, so a slug containing "__" cannot shift the split.
  return tool.route?.connectorId === "mcp" && pinned.includes(tool.route.toolName);
}
