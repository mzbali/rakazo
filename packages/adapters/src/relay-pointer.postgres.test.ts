import { randomUUID } from "node:crypto";
import type { BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  messageBot,
  postCloudAgentRelayPointers,
  returnBotMessageOutcome,
} from "./bot-messages.js";

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
    const jobs: JobPublisher = {
      enqueue: vi.fn(async (_job: BackgroundJob) => undefined),
      enqueueIn: vi.fn(async () => undefined),
      cancelIn: async () => undefined,
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
    return { ...fixture, deps, sender, runInput, pointers, agent };
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
    const [block] = pointers[0]!.blocks as Array<{ kind: string; text: string }>;
    expect(block!.kind).toBe("text");
    expect(block!.text).toContain("Engineering Lead finished");
    expect(block!.text).toContain("Which services still use the old queue?");
    expect(block!.text).toContain(`(/app/${t.botB.id})`);
    // A pointer, not the answer.
    expect(block!.text).not.toContain("Billing and Search");
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
});
