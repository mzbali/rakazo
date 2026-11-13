import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  BackgroundJob,
  CloudAgentAttention,
  CloudAgentProvider,
  CloudAgentSnapshot,
  ConnectorProvider,
  JobPublisher,
} from "@rakazo/adapter-kit";
import { CloudAgentRetryLater } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { createCloudAgentWake, pollCloudAgent } from "./cloud-agent-poll.js";
import {
  executeCloudAgentTool,
  reconcileCloudAgents,
  reportCloudAgent,
  trackDirectCloudAgent,
} from "./cloud-agent-service.js";
import { cancelStaleCloudAgentWake, cloudAgentWakeNonces } from "./cloud-agent-wake-start.js";
import { createRunExecutor } from "./executor.js";
import { T3CloudAgentProvider } from "./t3-cloud-agent.js";
import { T3ThreadEventsEmulator, t3EmulatedProvider } from "./t3-cloud-agent.test-support.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;

/** A scripted provider: each remote agent's state is set by the test. */
class ScriptedProvider implements CloudAgentProvider {
  readonly agents = new Map<
    string,
    {
      status: CloudAgentSnapshot["status"];
      attention: CloudAgentAttention[];
      missed?: CloudAgentAttention[];
      cursor: number;
      latestRunId?: string;
    }
  >();
  launches = 0;
  /** Holds a read after it is taken, as a slow poll would, until the test lets it return. */
  stall?: Promise<void>;
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
    this.agents.get(id)!.cursor += 1;
    const { missed = [], ...agent } = this.agents.get(id)!;
    // Closed blockers are events: each is reported once, from the cursor that saw it.
    delete this.agents.get(id)!.missed;
    const read = { ...agent, attention: [...agent.attention] };
    await this.stall;
    return {
      id,
      url: "",
      title: "",
      ...read,
      missedAttention: missed,
    };
  }
  replies = 0;
  /** Makes the next reply wait for the test, then refuse as a busy provider would. */
  refuseReply?: Promise<void>;
  async reply(id: string) {
    this.replies += 1;
    if (this.refuseReply) {
      const refusal = this.refuseReply;
      this.refuseReply = undefined;
      await refusal;
      throw new CloudAgentRetryLater("unavailable");
    }
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

  /** `launchedBy` stands in for the scripted provider, to drive a real adapter end to end. */
  async function setup(launchedBy?: CloudAgentProvider) {
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
    const connection: CloudAgentConnection = {
      key: `requests:${id}`,
      spaceId: id,
      provider: launchedBy ?? provider,
    };
    const jobs: JobPublisher = {
      enqueue: vi.fn(async (_job: BackgroundJob) => undefined),
      enqueueIn: async () => undefined,
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
    const wakeNonces = async () => (await wakes()).flatMap(cloudAgentWakeNonces);
    const reconcile = () => runAsSystem("reconciler", () => reconcileCloudAgents(deps));
    return {
      ...fixture,
      provider,
      deps,
      context,
      launch,
      state,
      poll,
      remote,
      wakes,
      wakeNonces,
      reconcile,
    };
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
    expect(await t.wakeNonces()).toHaveLength(7);
  });

  it("keeps the same request key from two members of a group apart", async () => {
    const t = await setup();
    const mine = await t.launch(1);
    const other = await runAsSystem("agent run tool call", () =>
      executeCloudAgentTool(
        t.deps,
        { ...t.context, userId: randomUUID(), operationId: randomUUID() },
        t.run,
        "cloud_agent_launch",
        { prompt: "Request 1", requestKey: "request-1", agreement: "Owner said yes" },
      ),
    );
    expect(other).toHaveProperty("id");
    expect((other as { id: string }).id).not.toBe(mine);
  });

  it("starts a queued request after a crash left its slot free", async () => {
    const t = await setup();
    const ids: string[] = [];
    for (let n = 1; n <= 3; n += 1) ids.push(await t.launch(n));
    // A request ended without the queue moving on, as if the worker died in between.
    await asSystem(prisma).cloudAgent.update({
      where: { id: ids[0]! },
      data: { status: "finished", nextPollAt: null },
    });
    expect((await t.state(ids[2]!)).queuedAt).not.toBeNull();
    await t.reconcile();
    expect((await t.state(ids[2]!)).queuedAt).toBeNull();
  });

  it("wakes once per question, again for a replaced one, and retries a failed wake", async () => {
    const t = await setup();
    const id = await t.launch(1);
    await t.poll(id);
    const agent = await t.remote(id);
    agent.attention = [{ requestId: "q1", kind: "question" }];
    await t.poll(id);
    await t.poll(id);
    expect(await t.wakeNonces()).toEqual([`cloud-agent-attention:${id}:q1`]);
    expect((await t.state(id)).status).toBe("running");
    // A new blocker in place of the old one is new work for the bot, though the count stays 1.
    agent.attention = [{ requestId: "q2", kind: "approval" }];
    await t.poll(id);
    expect(await t.wakeNonces()).toHaveLength(2);
    expect((await t.state(id)).remoteCursor).toBe(3);
    // Closed blockers do not wake the bot while the agent is still running.
    agent.missed = [
      { requestId: "q3", kind: "question" },
      { requestId: "q2", kind: "approval" },
    ];
    await t.poll(id);
    expect(await t.wakeNonces()).toEqual([
      `cloud-agent-attention:${id}:q1`,
      `cloud-agent-attention:${id}:q2`,
    ]);
    // A failed wake for a blocker still open is retried, at most three wakes in all.
    agent.attention = [{ requestId: "q2", kind: "approval" }];
    await t.poll(id);
    const failWake = async (nonce: string) =>
      asSystem(prisma).run.updateMany({
        where: { OR: [{ clientNonce: nonce }, { cloudAgentWakeNonces: { has: nonce } }] },
        data: { status: "failed" },
      });
    await failWake(`cloud-agent-attention:${id}:q2`);
    await t.reconcile();
    await t.reconcile();
    await failWake(`cloud-agent-attention:${id}:q2:r1`);
    await t.reconcile();
    await failWake(`cloud-agent-attention:${id}:q2:r2`);
    await t.reconcile();
    expect((await t.wakeNonces()).slice(2)).toEqual([
      `cloud-agent-attention:${id}:q2:r1`,
      `cloud-agent-attention:${id}:q2:r2`,
    ]);
    // A failed wake for a blocker that has closed is not retried.
    await failWake(`cloud-agent-attention:${id}:q1`);
    await t.reconcile();
    expect(await t.wakeNonces()).toHaveLength(4);

    agent.attention = [];
    agent.status = "finished";
    await t.poll(id);
    await t.poll(id);
    const finished = (await t.wakes()).at(-1)!;
    expect(await t.wakeNonces()).toHaveLength(5);
    expect(finished.cloudAgentWakeNonces).toContain(`cloud-agent-wake-run:${id}:0`);
    await asSystem(prisma).run.update({ where: { id: finished.id }, data: { status: "failed" } });
    await t.reconcile();
    await t.reconcile();
    expect((await t.wakeNonces()).at(-1)).toBe(`cloud-agent-wake-run:${id}:0:r1`);
    expect(await t.wakeNonces()).toHaveLength(6);
  });

  it.each(["running", "finished"] as const)(
    "drops closed blockers when the saved agent is %s",
    async (status) => {
      const t = await setup();
      const id = await t.launch(1);
      await t.poll(id);
      const remote = await t.remote(id);
      remote.status = status;
      remote.missed = [{ requestId: "answered-elsewhere", kind: "approval" }];
      await t.poll(id);
      expect(await t.wakeNonces()).toEqual(
        status === "running" ? [] : [`cloud-agent-wake-run:${id}:0`],
      );
    },
  );

  it("keeps a failed closure and its terminal notification in one wake", async () => {
    const t = await setup();
    const id = await t.launch(1);
    await t.poll(id);
    const remote = await t.remote(id);
    remote.status = "failed";
    remote.missed = [{ requestId: "closed", kind: "question" }];
    await t.poll(id);
    expect(await t.wakes()).toHaveLength(1);
    expect(await t.wakeNonces()).toEqual([
      `cloud-agent-wake-run:${id}:0`,
      `cloud-agent-attention:${id}:closed`,
    ]);
  });

  it.each(["attention", "reported", "continued"] as const)(
    "cancels a stale %s wake before invoking the model",
    async (kind) => {
      const t = await setup();
      const id = await t.launch(1);
      await t.poll(id);
      const remote = await t.remote(id);
      if (kind === "attention") remote.attention = [{ requestId: "q1", kind: "question" }];
      else remote.status = "finished";
      await t.poll(id);
      const [wake] = await t.wakes();
      expect(wake).toBeDefined();
      await asSystem(prisma).cloudAgent.update({
        where: { id },
        data:
          kind === "attention"
            ? { attention: [] }
            : kind === "reported"
              ? { verdict: "accepted" }
              : { generation: 1, status: "running" },
      });
      const model = vi.fn();
      const executor = createRunExecutor({
        ...t.deps,
        runtime: { run: model },
      } as unknown as Parameters<typeof createRunExecutor>[0]);
      await runAsSystem("execute stale wake", () => executor.continueRun(wake!.id, "test-worker"));
      expect(model).not.toHaveBeenCalled();
      expect(await asSystem(prisma).attempt.count({ where: { runId: wake!.id } })).toBe(0);
      expect(await asSystem(prisma).run.findUnique({ where: { id: wake!.id } })).toMatchObject({
        status: "cancelled",
        leaseOwner: null,
      });
      expect(await asSystem(prisma).task.findUnique({ where: { id: wake!.taskId } })).toMatchObject(
        { status: "cancelled" },
      );
    },
  );

  it("coalesces concurrent wakes and keeps every nonce exactly once", async () => {
    const t = await setup();
    const first = await t.launch(1);
    const second = await t.launch(2);
    const a = await t.state(first);
    const b = await t.state(second);
    const queue = (agent: typeof a, requestId: string) =>
      runAsSystem("queue attention wake", () =>
        prisma.$transaction((tx) =>
          createCloudAgentWake(
            tx,
            agent,
            `Cloud agent ${agent.id} needs input (${requestId}).`,
            `cloud-agent-attention:${agent.id}:${requestId}`,
          ),
        ),
      );
    await Promise.all([queue(a, "q1"), queue(b, "q2"), queue(a, "q1")]);
    const wakes = await t.wakes();
    expect(wakes).toHaveLength(1);
    expect(new Set(cloudAgentWakeNonces(wakes[0]!))).toEqual(
      new Set([`cloud-agent-attention:${first}:q1`, `cloud-agent-attention:${second}:q2`]),
    );
    const task = await asSystem(prisma).task.findUniqueOrThrow({ where: { id: wakes[0]!.taskId } });
    expect(task.prompt).toContain(first);
    expect(task.prompt).toContain(second);
    expect(task.prompt.match(/needs input/g)).toHaveLength(2);
    // Claimed work is immutable; a later wake starts another run even before startedAt is set.
    await asSystem(prisma).run.update({ where: { id: wakes[0]!.id }, data: { status: "leased" } });
    await queue(a, "q3");
    expect(await t.wakes()).toHaveLength(2);
  });

  it("keeps a batch with a current secondary wake and retries both identities on failure", async () => {
    const t = await setup();
    const ids = [await t.launch(1), await t.launch(2)];
    for (const id of ids) {
      await t.poll(id);
      (await t.remote(id)).attention = [{ requestId: "question", kind: "question" }];
      await t.poll(id);
    }
    const [wake] = await t.wakes();
    expect(await t.wakes()).toHaveLength(1);
    // The primary wake is obsolete, but the secondary still needs the bot.
    await asSystem(prisma).cloudAgent.update({ where: { id: ids[0]! }, data: { attention: [] } });
    const claimed = await asSystem(prisma).run.update({
      where: { id: wake!.id },
      data: { status: "running", leaseOwner: "batch-worker", leaseFence: 1 },
    });
    expect(
      await runAsSystem("check current batch", () =>
        cancelStaleCloudAgentWake(t.deps, claimed, { owner: "batch-worker", fence: 1 }),
      ),
    ).toBe(false);
    const refreshed = await asSystem(prisma).task.findUniqueOrThrow({
      where: { id: claimed.taskId },
    });
    expect(refreshed.prompt).not.toContain(ids[0]!);
    expect(refreshed.prompt).toContain(ids[1]!);
    // Both requests are current when a model outage fails this batch. Every identity gets its
    // own retry nonce, and the retries can themselves share one queued execution.
    await asSystem(prisma).cloudAgent.update({
      where: { id: ids[0]! },
      data: { attention: [{ requestId: "question", kind: "question" }] },
    });
    await asSystem(prisma).run.update({ where: { id: wake!.id }, data: { status: "failed" } });
    await Promise.all([t.reconcile(), t.reconcile()]);
    expect(await t.wakes()).toHaveLength(2);
    expect((await t.wakes())[1]!.cloudAgentWakeNonces).toEqual(
      ids.map((id) => `cloud-agent-attention:${id}:question:r1`),
    );
    await t.reconcile();
    expect(await t.wakes()).toHaveLength(2);
  });

  it("creates another run when a claim wins the race with a queued append", async () => {
    const t = await setup();
    const id = await t.launch(1);
    await t.poll(id);
    const remote = await t.remote(id);
    remote.attention = [{ requestId: "q1", kind: "question" }];
    await t.poll(id);
    const [wake] = await t.wakes();
    const agent = await t.state(id);
    let found!: () => void;
    let proceed!: () => void;
    const readQueued = new Promise<void>((resolve) => {
      found = resolve;
    });
    const claimed = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const append = runAsSystem("append racing wake", () =>
      prisma.$transaction(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(target, key) {
            if (key !== "run") return Reflect.get(target, key);
            return new Proxy(target.run, {
              get(runs, method) {
                if (method !== "findFirst") return Reflect.get(runs, method);
                return async (args: Parameters<typeof runs.findFirst>[0]) => {
                  const result = await runs.findFirst(args);
                  if (args?.where?.status === "queued") {
                    found();
                    await claimed;
                  }
                  return result;
                };
              },
            });
          },
        });
        return createCloudAgentWake(
          wrapped,
          agent,
          "Second wake (q2)",
          `cloud-agent-attention:${id}:q2`,
        );
      }),
    );
    await readQueued;
    try {
      await asSystem(prisma).run.update({
        where: { id: wake!.id },
        data: { status: "leased", leaseOwner: "winning-worker" },
      });
    } finally {
      proceed();
    }
    await append;
    expect(await t.wakes()).toHaveLength(2);
    const originalTask = await asSystem(prisma).task.findUniqueOrThrow({
      where: { id: wake!.taskId },
    });
    expect(originalTask.prompt).not.toContain("q2");
  });

  it("wakes for work the bot started or messaged with the provider's own tools", async () => {
    const t = await setup();
    t.provider.agents.set("remote:direct", { status: "running", attention: [], cursor: 0 });
    const remote = t.provider.agents.get("remote:direct")!;
    const track = () =>
      runAsSystem("agent run tool call", () =>
        trackDirectCloudAgent(t.deps, { ...t.context, operationId: randomUUID() }, t.run, {
          remoteId: "remote:direct",
          title: "Owner's thread",
        }),
      );
    await track();
    // Another message while it runs is the same piece of work.
    await track();
    const rows = await asSystem(prisma).cloudAgent.findMany({
      where: { userId: t.context.userId },
    });
    expect(rows).toHaveLength(1);
    const id = rows[0]!.id;
    remote.status = "finished";
    await t.poll(id);
    // Messaging it after it finished starts its next piece, which wakes the bot again, even
    // after its card was cleared: it gets a new one rather than being cancelled as abandoned.
    await asSystem(prisma).message.delete({ where: { id: rows[0]!.messageId! } });
    remote.status = "running";
    await track();
    await t.poll(id);
    expect(await t.state(id)).toMatchObject({ status: "running", cancelRequested: false });
    expect((await t.state(id)).messageId).not.toBe(rows[0]!.messageId);
    remote.status = "finished";
    await t.poll(id);
    expect(await t.wakeNonces()).toEqual([
      `cloud-agent-wake-run:${id}:0`,
      `cloud-agent-wake-run:${id}:1`,
    ]);
    expect(t.provider.launches).toBe(0);
  });

  it("wakes once per continuation, even one sent while a poll is reading", async () => {
    const t = await setup();
    t.provider.agents.set("remote:sent", { status: "running", attention: [], cursor: 0 });
    const remote = t.provider.agents.get("remote:sent")!;
    const send = () =>
      runAsSystem("agent run tool call", () =>
        trackDirectCloudAgent(t.deps, { ...t.context, operationId: randomUUID() }, t.run, {
          remoteId: "remote:sent",
          title: "Existing thread",
        }),
      );
    await send();
    const [row] = await asSystem(prisma).cloudAgent.findMany({
      where: { userId: t.context.userId },
    });
    const id = row!.id;
    // The poll reads the first run finished; the next message lands before it commits.
    remote.status = "finished";
    let release!: () => void;
    t.provider.stall = new Promise((resolve) => {
      release = resolve;
    });
    const stale = t.poll(id);
    await vi.waitFor(() => expect(remote.cursor).toBe(1));
    remote.status = "running";
    await send();
    release();
    await stale;
    t.provider.stall = undefined;
    expect(await t.state(id)).toMatchObject({ status: "running", generation: 0 });
    expect(await t.wakeNonces()).toHaveLength(0);
    await t.poll(id);
    remote.status = "finished";
    await t.poll(id);
    // Messaged again once finished: the next piece wakes once more, and replays add nothing.
    await send();
    remote.status = "running";
    await t.poll(id);
    remote.status = "finished";
    await t.poll(id);
    await t.poll(id);
    await t.reconcile();
    expect(await t.wakeNonces()).toEqual([
      `cloud-agent-wake-run:${id}:0`,
      `cloud-agent-wake-run:${id}:1`,
    ]);
    expect(await t.state(id)).toMatchObject({ status: "finished", nextPollAt: null });
  });

  it("resends a refused follow-up even when a message sent meanwhile started a run", async () => {
    const t = await setup();
    t.provider.agents.set("remote:busy", { status: "running", attention: [], cursor: 0 });
    const remote = t.provider.agents.get("remote:busy")!;
    const send = () =>
      runAsSystem("agent run tool call", () =>
        trackDirectCloudAgent(t.deps, { ...t.context, operationId: randomUUID() }, t.run, {
          remoteId: "remote:busy",
          title: "Existing thread",
        }),
      );
    await send();
    const [row] = await asSystem(prisma).cloudAgent.findMany({
      where: { userId: t.context.userId },
    });
    const id = row!.id;
    remote.status = "finished";
    await t.poll(id);
    await runAsSystem("agent run tool call", () =>
      executeCloudAgentTool(
        t.deps,
        { ...t.context, operationId: randomUUID() },
        t.run,
        "cloud_agent_reply",
        { id, prompt: "Add tests" },
      ),
    );
    let release!: () => void;
    t.provider.refuseReply = new Promise((resolve) => {
      release = resolve;
    });
    const refused = t.poll(id);
    await vi.waitFor(() => expect(t.provider.replies).toBe(1));
    // The bot's own message starts a run while the provider is refusing the follow-up.
    remote.status = "running";
    remote.latestRunId = "run:direct";
    await send();
    release();
    await refused;
    await t.poll(id);
    expect(t.provider.replies).toBe(2);
    expect(await t.state(id)).toMatchObject({ followup: null, status: "running" });
    // Both messages are one piece of work, which wakes the bot once when it ends.
    remote.status = "finished";
    await t.poll(id);
    await t.poll(id);
    expect(await t.wakeNonces()).toEqual([
      `cloud-agent-wake-run:${id}:0`,
      `cloud-agent-wake-run:${id}:1`,
    ]);
  });

  it("does not retry an earlier piece's failed wake once a continuation has finished", async () => {
    const t = await setup();
    t.provider.agents.set("remote:again", { status: "running", attention: [], cursor: 0 });
    const remote = t.provider.agents.get("remote:again")!;
    const send = () =>
      runAsSystem("agent run tool call", () =>
        trackDirectCloudAgent(t.deps, { ...t.context, operationId: randomUUID() }, t.run, {
          remoteId: "remote:again",
          title: "Existing thread",
        }),
      );
    await send();
    const [row] = await asSystem(prisma).cloudAgent.findMany({
      where: { userId: t.context.userId },
    });
    const id = row!.id;
    remote.status = "finished";
    await t.poll(id);
    await asSystem(prisma).run.updateMany({
      where: { clientNonce: `cloud-agent-wake-run:${id}:0` },
      data: { status: "failed" },
    });
    // The reconciler has read the first piece as due for a retry when the next piece finishes.
    const findFirst = prisma.run.findFirst.bind(prisma.run);
    const spy = vi.spyOn(prisma.run, "findFirst").mockImplementationOnce((async (args: unknown) => {
      await send();
      remote.status = "running";
      await t.poll(id);
      remote.status = "finished";
      await t.poll(id);
      return findFirst(args as never);
    }) as never);
    await t.reconcile();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(await t.wakeNonces()).toEqual([
      `cloud-agent-wake-run:${id}:0`,
      `cloud-agent-wake-run:${id}:1`,
    ]);
    expect(await t.state(id)).toMatchObject({ generation: 1, wakeAttempts: 1 });
  });

  it("starts a launched thread on the named model and modes, and wakes the bot when it ends", async () => {
    // An offline stand-in for the thread server, reached through the real adapter.
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    let finished = false;
    const handlers: Record<string, () => unknown> = {
      t3_thread_list: () => ({ threads: [] }),
      t3_project_list: () => ({ projects: [{ id: "project:1" }] }),
      t3_thread_launch: () => ({
        threadId: "thread:1",
        runId: "run:1",
        link: "<t3-thread://v2/env/thread%3A1>",
      }),
      t3_thread_events: () => ({
        contractVersion: 1,
        nextSequence: 1,
        hasMore: false,
        gap: null,
        events: [],
        state: {
          idle: finished,
          latestRun: { runId: "run:1", status: finished ? "completed" : "running" },
          pendingRequests: [],
          link: "<t3-thread://v2/env/thread%3A1>",
        },
      }),
    };
    const connector = {
      resolveCall: async (call: { tool: string; args: Record<string, unknown> }) => ({
        call,
        tool: { name: call.tool },
      }),
      async *execute(call: { tool: string; args: Record<string, unknown> }) {
        const tool = call.tool.replace(/^mcp__t3__/, "");
        calls.push({ tool, args: call.args });
        yield { type: "result" as const, data: { structuredContent: handlers[tool]!() } };
      },
    } as unknown as ConnectorProvider;
    const t = await setup(new T3CloudAgentProvider({ connector, server: "t3", holdKey: "hold" }));
    const launchFields = {
      modelSelection: {
        provider: "claudeAgent",
        instanceId: "claude-pool",
        model: "claude-model",
        options: [{ id: "effort", value: "high" }],
      },
      projectId: "project:1",
      workspaceStrategy: { type: "worktree", baseRef: "origin/main", startFromOrigin: true },
      runtimeMode: "full-access",
      interactionMode: "plan",
    };
    const result = await runAsSystem("agent run tool call", () =>
      executeCloudAgentTool(t.deps, t.context, t.run, "cloud_agent_launch", {
        prompt: "Fix the build",
        requestKey: "fix-build",
        ...launchFields,
      }),
    );
    if (!("id" in result)) throw new Error(`Launch failed: ${JSON.stringify(result)}`);
    expect(result.note).toBe("Runtime mode clamped to auto.");
    const clampedFields = { ...launchFields, runtimeMode: "auto" };
    // Stored with the request, so a replay starts with the same ceiling.
    expect((await t.state(result.id)).launchRequest).toMatchObject(clampedFields);
    await t.poll(result.id);
    expect(calls.filter((call) => call.tool === "t3_thread_launch")).toEqual([
      {
        tool: "t3_thread_launch",
        args: {
          title: `Fix the build · ${result.id.slice(0, 13)}`,
          message: "Fix the build",
          clientRequestId: result.id,
          ...clampedFields,
        },
      },
    ]);
    // No model was looked up or set after the launch: the thread started on the named one.
    expect(calls.map((call) => call.tool)).not.toContain("orchestrator_capabilities");
    expect(await t.state(result.id)).toMatchObject({
      remoteId: "thread:1",
      status: "running",
      url: "t3code://threads/env/thread%3A1",
    });

    finished = true;
    await t.poll(result.id);
    expect(await t.state(result.id)).toMatchObject({ status: "finished" });
    expect(await t.wakeNonces()).toEqual([`cloud-agent-wake-run:${result.id}:0`]);
  });

  it("wakes the bot once a thread on the T3 emulator ends, and not before", async () => {
    const emulator = new T3ThreadEventsEmulator();
    const t = await setup(t3EmulatedProvider(emulator));
    const id = await t.launch(1);
    await t.poll(id);
    const { remoteId } = await t.state(id);
    expect(emulator.threads.has(remoteId!)).toBe(true);
    expect(await t.state(id)).toMatchObject({ status: "running" });
    expect(await t.wakeNonces()).toEqual([]);

    emulator.complete(remoteId!);
    await t.poll(id);
    expect(await t.state(id)).toMatchObject({ status: "finished" });
    expect(await t.wakeNonces()).toEqual([`cloud-agent-wake-run:${id}:0`]);
    // Polling a finished agent again does not wake the bot a second time.
    await t.poll(id);
    expect(await t.wakeNonces()).toEqual([`cloud-agent-wake-run:${id}:0`]);
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
    // A different member using the same bot cannot set the initiating user's verdict.
    const otherContext = { ...t.context, userId: randomUUID() };
    const report = { id, verdict: "accepted", summary: "Tests pass" };
    expect(
      await runAsSystem("tool", () =>
        reportCloudAgent(t.deps as never, otherContext, t.run, report),
      ),
    ).toEqual({ error: "Unknown cloud agent, or another bot launched it." });
    expect((await t.state(id)).verdict).toBeNull();
    expect(
      await asSystem(prisma).message.count({
        where: { thread: { botId: t.asker.id }, clientNonce: { startsWith: "bot-message:" } },
      }),
    ).toBe(0);
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
    // Even an exact replay must pass the same ownership check.
    expect(
      await runAsSystem("tool", () =>
        reportCloudAgent(t.deps as never, otherContext, t.run, report),
      ),
    ).toEqual({ error: "Unknown cloud agent, or another bot launched it." });
    // The delivered verdict is the recorded one: a different one later is refused.
    expect(
      await runAsSystem("tool", () =>
        reportCloudAgent(t.deps as never, t.context, t.run, {
          id,
          verdict: "rejected",
          summary: "Changed my mind",
        }),
      ),
    ).toEqual({ error: "Already reported accepted for this work." });
    expect((await t.state(id)).verdict).toBe("accepted");
  });
});
