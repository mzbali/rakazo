import { ORPCError } from "@orpc/server";
import { cloudAgentBlock } from "@rakazo/adapters";
import type { RouterContext } from "./context.js";

const JOBS_LIMIT = 100;
const DETAIL_TEXT_MAX = 6000;
type JobRecord = Parameters<typeof cloudAgentBlock>[0] & { botId: string; threadId: string };

export function cloudAgentsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  async function presentJobs(agents: JobRecord[], spaceId: string) {
    const [bots, threads] = await Promise.all([
      deps.prisma.bot.findMany({
        where: { spaceId, id: { in: [...new Set(agents.map((agent) => agent.botId))] } },
        select: { id: true, name: true },
      }),
      deps.prisma.thread.findMany({
        where: { spaceId, id: { in: [...new Set(agents.map((agent) => agent.threadId))] } },
        select: { id: true, groupId: true, group: { select: { name: true } } },
      }),
    ]);
    const names = new Map(bots.map((bot) => [bot.id, bot.name]));
    const conversations = new Map(threads.map((thread) => [thread.id, thread]));
    return agents.map((agent) => {
      const { kind: _kind, ...job } = cloudAgentBlock(agent);
      const thread = conversations.get(agent.threadId);
      return {
        ...job,
        botId: agent.botId,
        botName: names.get(agent.botId) ?? "",
        threadId: agent.threadId,
        ...(thread?.groupId ? { groupId: thread.groupId, groupName: thread.group?.name } : {}),
      };
    });
  }
  return {
    cloudAgents: {
      list: authed.cloudAgents.list.handler(async ({ context }) => {
        const { spaceId, userId } = context.actor;
        const agents = await deps.prisma.cloudAgent.findMany({
          where: { spaceId, userId },
          orderBy: { createdAt: "desc" },
          take: JOBS_LIMIT,
        });
        return presentJobs(agents, spaceId);
      }),
      detail: authed.cloudAgents.detail.handler(async ({ context, input }) => {
        const { spaceId, userId } = context.actor;
        const agent = await deps.prisma.cloudAgent.findFirst({
          where: { id: input.agentId, spaceId, userId },
        });
        if (!agent) throw new ORPCError("NOT_FOUND");
        const [job] = await presentJobs([agent], spaceId);
        return {
          job: job!,
          ...(agent.launchBrief ? { brief: agent.launchBrief.slice(0, DETAIL_TEXT_MAX) } : {}),
          ...(agent.resultText ? { result: agent.resultText.slice(0, DETAIL_TEXT_MAX) } : {}),
        };
      }),
    },
  };
}
