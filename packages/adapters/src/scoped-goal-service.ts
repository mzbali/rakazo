import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob, scopedGoalAdvanceJob } from "@rakazo/adapter-kit";
import { ScopedGoalControl, ScopedGoalReport, ScopedGoalScope } from "@rakazo/contracts";
import type { Prisma, PrismaClient, Run, ScopedGoal } from "@rakazo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  Prisma as DbPrisma,
  runAsSystem,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { CloudAgentConnection, UserCloudAgents } from "./cloud-agent-factory.js";
import { createCloudAgentWake } from "./cloud-agent-poll.js";
import {
  cloudAgentFor,
  enqueueCloudAgent,
  queueCloudAgentFollowupInTransaction,
} from "./cloud-agent-service.js";
import type { ObservedResult, ObserverEgress } from "./scoped-goal-observers.js";
import { isCodeObserver, observe } from "./scoped-goal-observers.js";

type Deps = {
  prisma: PrismaClient;
  jobs: JobPublisher;
  /** What the reconciler reads the managed thread through; without it only reported evidence counts. */
  cloudAgent?: CloudAgentConnection | null;
  userCloudAgents?: UserCloudAgents;
  /** Outbound fetch seams for the built-in observations; tests inject them. */
  egress?: ObserverEgress;
};
/** A requirement's recorded observation: reported by the bot (`effectId`) or run by the reconciler. */
type Evidence = {
  requirementId: string;
  effectId?: string;
  source?: "code";
  observedAt?: string;
  result?: ObservedResult;
};
type Requirement = ScopedGoalScope["requirements"][number];
type Owner = { spaceId: string; userId: string; botId: string; threadId: string };
type Tx = Prisma.TransactionClient;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const MAX_NO_PROGRESS = 3;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const MAX_REASON = 1_000;
const json = (value: unknown) => value as Prisma.InputJsonValue;
export const SCOPED_GOAL_NONCE = "scoped-goal:";

/** An earlier write in the goal's thread that is still running or whose outcome is unknown. */
export function uncertainEffect(
  db: Pick<Tx, "externalEffect">,
  where: { spaceId: string; threadId: string },
) {
  return db.externalEffect.findFirst({
    where: {
      spaceId: where.spaceId,
      run: { threadId: where.threadId },
      status: { in: ["executing", "uncertain"] },
    },
    select: { id: true },
  });
}

/** A goal drives its agent only while running in the epoch the owner last set. */
export function goalDrivesAgent(goal: ScopedGoal | null): goal is ScopedGoal {
  return (
    !!goal && ["active", "waiting"].includes(goal.status) && goal.controlEpoch === goal.activeEpoch
  );
}

export function goalGate(scope: ScopedGoalScope, satisfied: readonly string[]) {
  return scope.requirements.find((r) => !satisfied.includes(r.id))?.gate ?? "complete";
}

export function observationMatches(
  requirement: ScopedGoalScope["requirements"][number],
  result: unknown,
) {
  return requirement.assertions.every(({ path, equals }) => {
    let value = result;
    for (const key of path) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return false;
      value = (value as Record<string, unknown>)[key];
    }
    return value === equals;
  });
}

const evidenceOf = (goal: ScopedGoal) =>
  Array.isArray(goal.evidence) ? (goal.evidence as Evidence[]) : [];

/** Each recorded requirement's result: kept with a code observation, the effect's when reported. */
async function evidenceResults(db: Pick<Tx, "externalEffect">, evidence: readonly Evidence[]) {
  const results = new Map<string, ObservedResult>();
  const reported = new Map<string, string>();
  for (const e of evidence) {
    if (e.result) results.set(e.requirementId, e.result);
    else if (e.effectId) reported.set(e.effectId, e.requirementId);
  }
  if (reported.size) {
    const effects = await db.externalEffect.findMany({
      where: { id: { in: [...reported.keys()] } },
      select: { id: true, result: true },
    });
    for (const { id, result } of effects)
      if (result && typeof result === "object" && !Array.isArray(result))
        results.set(reported.get(id)!, result as ObservedResult);
  }
  return results;
}

/** The commit the merge evidence names, when it names one. */
function mergedSha(scope: ScopedGoalScope, results: ReadonlyMap<string, ObservedResult>) {
  for (const r of scope.requirements) {
    const sha = r.gate === "merge" ? results.get(r.id)?.mergeCommitSha : undefined;
    if (typeof sha === "string") return sha;
  }
}

const sameRevision = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return Math.min(x.length, y.length) >= 7 && (x.startsWith(y) || y.startsWith(x));
};

/** Without a merged commit, deploy evidence counts only on a revision the owner approved. */
const pinsRevision = (r: Requirement) =>
  r.revisionCheck || r.assertions.some((a) => a.path.length === 1 && a.path[0] === "revision");

/** A deploy observation has to name the commit that was merged, or an approved revision. */
function revisionProblem(
  requirement: Requirement,
  result: ObservedResult,
  sha: string | undefined,
) {
  if (requirement.gate !== "deploy") return undefined;
  if (!sha)
    return pinsRevision(requirement)
      ? undefined
      : "Deploy evidence names no merged commit and the approved requirement pins no revision.";
  const revision = typeof result.revision === "string" ? result.revision : undefined;
  if (!revision) return `Deploy evidence names no revision; the merged commit is ${sha}.`;
  if (!sameRevision(revision, sha))
    return `Deployed revision ${revision} is not the merged commit ${sha}.`;
}

/** Retained deploy evidence that is not the merged commit, once that commit is known. */
function staleDeploys(
  scope: ScopedGoalScope,
  evidence: readonly Evidence[],
  results: ReadonlyMap<string, ObservedResult>,
) {
  const sha = mergedSha(scope, results);
  return scope.requirements.flatMap((r) => {
    if (!evidence.some((e) => e.requirementId === r.id)) return [];
    const reason = revisionProblem(r, results.get(r.id) ?? {}, sha);
    return reason ? [{ id: r.id, reason }] : [];
  });
}

/** The evidence a live goal still lacks, for refusing a "done" the evidence does not back. */
export async function missingGoalEvidence(prisma: PrismaClient, agentId: string) {
  const goal = await prisma.scopedGoal.findUnique({ where: { agentId } });
  if (!goal || !["active", "waiting"].includes(goal.status)) return undefined;
  const have = new Set(evidenceOf(goal).map((e) => e.requirementId));
  return ScopedGoalScope.parse(goal.scope)
    .requirements.filter((r) => !have.has(r.id))
    .map((r) => `${r.id} (${r.gate})`);
}

/** One notice in the owner's chat; the nonce keeps a retried transaction from saying it twice. */
async function notifyOwner(tx: Tx, goal: ScopedGoal, text: string, clientNonce: string) {
  const blocks = [{ kind: "text" as const, text }];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: goal.threadId,
    botId: goal.botId,
    role: "bot",
    blocks,
    clientNonce,
  });
  await appendEventInTransaction(tx, {
    spaceId: goal.spaceId,
    threadId: goal.threadId,
    botId: goal.botId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "bot", blocks },
  });
  // The notice is the owner's one word on it, so the agent's own finish wakes no run.
  const agent = await tx.cloudAgent.findUnique({
    where: { id: goal.agentId },
    select: { generation: true },
  });
  if (agent)
    await tx.cloudAgent.update({
      where: { id: goal.agentId },
      data: { wakeGeneration: agent.generation },
    });
}

async function notifyCompleted(
  tx: Tx,
  goal: ScopedGoal,
  scope: ScopedGoalScope,
  evidence: readonly Evidence[],
) {
  const results = await evidenceResults(tx, evidence);
  const parts = scope.requirements.flatMap((r) => {
    const result = results.get(r.id);
    if (!result) return [];
    const text = (key: string) => (typeof result[key] === "string" ? (result[key] as string) : "");
    if (r.gate === "merge" && text("url"))
      return [
        `PR ${text("url")} merged${text("mergeCommitSha") ? ` at ${text("mergeCommitSha")}` : ""}`,
      ];
    if (r.gate === "deploy" && text("revision")) return [`deployed revision ${text("revision")}`];
    if (r.gate === "health" && result.status !== undefined) return [`live check ${result.status}`];
    return [];
  });
  await notifyOwner(
    tx,
    goal,
    `The release goal is complete${parts.length ? `: ${parts.join("; ")}` : ""}.`,
    `scoped-goal-completed:${goal.id}:${goal.approvalEffectId}`,
  );
}

async function transition(
  tx: Tx,
  goal: ScopedGoal,
  data: Prisma.ScopedGoalUpdateManyMutationInput,
  detail: unknown,
) {
  const changed = await tx.scopedGoal.updateMany({
    where: { id: goal.id, version: goal.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (!changed.count) throw new Error("Goal changed; read its status again.");
  await tx.scopedGoalTransition.create({
    data: {
      goalId: goal.id,
      spaceId: goal.spaceId,
      userId: goal.userId,
      version: goal.version + 1,
      detail: json(detail),
    },
  });
}

async function owned(tx: Tx, owner: Owner, id: string) {
  return tx.scopedGoal.findFirstOrThrow({ where: { id, ...owner } });
}

/** Only the authenticated approval path sets these provenance columns. */
async function approved(tx: Tx, owner: Owner, key: string, kind: string, args: unknown) {
  const effect = await tx.externalEffect.findUniqueOrThrow({
    where: { idempotencyKey: key },
    include: { run: true },
  });
  if (
    effect.spaceId !== owner.spaceId ||
    effect.run.userId !== owner.userId ||
    effect.run.botId !== owner.botId ||
    effect.run.threadId !== owner.threadId ||
    effect.kind !== kind ||
    effect.approvedByUserId !== owner.userId ||
    !effect.approvedAt ||
    !["executing", "completed"].includes(effect.status) ||
    !isDeepStrictEqual(effect.request, args)
  )
    throw new Error("An authenticated approval of this exact scope is required.");
  return effect;
}

export async function scopedGoalTool(
  deps: Deps,
  owner: Owner,
  name: string,
  args: Record<string, unknown>,
  effectKey: string,
) {
  if (name === "scoped_goal_status") {
    return deps.prisma.scopedGoal.findFirstOrThrow({ where: { ...owner, id: String(args.id) } });
  }
  return deps.prisma.$transaction(async (tx) => {
    if (name === "scoped_goal_authorize") {
      const scope = ScopedGoalScope.parse(args);
      const effect = await approved(tx, owner, effectKey, name, args);
      const agent = await tx.cloudAgent.findFirstOrThrow({
        where: { id: scope.agentId, ...owner },
      });
      if (!agent.remoteId) throw new Error("Track an existing remote thread first.");
      const existing = await tx.scopedGoal.findUnique({ where: { agentId: agent.id } });
      if (existing?.approvalEffectId === effect.id) return existing;
      if (
        existing &&
        (existing.userId !== owner.userId ||
          existing.botId !== owner.botId ||
          existing.threadId !== owner.threadId)
      )
        throw new Error("Goal ownership changed.");
      const source = effect.run.sourceMessageId
        ? await tx.message.findUnique({ where: { id: effect.run.sourceMessageId } })
        : null;
      if (existing) {
        const approval = json({
          effectId: effect.id,
          approvedByUserId: effect.approvedByUserId,
          approvedAt: effect.approvedAt!.toISOString(),
          source: source?.blocks ?? null,
          request: args,
        });
        await transition(
          tx,
          existing,
          {
            approvalEffectId: effect.id,
            approval,
            scope: json(scope),
            evidence: [],
            gate: goalGate(scope, []),
            status: "active",
            blocker: DbPrisma.DbNull,
            noProgress: 0,
            activeRunId: null,
            nextAttemptAt: new Date(),
            ownerSeenAt: effect.approvedAt!,
            controlEpoch: { increment: 1 },
          },
          {
            action: "scope_reauthorized",
            previousApproval: existing.approval,
            previousScope: existing.scope,
            approval,
            scope,
          },
        );
        return tx.scopedGoal.findUniqueOrThrow({ where: { id: existing.id } });
      }
      const goal = await tx.scopedGoal.create({
        data: {
          ...owner,
          agentId: agent.id,
          approvalEffectId: effect.id,
          ownerSeenAt: effect.approvedAt!,
          sourceMessageId: source?.id,
          approval: json({
            effectId: effect.id,
            approvedByUserId: effect.approvedByUserId,
            approvedAt: effect.approvedAt!.toISOString(),
            source: source?.blocks ?? null,
            request: args,
          }),
          scope: json(scope),
          gate: goalGate(scope, []),
        },
      });
      await tx.scopedGoalTransition.create({
        data: {
          goalId: goal.id,
          spaceId: owner.spaceId,
          userId: owner.userId,
          version: 0,
          detail: json({ action: "authorized", effectId: effect.id }),
        },
      });
      return goal;
    }
    if (name === "scoped_goal_control") {
      const input = ScopedGoalControl.parse(args);
      const goal = await owned(tx, owner, input.id);
      if (goal.version !== input.version) throw new Error("Goal changed; read its status again.");
      const decision = await approved(tx, owner, effectKey, name, args);
      if (["completed", "cancelled"].includes(goal.status)) throw new Error("This goal has ended.");
      await transition(
        tx,
        goal,
        {
          status:
            input.action === "resume"
              ? "active"
              : input.action === "pause"
                ? "paused"
                : "cancelled",
          nextAttemptAt: input.action === "resume" ? new Date() : null,
          controlEpoch: { increment: 1 },
          ownerSeenAt: decision.approvedAt!,
          noProgress: input.action === "resume" ? 0 : goal.noProgress,
          // A continuation still running is superseded; its writes are refused from now on.
          activeRunId: null,
        },
        { action: input.action, effectKey },
      );
      return tx.scopedGoal.findUniqueOrThrow({ where: { id: goal.id } });
    }
    const input = ScopedGoalReport.parse(args);
    const goal = await owned(tx, owner, input.id);
    if (
      goal.version !== input.version ||
      goal.controlEpoch !== goal.activeEpoch ||
      !["active", "waiting"].includes(goal.status)
    )
      throw new Error("Goal changed or stopped.");
    const scope = ScopedGoalScope.parse(goal.scope);
    const evidence = [...evidenceOf(goal)];
    const guard = scope.requirements.find((r) => r.revisionCheck)!;
    // A revision the reconciler observes itself needs no re-read from the bot.
    if (input.observations.length && !isCodeObserver(guard.tool)) {
      const observation = input.observations.find((o) => o.requirementId === guard.id);
      if (!observation || !goal.activeRunId)
        throw new Error(
          "Re-read the current revision in this continuation before reporting evidence.",
        );
      const proof = await tx.externalEffect.findFirst({
        where: {
          id: observation.effectId,
          runId: goal.activeRunId,
          status: "completed",
          kind: guard.tool,
        },
      });
      if (
        !proof ||
        !isDeepStrictEqual(proof.request, guard.request) ||
        !observationMatches(guard, proof.result)
      )
        throw new Error("Current revision evidence is stale or changed.");
    }
    for (const observation of input.observations) {
      const requirement = scope.requirements.find((r) => r.id === observation.requirementId);
      if (!requirement) throw new Error("Unknown evidence requirement.");
      const effect = await tx.externalEffect.findFirstOrThrow({
        where: {
          id: observation.effectId,
          spaceId: owner.spaceId,
          status: "completed",
          kind: requirement.tool,
          createdAt: { gte: goal.createdAt },
          run: { userId: owner.userId, botId: owner.botId, threadId: owner.threadId },
        },
      });
      if (
        !isDeepStrictEqual(effect.request, requirement.request) ||
        !observationMatches(requirement, effect.result)
      )
        throw new Error("Recorded observation does not satisfy the approved evidence contract.");
      if (!evidence.some((e) => e.requirementId === observation.requirementId)) {
        evidence.push(observation);
      }
    }
    // A deploy that is not the merged commit fails its gate instead of counting, whichever
    // report named the commit or the deploy first.
    const refused = staleDeploys(scope, evidence, await evidenceResults(tx, evidence));
    const problem = refused[0]?.reason;
    if (refused.length)
      evidence.splice(
        0,
        evidence.length,
        ...evidence.filter((e) => !refused.some((r) => r.id === e.requirementId)),
      );
    const gate = goalGate(
      scope,
      evidence.map((e) => e.requirementId),
    );
    const progressed = !isDeepStrictEqual(evidence, goal.evidence);
    const blocker = problem ? { category: "failure" as const, reason: problem } : input.blocker;
    const retryAt =
      blocker?.category === "cooldown" && blocker.retryAt ? new Date(blocker.retryAt) : null;
    if (retryAt && retryAt <= new Date()) throw new Error("Cooldown reset must be in the future.");
    const blocks = blocker && !retryAt;
    await transition(
      tx,
      goal,
      {
        evidence: json(evidence),
        gate,
        noProgress: progressed ? -1 : goal.noProgress,
        status:
          gate === "complete"
            ? "completed"
            : blocker
              ? retryAt
                ? "waiting"
                : "blocked"
              : "active",
        blocker: blocker ? json(blocker) : DbPrisma.DbNull,
        nextAttemptAt:
          gate === "complete" || (blocker && !retryAt) ? null : (retryAt ?? new Date()),
      },
      { action: "report", observations: input.observations, blocker: blocker ?? null },
    );
    if (gate === "complete") await notifyCompleted(tx, goal, scope, evidence);
    else if (blocks)
      await notifyOwner(
        tx,
        goal,
        `The release goal is blocked: ${blocker.reason}`,
        `scoped-goal-blocked:${goal.id}:${goal.version}`,
      );
    return tx.scopedGoal.findUniqueOrThrow({ where: { id: goal.id } });
  });
}

/** Goals whose next look is due. */
export async function dueScopedGoalIds(prisma: PrismaClient, now: Date) {
  const due = await prisma.scopedGoal.findMany({
    where: { status: { in: ["active", "waiting"] }, nextAttemptAt: { lte: now } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true },
  });
  return due.map((goal) => goal.id);
}

/** Hands each due goal its own job, so one goal's remote reads never hold back another's. */
export async function reconcileScopedGoals(deps: Pick<Deps, "prisma" | "jobs">, now = new Date()) {
  for (const goalId of await dueScopedGoalIds(deps.prisma, now))
    await enqueueScopedGoal(deps, goalId);
}

/** The backup job fires if the process that committed a due goal never gets to advance it. */
const GOAL_BACKUP_MS = 2 * 60_000;
const advancing = new Map<string, Promise<void>>();

/**
 * Records the backup job in the transaction that makes the goal due. Returns its key, which the
 * direct pass retires once it has run.
 */
export async function recordScopedGoalBackup(deps: Pick<Deps, "jobs">, tx: Tx, goalId: string) {
  const job = scopedGoalAdvanceJob({ goalId }, new Date(Date.now() + GOAL_BACKUP_MS), randomUUID());
  await deps.jobs.enqueueIn(tx, job);
  return job.replaceKey!;
}

/**
 * Advances a goal from this process right after the commit that made it due, never behind the
 * queue's shared slots. The goal's version claim keeps this and its backup job from both acting.
 */
export function startScopedGoal(deps: Deps, goalId: string, backupKey?: string) {
  if (advancing.has(goalId)) return;
  const started = runAsSystem("advance scoped goal", async () => {
    await advanceScopedGoal(deps, goalId);
    // This attempt ran, so its backup is not needed; a newer attempt's backup has its own key.
    if (backupKey) await deps.prisma.$transaction((tx) => deps.jobs.cancelIn(tx, backupKey));
  })
    .catch((error: unknown) => getLogger().error("scoped goal direct start", error))
    .finally(() => advancing.delete(goalId));
  advancing.set(goalId, started);
}

/** Resolves once the goals this process started directly have finished their pass. */
export async function settleScopedGoalStarts() {
  await Promise.all(advancing.values());
}

export async function enqueueScopedGoal(deps: Pick<Deps, "jobs">, goalId: string) {
  await deps.jobs.enqueue(scopedGoalAdvanceJob({ goalId })).catch(() => {
    getLogger().warn("scoped goal advance deferred to reconciliation");
  });
}

/** One transaction owns the wake intent; Run leases own execution after commit. */
export async function advanceScopedGoal(deps: Deps, goalId: string, now = new Date()) {
  const candidate = await deps.prisma.scopedGoal.findFirst({
    where: {
      id: goalId,
      status: { in: ["active", "waiting"] },
      nextAttemptAt: { lte: now },
    },
  });
  if (!candidate) return;
  // Gates that code can observe advance here, with no model. Remote reads stay out of the
  // transaction below, which only decides whether a model has to look.
  const advanced = await advanceInCode(deps, candidate, now).catch((error: unknown) => {
    getLogger().error("scoped goal observation", error);
    return { proceed: false, version: candidate.version };
  });
  if (advanced && !advanced.proceed) return;
  // One goal's conflict or bad row never holds back the others; the next pass retries it.
  const runId = await deps.prisma
    .$transaction(async (tx) => {
      // Acquire the goal row before reading related state; no remote I/O under this lock.
      const claimed = await tx.scopedGoal.updateMany({
        where: { id: candidate.id, version: advanced?.version ?? candidate.version },
        data: { updatedAt: now },
      });
      if (!claimed.count) return;
      const goal = await tx.scopedGoal.findUniqueOrThrow({ where: { id: candidate.id } });
      const [agent, member, bot, active] = await Promise.all([
        tx.cloudAgent.findUnique({ where: { id: goal.agentId } }),
        tx.spaceMember.findUnique({
          where: { spaceId_userId: { spaceId: goal.spaceId, userId: goal.userId } },
        }),
        tx.bot.findFirst({ where: { id: goal.botId, spaceId: goal.spaceId, archivedAt: null } }),
        goal.activeRunId ? tx.run.findUnique({ where: { id: goal.activeRunId } }) : null,
      ]);
      if (!member || !bot || !agent || agent.cancelRequested) {
        await transition(
          tx,
          goal,
          { status: "blocked", nextAttemptAt: null },
          { reason: "Owner, bot or managed thread unavailable" },
        );
        return;
      }
      const intervention = await tx.message.findFirst({
        where: {
          threadId: goal.threadId,
          role: "user",
          authorUserId: goal.userId,
          createdAt: { gt: goal.ownerSeenAt },
        },
        select: { id: true },
      });
      if (intervention) {
        await transition(
          tx,
          goal,
          {
            status: "paused",
            nextAttemptAt: null,
            controlEpoch: { increment: 1 },
            blocker: json({
              category: "scope",
              reason: "Owner intervened; resume after reconciling the new instruction.",
            }),
          },
          { action: "owner_intervention", messageId: intervention.id },
        );
        return;
      }
      if (active && !TERMINAL.has(active.status)) return;
      if (goal.activeRunId) {
        await settleContinuation(tx, goal, active, now);
        return;
      }
      // Remote work and other owner turns settle before a new supervisory turn starts.
      if (
        agent.status === "running" ||
        agent.followup ||
        (await tx.run.findFirst({
          where: {
            threadId: goal.threadId,
            status: { notIn: [...TERMINAL] },
          },
          select: { id: true },
        }))
      )
        return;
      const uncertain = await uncertainEffect(tx, goal);
      const prompt = `Continue scoped goal ${goal.id}, version ${goal.version + 1}, gate ${goal.gate}. Read scoped_goal_status first. Inspect the existing managed thread and current revision before acting. ${uncertain ? `Effect ${uncertain.id} is uncertain: reconcile its observable result before retrying any write.` : ""} Advance only the approved scope; retain mandatory platform approvals. Use scoped_goal_report with recorded observation effect ids, or preserve the blocker and reset time. If the current provider is unavailable, inspect available capabilities and use a suitable configured fallback in the same thread only after reconciling uncertain work. Never broaden permissions or substitute a provider for a permission refusal. Persist cooldown/reset times rather than polling a model. A completed turn is not a completed goal.`;
      const [created] = await createCloudAgentWake(
        tx,
        agent,
        prompt,
        `${SCOPED_GOAL_NONCE}${goal.id}:${goal.attempt}`,
      );
      if (!created) return;
      await transition(
        tx,
        goal,
        {
          activeRunId: created,
          activeEpoch: goal.controlEpoch,
          attempt: { increment: 1 },
          status: "active",
          nextAttemptAt: now,
        },
        { action: "continue", runId: created },
      );
      return created;
    })
    .catch((error: unknown) => {
      getLogger().error("scoped goal reconciliation", error);
      return undefined;
    });
  if (runId) await deps.jobs.enqueue(runContinueJob(runId)).catch(() => undefined);
}

/**
 * Records how a finished continuation went, then schedules the next. A turn that ended without
 * new evidence backs off; three in a row stop the goal with one notice for the owner.
 */
async function settleContinuation(tx: Tx, goal: ScopedGoal, run: Run | null, now: Date) {
  // -1 marks a continuation that reported progress, so settling it counts nothing.
  const noProgress = Math.max(goal.noProgress, -1) + 1;
  const outcome = {
    action: "settled",
    runId: goal.activeRunId,
    runStatus: run?.status ?? "missing",
    ...(run?.error ? { reason: run.error.slice(0, MAX_REASON) } : {}),
  };
  if (noProgress < MAX_NO_PROGRESS) {
    await transition(
      tx,
      goal,
      {
        activeRunId: null,
        noProgress,
        nextAttemptAt:
          noProgress === 0 || goal.status === "waiting"
            ? goal.nextAttemptAt
            : new Date(now.getTime() + BACKOFF_MS[noProgress - 1]!),
      },
      outcome,
    );
    return;
  }
  await transition(
    tx,
    goal,
    {
      activeRunId: null,
      noProgress,
      status: "blocked",
      nextAttemptAt: null,
      blocker: json({
        category: "failure",
        reason: outcome.reason ?? "Three continuations ended without evidence progress.",
      }),
    },
    { ...outcome, exhausted: true },
  );
  await notifyOwner(
    tx,
    goal,
    "The release goal stopped after three continuations without new completion evidence. Review its blocker before resuming.",
    `scoped-goal-blocked:${goal.id}:${goal.version}`,
  );
}

/** Between code passes while a gate waits on the agent or the world. */
const POLL_MS = 60_000;
/** A finished agent whose gate shows nothing new for this long is stuck, and a model looks. */
const STUCK_MS = 10 * 60_000;
const PROGRESS_ACTIONS = new Set([
  "authorized",
  "scope_reauthorized",
  "gate_passed",
  "followup_sent",
  "resume",
]);

type Step = { goal: ScopedGoal; evidence: Evidence[] };
const nextRequirement = (scope: ScopedGoalScope, evidence: readonly Evidence[]) =>
  scope.requirements.find((r) => !evidence.some((e) => e.requirementId === r.id));

/** The goal's history since its scope was last approved, newest first. */
async function historySinceApproval(prisma: PrismaClient, goalId: string) {
  const rows = await prisma.scopedGoalTransition.findMany({
    where: { goalId },
    orderBy: [{ createdAt: "desc" }, { version: "desc" }],
    take: 100,
  });
  const out: Array<{ createdAt: Date; detail: Record<string, unknown> }> = [];
  for (const row of rows) {
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    out.push({ createdAt: row.createdAt, detail });
    if (detail.action === "authorized" || detail.action === "scope_reauthorized") break;
  }
  return out;
}

/**
 * Advances the gates code can observe by itself (the agent's pull request, a live check) and
 * sends the agent the next gate's instruction. A model turn is wanted only when a gate failed,
 * the agent failed, or a finished agent has shown nothing new for a while; `proceed` says so.
 * Remote reads happen here, outside any lock; each recorded step is its own versioned transition.
 */
async function advanceInCode(deps: Deps, candidate: ScopedGoal, now: Date) {
  let goal = candidate;
  const scope = ScopedGoalScope.parse(goal.scope);
  const proceed = () => ({ proceed: true, version: goal.version });
  const wait = async () => {
    await deps.prisma.scopedGoal.updateMany({
      where: { id: goal.id, version: goal.version },
      data: { nextAttemptAt: new Date(now.getTime() + POLL_MS) },
    });
    return { proceed: false, version: goal.version };
  };
  const first = nextRequirement(scope, evidenceOf(goal));
  if (goal.activeRunId || !first || !isCodeObserver(first.tool)) return proceed();
  const [agent, intervention] = await Promise.all([
    deps.prisma.cloudAgent.findUnique({ where: { id: goal.agentId } }),
    deps.prisma.message.findFirst({
      where: {
        threadId: goal.threadId,
        role: "user",
        authorUserId: goal.userId,
        createdAt: { gt: goal.ownerSeenAt },
      },
      select: { id: true },
    }),
  ]);
  // Owner turns and an unavailable thread are for the locked pass below to settle.
  if (!agent?.remoteId || agent.cancelRequested || intervention) return proceed();
  const provider = (await cloudAgentFor(deps, agent))?.provider;
  const env = {
    scope,
    provider,
    remoteId: agent.remoteId,
    egress: deps.egress,
    context: {
      operationId: `scoped-goal:${goal.id}`,
      traceId: goal.id,
      spaceId: goal.spaceId,
      userId: goal.userId,
      botId: goal.botId,
      signal: AbortSignal.timeout(30_000),
    },
  };
  let evidence = evidenceOf(goal);
  let progressed = false;
  let mismatch: string | undefined;
  for (let requirement = first; ; ) {
    if (!isCodeObserver(requirement.tool)) break;
    const result = await observe(requirement, env);
    if (!observationMatches(requirement, result)) break;
    const sha = mergedSha(scope, await evidenceResults(deps.prisma, evidence));
    mismatch = revisionProblem(requirement, result, sha);
    if (mismatch) break;
    const added = [
      ...evidence,
      {
        requirementId: requirement.id,
        source: "code" as const,
        observedAt: now.toISOString(),
        result,
      },
    ];
    // A merged commit that just became known outranks deploy evidence recorded before it.
    const stale = staleDeploys(scope, added, await evidenceResults(deps.prisma, added));
    const next = added.filter((e) => !stale.some((s) => s.id === e.requirementId));
    const gate = goalGate(
      scope,
      next.map((e) => e.requirementId),
    );
    const recorded = await deps.prisma.$transaction(async (tx): Promise<Step> => {
      await transition(
        tx,
        goal,
        {
          evidence: json(next),
          gate,
          noProgress: 0,
          activeEpoch: goal.controlEpoch,
          status: gate === "complete" ? "completed" : "active",
          blocker: DbPrisma.DbNull,
          nextAttemptAt: gate === "complete" ? null : now,
        },
        {
          action: "gate_passed",
          source: "code",
          requirementId: requirement.id,
          gate: requirement.gate,
          ...(stale.length ? { dropped: stale } : {}),
        },
      );
      const updated = await tx.scopedGoal.findUniqueOrThrow({ where: { id: goal.id } });
      if (gate === "complete") await notifyCompleted(tx, updated, scope, next);
      return { goal: updated, evidence: next };
    });
    ({ goal, evidence } = recorded);
    progressed = true;
    mismatch = undefined;
    const following = nextRequirement(scope, evidence);
    if (!following) return { proceed: false, version: goal.version };
    requirement = following;
  }
  const current = nextRequirement(scope, evidence)!;
  const fresh = await deps.prisma.cloudAgent.findUniqueOrThrow({ where: { id: agent.id } });
  const idle = fresh.status !== "running" && !fresh.followup;
  const history = await historySinceApproval(deps.prisma, goal.id);
  const instruction = history.find(
    (h) => h.detail.action === "followup_sent" && h.detail.gate === current.gate,
  );
  const instructed = Boolean(instruction);
  // The agent was told what to do and stopped long ago, yet the world shows something else.
  if (
    mismatch &&
    idle &&
    instruction &&
    now.getTime() - instruction.createdAt.getTime() >= STUCK_MS
  ) {
    const reason = mismatch;
    await deps.prisma.$transaction(async (tx) => {
      await transition(
        tx,
        goal,
        {
          status: "blocked",
          nextAttemptAt: null,
          blocker: json({ category: "failure", reason }),
        },
        { action: "gate_failed", source: "code", requirementId: current.id, reason },
      );
      await notifyOwner(
        tx,
        goal,
        `The release goal is blocked: ${reason}`,
        `scoped-goal-blocked:${goal.id}:${goal.version}`,
      );
    });
    return { proceed: false, version: goal.version + 1 };
  }
  // The next gate's instruction goes to the agent once, without a model.
  const results = await evidenceResults(deps.prisma, evidence);
  if (
    (current.gate === "deploy" || current.gate === "install") &&
    evidence.length &&
    idle &&
    !instructed &&
    fresh.remoteId
  ) {
    const sha = mergedSha(scope, results);
    const deployed = scope.requirements
      .filter((r) => r.gate === "deploy")
      .map((r) => results.get(r.id)?.revision)
      .find((revision) => typeof revision === "string");
    const prompt =
      current.gate === "deploy"
        ? `PR merged${sha ? ` at ${sha}` : ""}. Deploy ${sha ?? "it"} per the repo's runbook, then reply with the deployed revision.`
        : `Deployed${deployed ? ` revision ${deployed}` : ""}. Install ${scope.installTarget} per the repo's runbook, then reply once it is installed.`;
    // The marker and the follow-up commit together; a changed agent undoes the marker.
    const changed = new Error("Cloud agent changed before the follow-up was recorded.");
    const queued = await deps.prisma
      .$transaction(async (tx) => {
        // A write still running or of unknown outcome stops another one, as at the tool gate.
        const uncertain = await uncertainEffect(tx, goal);
        if (uncertain) {
          const reason = `Effect ${uncertain.id} is not reconciled; the follow-up waits for it.`;
          const blocked = (goal.blocker ?? {}) as { reason?: string };
          if (blocked.reason !== reason)
            await transition(
              tx,
              goal,
              {
                status: "waiting",
                blocker: json({ category: "uncertain_effect", reason }),
              },
              { action: "followup_deferred", source: "code", gate: current.gate, reason },
            );
          return "uncertain" as const;
        }
        await transition(
          tx,
          goal,
          { activeEpoch: goal.controlEpoch, status: "active", blocker: DbPrisma.DbNull },
          { action: "followup_sent", source: "code", gate: current.gate },
        );
        const result = await queueCloudAgentFollowupInTransaction(
          tx,
          fresh,
          { prompt, goalGate: current.gate },
          false,
        );
        if (!result.count) throw changed;
        return true;
      })
      .catch((error: unknown) => {
        if (error !== changed) throw error;
        return false;
      });
    goal = await deps.prisma.scopedGoal.findUniqueOrThrow({ where: { id: goal.id } });
    if (queued === false) return wait();
    // A write that stays unreconciled holds the follow-up back, not the goal: past the stuck
    // window the checks below hand it to a continuation that reconciles the effect.
    if (queued === true) {
      await enqueueCloudAgent(deps, fresh.id);
      return wait();
    }
  }
  if (fresh.status === "failed") return proceed();
  const since = [...history].find(
    (h) =>
      PROGRESS_ACTIONS.has(String(h.detail.action)) ||
      (h.detail.action === "report" &&
        Array.isArray(h.detail.observations) &&
        h.detail.observations.length > 0),
  )?.createdAt;
  if (!progressed && idle && now.getTime() - (since ?? goal.createdAt).getTime() >= STUCK_MS)
    return proceed();
  return wait();
}
