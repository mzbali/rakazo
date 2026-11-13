/** A pinned entry names a tool as listed, or an MCP tool by its bare name under any server. */
export function isPinnedTool(pinned: readonly string[] | undefined, toolName: string): boolean {
  if (!pinned?.length) return false;
  if (pinned.includes(toolName)) return true;
  const bare = /^mcp__.+?__(.+)$/.exec(toolName)?.[1];
  return bare !== undefined && pinned.includes(bare);
}
