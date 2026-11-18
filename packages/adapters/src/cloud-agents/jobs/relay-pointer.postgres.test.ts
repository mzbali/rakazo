import { randomUUID } from "node:crypto";
import type { BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { messageBot, returnBotMessageOutcome } from "../../messaging/bot-messages.js";
import {
  createCloudAgentWake,
  postCloudAgentRelayPointers,
  runRelayPointerBackup,
} from "../cloud-agent-poll.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;

describePostgres("relay pointer in the asking chat (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const spaces: string[] = [];
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  afterAll(async () => {
    if (!db) return;
    await prisma.cloudAgent.deleteMany({ where: { spaceId: { in: spaces } } });
    await prisma.organization.deleteMany({ where: { id: { in: spaces } } });
    await prisma.user.deleteMany({ where: { id: { in: spaces } } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  /** Bot A asked bot B a question on the owner's behalf; B's run answers it. */
  async function setup(options: { relayed?: boolean } = {}) {
    const id = randomUUID();
    spaces.push(id);
    const sys = asSystem(prisma);
    const fixture = await runAsSystem("test fixture", async () => {
      await prisma.user.create({
        data: { id, name: "Relay test", email: `${id}@example.test`, emailVerified: true },
      });
      await prisma.organization.create({
        data: { id, name: "Relay test", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Relay test", isDefault: true },
      });
      await prisma.member.create({
        data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
      });
      const botA = await prisma.bot.create({
        data: { spaceId: id, userId: id, name: "Chief of Staff", color: "test-color" },
      });
      const botB = await prisma.bot.create({
        data: { spaceId: id, userId: id, name: "Engineering Lead", color: "test-color" },
      });
      const threadA = await sys.thread.create({
        data: { spaceId: id, userId: id, botId: botA.id, nextMessageSeq: 1 },
      });
      const threadB = await sys.thread.create({
        data: { spaceId: id, userId: id, botId: botB.id, nextMessageSeq: 1 },
      });
      const asked = await sys.message.create({
        data: {
          threadId: threadA.id,
          seq: 0,
          role: "bot",
          botId: botA.id,
          blocks: [
            {
              kind: "bot_message_sent",
              toBotId: botB.id,
              toBotName: botB.name,
              text: "Which services still use the old queue? Report in your own chat.",
              intent: "question",
            },
          ],
        },
      });
      const received: MessageBlock =
        options.relayed === false
          ? { kind: "text", text: "Which services still use the old queue?" }
          : {
              kind: "bot_message_received",
              fromBotId: botA.id,
              fromBotName: botA.name,
              text: "Which services still use the old queue? Report in your own chat.",
              intent: "question",
              hop: 1,
              returnToMessageId: asked.id,
            };
      const inbound = await sys.message.create({
        data: {
          threadId: threadB.id,
          seq: 0,
          role: "user",
          blocks: [received],
          ...(options.relayed === false ? { authorUserId: id } : {}),
        },
      });
      const runFor = async (trigger: string, status: string, sourceMessageId?: string) => {
        const task = await sys.task.create({
          data: {
            spaceId: id,
            userId: id,
            botId: botB.id,
            threadId: threadB.id,
            prompt: "Test",
            status: "completed",
          },
        });
        return sys.run.create({
          data: {
            spaceId: id,
            userId: id,
            botId: botB.id,
            threadId: threadB.id,
            taskId: task.id,
            status,
            trigger,
            sourceMessageId,
          },
        });
      };
      const run = await runFor("bot_message", "completed", inbound.id);
      return { botA, botB, threadA, threadB, inbound, run, runFor };
    });
    // The queue, as far as these tests need it: what was enqueued and not cancelled still fires.
    const queued = new Map<string, BackgroundJob>();
    const jobs: JobPublisher = {
      enqueue: vi.fn(async (job: BackgroundJob) => void queued.set(job.replaceKey!, job)),
      enqueueIn: vi.fn(
        async (_tx: unknown, job: BackgroundJob) => void queued.set(job.replaceKey!, job),
      ),
      enqueueManyIn: vi.fn(async () => undefined),
      cancelIn: vi.fn(async (_tx: unknown, key: string) => void queued.delete(key)),
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const deps = { prisma, jobs, events: { notify: vi.fn(async () => undefined) } };
    const sender = { id: fixture.botB.id, name: fixture.botB.name };
    const runInput = (run: { id: string }) => ({
      id: run.id,
      spaceId: id,
      threadId: fixture.threadB.id,
      botId: fixture.botB.id,
      userId: id,
      sourceMessageId: fixture.inbound.id,
    });
    const pointers = () =>
      runAsSystem("read pointers", () =>
        asSystem(prisma).message.findMany({
          where: { threadId: fixture.threadA.id, clientNonce: { startsWith: "relay-pointer:" } },
          select: { blocks: true, botId: true, role: true },
        }),
      );
    const agent = (status: string) =>
      runAsSystem("agent fixture", () =>
        asSystem(prisma).cloudAgent.create({
          data: {
            operationKey: randomUUID(),
            providerKey: "test",
            spaceId: id,
            userId: id,
            botId: fixture.botB.id,
            threadId: fixture.threadB.id,
            title: "Queue audit",
            status,
            launchRequest: {},
            originBotId: fixture.botA.id,
            originMessageId: fixture.inbound.id,
          },
        }),
      );
    return { ...fixture, deps, sender, runInput, pointers, agent, queued };
  }

  it("leaves one pointer in the asking chat when the relayed question is answered", async () => {
    const t = await setup();
    for (let attempt = 0; attempt < 2; attempt++) {
      await runAsSystem("outcome return", () =>
        returnBotMessageOutcome(
          t.deps as never,
          t.runInput(t.run),
          t.sender,
          "Billing and Search still use it.",
        ),
      );
    }
    const pointers = await t.pointers();
    expect(pointers).toHaveLength(1);
    expect(pointers[0]).toMatchObject({ role: "bot", botId: t.botA.id });
    const [line, mention] = pointers[0]!.blocks as Array<Record<string, string>>;
    expect(line).toMatchObject({ kind: "text" });
    expect(line!.text).toContain("Engineering Lead finished");
    expect(line!.text).toContain("Which services still use the old queue?");
    // A pointer, not the answer.
    expect(line!.text).not.toContain("Billing and Search");
    // A bot mention, which web and mobile both open as that bot's chat.
    expect(mention).toMatchObject({
      kind: "child_bot",
      botId: t.botB.id,
      name: "Engineering Lead",
      status: "created",
    });
  });

  it("leaves nothing for a report that was not a relayed request", async () => {
    const t = await setup({ relayed: false });
    await runAsSystem("outcome return", () =>
      returnBotMessageOutcome(t.deps as never, t.runInput(t.run), t.sender, "Done."),
    );
    expect(await t.pointers()).toHaveLength(0);
  });

  it("leaves nothing for the bot's intermediate messages", async () => {
    const t = await setup();
    const running = await t.runFor("bot_message", "running", t.inbound.id);
    const sent = await runAsSystem("interim message", () =>
      messageBot(t.deps as never, t.runInput(running), t.sender, {
        bot_id: t.botA.id,
        message: "Still looking at Billing.",
        intent: "status",
      }),
    );
    expect(sent.ok).toBe(true);
    expect(await t.pointers()).toHaveLength(0);
  });

  it("waits for the cloud agent the bot started, then points once at its report", async () => {
    const t = await setup();
    const agent = await t.agent("running");
    await runAsSystem("outcome return", () =>
      returnBotMessageOutcome(t.deps as never, t.runInput(t.run), t.sender, "Launched an agent."),
    );
    expect(await t.pointers()).toHaveLength(0);
    const wake = async (nonce: string) => {
      const run = await t.runFor("cloud_agent", "completed");
      await runAsSystem("wake nonce", () =>
        asSystem(prisma).run.update({
          where: { id: run.id },
          data: { clientNonce: nonce, cloudAgentWakeNonces: [nonce] },
        }),
      );
      await runAsSystem("wake pointer", () =>
        postCloudAgentRelayPointers(t.deps as never, run, t.sender),
      );
    };
    // A question or approval along the way is not the report.
    await wake(`cloud-agent-attention:${agent.id}:request-1`);
    expect(await t.pointers()).toHaveLength(0);
    await wake(`cloud-agent-wake-run:${agent.id}:0`);
    await wake(`cloud-agent-wake-run:${agent.id}:1`);
    expect(await t.pointers()).toHaveLength(1);
  });

  it("points when the run that waited for the agent's result reports it itself", async () => {
    const t = await setup();
    const agent = await t.agent("finished");
    // The agent finished while this run waited for it, so no wake was made: this run reports it.
    await runAsSystem("waiting run", () =>
      asSystem(prisma).cloudAgent.update({
        where: { id: agent.id },
        data: { waitingRunId: t.run.id },
      }),
    );
    await runAsSystem("outcome return", () =>
      returnBotMessageOutcome(t.deps as never, t.runInput(t.run), t.sender, "Billing and Search."),
    );
    expect(await t.pointers()).toHaveLength(1);
  });

  /** B's report run for a finished job: the wake is made, the run completes, then the post is tried. */
  async function reportRun(t: Awaited<ReturnType<typeof setup>>) {
    const agent = await t.agent("finished");
    const wakeRunIds = await runAsSystem("wake", () =>
      prisma.$transaction((tx) =>
        createCloudAgentWake(
          tx,
          agent,
          "The agent finished.",
          `cloud-agent-wake-run:${agent.id}:${agent.generation}`,
          { jobs: t.deps.jobs },
        ),
      ),
    );
    await runAsSystem("complete the report run", () =>
      asSystem(prisma).run.update({ where: { id: wakeRunIds[0]! }, data: { status: "completed" } }),
    );
    return { agent, run: { id: wakeRunIds[0]! } };
  }

  /** Fires what the queue still holds, as the worker would once a job is due. */
  async function fireQueued(t: Awaited<ReturnType<typeof setup>>) {
    for (const job of [...t.queued.values()]) {
      if (job.name !== "cloud_agent.relay_pointer") continue;
      await runAsSystem("relay pointer backup", () =>
        runRelayPointerBackup(t.deps as never, job.payload as never),
      );
    }
  }

  it("still leaves one pointer when posting it fails after the report run completed", async () => {
    const t = await setup();
    const { run } = await reportRun(t);
    // The backup was recorded with the wake, before anything could go wrong.
    expect([...t.queued.keys()]).toHaveLength(1);
    let failures = 1;
    const flaky = new Proxy(prisma, {
      get: (target, key) =>
        key === "$transaction" && failures-- > 0
          ? () => Promise.reject(new Error("database went away"))
          : Reflect.get(target, key),
    });
    await expect(
      runAsSystem("direct post", () =>
        postCloudAgentRelayPointers({ ...t.deps, prisma: flaky } as never, run, t.sender),
      ),
    ).rejects.toThrow("database went away");
    expect(await t.pointers()).toHaveLength(0);
    await fireQueued(t);
    await fireQueued(t);
    expect(await t.pointers()).toHaveLength(1);
  });

  it("leaves one pointer when the process dies before posting, and retires the job when it posts", async () => {
    const crashed = await setup();
    await reportRun(crashed);
    await fireQueued(crashed);
    expect(await crashed.pointers()).toHaveLength(1);

    const posted = await setup();
    const { run } = await reportRun(posted);
    await runAsSystem("direct post", () =>
      postCloudAgentRelayPointers(posted.deps as never, run, posted.sender),
    );
    expect(await posted.pointers()).toHaveLength(1);
    expect(posted.queued.size).toBe(0);
    await fireQueued(posted);
    expect(await posted.pointers()).toHaveLength(1);
  });
});
