import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentRunRequest,
  BackgroundJob,
  CloudAgentAttention,
  CloudAgentProvider,
  CloudAgentReplyRequest,
  CloudAgentSnapshot,
  JobPublisher,
} from "@rakazo/adapter-kit";
import {
  createRunExecutor,
  EncryptedSecretStore,
  FakeBrowserProvider,
  FakeSandboxProvider,
  LocalAgentHomeStore,
  pollCloudAgent,
  ScriptedAgentRuntime,
} from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { asSystem, createDb, createThreadEvents, runAsSystem, runAsTenant } from "@rakazo/db";
import { MarkdownMemoryStore } from "@rakazo/memory";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;

/** The remote coding agents, scripted by the test; it records what the coordinator sent. */
class ScriptedRemote implements CloudAgentProvider {
  readonly agents = new Map<
    string,
    { status: CloudAgentSnapshot["status"]; attention: CloudAgentAttention[]; prompt: string }
  >();
  readonly answers: CloudAgentReplyRequest[] = [];
  maxRunning = 0;
  describe() {
    return {
      id: "scripted",
      contractVersion: "1",
      adapterVersion: "0",
      capabilities: { launch: true, reply: true, cancel: true, offline: true },
    };
  }
  async launch(request: { idempotencyKey: string; prompt: string }) {
    const id = `remote:${request.idempotencyKey}`;
    this.agents.set(id, { status: "running", attention: [], prompt: request.prompt });
    const running = [...this.agents.values()].filter((agent) => agent.status === "running");
    this.maxRunning = Math.max(this.maxRunning, running.length);
    return { id, url: "", title: "", status: "running" as const };
  }
  async get(id: string) {
    const agent = this.agents.get(id)!;
    return { id, url: "", title: "", status: agent.status, attention: [...agent.attention] };
  }
  async reply(id: string, request: CloudAgentReplyRequest) {
    this.answers.push(request);
    this.agents.get(id)!.attention = [];
    return this.get(id);
  }
  async cancel(id: string) {
    return this.get(id);
  }
  byPrompt(prompt: string) {
    return [...this.agents.values()].find((agent) => agent.prompt === prompt)!;
  }
}

/**
 * The coordinator's model: launch what the owner agreed, answer a question, judge a result.
 * Every call goes through the executor's tool gate, as a real model's would.
 */
const coordinator = {
  describe: () => ({
    ...new ScriptedAgentRuntime().describe(),
    capabilities: { streaming: true, compaction: false, tools: true, scripted: false },
  }),
  abort: async () => undefined,
  async *run(request: AgentRunRequest) {
    const call = (name: string, args: Record<string, unknown>) =>
      request.executeTool!(name, args, `${request.runId}:${name}:${args.id ?? "launch"}`);
    const agreed = /^Agreed: request (\d+)/.exec(request.prompt);
    const inputs = [...request.prompt.matchAll(/^Cloud agent (\S+) needs input/gm)];
    const endings = [...request.prompt.matchAll(/^Cloud agent (\S+) is (\w+)\./gm)];
    if (agreed) {
      await call("cloud_agent_launch", {
        prompt: `Request ${agreed[1]}`,
        requestKey: `request-${agreed[1]}`,
        agreement: request.prompt,
      });
    }
    for (const input of inputs) {
      await call("cloud_agent_status", { id: input[1] });
      await call("cloud_agent_reply", { id: input[1], prompt: "Use the existing style." });
    }
    for (const ended of endings) {
      await call("cloud_agent_status", { id: ended[1] });
      await call("cloud_agent_report", {
        id: ended[1],
        verdict: ended[2] === "finished" ? "accepted" : "needs_owner",
        summary: ended[2] === "finished" ? "Checked the result." : "It failed; the owner decides.",
      });
    }
    yield { type: "done" as const, text: "ok" };
  },
};

describePostgres("a coordinator bot runs six agreed requests (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  let system: PrismaClient;
  let dataDir: string;
  const organizations: string[] = [];

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
    system = asSystem(prisma);
    dataDir = await mkdtemp(join(process.cwd(), ".cloud-agent-coordinator-test-"));
    await system.deploymentSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        defaultModelProvider: "openrouter",
        defaultModelId: "openai/gpt-4o",
      },
      update: { defaultModelProvider: "openrouter", defaultModelId: "openai/gpt-4o" },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await system.cloudAgent.deleteMany({ where: { spaceId: { in: organizations } } });
      await system.organization.deleteMany({ where: { id: { in: organizations } } });
      await system.user.deleteMany({ where: { id: { in: organizations } } });
      await prisma.$disconnect();
      await db.pool.end();
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("launches two at a time, then answers, judges and reports each from its own wake", async () => {
    const id = randomUUID();
    organizations.push(id);
    await system.user.create({
      data: { id, name: "Owner", email: `${id}@example.test`, emailVerified: true },
    });
    await system.organization.create({
      data: { id, name: "Owner", slug: id, createdAt: new Date() },
    });
    await system.space.create({ data: { id, organizationId: id, name: "Home" } });
    await system.member.create({
      data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
    });
    await system.spaceMember.create({
      data: {
        id,
        spaceId: id,
        organizationId: id,
        userId: id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    // The owner lets the coordinator launch and answer without a card in their own chat.
    for (const tool of ["cloud_agent_launch", "cloud_agent_reply"])
      await system.userActionApprovalRule.create({
        data: {
          userId: id,
          effect: "always_allow",
          matchKind: "tool",
          matchValue: tool,
        },
      });
    const sandbox = new FakeSandboxProvider();
    const actor: Actor = {
      spaceId: id,
      userId: id,
      email: `${id}@example.test`,
      isDeploymentOwner: false,
    };
    const ref = await sandbox.provision(
      { botId: id, homePath: dataDir },
      {
        ...actor,
        operationId: "fixture",
        traceId: "fixture",
        signal: new AbortController().signal,
      },
    );
    const computer = await system.computer.create({
      data: {
        spaceId: id,
        userId: id,
        scopeKey: id,
        homeKey: id,
        kind: "fake",
        state: "running",
        providerRef: ref.id,
      },
    });
    const bot = await system.bot.create({
      data: { spaceId: id, userId: id, name: "Lead", color: "test", computerId: computer.id },
    });
    const thread = await system.thread.create({ data: { spaceId: id, userId: id, botId: bot.id } });

    const remote = new ScriptedRemote();
    const queue: BackgroundJob[] = [];
    const jobs: JobPublisher = {
      enqueue: async (job) => void queue.push(job),
      enqueueIn: async (_tx, job) => void queue.push(job),
      cancelIn: async () => undefined,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const events = createThreadEvents(prisma);
    const cloudAgent = { key: `coordinator:${id}`, spaceId: id, provider: remote };
    const executor = createRunExecutor({
      prisma,
      events,
      jobs,
      sandbox,
      browser: new FakeBrowserProvider(),
      runtime: coordinator,
      home: new LocalAgentHomeStore(dataDir),
      memory: new MarkdownMemoryStore(prisma),
      memoryProviders: { resolve: async () => null },
      secretStore: new EncryptedSecretStore("fake-fixture-encryption-key"),
      secrets: [],
      deploymentModelKey: "fake-fixture-model-key",
      deploymentModelConfigured: true,
      dataDir,
      cloudAgent,
    });
    /** The worker: runs each queued turn, and polls each agent once per pass. */
    const settle = async () => {
      for (let pass = 0; pass < 6; pass += 1) {
        const polls = new Set<string>();
        while (queue.length) {
          const job = queue.shift()!;
          if (job.name === "run.continue")
            await runAsTenant(actor, () => executor.continueRun(job.payload.runId, "worker"));
          if (job.name === "cloud_agent.poll") polls.add(job.payload.agentId);
        }
        for (const agentId of polls)
          await runAsSystem("cloud agent poll job", () =>
            pollCloudAgent({ prisma, jobs, events, cloudAgent }, { agentId }),
          );
      }
    };
    const say = async (text: string) => {
      const { nextMessageSeq } = await system.thread.update({
        where: { id: thread.id },
        data: { nextMessageSeq: { increment: 1 } },
        select: { nextMessageSeq: true },
      });
      const message = await system.message.create({
        data: {
          threadId: thread.id,
          botId: bot.id,
          authorUserId: id,
          seq: nextMessageSeq - 1,
          role: "user",
          blocks: [{ kind: "text", text }],
          clientNonce: randomUUID(),
        },
      });
      const task = await system.task.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          prompt: text,
          status: "queued",
        },
      });
      const run = await system.run.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          taskId: task.id,
          status: "queued",
          trigger: "user",
          sourceMessageId: message.id,
        },
      });
      queue.push({ name: "run.continue", payload: { runId: run.id } } as BackgroundJob);
      await settle();
      return run.id;
    };

    // Six agreements, with ordinary chat in between, each its own turn.
    const turns = [];
    for (const text of [
      "Agreed: request 1, fix the login copy.",
      "How was your morning?",
      "Agreed: request 2, add the export button.",
      "Agreed: request 3, update the docs.",
      "Thanks, that is all for now.",
      "Agreed: request 4, tidy the settings page.",
      "Agreed: request 5, rename the field.",
      "Agreed: request 6, bump the timeout.",
    ])
      turns.push(await say(text));
    // Each turn ended before any agent did; only two ever ran at once.
    expect(
      (await system.run.findMany({ where: { id: { in: turns } } })).map((run) => run.status),
    ).toEqual(Array(8).fill("completed"));
    const rows = () =>
      system.cloudAgent.findMany({ where: { spaceId: id }, orderBy: { createdAt: "asc" } });
    expect((await rows()).map((row) => row.requestKey)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `request-${n}`),
    );
    expect(remote.agents.size).toBe(2);

    // Request 1 asks a question, request 2 fails, the rest finish as slots free.
    remote.byPrompt("Request 1").attention = [{ requestId: "q1", kind: "question" }];
    await settle();
    remote.byPrompt("Request 2").status = "failed";
    await settle();
    remote.byPrompt("Request 1").status = "finished";
    for (let n = 3; n <= 6; n += 1) {
      await settle();
      remote.byPrompt(`Request ${n}`).status = "finished";
    }
    await settle();

    expect(remote.maxRunning).toBe(2);
    expect(remote.answers).toMatchObject([{ prompt: "Use the existing style.", questionId: "q1" }]);
    // Every request got its verdict from a wake about that request, after the owner's turn ended.
    expect((await rows()).map((row) => [row.requestKey, row.status, row.verdict])).toEqual([
      ["request-1", "finished", "accepted"],
      ["request-2", "failed", "needs_owner"],
      ...[3, 4, 5, 6].map((n) => [`request-${n}`, "finished", "accepted"]),
    ]);
    const wakes = await system.run.findMany({
      where: { threadId: thread.id, trigger: "cloud_agent" },
    });
    expect(wakes.every((run) => run.status === "completed")).toBe(true);
    expect(wakes.flatMap((run) => run.cloudAgentWakeNonces)).toHaveLength(7);
  });
});
