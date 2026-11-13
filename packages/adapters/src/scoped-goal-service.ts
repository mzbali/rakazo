import { isDeepStrictEqual } from "node:util";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import { ScopedGoalControl, ScopedGoalReport, ScopedGoalScope } from "@rakazo/contracts";
import type { Prisma, PrismaClient, Run, ScopedGoal } from "@rakazo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  Prisma as DbPrisma,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { createCloudAgentWake } from "./cloud-agent-poll.js";

type Deps = { prisma: PrismaClient; jobs: JobPublisher };
type Owner = { spaceId: string; userId: string; botId: string; threadId: string };
type Tx = Prisma.TransactionClient;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const MAX_NO_PROGRESS = 3;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const MAX_REASON = 1_000;
const json = (value: unknown) => value as Prisma.InputJsonValue;
export const SCOPED_GOAL_NONCE = "scoped-goal:";

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
    const evidence = Array.isArray(goal.evidence)
      ? ([...goal.evidence] as Array<{ requirementId: string; effectId: string }>)
      : [];
    if (input.observations.length) {
      const guard = scope.requirements.find((r) => r.revisionCheck)!;
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
      if (!evidence.some((e) => e.requirementId === observation.requirementId))
        evidence.push(observation);
    }
    const gate = goalGate(
      scope,
      evidence.map((e) => e.requirementId),
    );
    const progressed = !isDeepStrictEqual(evidence, goal.evidence);
    const blocker = input.blocker;
    const retryAt =
      blocker?.category === "cooldown" && blocker.retryAt ? new Date(blocker.retryAt) : null;
    if (retryAt && retryAt <= new Date()) throw new Error("Cooldown reset must be in the future.");
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
    return tx.scopedGoal.findUniqueOrThrow({ where: { id: goal.id } });
  });
}

/** One transaction owns the wake intent; Run leases own execution after commit. */
export async function reconcileScopedGoals(deps: Deps, now = new Date()) {
  const due = await deps.prisma.scopedGoal.findMany({
    where: {
      status: { in: ["active", "waiting"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  for (const candidate of due) {
    // One goal's conflict or bad row never holds back the others; the next pass retries it.
    const runId = await deps.prisma
      .$transaction(async (tx) => {
        // Acquire the goal row before reading related state; no remote I/O under this lock.
        const claimed = await tx.scopedGoal.updateMany({
          where: { id: candidate.id, version: candidate.version },
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
        const uncertain = await tx.externalEffect.findFirst({
          where: {
            spaceId: goal.spaceId,
            run: { threadId: goal.threadId },
            status: { in: ["executing", "uncertain"] },
          },
          select: { id: true },
        });
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
  const blocks = [
    {
      kind: "text" as const,
      text: "The release goal stopped after three continuations without new completion evidence. Review its blocker before resuming.",
    },
  ];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: goal.threadId,
    botId: goal.botId,
    role: "bot",
    blocks,
    clientNonce: `scoped-goal-blocked:${goal.id}:${goal.version}`,
  });
  await appendEventInTransaction(tx, {
    spaceId: goal.spaceId,
    threadId: goal.threadId,
    botId: goal.botId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "bot", blocks },
  });
}
