import { randomUUID } from "node:crypto";
import type { AdapterContext, BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentState } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, runAsSystem } from "@rakazo/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { returnHelperOutcome } from "./background-helpers.js";
import { CursorCloudAgentEmulator } from "./cloud-agent-emulator.js";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { pollCloudAgent } from "./cloud-agent-poll.js";
import {
  cloudAgentStatusResult,
  executeCloudAgentTool,
  reportCloudAgent,
} from "./cloud-agent-service.js";
import { CursorCloudAgentProvider } from "./cursor-cloud-agent.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;

/** Refuses the first `refusals` launches, as a provider with no default branch would. */
class RefusingProvider extends CursorCloudAgentProvider {
  refusals = 0;
  override async launch(...args: Parameters<CursorCloudAgentProvider["launch"]>) {
    if (this.refusals > 0) {
      this.refusals -= 1;
      throw new CloudAgentRequestRejected("invalid", "origin/HEAD does not exist");
    }
    return super.launch(...args);
  }
}

describePostgres("cloud agent attempts and one card per request (PostgreSQL + emulator)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const users: string[] = [];
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (!db) return;
    await prisma.cloudAgent.deleteMany({ where: { userId: { in: users } } });
    await prisma.organization.deleteMany({ where: { id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  async function setup() {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const id = randomUUID();
    users.push(id);
    const { bot, thread, run } = await runAsSystem("test fixture", async () => {
      await prisma.user.create({
        data: { id, name: "Attempts", email: `${id}@example.test`, emailVerified: true },
      });
      await prisma.organization.create({
        data: { id, name: "Attempts", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Attempts", isDefault: true },
      });
      await prisma.member.create({
        data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
      });
      const bot = await prisma.bot.create({
        data: { spaceId: id, userId: id, name: "Attempts", color: "test-color" },
      });
      const thread = await asSystem(prisma).thread.create({
        data: { spaceId: id, userId: id, botId: bot.id },
      });
      const task = await asSystem(prisma).task.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          prompt: "Test",
          status: "completed",
        },
      });
      const run = await asSystem(prisma).run.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          taskId: task.id,
          status: "completed",
          trigger: "user",
        },
      });
      return { bot, thread, run };
    });
    const wire = new CursorCloudAgentEmulator();
    const provider = new RefusingProvider({ apiKey: "fake-key", fetch: wire.fetch });
    const connection: CloudAgentConnection = {
      key: `test-connection:${id}`,
      spaceId: id,
      provider,
    };
    const jobs: JobPublisher = {
      enqueue: vi.fn(async (_job: BackgroundJob) => undefined),
      enqueueIn: vi.fn(async () => undefined),
      cancelIn: async () => undefined,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const deps = {
      prisma,
      jobs,
      events: { notify: vi.fn(async () => undefined) },
      cloudAgent: connection,
    };
    const context: AdapterContext & { botId: string } = {
      operationId: randomUUID(),
      traceId: "test",
      spaceId: id,
      userId: id,
      botId: bot.id,
      signal: new AbortController().signal,
    };
    const launch = async (args: Record<string, unknown>) => {
      const result = await runAsSystem("agent run tool call", () =>
        executeCloudAgentTool(
          deps,
          { ...context, operationId: randomUUID() },
          run,
          "cloud_agent_launch",
          {
            repository: "https://github.com/example/demo",
            ...args,
          },
        ),
      );
      if (!("id" in result)) throw new Error(`Launch failed: ${JSON.stringify(result)}`);
      return result.id;
    };
    const poll = (agentId: string) => runAsSystem("poll", () => pollCloudAgent(deps, { agentId }));
    const state = (agentId: string) =>
      prisma.cloudAgent.findUniqueOrThrow({ where: { id: agentId } });
    const chat = async () =>
      runAsSystem("read", () =>
        asSystem(prisma).message.findMany({
          where: { threadId: thread.id },
          orderBy: { seq: "asc" },
        }),
      );
    const cards = async () =>
      (await chat()).flatMap((message) =>
        (message.blocks as MessageBlock[]).filter(
          (block) => block.kind === "cloud_agent" || block.kind === "subagent",
        ),
      );
    return {
      id,
      bot,
      thread,
      run,
      context,
      deps,
      provider,
      wire,
      launch,
      poll,
      state,
      chat,
      cards,
    };
  }

  it("replays a failed launch, its relaunch, completion and review on one card", async () => {
    const h = await setup();
    h.provider.refusals = 1;
    const first = await h.launch({ prompt: "Fix the build" });
    await h.poll(first);
    const failed = await h.state(first);
    expect(failed).toMatchObject({ status: "failed", remoteId: null, requestKey: null });
    const recovery = cloudAgentStatusResult(failed).retry!;
    expect(recovery).toMatchObject({ tool: "cloud_agent_launch", arguments: { replaces: first } });
    const wakeTask = await asSystem(prisma).task.findFirstOrThrow({
      where: { threadId: failed.jobThreadId! },
    });
    expect(wakeTask.prompt).toContain(JSON.stringify(recovery));
    const failedReview = await asSystem(prisma).run.findFirstOrThrow({
      where: { threadId: failed.jobThreadId! },
    });
    await runAsSystem("failed review returns", async () => {
      await asSystem(prisma).run.update({
        where: { id: failedReview.id },
        data: { status: "completed" },
      });
      await returnHelperOutcome(h.deps, failedReview, {
        status: "completed",
        text: "The launch was refused.",
      });
    });
    const leadWake = await asSystem(prisma).run.findFirstOrThrow({
      where: { threadId: h.thread.id, trigger: "helper_result" },
      include: { task: true },
    });
    expect(leadWake.task.prompt).toContain(JSON.stringify(recovery));
    expect(await h.chat()).toHaveLength(1);
    // A failed launch is failed, never a question for the owner, even with one attached.
    let [card] = await h.cards();
    expect(card).toMatchObject({ agentId: first, status: "failed", launchFailed: true });
    expect(cloudAgentState({ ...card, ownerQuestion: "Retry?" } as never)).toBe("failed");

    // The same request again is the next attempt on the same card, not a second card.
    const second = await h.launch({ prompt: "Fix the build", ...recovery.arguments });
    expect(second).not.toBe(first);
    expect(await h.state(second)).toMatchObject({ replacesId: first, requestKey: null });
    expect(await h.state(first)).toMatchObject({ requestKey: null });
    expect(await h.chat()).toHaveLength(1);
    [card] = await h.cards();
    expect(card).toMatchObject({
      agentId: second,
      status: "running",
      attempts: [{ agentId: first, status: "failed", failureReason: "origin/HEAD does not exist" }],
    });

    // Replaying either call finds the current attempt and starts nothing.
    expect(await h.launch({ prompt: "Fix the build", ...recovery.arguments })).toBe(second);
    expect(await h.launch({ prompt: "Fix the build", replaces: first })).toBe(second);

    await h.poll(second);
    h.wire.complete((await h.state(second)).remoteId!);
    await h.poll(second);
    const done = await h.state(second);
    expect(done).toMatchObject({ status: "finished" });
    // The review is the same card saying Checking, then what it concluded.
    expect(await h.chat()).toHaveLength(1);
    expect((await h.cards())[0]).toMatchObject({ status: "finished", review: "checking" });
    const [helperRun] = await runAsSystem("read", () =>
      asSystem(prisma).run.findMany({ where: { threadId: done.jobThreadId! } }),
    );
    expect(helperRun!.sourceMessageId).toBe(done.messageId);
    await runAsSystem("report", () =>
      reportCloudAgent(h.deps as never, h.context, h.run, {
        id: second,
        verdict: "accepted",
        summary: "Builds.",
      }),
    );
    await runAsSystem("helper ends", () =>
      asSystem(prisma).run.update({ where: { id: helperRun!.id }, data: { status: "completed" } }),
    );
    const parallel = await runAsSystem("parallel review", () =>
      asSystem(prisma).run.create({
        data: {
          spaceId: h.id,
          userId: h.id,
          botId: h.bot.id,
          threadId: helperRun!.threadId,
          taskId: helperRun!.taskId,
          sourceMessageId: done.messageId,
          status: "running",
          trigger: "helper",
          clientNonce: `cloud-agent-attention:${second}:parallel`,
        },
      }),
    );
    await runAsSystem("helper result", () =>
      returnHelperOutcome(
        h.deps,
        { ...helperRun!, botId: h.bot.id },
        { status: "completed", text: "Accepted." },
      ),
    );
    expect((await h.cards())[0]).toMatchObject({ review: "checking" });
    await runAsSystem("parallel review ends", async () => {
      await asSystem(prisma).run.update({
        where: { id: parallel.id },
        data: { status: "completed" },
      });
      await returnHelperOutcome(h.deps, parallel, { status: "completed", text: "Accepted." });
    });
    // Delivered once: a replay changes nothing.
    await runAsSystem("helper result", () =>
      returnHelperOutcome(
        h.deps,
        { ...helperRun!, botId: h.bot.id },
        { status: "completed", text: "Accepted." },
      ),
    );
    expect(await h.chat()).toHaveLength(1);
    expect(await h.cards()).toMatchObject([
      { agentId: second, status: "finished", review: "accepted" },
    ]);
    // The initial run and failed-start recovery wake; accepted reviews add no lead run.
    expect(await asSystem(prisma).run.count({ where: { threadId: h.thread.id } })).toBe(2);
  });

  it("keeps distinct requests, even with the same title, as independent cards", async () => {
    const h = await setup();
    const a = await h.launch({ prompt: "Fix the build", requestKey: "one" });
    const b = await h.launch({ prompt: "Fix the build", requestKey: "two" });
    const c = await h.launch({ prompt: "Fix the build" });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(await h.chat()).toHaveLength(3);
    expect((await h.cards()).map((card) => card.agentId)).toEqual([a, b, c]);
    for (const id of [a, b, c]) expect((await h.state(id)).replacesId).toBeNull();
  });

  it("refuses to replace an attempt that started, or one that is not the bot's", async () => {
    const h = await setup();
    const started = await h.launch({ prompt: "Fix the build" });
    await h.poll(started);
    const result = await runAsSystem("launch", () =>
      executeCloudAgentTool(
        h.deps,
        { ...h.context, operationId: randomUUID() },
        h.run,
        "cloud_agent_launch",
        {
          prompt: "Fix the build",
          replaces: started,
        },
      ),
    );
    expect(result).toMatchObject({ error: expect.stringContaining("failed to start") });
    expect(await h.chat()).toHaveLength(1);
  });
});
