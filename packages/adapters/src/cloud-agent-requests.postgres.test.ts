import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  BackgroundJob,
  CloudAgentAttention,
  CloudAgentProvider,
  CloudAgentSnapshot,
  JobPublisher,
} from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { pollCloudAgent } from "./cloud-agent-poll.js";
import {
  executeCloudAgentTool,
  reconcileCloudAgents,
  reportCloudAgent,
} from "./cloud-agent-service.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;

/** A scripted provider: each remote agent's state is set by the test. */
class ScriptedProvider implements CloudAgentProvider {
  readonly agents = new Map<
    string,
    { status: CloudAgentSnapshot["status"]; attention: CloudAgentAttention[]; cursor: number }
  >();
  launches = 0;
  describe() {
    return {
      id: "scripted",
      contractVersion: "1",
      adapterVersion: "0",
      capabilities: { launch: true, reply: true, cancel: true, offline: true },
    };
  }
  async launch(request: { idempotencyKey: string }) {
    this.launches += 1;
    const id = `remote:${request.idempotencyKey}`;
    if (!this.agents.has(id)) this.agents.set(id, { status: "running", attention: [], cursor: 0 });
    return { id, url: "", title: "", status: "running" as const };
  }
  async get(id: string) {
    const agent = this.agents.get(id)!;
    agent.cursor += 1;
    return { id, url: "", title: "", ...agent, attention: [...agent.attention] };
  }
  async reply(id: string) {
    return { id, url: "", title: "", status: "running" as const, latestRunId: randomUUID() };
  }
  async cancel(id: string) {
    return this.get(id);
  }
}

describePostgres("tracked cloud agent requests (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const users: string[] = [];
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  afterAll(async () => {
    if (!db) return;
    await prisma.cloudAgent.deleteMany({ where: { userId: { in: users } } });
    await prisma.organization.deleteMany({ where: { id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  async function setup() {
    const id = randomUUID();
    users.push(id);
    const fixture = await runAsSystem("test fixture", async () => {
      await prisma.user.create({
        data: { id, name: "Requests", email: `${id}@example.test`, emailVerified: true },
      });
      await prisma.organization.create({
        data: { id, name: "Requests", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Requests", isDefault: true },
      });
      await prisma.member.create({
        data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
      });
      const lead = await prisma.bot.create({
        data: { spaceId: id, userId: id, name: "Lead", color: "test-color" },
      });
      const asker = await prisma.bot.create({
        data: { spaceId: id, userId: id, name: "Asker", color: "test-color" },
      });
      const thread = await prisma.thread.create({
        data: { spaceId: id, userId: id, botId: lead.id },
      });
      await prisma.thread.create({ data: { spaceId: id, userId: id, botId: asker.id } });
      const task = await prisma.task.create({
        data: {
          spaceId: id,
          userId: id,
          botId: lead.id,
          threadId: thread.id,
          prompt: "Test",
          status: "running",
        },
      });
      // Still running, as the bot's own turn is when it launches and reports.
      const run = await prisma.run.create({
        data: {
          spaceId: id,
          userId: id,
          botId: lead.id,
          threadId: thread.id,
          taskId: task.id,
          status: "running",
          trigger: "user",
        },
      });
      return { lead, asker, thread, run };
    });
    const provider = new ScriptedProvider();
    const connection: CloudAgentConnection = { key: `requests:${id}`, spaceId: id, provider };
    const jobs: JobPublisher = {
      enqueue: vi.fn(async (_job: BackgroundJob) => undefined),
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const deps = {
      prisma,
      jobs,
      events: { notify: vi.fn(async () => undefined) },
      cloudAgent: connection,
    };
    const context: AdapterContext & { botId: string; botName: string } = {
      operationId: randomUUID(),
      traceId: "test",
      spaceId: id,
      userId: id,
      botId: fixture.lead.id,
      botName: "Lead",
      signal: new AbortController().signal,
    };
    const launch = async (n: number, origin?: { botId: string; messageId: string }) => {
      const result = await runAsSystem("agent run tool call", () =>
        executeCloudAgentTool(
          deps,
          { ...context, operationId: randomUUID() },
          fixture.run,
          "cloud_agent_launch",
          { prompt: `Request ${n}`, requestKey: `request-${n}`, agreement: "Owner said yes" },
          origin,
        ),
      );
      if (!("id" in result)) throw new Error(`Launch failed: ${JSON.stringify(result)}`);
      return result.id;
    };
    const state = (agentId: string) =>
      asSystem(prisma).cloudAgent.findUniqueOrThrow({ where: { id: agentId } });
    const poll = (agentId: string) =>
      runAsSystem("cloud agent poll job", () => pollCloudAgent(deps, { agentId }));
    const remote = async (agentId: string) =>
      provider.agents.get((await state(agentId)).remoteId!)!;
    const wakes = () =>
      asSystem(prisma).run.findMany({
        where: { threadId: fixture.thread.id, trigger: "cloud_agent" },
        orderBy: { createdAt: "asc" },
      });
    const reconcile = () => runAsSystem("reconciler", () => reconcileCloudAgents(deps));
    return { ...fixture, provider, deps, context, launch, state, poll, remote, wakes, reconcile };
  }

  it("runs two requests at a time, queues the rest in order and drains the queue", async () => {
    const t = await setup();
    const ids: string[] = [];
    for (let n = 1; n <= 6; n += 1) ids.push(await t.launch(n));
    // The same agreed request, sent again in a later turn, is the same row.
    expect(await t.launch(3)).toBe(ids[2]);
    const queued = async () =>
      (await Promise.all(ids.map(t.state))).map((row) => row.queuedAt !== null);
    expect(await queued()).toEqual([false, false, true, true, true, true]);
    for (const id of ids) await t.poll(id);
    expect(t.provider.launches).toBe(2);
    // Cancelling a request still in the queue ends it there, without waiting for a slot.
    const extra = await t.launch(7);
    await runAsSystem("agent run tool call", () =>
      executeCloudAgentTool(t.deps, t.context, t.run, "cloud_agent_cancel", { id: extra }),
    );
    await t.poll(extra);
    expect(await t.state(extra)).toMatchObject({ status: "cancelled", queuedAt: null });
    expect(t.provider.launches).toBe(2);

    for (let done = 0; done < ids.length; done += 1) {
      (await t.remote(ids[done]!)).status = "finished";
      await t.poll(ids[done]!);
      // The next queued request starts as soon as a slot frees.
      const next = ids[done + 2];
      if (next) {
        expect((await t.state(next)).queuedAt).toBeNull();
        await t.poll(next);
      }
    }
    expect((await Promise.all(ids.map(t.state))).map((row) => row.status)).toEqual(
      Array(6).fill("finished"),
    );
    expect(t.provider.launches).toBe(6);
    expect(await t.wakes()).toHaveLength(7);
  });

  it("wakes once per question, again for a replaced one, and retries a failed wake", async () => {
    const t = await setup();
    const id = await t.launch(1);
    await t.poll(id);
    const agent = await t.remote(id);
    agent.attention = [{ requestId: "q1", kind: "question" }];
    await t.poll(id);
    await t.poll(id);
    expect((await t.wakes()).map((run) => run.clientNonce)).toEqual([
      `cloud-agent-attention:${id}:q1`,
    ]);
    expect((await t.state(id)).status).toBe("running");
    // A new blocker in place of the old one is new work for the bot, though the count stays 1.
    agent.attention = [{ requestId: "q2", kind: "approval" }];
    await t.poll(id);
    expect(await t.wakes()).toHaveLength(2);
    expect((await t.state(id)).remoteCursor).toBe(3);

    agent.attention = [];
    agent.status = "finished";
    await t.poll(id);
    await t.poll(id);
    const finished = (await t.wakes()).at(-1)!;
    expect(finished.clientNonce).toBe(`cloud-agent-wake-run:${id}:0`);
    await asSystem(prisma).run.update({ where: { id: finished.id }, data: { status: "failed" } });
    await t.reconcile();
    await t.reconcile();
    expect((await t.wakes()).map((run) => run.clientNonce).at(-1)).toBe(
      `cloud-agent-wake-run:${id}:0:r1`,
    );
    expect(await t.wakes()).toHaveLength(4);
  });

  it("records the asking bot and tells it the verdict once", async () => {
    const t = await setup();
    const id = await t.launch(1, { botId: t.asker.id, messageId: "message:ask" });
    expect((await t.state(id)).originBotId).toBe(t.asker.id);
    await t.poll(id);
    expect(
      await runAsSystem("tool", () =>
        reportCloudAgent(t.deps as never, t.context, t.run, {
          id,
          verdict: "accepted",
          summary: "Too early",
        }),
      ),
    ).toEqual({ error: "Report once the cloud agent has finished." });
    (await t.remote(id)).status = "finished";
    await t.poll(id);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runAsSystem("tool", () =>
        reportCloudAgent(t.deps as never, t.context, t.run, {
          id,
          verdict: "accepted",
          summary: "Tests pass",
        }),
      );
    }
    const received = await asSystem(prisma).message.findMany({
      where: { thread: { botId: t.asker.id }, clientNonce: { startsWith: "bot-message:" } },
    });
    expect(received).toHaveLength(1);
    expect((await t.state(id)).verdict).toBe("accepted");
  });
});
