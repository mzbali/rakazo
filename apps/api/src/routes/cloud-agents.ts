import { cloudAgentBlock } from "@rakazo/adapters";
import type { RouterContext } from "./context.js";

const JOBS_LIMIT = 100;

export function cloudAgentsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    cloudAgents: {
      list: authed.cloudAgents.list.handler(async ({ context }) => {
        const { spaceId, userId } = context.actor;
        const agents = await deps.prisma.cloudAgent.findMany({
          where: { spaceId, userId },
          orderBy: { createdAt: "desc" },
          take: JOBS_LIMIT,
        });
        const bots = await deps.prisma.bot.findMany({
          where: { spaceId, id: { in: [...new Set(agents.map((agent) => agent.botId))] } },
          select: { id: true, name: true },
        });
        const names = new Map(bots.map((bot) => [bot.id, bot.name]));
        return agents.map((agent) => {
          const { kind: _kind, ...job } = cloudAgentBlock(agent);
          return {
            ...job,
            botId: agent.botId,
            botName: names.get(agent.botId) ?? "",
            threadId: agent.threadId,
          };
        });
      }),
    },
  };
}
