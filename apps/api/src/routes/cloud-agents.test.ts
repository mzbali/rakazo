import { beforeEach, expect, it, vi } from "vitest";
import { cloudAgentsRoutes } from "./cloud-agents.js";
import type { RouterContext } from "./context.js";

vi.mock("@rakazo/adapters", () => ({
  cloudAgentBlock: (agent: { id: string; title: string; status: string }) => ({
    kind: "cloud_agent",
    agentId: agent.id,
    title: agent.title,
    status: agent.status,
    url: "",
  }),
}));

const findFirst = vi.fn();
const findMany = vi.fn();
const agent = {
  id: "older-than-recent-list",
  title: "Older job",
  status: "finished",
  botId: "bot",
  threadId: "group-thread",
  bot: { name: "Helper" },
  thread: { groupId: "group", group: { name: "Team" } },
  launchBrief: "Original brief",
  resultText: "Result",
};
const handler = { handler: (fn: unknown) => fn };
const routes = cloudAgentsRoutes({
  deps: {
    prisma: {
      cloudAgent: { findFirst, findMany },
      thread: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "group-thread", groupId: "group", group: { name: "Team" } }]),
      },
      bot: { findMany: vi.fn().mockResolvedValue([{ id: "bot", name: "Helper" }]) },
    },
  },
  authed: { cloudAgents: { list: handler, detail: handler } },
} as unknown as RouterContext).cloudAgents;
const context = { actor: { spaceId: "space", userId: "owner" } };
const invoke = (fn: unknown, input = {}) =>
  (fn as (args: unknown) => Promise<unknown>)({ context, input });

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(agent);
  findMany.mockResolvedValue([agent]);
});
it("fetches an owned job by id independently of the recent list", async () => {
  const result = await invoke(routes.detail, { agentId: agent.id });
  expect(result).toMatchObject({
    job: { agentId: agent.id, groupId: "group", groupName: "Team" },
    brief: "Original brief",
  });
  expect(findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: agent.id, spaceId: "space", userId: "owner" } }),
  );
  expect(findMany).not.toHaveBeenCalled();
});
it("includes the originating group in list rows", async () => {
  expect(await invoke(routes.list)).toMatchObject([
    { groupId: "group", groupName: "Team", threadId: "group-thread" },
  ]);
});
it("does not return another owner's job", async () => {
  findFirst.mockResolvedValue(null);
  await expect(invoke(routes.detail, { agentId: agent.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
