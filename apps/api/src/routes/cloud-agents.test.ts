import { beforeEach, expect, it, vi } from "vitest";
import { cloudAgentsRoutes } from "./cloud-agents.js";
import type { RouterContext } from "./context.js";

const actions = vi.hoisted(() => ({
  answer: vi.fn(),
  steer: vi.fn(),
  stop: vi.fn(),
  Refused: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@rakazo/adapters", () => ({
  answerCloudAgentQuestion: actions.answer,
  steerCloudAgent: actions.steer,
  stopCloudAgent: actions.stop,
  CloudAgentOwnerActionError: actions.Refused,
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
const updateMany = vi.fn();
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
      cloudAgent: { findFirst, findMany, updateMany },
      thread: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "group-thread", groupId: "group", group: { name: "Team" } }]),
      },
      bot: { findMany: vi.fn().mockResolvedValue([{ id: "bot", name: "Helper" }]) },
    },
  },
  authed: {
    cloudAgents: {
      list: handler,
      detail: handler,
      answer: handler,
      steer: handler,
      stop: handler,
      clear: handler,
    },
  },
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

it("acts on a job as the signed-in owner, never as an id from the request", async () => {
  actions.answer.mockResolvedValue({ duplicate: false });
  await invoke(routes.answer, { agentId: "job", requestId: "q1", answer: "main" });
  expect(actions.answer).toHaveBeenCalledWith(expect.anything(), context.actor, {
    agentId: "job",
    requestId: "q1",
    answer: "main",
  });
});
it("tells the owner plainly when a question has closed, and hides jobs that are not theirs", async () => {
  actions.answer.mockRejectedValue(new actions.Refused("stale", "That question has closed."));
  await expect(
    invoke(routes.answer, { agentId: "job", requestId: "q1", answer: "main" }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "That question has closed." });
  actions.stop.mockRejectedValue(new actions.Refused("not_found", "Job not found."));
  await expect(invoke(routes.stop, { agentId: "job" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("lists only jobs the owner has not cleared", async () => {
  await invoke(routes.list);
  expect(findMany.mock.calls[0]?.[0]).toMatchObject({
    where: { spaceId: "space", userId: "owner", clearedAt: null },
  });
});

it("clears only a finished job with nothing waiting on the owner", async () => {
  updateMany.mockResolvedValueOnce({ count: 1 });
  expect(await invoke(routes.clear, { agentId: agent.id })).toEqual({ duplicate: false });
  expect(updateMany).toHaveBeenCalledWith({
    where: {
      id: agent.id,
      spaceId: "space",
      userId: "owner",
      status: { not: "running" },
      ownerQuestion: null,
      reviewingAt: null,
      clearedAt: null,
    },
    data: { clearedAt: expect.any(Date) },
  });
});

it("treats clearing a cleared job as done and refuses one still going", async () => {
  updateMany.mockResolvedValue({ count: 0 });
  findFirst.mockResolvedValueOnce({ clearedAt: new Date() });
  expect(await invoke(routes.clear, { agentId: agent.id })).toEqual({ duplicate: true });
  findFirst.mockResolvedValueOnce({ clearedAt: null });
  await expect(invoke(routes.clear, { agentId: agent.id })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  findFirst.mockResolvedValueOnce(null);
  await expect(invoke(routes.clear, { agentId: "nope" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
