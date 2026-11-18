import { beforeEach, describe, expect, it, vi } from "vitest";

const wake = vi.hoisted(() => vi.fn(async () => ["wake-run"]));
vi.mock("./cloud-agent-poll.js", () => ({
  createCloudAgentWake: wake,
  repaintCloudAgentCard: vi.fn(async () => undefined),
}));
vi.mock("../cloud-agent-service.js", async (original) => ({
  ...(await original<typeof import("../cloud-agent-service.js")>()),
  enqueueCloudAgent: vi.fn(async () => undefined),
}));

import {
  answerCloudAgentQuestion,
  CloudAgentOwnerActionError,
  steerCloudAgent,
  stopCloudAgent,
} from "./cloud-agent-owner-actions.js";

type Row = Record<string, unknown> & { id: string; version: number };

/** One job row, with the version guard and the transaction the actions rely on. */
function fake(initial: Partial<Row> = {}) {
  const row: Row = {
    id: "job",
    spaceId: "space",
    userId: "owner",
    botId: "bot",
    title: "Ship it",
    status: "running",
    remoteId: "thread-1",
    version: 0,
    followup: null,
    cancelRequested: false,
    queuedAt: null,
    attention: [{ requestId: "q1", kind: "question" }],
    ownerAnswer: null,
    questionPrompt: '{"requestId":"q1","options":[{"label":"main"}]}',
    ...initial,
  };
  const cloudAgent = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      row.id === where.id && row.spaceId === where.spaceId && row.userId === where.userId
        ? { ...row }
        : null,
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: { version: number }; data: Record<string, unknown> }) => {
        if (where.version !== row.version) return { count: 0 };
        for (const [key, value] of Object.entries(data))
          row[key] =
            value && typeof value === "object" && "increment" in value
              ? (row[key] as number) + 1
              : value;
        return { count: 1 };
      },
    ),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      for (const [key, value] of Object.entries(data))
        row[key] =
          value && typeof value === "object" && "increment" in value
            ? (row[key] as number) + 1
            : value;
      return { ...row };
    }),
  };
  const tx = { cloudAgent, $executeRaw: vi.fn(async () => 1) };
  const enqueue = vi.fn(async () => undefined);
  const deps = {
    prisma: { cloudAgent, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
    jobs: { enqueue },
    events: { notify: vi.fn() },
  };
  return { row, deps: deps as never, enqueue };
}

const owner = { spaceId: "space", userId: "owner" };
const answer = { agentId: "job", requestId: "q1", answer: "main" };

beforeEach(() => vi.clearAllMocks());

describe("answering a job's question from its card", () => {
  it("queues the answer for the provider, shows it and tells the bot once", async () => {
    const { row, deps, enqueue } = fake();
    await expect(answerCloudAgentQuestion(deps, owner, answer)).resolves.toEqual({
      duplicate: false,
    });
    expect(row.followup).toEqual({ prompt: "main" });
    expect(row.ownerAnswer).toBe("main");
    expect(row.questionPrompt).toBeNull();
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake.mock.calls[0]).toEqual([
      expect.anything(),
      expect.anything(),
      expect.stringContaining('"main"'),
      "cloud-agent-owner-answer:job:q1",
    ]);
    expect(enqueue).toHaveBeenCalled();
  });

  it("treats a double tap as the same answer, not a second one", async () => {
    const { deps } = fake();
    await answerCloudAgentQuestion(deps, owner, answer);
    await expect(answerCloudAgentQuestion(deps, owner, answer)).resolves.toEqual({
      duplicate: true,
    });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer to a question that closed or was answered elsewhere", async () => {
    const closed = fake({ attention: null });
    await expect(answerCloudAgentQuestion(closed.deps, owner, answer)).rejects.toMatchObject({
      code: "stale",
      message: expect.stringContaining("already been answered"),
    });
    const other = fake({ attention: [{ requestId: "q2", kind: "question" }] });
    await expect(answerCloudAgentQuestion(other.deps, owner, answer)).rejects.toMatchObject({
      code: "stale",
    });
    expect(closed.row.followup).toBeNull();
    expect(wake).not.toHaveBeenCalled();
  });

  it("refuses someone else's job", async () => {
    const { row, deps } = fake();
    const error = await answerCloudAgentQuestion(deps, { ...owner, userId: "other" }, answer).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CloudAgentOwnerActionError);
    expect(error).toMatchObject({ code: "not_found" });
    const space = await answerCloudAgentQuestion(
      deps,
      { ...owner, spaceId: "elsewhere" },
      answer,
    ).catch((caught: unknown) => caught);
    expect(space).toMatchObject({ code: "not_found" });
    expect(row.followup).toBeNull();
  });
});

describe("steering a running job", () => {
  it("delivers an instruction once, whatever the retries", async () => {
    const { row, deps } = fake({ attention: null, questionPrompt: null });
    const input = { agentId: "job", text: "Skip the docs", key: "tap-0001" };
    await expect(steerCloudAgent(deps, owner, input)).resolves.toEqual({ duplicate: false });
    expect(row.followup).toEqual({ prompt: "Skip the docs", steerKey: "tap-0001" });
    await expect(steerCloudAgent(deps, owner, input)).resolves.toEqual({ duplicate: true });
    expect(row.version).toBe(1);
  });

  it("makes the owner wait for a delivery in flight, or for their answer first", async () => {
    const sending = fake({ attention: null, followup: { prompt: "x", steerKey: "first-key" } });
    await expect(
      steerCloudAgent(sending.deps, owner, { agentId: "job", text: "More", key: "second-key" }),
    ).rejects.toMatchObject({ code: "busy" });
    const asking = fake();
    await expect(
      steerCloudAgent(asking.deps, owner, { agentId: "job", text: "More", key: "second-key" }),
    ).rejects.toMatchObject({ code: "busy" });
  });

  it("refuses a finished job and someone else's", async () => {
    const done = fake({ status: "finished", attention: null });
    await expect(
      steerCloudAgent(done.deps, owner, { agentId: "job", text: "More", key: "some-key-1" }),
    ).rejects.toMatchObject({ code: "ended" });
    await expect(
      steerCloudAgent(
        done.deps,
        { ...owner, userId: "other" },
        {
          agentId: "job",
          text: "More",
          key: "some-key-1",
        },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("stopping a job", () => {
  it("asks the provider to stop it once", async () => {
    const { row, deps } = fake();
    await expect(stopCloudAgent(deps, owner, { agentId: "job" })).resolves.toEqual({
      duplicate: false,
    });
    expect(row.cancelRequested).toBe(true);
    await expect(stopCloudAgent(deps, owner, { agentId: "job" })).resolves.toEqual({
      duplicate: true,
    });
  });

  it("refuses someone else's job", async () => {
    const { row, deps } = fake();
    await expect(
      stopCloudAgent(deps, { ...owner, userId: "other" }, { agentId: "job" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(row.cancelRequested).toBe(false);
  });
});
