import { randomUUID } from "node:crypto";
import type { AdapterContext, BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import { BACKGROUND_HELPER_TRIGGER, HELPER_RESULT_TRIGGER, isJobHelperRun } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, runAsSystem } from "@rakazo/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { returnHelperOutcome } from "./background-helpers.js";
import { CursorCloudAgentEmulator } from "./cloud-agent-emulator.js";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import {
  checkCloudAgentReporter,
  createCloudAgentWake,
  expediteCloudAgentReporterCheck,
  pollCloudAgent,
  REPORTER_CHECK_MS,
} from "./cloud-agent-poll.js";
import {
  executeCloudAgentTool,
  markCloudAgentWaiting,
  trackDirectCloudAgent,
} from "./cloud-agent-service.js";
import { cancelStaleCloudAgentWake } from "./cloud-agent-wake-start.js";
import { CursorCloudAgentProvider } from "./cursor-cloud-agent.js";
import { helperToolAllowed } from "./run-tool-selection.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;

describePostgres("cloud agent job threads (PostgreSQL + Cursor emulator)", () => {
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

  async function setup(mainMessages = 0) {
    const id = randomUUID();
    users.push(id);
    const { bot, thread, run } = await runAsSystem("test fixture", async () => {
      await prisma.user.create({
        data: { id, name: "Job test", email: `${id}@example.test`, emailVerified: true },
      });
      await prisma.organization.create({
        data: { id, name: "Job test", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Job test", isDefault: true },
      });
      await prisma.member.create({
        data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
      });
      const bot = await prisma.bot.create({
        data: { spaceId: id, userId: id, name: "Job test", color: "test-color" },
      });
      const thread = await asSystem(prisma).thread.create({
        data: { spaceId: id, userId: id, botId: bot.id, nextMessageSeq: mainMessages },
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
      // The owner's long chat: every message mentions something the job record must not carry.
      await asSystem(prisma).message.createMany({
        data: Array.from({ length: mainMessages }, (_, seq) => ({
          threadId: thread.id,
          seq,
          role: seq % 2 ? "bot" : "user",
          blocks: [{ kind: "text", text: `OWNER-CHAT-LINE-${seq} ${"lorem ipsum ".repeat(30)}` }],
        })),
      });
      return { bot, thread, run };
    });
    const wire = new CursorCloudAgentEmulator();
    const connection: CloudAgentConnection = {
      key: `test-connection:${id}`,
      spaceId: id,
      provider: new CursorCloudAgentProvider({ apiKey: "fake-key", fetch: wire.fetch }),
    };
    const enqueue = vi.fn(async (_job: BackgroundJob) => undefined);
    const enqueueIn = vi.fn(async (_tx: unknown, _job: BackgroundJob) => undefined);
    const jobs: JobPublisher = {
      enqueue,
      enqueueIn,
      cancelIn: async () => undefined,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const notify = vi.fn(async () => undefined);
    const deps = { prisma, jobs, events: { notify }, cloudAgent: connection };
    const context: AdapterContext & { botId: string } = {
      operationId: randomUUID(),
      traceId: "test",
      spaceId: id,
      userId: id,
      botId: bot.id,
      signal: new AbortController().signal,
    };
    const launch = async (prompt = "Add a README with install steps") => {
      const result = await runAsSystem("agent run tool call", () =>
        executeCloudAgentTool(
          deps,
          { ...context, operationId: randomUUID() },
          run,
          "cloud_agent_launch",
          { prompt, repository: "https://github.com/example/demo", openPr: true },
        ),
      );
      if (!("id" in result)) throw new Error("Launch failed");
      return result.id;
    };
    const state = (agentId: string) =>
      prisma.cloudAgent.findUniqueOrThrow({ where: { id: agentId } });
    const poll = (agentId: string) =>
      runAsSystem("cloud agent poll job", () => pollCloudAgent(deps, { agentId }));
    const finish = async (agentId: string) => {
      wire.complete((await state(agentId)).remoteId!);
      await poll(agentId);
    };
    const runsIn = (threadId: string) =>
      runAsSystem("test read", () =>
        asSystem(prisma).run.findMany({ where: { threadId }, orderBy: { createdAt: "asc" } }),
      );
    const messagesIn = (threadId: string) =>
      runAsSystem("test read", () =>
        asSystem(prisma).message.findMany({ where: { threadId }, orderBy: { seq: "asc" } }),
      );
    return {
      id,
      bot,
      thread,
      run,
      context,
      deps,
      launch,
      state,
      poll,
      finish,
      runsIn,
      messagesIn,
      enqueue,
      enqueueIn,
      notify,
    };
  }

  /** The agent finished once; one more piece of work follows, for a second wake. */
  async function restart(h: Awaited<ReturnType<typeof setup>>, agentId: string) {
    await prisma.cloudAgent.update({
      where: { id: agentId },
      data: {
        status: "running",
        generation: { increment: 1 },
        verdict: null,
        nextPollAt: new Date(),
        version: { increment: 1 },
      },
    });
    await h.finish(agentId);
  }

  it("runs a terminal wake in a hidden helper thread, with one card in the main chat", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup(40);
    const agentId = await h.launch();
    await h.poll(agentId);
    const before = (await h.messagesIn(h.thread.id)).length;
    await h.finish(agentId);

    const agent = await h.state(agentId);
    expect(agent.jobThreadId).toBeTruthy();
    expect(agent.jobThreadId).not.toBe(h.thread.id);
    const helperThread = await asSystem(prisma).thread.findUniqueOrThrow({
      where: { id: agent.jobThreadId! },
    });
    expect(helperThread).toMatchObject({ helperBotId: h.bot.id, botId: null });

    // Nothing in the main chat runs for the wake.
    const mainRuns = await h.runsIn(h.thread.id);
    expect(mainRuns.map((run) => run.trigger)).toEqual(["user"]);
    const [helperRun, ...rest] = await h.runsIn(helperThread.id);
    expect(rest).toHaveLength(0);
    expect(helperRun).toMatchObject({
      trigger: BACKGROUND_HELPER_TRIGGER,
      status: "queued",
      cloudAgentWakeNonces: [`cloud-agent-wake-run:${agentId}:0`],
    });
    expect(isJobHelperRun(helperRun!)).toBe(true);
    expect(h.enqueue).toHaveBeenCalledWith(runContinueJob(helperRun!.id));

    // The main chat gained exactly the helper's running card.
    const added = (await h.messagesIn(h.thread.id)).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.blocks).toMatchObject([{ kind: "subagent", status: "running" }]);
    expect(helperRun!.sourceMessageId).toBe(added[0]!.id);

    // Its result settles that card and does not start a main chat run.
    await runAsSystem("helper ends", () =>
      asSystem(prisma).run.update({ where: { id: helperRun!.id }, data: { status: "completed" } }),
    );
    await runAsSystem("helper result", () =>
      returnHelperOutcome(
        h.deps,
        { ...helperRun!, botId: h.bot.id },
        { status: "completed", text: "Accepted: the README covers install." },
      ),
    );
    const settled = await h.messagesIn(h.thread.id);
    expect(settled).toHaveLength(before + 1);
    expect(settled.at(-1)!.blocks).toMatchObject([
      { kind: "subagent", status: "completed", result: "Accepted: the README covers install." },
    ]);
    expect((await h.runsIn(h.thread.id)).map((run) => run.trigger)).toEqual(["user"]);
  });

  it("feeds the helper the job record, not the owner's chat", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup(1200);
    const agentId = await h.launch("Add a README with install steps");
    await h.poll(agentId);
    await h.finish(agentId);
    const agent = await h.state(agentId);
    const [helperRun] = await h.runsIn(agent.jobThreadId!);
    const task = await asSystem(prisma).task.findUniqueOrThrow({
      where: { id: helperRun!.taskId },
    });

    expect(task.prompt).toContain("Add a README with install steps");
    expect(task.prompt).toContain(`id: ${agentId}`);
    expect(task.prompt).toContain("status: finished");
    expect(task.prompt).toContain("is finished");
    // The brief points at the result in the status, not at a thread read the helper may not make.
    expect(task.prompt).toContain("untrustedResult");
    expect(task.prompt).not.toContain("OWNER-CHAT-LINE");
    expect(await h.messagesIn(agent.jobThreadId!)).toHaveLength(0);

    // What a main chat wake carries: the chat's history (what the executor loads for it).
    const chat = (await h.messagesIn(h.thread.id))
      .map((message) => JSON.stringify(message.blocks))
      .join("\n");
    process.stdout.write(
      `job helper wake: ${task.prompt.length} chars (~${Math.ceil(task.prompt.length / 4)} tokens); main chat history it replaces: ${chat.length} chars (~${Math.ceil(chat.length / 4)} tokens)\n`,
    );
    expect(task.prompt.length).toBeLessThan(chat.length / 50);
  });

  /** The bot messages the finished agent's thread itself, as its own run's tool call. */
  async function sendDirect(
    h: Awaited<ReturnType<typeof setup>>,
    run: { id: string; threadId: string },
    brief: string,
  ) {
    const agent = (await asSystem(prisma).cloudAgent.findFirstOrThrow({
      where: { userId: h.id },
    })) as { remoteId: string | null };
    await runAsSystem("agent run tool call", () =>
      trackDirectCloudAgent(h.deps, { ...h.context, operationId: randomUUID() }, run, {
        remoteId: agent.remoteId!,
        title: "Follow-up",
        brief,
      }),
    );
  }

  /** The helper's earlier run is over, so the next wake starts one of its own. */
  const settleHelper = async (h: Awaited<ReturnType<typeof setup>>, agentId: string) => {
    const { jobThreadId } = await h.state(agentId);
    await runAsSystem("helper ends", () =>
      asSystem(prisma).run.updateMany({
        where: { threadId: jobThreadId! },
        data: { status: "completed" },
      }),
    );
  };

  it("judges a follow-up's result against that follow-up, with the launch brief as background", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup();
    const agentId = await h.launch("Reinstall the app on my phone and read the version back");
    await h.poll(agentId);
    await h.finish(agentId);
    await settleHelper(h, agentId);
    await sendDirect(h, h.run, "What is the latest commit on main?");
    // The next piece's request is sealed at rest like the launch brief.
    const stored = await prisma.$queryRaw<Array<{ brief: string }>>`
      SELECT "followupBrief" AS brief FROM cloud_agents WHERE id = ${agentId}`;
    expect(stored[0]!.brief).not.toContain("latest commit");
    await h.finish(agentId);

    const runs = await h.runsIn((await h.state(agentId)).jobThreadId!);
    expect(runs).toHaveLength(2);
    const [, second] = runs;
    const prompt = (
      await asSystem(prisma).task.findUniqueOrThrow({ where: { id: second!.taskId } })
    ).prompt;
    expect(prompt).toContain("current request: What is the latest commit on main?");
    expect(prompt).toContain("launch brief (background): Reinstall the app on my phone");
    expect(prompt).toContain("judge it against the current request");
  });

  it("judges a cloud_agent_reply's result against that reply", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup();
    const agentId = await h.launch("Reinstall the app on my phone");
    await h.poll(agentId);
    await h.finish(agentId);
    await settleHelper(h, agentId);
    await runAsSystem("agent run tool call", () =>
      executeCloudAgentTool(
        h.deps,
        { ...h.context, operationId: randomUUID() },
        h.run,
        "cloud_agent_reply",
        { id: agentId, prompt: "Now bump the build number" },
      ),
    );
    await h.poll(agentId);
    await h.finish(agentId);
    const runs = await h.runsIn((await h.state(agentId)).jobThreadId!);
    expect(runs).toHaveLength(2);
    const prompt = (
      await asSystem(prisma).task.findUniqueOrThrow({ where: { id: runs[1]!.taskId } })
    ).prompt;
    expect(prompt).toContain("current request: Now bump the build number");
    expect(prompt).toContain("launch brief (background): Reinstall the app on my phone");
  });

  /** Another turn of the bot's main chat, as the run that waits on a thread. */
  const turn = (h: Awaited<ReturnType<typeof setup>>, status: string) =>
    runAsSystem("test fixture", () =>
      asSystem(prisma).run.create({
        data: {
          spaceId: h.id,
          userId: h.id,
          botId: h.bot.id,
          threadId: h.thread.id,
          taskId: h.run.taskId,
          status,
          trigger: "user",
        },
      }),
    );

  it("starts no helper wake for a piece the bot's own run is still reporting", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup();
    const agentId = await h.launch("Reinstall the app on my phone");
    await h.poll(agentId);
    await h.finish(agentId);
    const before = (await h.messagesIn(h.thread.id)).length;

    await settleHelper(h, agentId);
    // Sent by a run that then waits on the thread and is still going when it finishes.
    const sender = await turn(h, "running");
    await sendDirect(h, sender, "What is the latest commit on main?");
    await runAsSystem("agent run tool call", async () =>
      markCloudAgentWaiting(h.deps, h.context, sender, (await h.state(agentId)).remoteId!),
    );
    await h.finish(agentId);
    expect(await h.state(agentId)).toMatchObject({ status: "finished", wakeGeneration: 1 });
    expect(await h.runsIn((await h.state(agentId)).jobThreadId!)).toHaveLength(1);
    expect(await h.messagesIn(h.thread.id)).toHaveLength(before);

    // A send the run ended after, then a later run waiting on the thread: also no wake.
    await sendDirect(h, h.run, "And the one before it?");
    const waiter = await turn(h, "running");
    await runAsSystem("agent run tool call", async () =>
      markCloudAgentWaiting(h.deps, h.context, waiter, (await h.state(agentId)).remoteId!),
    );
    await h.finish(agentId);
    expect(await h.state(agentId)).toMatchObject({ wakeGeneration: 2 });
    expect(await h.runsIn((await h.state(agentId)).jobThreadId!)).toHaveLength(1);
    expect(await h.messagesIn(h.thread.id)).toHaveLength(before);
  });

  /** A piece finishes while a run that waited on its thread is still going; the wake is held. */
  async function heldWake(status: "running" | "completed" | "failed") {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup();
    const agentId = await h.launch("Reinstall the app on my phone");
    await h.poll(agentId);
    await h.finish(agentId);
    await settleHelper(h, agentId);
    const before = (await h.messagesIn(h.thread.id)).length;
    await sendDirect(h, h.run, "What is the latest commit on main?");
    const waiter = await turn(h, "running");
    await runAsSystem("agent run tool call", async () =>
      markCloudAgentWaiting(h.deps, h.context, waiter, (await h.state(agentId)).remoteId!),
    );
    await h.finish(agentId);
    const generation = (await h.state(agentId)).generation;
    const helperRuns = async () => (await h.runsIn((await h.state(agentId)).jobThreadId!)).length;
    // Held back, with a durable backup job for after the run's own time.
    expect(await helperRuns()).toBe(1);
    const backup = h.enqueueIn.mock.calls
      .map(([, job]) => job)
      .filter((job) => job.name === "cloud_agent.reporter_check")
      .at(-1);
    expect(backup).toMatchObject({
      payload: { agentId, generation },
      replaceKey: `cloud_agent.reporter_check:${agentId}:${generation}`,
    });
    expect(backup!.availableAt!.getTime()).toBeGreaterThan(Date.now() + REPORTER_CHECK_MS - 60_000);
    if (status !== "running")
      await runAsSystem("run ends", () =>
        asSystem(prisma).run.update({ where: { id: waiter.id }, data: { status } }),
      );
    const check = () =>
      runAsSystem("reporter check", () => checkCloudAgentReporter(h.deps, { agentId, generation }));
    return { h, agentId, generation, before, helperRuns, check, waiter };
  }

  it("makes no wake when the reporting run completed normally", async () => {
    const { h, helperRuns, check, before } = await heldWake("completed");
    await check();
    expect(await helperRuns()).toBe(1);
    expect(await h.messagesIn(h.thread.id)).toHaveLength(before);
  });

  it("wakes at once when the reporting run fails, and only once", async () => {
    const { h, agentId, generation, helperRuns, check, before, waiter } = await heldWake("failed");
    h.enqueue.mockClear();
    await runAsSystem("run fails", () => expediteCloudAgentReporterCheck(h.deps, waiter.id));
    // The backup job is moved up to now, under the same key.
    const [expedited] = h.enqueue.mock.calls.map(([job]) => job);
    expect(expedited).toMatchObject({
      name: "cloud_agent.reporter_check",
      replaceKey: `cloud_agent.reporter_check:${agentId}:${generation}`,
    });
    expect(expedited!.availableAt!.getTime()).toBeLessThanOrEqual(Date.now());
    await check();
    expect(await helperRuns()).toBe(2);
    expect(await h.messagesIn(h.thread.id)).toHaveLength(before + 1);
    // Running again, as the backup would at its own run-at, adds nothing.
    await check();
    expect(await helperRuns()).toBe(2);
    expect(await h.messagesIn(h.thread.id)).toHaveLength(before + 1);
  });

  it("wakes at the backup's run-at when the reporting run is still going", async () => {
    const { h, helperRuns, check, before } = await heldWake("running");
    await check();
    expect(await helperRuns()).toBe(2);
    expect(await h.messagesIn(h.thread.id)).toHaveLength(before + 1);
  });

  it("wakes for a follow-up sent after a result the run received before the poll saw it", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup();
    const agentId = await h.launch("Reinstall the app on my phone");
    await h.poll(agentId);
    // The bot's run reads the finished result while the agent is still running locally.
    const bot = await turn(h, "running");
    await runAsSystem("agent run tool call", async () =>
      markCloudAgentWaiting(h.deps, h.context, bot, (await h.state(agentId)).remoteId!),
    );
    // It then sends a follow-up without waiting on it, and stays active.
    await sendDirect(h, bot, "Now bump the build number");
    expect((await h.state(agentId)).waitingRunId).toBeNull();
    await h.finish(agentId);
    const runs = await h.runsIn((await h.state(agentId)).jobThreadId!);
    expect(runs).toHaveLength(1);
    // Judged against the follow-up, not the launch brief.
    const prompt = (
      await asSystem(prisma).task.findUniqueOrThrow({ where: { id: runs[0]!.taskId } })
    ).prompt;
    expect(prompt).toContain("current request: Now bump the build number");
  });

  it("judges a follow-up sent after the chat lost a running agent's card against that follow-up", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup();
    const agentId = await h.launch("Reinstall the app on my phone");
    await h.poll(agentId);
    // The chat was cleared while the agent still ran: its card is gone.
    await asSystem(prisma).message.delete({ where: { id: (await h.state(agentId)).messageId! } });
    await sendDirect(h, h.run, "Now bump the build number");
    await h.finish(agentId);
    const runs = await h.runsIn((await h.state(agentId)).jobThreadId!);
    expect(runs).toHaveLength(1);
    const prompt = (
      await asSystem(prisma).task.findUniqueOrThrow({ where: { id: runs[0]!.taskId } })
    ).prompt;
    expect(prompt).toContain("current request: Now bump the build number");
  });

  it("still wakes for a follow-up its sender did not stay for", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup();
    const agentId = await h.launch("Reinstall the app on my phone");
    await h.poll(agentId);
    await h.finish(agentId);
    await settleHelper(h, agentId);
    // Sent, then the run ended while the agent worked on.
    await sendDirect(h, h.run, "Check the lockfile");
    await h.finish(agentId);
    expect(await h.runsIn((await h.state(agentId)).jobThreadId!)).toHaveLength(2);

    // Sent by a run still going that never waits on the thread: sending is not reporting.
    await settleHelper(h, agentId);
    const sender = await turn(h, "running");
    await sendDirect(h, sender, "Check the readme");
    await h.finish(agentId);
    expect(await h.runsIn((await h.state(agentId)).jobThreadId!)).toHaveLength(3);

    // A run that waited on the thread but ended before the agent finished: it reports nothing.
    await settleHelper(h, agentId);
    await sendDirect(h, h.run, "Check the changelog");
    const waiter = await turn(h, "completed");
    await runAsSystem("agent run tool call", async () =>
      markCloudAgentWaiting(h.deps, h.context, waiter, (await h.state(agentId)).remoteId!),
    );
    await h.finish(agentId);
    expect(await h.runsIn((await h.state(agentId)).jobThreadId!)).toHaveLength(4);
  });

  it("reuses the same helper thread for the next wake", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup(4);
    const agentId = await h.launch();
    await h.poll(agentId);
    await h.finish(agentId);
    const first = (await h.state(agentId)).jobThreadId!;
    const [firstRun] = await h.runsIn(first);
    // The first wake's helper runs and ends before the agent is sent back to work.
    await runAsSystem("helper ends", () =>
      asSystem(prisma).run.update({ where: { id: firstRun!.id }, data: { status: "completed" } }),
    );
    await restart(h, agentId);

    const agent = await h.state(agentId);
    expect(agent.jobThreadId).toBe(first);
    expect(agent.wakeGeneration).toBe(1);
    const runs = await h.runsIn(first);
    expect(runs.map((run) => run.cloudAgentWakeNonces)).toEqual([
      [`cloud-agent-wake-run:${agentId}:0`],
      [`cloud-agent-wake-run:${agentId}:1`],
    ]);
    expect(await asSystem(prisma).thread.count({ where: { helperBotId: h.bot.id } })).toBe(1);
    expect((await h.runsIn(h.thread.id)).map((run) => run.trigger)).toEqual(["user"]);
  });

  it("folds a second wake into the helper run that has not started", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup(2);
    const agentId = await h.launch();
    await h.poll(agentId);
    await h.finish(agentId);
    const agent = await h.state(agentId);
    const created = await runAsSystem("second wake", () =>
      prisma.$transaction((tx) =>
        createCloudAgentWake(
          tx,
          agent,
          `Cloud agent ${agentId} needs input (req-1). Use cloud_agent_status.`,
          `cloud-agent-attention:${agentId}:req-1`,
          { jobThread: true },
        ),
      ),
    );
    const runs = await h.runsIn(agent.jobThreadId!);
    expect(runs).toHaveLength(1);
    expect(created).toEqual([runs[0]!.id]);
    expect(runs[0]!.cloudAgentWakeNonces).toHaveLength(2);
    const task = await asSystem(prisma).task.findUniqueOrThrow({ where: { id: runs[0]!.taskId } });
    expect(task.prompt).toContain("needs input (req-1)");
  });

  it("brings an unanswered question to the main chat", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup(2);
    const agentId = await h.launch();
    await h.poll(agentId);
    await prisma.cloudAgent.update({
      where: { id: agentId },
      data: { attention: [{ requestId: "req-1", kind: "question" }] },
    });
    const agent = await h.state(agentId);
    const [id] = await runAsSystem("attention wake", () =>
      prisma.$transaction((tx) =>
        createCloudAgentWake(
          tx,
          agent,
          `Cloud agent ${agentId} needs input (req-1).`,
          `cloud-agent-attention:${agentId}:req-1`,
          { jobThread: true },
        ),
      ),
    );
    const helperRun = await asSystem(prisma).run.findUniqueOrThrow({ where: { id: id! } });
    expect(helperRun.threadId).toBe((await h.state(agentId)).jobThreadId);
    await runAsSystem("helper ends", () =>
      asSystem(prisma).run.update({ where: { id: helperRun.id }, data: { status: "completed" } }),
    );
    await runAsSystem("helper result", () =>
      returnHelperOutcome(
        h.deps,
        { ...helperRun, botId: h.bot.id },
        { status: "completed", text: "The agent asks which license to use." },
      ),
    );
    const mainRuns = await h.runsIn(h.thread.id);
    expect(mainRuns.map((run) => run.trigger)).toEqual(["user", HELPER_RESULT_TRIGGER]);
  });

  it("settles the card and cancels a wake that became stale", async () => {
    vi.stubEnv("CLOUD_AGENT_JOB_THREADS", "1");
    const h = await setup(2);
    const agentId = await h.launch();
    await h.poll(agentId);
    await h.finish(agentId);
    const agent = await h.state(agentId);
    const [helperRun] = await h.runsIn(agent.jobThreadId!);
    // The agent was sent back to work before its helper started.
    await prisma.cloudAgent.update({
      where: { id: agentId },
      data: { status: "running", generation: { increment: 1 } },
    });
    await asSystem(prisma).run.update({
      where: { id: helperRun!.id },
      data: { status: "running", leaseOwner: "w1", leaseFence: 1 },
    });
    const cancelled = await runAsSystem("stale wake", () =>
      cancelStaleCloudAgentWake(
        h.deps,
        { ...(helperRun as NonNullable<typeof helperRun>), status: "running" },
        { owner: "w1", fence: 1 },
      ),
    );
    expect(cancelled).toBe(true);
    expect((await h.runsIn(agent.jobThreadId!)).map((run) => run.status)).toEqual(["cancelled"]);
    expect((await h.runsIn(h.thread.id)).map((run) => run.trigger)).toEqual(["user"]);
    const card = (await h.messagesIn(h.thread.id)).at(-1)!;
    expect(card.blocks).toMatchObject([{ kind: "subagent", status: "failed", result: "stopped" }]);
  });

  it("changes nothing while the flag is off", async () => {
    const h = await setup(2);
    const agentId = await h.launch();
    await h.poll(agentId);
    await h.finish(agentId);
    const agent = await h.state(agentId);
    expect(agent.jobThreadId).toBeNull();
    expect(agent.launchBrief).toBeNull();
    const runs = await h.runsIn(h.thread.id);
    expect(runs.map((run) => run.trigger)).toEqual(["user", "cloud_agent"]);
    const task = await asSystem(prisma).task.findUniqueOrThrow({ where: { id: runs[1]!.taskId } });
    expect(task.prompt).toBe(
      `Cloud agent ${agentId} is finished. Use cloud_agent_status to inspect its result, then cloud_agent_report your verdict.`,
    );
    expect(await asSystem(prisma).thread.count({ where: { helperBotId: h.bot.id } })).toBe(0);
    expect(await h.messagesIn(h.thread.id)).toHaveLength(2 + 1);
  });

  it("offers a job helper the cloud-agent tools a plain helper lacks", () => {
    for (const name of ["cloud_agent_reply", "cloud_agent_report", "cloud_agent_cancel"]) {
      expect(helperToolAllowed(name, false)).toBe(false);
      expect(helperToolAllowed(name, true)).toBe(true);
    }
    expect(helperToolAllowed("cloud_agent_launch", true)).toBe(false);
    expect(helperToolAllowed("message_user", true)).toBe(false);
    expect(helperToolAllowed("cloud_agent_status", false)).toBe(true);
  });
});
