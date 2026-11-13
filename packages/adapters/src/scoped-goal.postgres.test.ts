import { randomUUID } from "node:crypto";
import type { BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import { ScopedGoalScope } from "@rakazo/contracts";
import { createDb, Prisma, runAsSystem, runAsTenant } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { goalDrivesAgent, reconcileScopedGoals, scopedGoalTool } from "./scoped-goal-service.js";

const suite = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;
suite("durable scoped continuation", () => {
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!, { encryptContent: true });
  });
  afterAll(async () => {
    await db?.prisma.$disconnect();
    await db?.pool.end();
  });
  async function fixture() {
    return runAsSystem("isolated goal fixture", async () => {
      const p = db.prisma;
      const id = randomUUID();
      await p.user.create({
        data: { id, name: "Test", email: `${id}@example.test`, emailVerified: true },
      });
      await p.organization.create({ data: { id, name: "Test", slug: id, createdAt: new Date() } });
      await p.space.create({ data: { id, organizationId: id, name: "Test", isDefault: true } });
      await p.member.create({
        data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
      });
      const bot = await p.bot.create({
        data: { userId: id, spaceId: id, name: "Test", color: "test" },
      });
      const thread = await p.thread.create({ data: { userId: id, spaceId: id, botId: bot.id } });
      const owner = { userId: id, spaceId: id, botId: bot.id, threadId: thread.id };
      const task = await p.task.create({ data: { ...owner, prompt: "Test", status: "completed" } });
      const run = await p.run.create({
        data: { ...owner, taskId: task.id, status: "completed", trigger: "user" },
      });
      const agent = await p.cloudAgent.create({
        data: {
          ...owner,
          operationKey: id,
          providerKey: "offline",
          title: "Test",
          launchRequest: {},
          remoteId: "existing-thread",
          status: "finished",
        },
      });
      const scope = ScopedGoalScope.parse({
        agentId: agent.id,
        repository: "https://example.test/repo",
        revision: "revision-1",
        pullRequests: ["https://example.test/pr/1"],
        intent: "md",
        deployment: "test",
        work: "Ship the approved change",
        requirements: ["merge", "health", "deploy"].map((gate) => ({
          id: gate,
          gate,
          revisionCheck: gate === "merge",
          tool: "observe_release",
          request: { gate, revision: "revision-1" },
          assertions: [
            { path: ["revision"], equals: "revision-1" },
            { path: ["passed"], equals: true },
          ],
        })),
      });
      const key = `approve:${id}`;
      const effect = await p.externalEffect.create({
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
      });
      const enqueue = vi.fn(async (_job: BackgroundJob) => undefined);
      const jobs: JobPublisher = {
        enqueue,
        enqueueIn: async () => undefined,
        cancelIn: async () => undefined,
        cancel: async () => undefined,
        close: async () => undefined,
      };
      const deps = { prisma: p, jobs };
      const authorize = () => scopedGoalTool(deps, owner, "scoped_goal_authorize", scope, key);
      const goal = async () => p.scopedGoal.findUniqueOrThrow({ where: { agentId: agent.id } });
      const settle = async () => {
        const g = await goal();
        await p.run.update({ where: { id: g.activeRunId! }, data: { status: "completed" } });
      };
      return { p, owner, run, agent, scope, effect, deps, key, authorize, goal, settle, enqueue };
    });
  }

  it("requires exact authenticated approval and scopes reads to the owner", async () =>
    runAsSystem("goal test", async () => {
      const t = await fixture();
      await t.p.externalEffect.update({
        where: { id: t.effect.id },
        data: { approvedByUserId: null },
      });
      await expect(t.authorize()).rejects.toThrow("authenticated approval");
      await t.p.externalEffect.update({
        where: { id: t.effect.id },
        data: { approvedByUserId: t.owner.userId },
      });
      await expect(
        scopedGoalTool(
          t.deps,
          t.owner,
          "scoped_goal_authorize",
          { ...t.scope, work: "Changed scope" },
          t.key,
        ),
      ).rejects.toThrow("exact scope");
      await t.authorize();
      await t.authorize();
      const g = await t.goal();
      await runAsTenant({ spaceId: t.owner.spaceId, userId: "another-owner" }, async () => {
        expect(await t.p.scopedGoal.findMany({ where: { id: g.id } })).toEqual([]);
      });
    }));

  it("recovers missed wakes and enqueue failure without concurrent duplicate runs, then stops no-progress retries", async () =>
    runAsSystem("goal recovery", async () => {
      const t = await fixture();
      await t.authorize();
      t.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
      await Promise.all([reconcileScopedGoals(t.deps), reconcileScopedGoals(t.deps)]);
      const first = await t.goal();
      expect(first.attempt).toBe(1);
      expect(
        await t.p.run.count({ where: { clientNonce: { startsWith: `scoped-goal:${first.id}:` } } }),
      ).toBe(1);
      expect((await t.p.run.findUniqueOrThrow({ where: { id: first.activeRunId! } })).status).toBe(
        "queued",
      );
      await t.p.run.update({
        where: { id: first.activeRunId! },
        data: { status: "failed", error: "Provider refused: quota exhausted" },
      });
      await reconcileScopedGoals(t.deps);
      const settled = await t.goal();
      expect(settled).toMatchObject({ activeRunId: null, noProgress: 1, attempt: 1 });
      // Backs off instead of starting another turn straight away.
      await reconcileScopedGoals(t.deps);
      expect((await t.goal()).attempt).toBe(1);
      const history = await t.p.scopedGoalTransition.findMany({ where: { goalId: first.id } });
      expect(history.map((h) => h.detail)).toContainEqual(
        expect.objectContaining({ reason: "Provider refused: quota exhausted" }),
      );
      let at = Date.now();
      for (let i = 0; i < 2; i++) {
        at += 31 * 60_000;
        await reconcileScopedGoals(t.deps, new Date(at));
        await t.settle();
        await reconcileScopedGoals(t.deps, new Date(at));
      }
      const stopped = await t.goal();
      expect(stopped).toMatchObject({ status: "blocked", attempt: 3, nextAttemptAt: null });
      await reconcileScopedGoals(t.deps, new Date(at + 24 * 60 * 60_000));
      expect(
        await t.p.message.count({
          where: {
            threadId: t.owner.threadId,
            clientNonce: { startsWith: "scoped-goal-blocked:" },
          },
        }),
      ).toBe(1);
    }));

  it("stops dispatch on pause, intervention and cancel, and supersedes the running continuation", async () =>
    runAsSystem("goal control", async () => {
      const t = await fixture();
      await t.authorize();
      await reconcileScopedGoals(t.deps);
      let g = await t.goal();
      const runningId = g.activeRunId!;
      await t.p.run.update({ where: { id: runningId }, data: { status: "running" } });
      // A follow-up the continuation queued but has not sent yet.
      await t.p.cloudAgent.update({
        where: { id: t.agent.id },
        data: { followup: { prompt: "Merge it", goalRunId: runningId } },
      });
      const control = async (action: string) => {
        g = await t.goal();
        const args = { id: g.id, version: g.version, action };
        const key = `control:${randomUUID()}`;
        await t.p.externalEffect.create({
          data: {
            spaceId: t.owner.spaceId,
            runId: t.run.id,
            kind: "scoped_goal_control",
            idempotencyKey: key,
            status: "executing",
            request: args,
            approvedByUserId: t.owner.userId,
            approvedAt: new Date(),
          },
        });
        return scopedGoalTool(t.deps, t.owner, "scoped_goal_control", args, key);
      };
      await expect(
        scopedGoalTool(
          t.deps,
          t.owner,
          "scoped_goal_control",
          { id: g.id, version: g.version, action: "pause" },
          "unapproved",
        ),
      ).rejects.toThrow();
      await control("pause");
      g = await t.goal();
      expect(g).toMatchObject({ status: "paused", activeRunId: null });
      expect(goalDrivesAgent(g)).toBe(false);
      await t.p.run.update({ where: { id: runningId }, data: { status: "completed" } });
      await t.p.cloudAgent.update({ where: { id: t.agent.id }, data: { followup: Prisma.DbNull } });
      await reconcileScopedGoals(t.deps, new Date(Date.now() + 60 * 60_000));
      expect((await t.goal()).attempt).toBe(1);

      await control("resume");
      await reconcileScopedGoals(t.deps);
      g = await t.goal();
      expect(g).toMatchObject({ status: "active", attempt: 2 });
      expect(goalDrivesAgent(g)).toBe(true);
      await t.settle();

      // The owner writing in the thread pauses the goal until they resume it.
      await t.p.message.create({
        data: {
          threadId: t.owner.threadId,
          seq: 1_000,
          role: "user",
          authorUserId: t.owner.userId,
          blocks: [{ kind: "text", text: "Hold on" }],
          createdAt: new Date(Date.now() + 1_000),
        },
      });
      await reconcileScopedGoals(t.deps, new Date(Date.now() + 60 * 60_000));
      expect(await t.goal()).toMatchObject({ status: "paused", attempt: 2 });

      await control("cancel");
      await expect(control("resume")).rejects.toThrow("ended");
      await reconcileScopedGoals(t.deps, new Date(Date.now() + 60 * 60_000));
      expect(await t.goal()).toMatchObject({ status: "cancelled", attempt: 2 });
    }));

  it("needs a new approval for changed scope and drops evidence from the old scope", async () =>
    runAsSystem("goal reauthorization", async () => {
      const t = await fixture();
      await t.authorize();
      await t.p.scopedGoal.update({
        where: { id: (await t.goal()).id },
        data: { evidence: [{ requirementId: "merge", effectId: "old" }], gate: "health" },
      });
      const changed = { ...t.scope, revision: "revision-2" };
      changed.requirements = changed.requirements.map((r) => ({
        ...r,
        request: { ...r.request, revision: "revision-2" },
        assertions: [{ path: ["revision"], equals: "revision-2" }],
      }));
      const key = `approve-2:${t.owner.userId}`;
      const pending = await t.p.externalEffect.create({
        data: {
          spaceId: t.owner.spaceId,
          runId: t.run.id,
          kind: "scoped_goal_authorize",
          idempotencyKey: key,
          status: "intended",
          request: changed,
        },
      });
      const reauthorize = () =>
        scopedGoalTool(t.deps, t.owner, "scoped_goal_authorize", changed, key);
      await expect(reauthorize()).rejects.toThrow("authenticated approval");
      expect((await t.goal()).evidence).toHaveLength(1);
      await t.p.externalEffect.update({
        where: { id: pending.id },
        data: { status: "executing", approvedByUserId: t.owner.userId, approvedAt: new Date() },
      });
      await reauthorize();
      const g = await t.goal();
      expect(g).toMatchObject({ evidence: [], gate: "merge", approvalEffectId: pending.id });
      expect((g.scope as { revision: string }).revision).toBe("revision-2");
    }));

  it("requires recorded revision-matched evidence for every completion gate", async () =>
    runAsSystem("goal evidence", async () => {
      const t = await fixture();
      await t.authorize();
      await reconcileScopedGoals(t.deps);
      let g = await t.goal();
      const report = (observations: unknown[]) =>
        scopedGoalTool(
          t.deps,
          t.owner,
          "scoped_goal_report",
          { id: g.id, version: g.version, observations },
          "report",
        );
      const effect = await t.p.externalEffect.create({
        data: {
          spaceId: t.owner.spaceId,
          runId: g.activeRunId!,
          kind: "observe_release",
          idempotencyKey: randomUUID(),
          status: "completed",
          request: t.scope.requirements[0]!.request,
          result: { revision: "old", passed: true },
        },
      });
      await expect(report([{ requirementId: "merge", effectId: effect.id }])).rejects.toThrow(
        "revision evidence",
      );
      await t.p.externalEffect.update({
        where: { id: effect.id },
        data: { result: { revision: "revision-1", passed: true } },
      });
      await report([{ requirementId: "merge", effectId: effect.id }]);
      g = await t.goal();
      expect(g.status).toBe("active");
      expect(g.gate).toBe("health");
      const observations = [{ requirementId: "merge", effectId: effect.id }];
      for (const requirement of t.scope.requirements.slice(1)) {
        const proof = await t.p.externalEffect.create({
          data: {
            spaceId: t.owner.spaceId,
            runId: g.activeRunId!,
            kind: requirement.tool,
            idempotencyKey: randomUUID(),
            status: "completed",
            request: requirement.request,
            result: { revision: "revision-1", passed: true },
          },
        });
        observations.push({ requirementId: requirement.id, effectId: proof.id });
      }
      await report(observations);
      expect(await t.goal()).toMatchObject({
        status: "completed",
        gate: "complete",
        nextAttemptAt: null,
      });
      await reconcileScopedGoals(t.deps);
      expect((await t.goal()).attempt).toBe(1);
    }));

  it("persists long cooldowns without spending continuation attempts", async () =>
    runAsSystem("goal cooldown", async () => {
      const t = await fixture();
      await t.authorize();
      await reconcileScopedGoals(t.deps);
      const g = await t.goal();
      const reset = new Date(Date.now() + 24 * 60 * 60_000);
      await scopedGoalTool(
        t.deps,
        t.owner,
        "scoped_goal_report",
        {
          id: g.id,
          version: g.version,
          blocker: {
            category: "cooldown",
            reason: "Provider quota exhausted",
            retryAt: reset.toISOString(),
          },
        },
        "report",
      );
      await t.settle();
      await reconcileScopedGoals(t.deps);
      expect(await t.goal()).toMatchObject({ status: "waiting", attempt: 1, nextAttemptAt: reset });
      expect(await t.p.scopedGoalTransition.count({ where: { goalId: g.id } })).toBe(3);
    }));
});
