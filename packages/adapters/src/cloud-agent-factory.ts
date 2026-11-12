import { createHash } from "node:crypto";
import type { CloudAgentProvider, ConnectorProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { EmulatorCloudAgentProvider } from "./cloud-agent-emulator.js";
import { resolveCloudAgentProvider } from "./cloud-agent-provider-env.js";
import { CursorCloudAgentProvider } from "./cursor-cloud-agent.js";
import { T3_CLOUD_AGENT_TOOLS, T3CloudAgentProvider, t3DirectThread } from "./t3-cloud-agent.js";

/** The composition root binds a credential to exactly one authorized Space. */
export interface CloudAgentConnection {
  provider: CloudAgentProvider;
  /** Opaque credential binding. Rotation fails closed for existing agents. */
  key: string;
  /** Only the offline emulator may be available in every Space. */
  spaceId?: string;
  /** Providers reached through a bot's own connection offer the tools only to bots that have it. */
  enabledForBot?: (prisma: PrismaClient, spaceId: string, botId: string) => Promise<boolean>;
  /** The remote work a bot started or messaged with the provider's own tools, if this call did. */
  directThread?: (
    tool: string,
    args: Record<string, unknown>,
    result: unknown,
  ) => { remoteId: string; title: string } | undefined;
}

export function cloudAgentsEnabled(
  connection: CloudAgentConnection | null | undefined,
  spaceId: string,
) {
  return Boolean(
    connection &&
      (connection.spaceId === spaceId ||
        (!connection.spaceId && connection.provider.describe().capabilities.offline)),
  );
}

export function createCloudAgentConnection(
  source: NodeJS.ProcessEnv = process.env,
  connector?: ConnectorProvider,
): CloudAgentConnection | null {
  const kind = resolveCloudAgentProvider(source);
  if (kind === "emulator") {
    return { provider: new EmulatorCloudAgentProvider(), key: "emulator" };
  }
  if (kind === "t3") {
    if (!connector) return null;
    const server = source.CLOUD_AGENT_MCP_SERVER!.trim();
    const spaceId = source.CLOUD_AGENT_SPACE_ID!.trim();
    const key = `t3:${spaceId}:${server}`;
    return {
      provider: new T3CloudAgentProvider({ connector, server, holdKey: `rakazo:${spaceId}` }),
      key,
      spaceId,
      enabledForBot: (prisma, botSpaceId, botId) =>
        botHasServerTools(prisma, botSpaceId, botId, server, T3_CLOUD_AGENT_TOOLS),
      directThread: (tool, args, result) => t3DirectThread(server, tool, args, result),
    };
  }
  if (kind !== "cursor") return null;
  const apiKey = source.CURSOR_API_KEY!.trim();
  const spaceId = source.CLOUD_AGENT_SPACE_ID!.trim();
  return {
    provider: new CursorCloudAgentProvider({ apiKey }),
    key: `cursor:${createHash("sha256").update(apiKey).digest("hex")}`,
    spaceId,
  };
}

/** Whether the bot may call every one of these tools on the space's MCP server. */
async function botHasServerTools(
  prisma: PrismaClient,
  spaceId: string,
  botId: string,
  slug: string,
  tools: readonly string[],
): Promise<boolean> {
  const server = await prisma.mcpServer.findFirst({
    where: { spaceId, slug, enabled: true },
    select: { allBots: true, assignments: { where: { botId } } },
  });
  if (!server) return false;
  const assignment = server.assignments[0];
  if (!assignment) return server.allBots;
  const allowed = Array.isArray(assignment.allowedTools) ? assignment.allowedTools : [];
  return assignment.allowAllTools || tools.every((tool) => allowed.includes(tool));
}
