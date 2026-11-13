import { randomUUID } from "node:crypto";
import type { AdapterContext, BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import { ScopedGoalScope } from "@rakazo/contracts";
import { createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { pollCloudAgent } from "./cloud-agent-poll.js";
import { executeCloudAgentTool, reportCloudAgent } from "./cloud-agent-service.js";
import { reconcileCloudWork } from "./run-runtime.js";
import { observe } from "./scoped-goal-observers.js";
import {
  advanceScopedGoal,
  dueScopedGoalIds,
  reconcileScopedGoals,
  scopedGoalTool,
} from "./scoped-goal-service.js";
import { T3ThreadEventsEmulator, t3EmulatedProvider } from "./t3-cloud-agent.test-support.js";

const PR = "https://github.com/example/demo/pull/1";
const SHA = "a".repeat(40);
const VERSION_URL = "https://app.example.test/version";
const HEALTH_URL = "https://app.example.test/health";
const publicResolver = async () => [{ address: "203.0.113.10", family: 4 }];
const MINUTE = 60_000;

const suite = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;
suite("scoped goal gates advance in code", () => {
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!, { encryptContent: true });
  });
  afterAll(async () => {
    await db?.prisma.$disconnect();
    await db?.pool.end();
  });

  const scopeOf = (agentId: string) =>
    ScopedGoalScope.parse({
      agentId,
      repository: "https://github.com/example/demo",
      revision: "example/demo",
      pullRequests: [PR],
      intent: "md",
      deployment: "production",
      work: "Ship the approved change",
      requirements: [
        {
          id: "merge",
          gate: "merge",
          revisionCheck: true,
          tool: "agent_pull_request",
          request: { pullRequest: PR },
          assertions: [
            { path: ["merged"], equals: true },
            { path: ["repository"], equals: "example/demo" },
          ],
        },
        {
          id: "deploy",
          gate: "deploy",
          revisionCheck: false,
          tool: "http_check",
          request: { url: VERSION_URL, revisionPath: ["sha"] },
          assertions: [{ path: ["ok"], equals: true }],
        },
        {
          id: "health",
          gate: "health",
          revisionCheck: false,
          tool: "http_check",
          request: { url: HEALTH_URL },
          assertions: [{ path: ["status"], equals: 200 }],
        },
      ],
    });

  async function fixture() {
    const p = db.prisma;
    const id = randomUUID();
    const base = await runAsSystem("isolated goal gates fixture", async () => {
      await p.user.create({
        data: { id, name: "Test", email: `${id}@example.test`, emailVerified: true },
      });
      await p.organization.create({ data: { id, name: "Test", slug: id, createdAt: new Date() } });
      await p.space.create({ data: { id, organizationId: id, name: "Test", isDefault: true } });
      await p.member.create({
        data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
      });
      const bot = await p.bot.create({
        data: { userId: id, spaceId: id, name: "Lead", color: "test" },
      });
      const thread = await p.thread.create({ data: { userId: id, spaceId: id, botId: bot.id } });
      const owner = { userId: id, spaceId: id, botId: bot.id, threadId: thread.id };
      const task = await p.task.create({ data: { ...owner, prompt: "Test", status: "running" } });
      const run = await p.run.create({
        data: { ...owner, taskId: task.id, status: "running", trigger: "user" },
      });
      return { owner, run };
    });
    const { owner, run } = base;
    const emulator = new T3ThreadEventsEmulator();
    const connection: CloudAgentConnection = {
      key: `t3:${id}:t3`,
      spaceId: id,
      provider: t3EmulatedProvider(emulator),
    };
    // What the live checks and the code host answer; tests change it between passes.
    const world: { deployedSha: string; healthStatus: number; hold?: Promise<void> } = {
      deployedSha: "0".repeat(40),
      healthStatus: 200,
    };
    const requests: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      await world.hold;
      if (url.startsWith("https://api.github.com/"))
        return Response.json({ merged: true, merge_commit_sha: SHA });
      if (url === VERSION_URL) return Response.json({ sha: world.deployedSha });
      if (url === HEALTH_URL) return Response.json({}, { status: world.healthStatus });
      return new Response("not found", { status: 404 });
    });
    const jobs: JobPublisher = {
      enqueue: vi.fn(async (_job: BackgroundJob) => undefined),
      enqueueIn: async () => undefined,
      cancelIn: async () => undefined,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const deps = {
      prisma: p,
      jobs,
      events: { notify: vi.fn(async () => undefined) },
      cloudAgent: connection,
      egress: { fetch: fetch as typeof globalThis.fetch, resolveHostname: publicResolver },
    };
    const context: AdapterContext & { botId: string; botName: string } = {
      operationId: randomUUID(),
      traceId: "test",
      spaceId: id,
      userId: id,
      botId: owner.botId,
      botName: "Lead",
      signal: new AbortController().signal,
    };
    const launched = await runAsSystem("launch", () =>
      executeCloudAgentTool(
        deps,
        context,
        run,
        "cloud_agent_launch",
        { prompt: "Ship the approved change", requestKey: "ship" },
        undefined,
      ),
    );
    const agentId = (launched as { id: string }).id;
    const poll = () => runAsSystem("poll", () => pollCloudAgent(deps, { agentId }));
    await poll();
    const agent = () => p.cloudAgent.findUniqueOrThrow({ where: { id: agentId } });
    const threadId = (await agent()).remoteId!;
    // The bot's launching turn is over by the time the goal drives the agent.
    await runAsSystem("settle", () =>
      p.run.update({ where: { id: run.id }, data: { status: "completed" } }),
    );
    const scope = scopeOf(agentId);
    const key = `approve:${id}`;
    await runAsSystem("approve", () =>
      p.externalEffect.create({
        data: {
          spaceId: id,
          runId: run.id,
          kind: "scoped_goal_authorize",
          idempotencyKey: key,
          status: "executing",
          request: scope,
          approvedByUserId: id,
          approvedAt: new Date(),
        },
      }),
    );
    await runAsSystem("authorize", () =>
      scopedGoalTool(deps, owner, "scoped_goal_authorize", scope, key),
    );
    // The approved write has settled by the time the goal drives the agent.
    await runAsSystem("settle approval", () =>
      p.externalEffect.updateMany({
        where: { idempotencyKey: key },
        data: { status: "completed" },
      }),
    );
    const goal = () => p.scopedGoal.findUniqueOrThrow({ where: { agentId } });
    const reconcile = (now = new Date()) =>
      runAsSystem("reconcile", async () => {
        // What the job queue does with the goals the reconciler finds due, run inline.
        for (const id of await dueScopedGoalIds(deps.prisma, now))
          await advanceScopedGoal(deps, id, now);
      });
    const continuations = async () =>
      p.run.count({ where: { clientNonce: { startsWith: `scoped-goal:${(await goal()).id}:` } } });
    const wakes = () =>
      p.run.count({ where: { threadId: owner.threadId, trigger: "cloud_agent" } });
    const notices = (prefix: string) =>
      p.message.count({
        where: { threadId: owner.threadId, clientNonce: { startsWith: prefix } },
      });
    const history = async () =>
      (await p.scopedGoalTransition.findMany({ where: { goalId: (await goal()).id } })).map(
        (t) => t.detail as Record<string, unknown>,
      );
    /** The agent stops, as T3 reports it, and the poll records that. */
    const finish = async () => {
      emulator.complete(threadId);
      await poll();
    };
    return {
      p,
      owner,
      run,
      emulator,
      deps,
      context,
      world,
      requests,
      fetch,
      agentId,
      threadId,
      agent,
      poll,
      goal,
      reconcile,
      continuations,
      wakes,
      notices,
      history,
      finish,
    };
  }

  /** The agent finished, merged its pull request and was told to deploy; it has now stopped. */
  async function mergedAndInstructed(t: Awaited<ReturnType<typeof fixture>>) {
    await t.finish();
    t.emulator.openPullRequest(t.threadId, PR);
    await t.reconcile();
    expect(await t.goal()).toMatchObject({ gate: "merge", status: "active" });
    t.emulator.landPullRequest(t.threadId);
    await t.reconcile(new Date(Date.now() + 2 * MINUTE));
    expect(await t.goal()).toMatchObject({ gate: "deploy", status: "active" });
    await t.poll();
    await t.finish();
  }

  it("takes a merge-and-deploy goal through merge, deploy and health without a model turn", async () =>
    runAsSystem("goal happy path", async () => {
      const t = await fixture();
      await t.finish();
      t.emulator.openPullRequest(t.threadId, PR);

      // Nothing has merged yet; the agent is still at it, so nothing runs and nobody is asked.
      await t.reconcile();
      expect(await t.goal()).toMatchObject({ gate: "merge", status: "active", attempt: 0 });

      // T3 reports the merge without a commit; the public code host names it, once.
      t.emulator.landPullRequest(t.threadId);
      await t.reconcile(new Date(Date.now() + 2 * MINUTE));
      expect(t.requests.filter((url) => url.startsWith("https://api.github.com/"))).toEqual([
        "https://api.github.com/repos/example/demo/pulls/1",
      ]);
      const sent = await t.agent();
      expect(sent.followup).toMatchObject({
        prompt: `PR merged at ${SHA}. Deploy ${SHA} per the repo's runbook, then reply with the deployed revision.`,
        goalGate: "deploy",
      });
      expect(await t.goal()).toMatchObject({ gate: "deploy", status: "active" });

      // The follow-up reaches the thread; the agent deploys and stops.
      await t.poll();
      expect(t.emulator.calls.filter((c) => c.tool === "t3_thread_send")).toHaveLength(1);
      t.world.deployedSha = SHA;
      await t.finish();
      await t.reconcile(new Date(Date.now() + 4 * MINUTE));

      expect(await t.goal(), JSON.stringify((await t.goal()).blocker)).toMatchObject({
        gate: "complete",
        status: "completed",
      });
      expect(await t.continuations()).toBe(0);
      expect(await t.wakes()).toBe(0);
      const history = await t.history();
      expect(history.filter((h) => h.action === "gate_passed")).toEqual([
        expect.objectContaining({ requirementId: "merge", source: "code" }),
        expect.objectContaining({ requirementId: "deploy", source: "code" }),
        expect.objectContaining({ requirementId: "health", source: "code" }),
      ]);
      expect(history.filter((h) => h.action === "followup_sent")).toHaveLength(1);
      const evidence = (await t.goal()).evidence as Array<Record<string, unknown>>;
      expect(evidence.map((e) => e.source)).toEqual(["code", "code", "code"]);
      expect(evidence[0]?.result).toMatchObject({ merged: true, mergeCommitSha: SHA });

      // The owner hears once, with the evidence.
      expect(await t.notices("scoped-goal-completed:")).toBe(1);
      const message = await t.p.message.findFirstOrThrow({
        where: {
          threadId: t.owner.threadId,
          clientNonce: { startsWith: "scoped-goal-completed:" },
        },
      });
      const text = JSON.stringify(message.blocks);
      expect(text).toContain(PR);
      expect(text).toContain(SHA);
      expect(text).toContain("live check 200");
      await t.reconcile(new Date(Date.now() + 60 * MINUTE));
      expect(await t.notices("scoped-goal-completed:")).toBe(1);
      expect(await t.continuations()).toBe(0);
    }));

  it("blocks once when the deployed revision is not the merged commit", async () =>
    runAsSystem("goal wrong revision", async () => {
      const t = await fixture();
      await mergedAndInstructed(t);
      // The agent says it deployed, but the live service runs something else, and stays so.
      await t.reconcile(new Date(Date.now() + 4 * MINUTE));
      expect(await t.goal()).toMatchObject({ status: "active", gate: "deploy" });
      await t.reconcile(new Date(Date.now() + 12 * MINUTE));
      const goal = await t.goal();
      expect(goal).toMatchObject({ status: "blocked", gate: "deploy", nextAttemptAt: null });
      expect(JSON.stringify(goal.blocker)).toContain(`is not the merged commit ${SHA}`);
      expect(await t.notices("scoped-goal-blocked:")).toBe(1);
      await t.reconcile(new Date(Date.now() + 60 * MINUTE));
      expect(await t.notices("scoped-goal-blocked:")).toBe(1);
      expect(await t.continuations()).toBe(0);
      expect(await t.wakes()).toBe(0);
    }));

  it("drives goals for a deployment with only user-connected agents", async () =>
    runAsSystem("goal user-connected only", async () => {
      const t = await fixture();
      await t.finish();
      t.emulator.openPullRequest(t.threadId, PR);
      t.emulator.landPullRequest(t.threadId);
      const { cloudAgent, ...rest } = t.deps;
      const userCloudAgents = {
        forActor: async () => cloudAgent,
        listForActor: async () => [cloudAgent],
        forKey: async (key: string) => (key === cloudAgent.key ? cloudAgent : null),
      };
      await t.p.scopedGoal.update({
        where: { id: (await t.goal()).id },
        data: { nextAttemptAt: new Date() },
      });
      await reconcileCloudWork({
        ...rest,
        events: rest.events as never,
        cloudAgent: null,
        userCloudAgents,
      });
      // The pass hands the goal to its own job, which then advances it.
      const goalId = (await t.goal()).id;
      expect(t.deps.jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ name: "scoped_goal.advance", payload: { goalId } }),
      );
      await advanceScopedGoal({ ...rest, cloudAgent: null, userCloudAgents }, goalId);
      expect(await t.goal()).toMatchObject({ gate: "deploy", status: "active" });
      expect((await t.history()).filter((h) => h.action === "gate_passed")).toHaveLength(1);
    }));

  it("does not complete on deploy evidence that predates a different merged commit", async () =>
    runAsSystem("goal deploy before merge", async () => {
      const t = await fixture();
      await t.finish();
      const goal = await t.goal();
      const scope = ScopedGoalScope.parse(goal.scope);
      // The bot reports a deploy of another commit first; no merged commit is known yet.
      const deployEffect = await t.p.externalEffect.create({
        data: {
          spaceId: t.owner.spaceId,
          runId: t.run.id,
          kind: "http_check",
          idempotencyKey: `deploy:${goal.id}`,
          status: "completed",
          request: scope.requirements[1]!.request,
          result: { ok: true, status: 200, revision: "b".repeat(40) },
        },
      });
      await t.p.scopedGoal.update({
        where: { id: goal.id },
        data: { evidence: [{ requirementId: "deploy", effectId: deployEffect.id }] },
      });
      // The merge is then observed in code and names the real commit.
      t.emulator.openPullRequest(t.threadId, PR);
      t.emulator.landPullRequest(t.threadId);
      await t.reconcile(new Date(Date.now() + 2 * MINUTE));
      const after = await t.goal();
      expect(after.status).not.toBe("completed");
      expect(after.gate).toBe("deploy");
      expect(
        (after.evidence as Array<{ requirementId: string }>).map((e) => e.requirementId),
      ).toEqual(["merge"]);
    }));

  it("leaves no follow-up marker when the agent changed, and sends it on the next pass", async () =>
    runAsSystem("goal followup conflict", async () => {
      const t = await fixture();
      await t.finish();
      t.emulator.openPullRequest(t.threadId, PR);
      await t.reconcile();
      t.emulator.landPullRequest(t.threadId);
      // The agent row changes between the read and the follow-up write.
      const delegate = t.p.cloudAgent as unknown as {
        findUniqueOrThrow: (args: unknown) => Promise<unknown>;
      };
      const original = delegate.findUniqueOrThrow.bind(delegate);
      const spy = vi.spyOn(delegate, "findUniqueOrThrow").mockImplementationOnce(async (args) => {
        const row = await original(args);
        await t.p.cloudAgent.updateMany({
          where: { id: t.agentId },
          data: { version: { increment: 1 } },
        });
        return row;
      });
      await t.reconcile(new Date(Date.now() + 2 * MINUTE));
      spy.mockRestore();
      expect((await t.history()).filter((h) => h.action === "followup_sent")).toHaveLength(0);
      expect((await t.agent()).followup).toBeNull();
      await t.reconcile(new Date(Date.now() + 4 * MINUTE));
      expect((await t.history()).filter((h) => h.action === "followup_sent")).toHaveLength(1);
      expect((await t.agent()).followup).toMatchObject({ goalGate: "deploy" });
    }));

  it("lets one goal's slow remote check hold back no other goal", async () =>
    runAsSystem("goal independence", async () => {
      const slow = await fixture();
      const quick = await fixture();
      for (const t of [slow, quick]) {
        await t.finish();
        t.emulator.openPullRequest(t.threadId, PR);
        t.emulator.landPullRequest(t.threadId);
      }
      let release!: () => void;
      slow.world.hold = new Promise<void>((resolve) => (release = resolve));
      const now = new Date(Date.now() + 2 * MINUTE);
      const goalIds = [await slow.goal(), await quick.goal()].map((g) => g.id);
      const enqueued = (t: typeof slow) =>
        vi
          .mocked(t.deps.jobs.enqueue)
          .mock.calls.map(([job]) => job)
          .filter((job) => job.name === "scoped_goal.advance")
          .map((job) => (job.payload as { goalId: string }).goalId);

      // The pass only hands each due goal its own job, so it finishes while a check hangs.
      await runAsSystem("pass", () => reconcileScopedGoals(slow.deps, now));
      expect(enqueued(slow)).toEqual(expect.arrayContaining(goalIds));

      // The hung goal's job is running; the other goal's job still advances it.
      const hung = runAsSystem("hung", () => advanceScopedGoal(slow.deps, goalIds[0]!, now));
      await vi.waitFor(() =>
        expect(slow.requests.some((url) => url.startsWith("https://api.github.com/"))).toBe(true),
      );
      await runAsSystem("quick", () => advanceScopedGoal(quick.deps, goalIds[1]!, now));
      expect(await quick.goal()).toMatchObject({ gate: "deploy", status: "active" });
      expect(await slow.goal()).toMatchObject({ gate: "merge" });

      release();
      await hung;
      expect(await slow.goal()).toMatchObject({ gate: "deploy", status: "active" });
    }));

  it("nudges only the goal of the agent that finished", async () =>
    runAsSystem("goal nudge", async () => {
      const a = await fixture();
      const b = await fixture();
      const later = new Date(Date.now() + 60 * MINUTE);
      for (const t of [a, b])
        await t.p.scopedGoal.update({
          where: { id: (await t.goal()).id },
          data: { nextAttemptAt: later },
        });
      await a.finish();
      const advances = (t: typeof a) =>
        vi
          .mocked(t.deps.jobs.enqueue)
          .mock.calls.filter(([job]) => job.name === "scoped_goal.advance")
          .map(([job]) => (job.payload as { goalId: string }).goalId);
      expect(advances(a)).toEqual([(await a.goal()).id]);
      expect((await a.goal()).nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now());
      expect((await b.goal()).nextAttemptAt).toEqual(later);
      expect(advances(b)).toEqual([]);
    }));

  it("holds the automatic follow-up while an earlier write is uncertain, then sends it", async () =>
    runAsSystem("goal uncertain follow-up", async () => {
      const t = await fixture();
      await t.finish();
      t.emulator.openPullRequest(t.threadId, PR);
      await t.reconcile();
      t.emulator.landPullRequest(t.threadId);
      const effect = await t.p.externalEffect.create({
        data: {
          spaceId: t.owner.spaceId,
          runId: t.run.id,
          kind: "http_post",
          idempotencyKey: `uncertain:${randomUUID()}`,
          status: "uncertain",
          request: {},
        },
      });
      await t.reconcile(new Date(Date.now() + 2 * MINUTE));
      expect((await t.agent()).followup).toBeNull();
      expect(await t.goal()).toMatchObject({ gate: "deploy", status: "waiting" });
      expect(JSON.stringify((await t.goal()).blocker)).toContain(effect.id);
      expect((await t.history()).filter((h) => h.action === "followup_sent")).toHaveLength(0);
      expect((await t.history()).filter((h) => h.action === "followup_deferred")).toHaveLength(1);

      // Waiting again records nothing new.
      await t.reconcile(new Date(Date.now() + 4 * MINUTE));
      expect((await t.history()).filter((h) => h.action === "followup_deferred")).toHaveLength(1);

      await t.p.externalEffect.update({ where: { id: effect.id }, data: { status: "completed" } });
      await t.reconcile(new Date(Date.now() + 6 * MINUTE));
      expect((await t.agent()).followup).toMatchObject({ goalGate: "deploy" });
      expect(await t.goal()).toMatchObject({ status: "active", blocker: null });
      expect((await t.history()).filter((h) => h.action === "followup_sent")).toHaveLength(1);
    }));

  it("refuses a done report while evidence is missing", async () =>
    runAsSystem("goal done report", async () => {
      const t = await fixture();
      await t.finish();
      const report = (verdict: "accepted" | "rejected") =>
        runAsSystem("report", () =>
          reportCloudAgent({ ...t.deps, events: {} as never }, t.context, t.run, {
            id: t.agentId,
            verdict,
            summary: "All shipped",
          }),
        );
      expect(await report("accepted")).toEqual({
        error:
          "This agent's release goal is not complete. Missing evidence: merge (merge), deploy (deploy), health (health).",
      });
      // Saying the work did not land is not a claim of completion.
      expect(await report("rejected")).toMatchObject({ verdict: "rejected" });
    }));

  it("starts exactly one continuation for a stuck gate", async () =>
    runAsSystem("goal stuck", async () => {
      const t = await fixture();
      await t.finish();
      t.emulator.openPullRequest(t.threadId, PR);
      await t.reconcile(new Date(Date.now() + MINUTE));
      expect(await t.continuations()).toBe(0);
      // Idle for a good while with the pull request still open.
      const late = new Date(Date.now() + 30 * MINUTE);
      await t.reconcile(late);
      await t.reconcile(late);
      await t.reconcile(new Date(late.getTime() + MINUTE));
      expect(await t.continuations()).toBe(1);
      expect(await t.goal()).toMatchObject({ attempt: 1, gate: "merge" });
    }));

  it("refuses a URL outside the approved scope and private hosts", async () => {
    const scope = scopeOf("agent");
    const fetch = vi.fn(async () => Response.json({}));
    const env = {
      scope,
      remoteId: "thread",
      context: {} as AdapterContext,
      egress: { fetch: fetch as typeof globalThis.fetch, resolveHostname: publicResolver },
    };
    const check = (url: string) => ({
      ...scope.requirements[2]!,
      request: { url },
    });
    expect(await observe(check("https://elsewhere.example.test/health"), env)).toEqual({
      error: "URL is not in the approved scope",
    });
    // Even an approved URL cannot reach an internal host.
    const internal = "http://127.0.0.1:8080/health";
    const approved = { ...scope, requirements: [check(internal), ...scope.requirements] };
    expect(await observe(check(internal), { ...env, scope: approved })).toMatchObject({
      error: expect.stringMatching(/private|internal|blocked/i),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
