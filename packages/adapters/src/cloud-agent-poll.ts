import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  BackgroundJobPayloads,
  CloudAgentAttention,
  CloudAgentSnapshot,
} from "@rakazo/adapter-kit";
import {
  CloudAgentRequestRejected,
  CloudAgentRetryLater,
  runContinueJob,
} from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import { BACKGROUND_HELPER_TRIGGER, cloudAgentHttpsUrl, cloudAgentUrl } from "@rakazo/core";
import type { CloudAgent } from "@rakazo/db";
import { appendEventInTransaction, Prisma } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import {
  cloudAgentJobThreadsEnabled,
  jobHelperTaskPrompt,
  jobThreadFor,
  postJobHelperCard,
} from "./cloud-agent-job-thread.js";
import type { CloudAgentDeps } from "./cloud-agent-service.js";
import {
  cloudAgentBlock,
  cloudAgentFor,
  enqueueCloudAgent,
  openQuestion,
  promoteQueuedCloudAgent,
} from "./cloud-agent-service.js";
import { cloudAgentLaunchSchema, cloudAgentPromptSchema } from "./cloud-agent-tools.js";
import {
  attentionWakePrompt,
  cloudAgentWakeNonces,
  terminalWakePrompt,
} from "./cloud-agent-wake-start.js";
import { notifyCloudAgentUnreachable } from "./run-notifications.js";
import { goalDrivesAgent, recordScopedGoalBackup, startScopedGoal } from "./scoped-goal-service.js";

const FOLLOWUP_SETTLE_MS = 5 * 60_000;
const MAX_FAILURE_REASON = 1_000;
/** Retryable failures this long in a row mean the agent's provider is unreachable, not blipping. */
export const UNREACHABLE_AFTER_MS = 5 * 60_000;

/** Reconcile one persisted intent. A fenced lease serializes remote mutations. */
export async function pollCloudAgent(
  deps: CloudAgentDeps,
  payload: BackgroundJobPayloads["cloud_agent.poll"],
) {
  const stored = await deps.prisma.cloudAgent.findUnique({ where: { id: payload.agentId } });
  // A queued request waits for a slot (promoteQueuedCloudAgent), so it is never launched early;
  // cancelling one goes ahead, since a never-launched request is cancelled locally below.
  if (!stored?.nextPollAt || (stored.queuedAt && !stored.cancelRequested)) return;
  const connection = await cloudAgentFor(deps, stored);
  if (!connection) return;
  const token = randomUUID();
  const claimed = await deps.prisma.cloudAgent.updateMany({
    where: {
      id: stored.id,
      version: stored.version,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
    },
    data: { leaseToken: token, leaseExpiresAt: new Date(Date.now() + 90_000) },
  });
  if (!claimed.count) return;
  const agent = { ...stored, leaseToken: token };
  const context: AdapterContext = {
    operationId: agent.id,
    traceId: agent.id,
    spaceId: agent.spaceId,
    userId: agent.userId,
    botId: agent.botId,
    signal: AbortSignal.timeout(60_000),
  };
  const provider = connection.provider;
  try {
    const [card, member, bot] = await Promise.all([
      deps.prisma.message.findFirst({
        where: { id: agent.messageId ?? "", threadId: agent.threadId },
        select: { id: true },
      }),
      deps.prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: agent.spaceId, userId: agent.userId } },
        select: { id: true },
      }),
      deps.prisma.bot.findFirst({
        where: { id: agent.botId, spaceId: agent.spaceId, archivedAt: null },
      }),
    ]);
    const abandoned = !card || !member || !bot;
    if ((abandoned || agent.cancelRequested) && !agent.remoteId && !agent.launchDispatched) {
      await finishPoll(
        deps,
        agent,
        { status: "cancelled", cancelRequested: false, launchRequest: {} },
        abandoned,
      );
      return;
    }
    if (!agent.remoteId) {
      // Write dispatch intent before I/O; a crash replays the same idempotent create.
      const marked = await deps.prisma.cloudAgent.updateMany({
        where: fence(agent),
        data: { launchDispatched: true },
      });
      if (!marked.count) return;
      const request = cloudAgentLaunchSchema.parse(agent.launchRequest);
      try {
        const snapshot = await provider.launch({ ...request, idempotencyKey: agent.id }, context);
        await finishPoll(
          deps,
          agent,
          {
            ...snapshotData(snapshot),
            // A wait for quota left its note; the started agent replaces it.
            launchNote: snapshot.launchNote ?? null,
            remoteId: snapshot.id,
            launchRequest: {},
            cancelRequested: abandoned || agent.cancelRequested,
          },
          abandoned,
        );
      } catch (error) {
        if (!(error instanceof CloudAgentRequestRejected)) throw error;
        await finishPoll(
          deps,
          agent,
          { ...rejectedData(error), launchNote: null, launchRequest: {} },
          abandoned,
        );
      }
      return;
    }
    const dispatchedAt = agent.followup ? agent.followupDispatchedAt : null;
    // An ambiguous follow-up appears in the newest-first run list once accepted.
    // The client abandons its request long before this window ends, so a run that
    // still has not appeared was never accepted and can be resent or dropped.
    const unsent =
      dispatchedAt !== null && Date.now() - dispatchedAt.getTime() >= FOLLOWUP_SETTLE_MS;
    if (abandoned || agent.cancelRequested) {
      // An unsent follow-up to finished work can just be dropped; an unsent answer belongs to
      // work still running remotely, which the cancel below must stop.
      if (agent.followup && !dispatchedAt && !openQuestion(agent)) {
        await finishPoll(
          deps,
          agent,
          { status: "cancelled", followup: Prisma.DbNull, cancelRequested: false },
          abandoned,
        );
        return;
      }
      const snapshot = await provider.cancel(
        agent.remoteId,
        context,
        dispatchedAt ? undefined : (agent.latestRunId ?? undefined),
      );
      // Only a follow-up starts a new run that may still appear; an answer continues the current one.
      const pending =
        dispatchedAt !== null && !openQuestion(agent) && snapshot.latestRunId === agent.latestRunId;
      if (pending && !unsent) {
        // An old terminal run cannot confirm cancellation of a run that may still appear.
        await retryPoll(deps, agent);
        return;
      }
      await finishPoll(
        deps,
        agent,
        {
          ...(pending ? { status: "cancelled" } : snapshotData(snapshot)),
          cancelRequested: !pending && snapshot.status === "running",
          followup: Prisma.DbNull,
          followupDispatchedAt: null,
        },
        abandoned,
      );
      return;
    }
    if (agent.followup) {
      if (dispatchedAt) {
        // Follow-ups have no idempotency key: resend only once the run list has settled.
        const snapshot = await provider.get(
          agent.remoteId,
          context,
          undefined,
          agent.remoteCursor ?? undefined,
        );
        // An answer keeps its run; the question leaving the open list says it was accepted.
        const question = openQuestion(agent);
        const answered =
          question !== undefined &&
          !snapshot.attention?.some((item) => item.requestId === question.requestId);
        if (!answered && snapshot.latestRunId === agent.latestRunId) {
          await retryPoll(deps, agent, undefined, unsent ? { followupDispatchedAt: null } : {});
          return;
        }
        await finishPoll(
          deps,
          agent,
          { ...snapshotData(snapshot), followup: Prisma.DbNull, followupDispatchedAt: null },
          false,
          snapshot.missedAttention,
        );
      } else {
        // A goal's follow-up is dropped if the owner stops the goal first: a continuation's also
        // if that continuation was superseded (`goalRunId`), the reconciler's own (`goalGate`)
        // once its goal no longer drives the agent.
        const { goalRunId, goalGate, ...followup } = agent.followup as {
          goalRunId?: string;
          goalGate?: string;
        };
        const goal =
          goalRunId || goalGate
            ? await deps.prisma.scopedGoal.findUnique({ where: { agentId: agent.id } })
            : null;
        if (
          (goalRunId || goalGate) &&
          (!goalDrivesAgent(goal) || (goalRunId && goal?.activeRunId !== goalRunId))
        ) {
          const snapshot = await provider.get(
            agent.remoteId,
            context,
            undefined,
            agent.remoteCursor ?? undefined,
          );
          await finishPoll(deps, agent, {
            ...snapshotData(snapshot),
            followup: Prisma.DbNull,
            followupDispatchedAt: null,
          });
          return;
        }
        const marked = await deps.prisma.cloudAgent.updateMany({
          where: fence(agent),
          data: { followupDispatchedAt: new Date() },
        });
        if (!marked.count) return;
        const question = openQuestion(agent);
        try {
          const snapshot = await provider.reply(
            agent.remoteId,
            {
              ...cloudAgentPromptSchema.parse(followup),
              ...(question
                ? { questionId: question.requestId, questionThreadId: question.threadId }
                : {}),
              idempotencyKey: `${agent.id}:${agent.generation}`,
            },
            context,
          );
          // An answer continues the current run; only a follow-up must start a new one.
          if (!question && (!snapshot.latestRunId || snapshot.latestRunId === agent.latestRunId))
            throw new Error("Cloud agent follow-up did not identify a new run");
          await finishPoll(deps, agent, {
            ...snapshotData(snapshot),
            followup: Prisma.DbNull,
            followupDispatchedAt: null,
          });
        } catch (error) {
          if (error instanceof CloudAgentRetryLater) {
            // A refused request was never accepted, so the next poll resends it. That stays true
            // when a message sent meanwhile moved the version, so only our lease guards it: a
            // marker left behind would let that message's run pass for this one's.
            await deps.prisma.cloudAgent.updateMany({
              where: { id: agent.id, leaseToken: agent.leaseToken },
              data: { followupDispatchedAt: null },
            });
            await outagePoll(deps, agent, error.retryAfterMs);
            return;
          }
          if (!(error instanceof CloudAgentRequestRejected)) throw error;
          // A refused answer (the owner answered first, say) leaves the work running.
          await finishPoll(deps, agent, {
            ...(question ? {} : rejectedData(error)),
            followup: Prisma.DbNull,
            followupDispatchedAt: null,
          });
        }
      }
      return;
    }
    // A specific run cannot regress to stale agent-level metadata after a follow-up.
    const snapshot = await provider.get(
      agent.remoteId,
      context,
      agent.latestRunId ?? undefined,
      agent.remoteCursor ?? undefined,
    );
    await finishPoll(deps, agent, snapshotData(snapshot), false, snapshot.missedAttention);
  } catch (error) {
    if (error instanceof CloudAgentRequestRejected && error.reason !== "invalid") {
      // The remote agent or run is gone. Polling it again can never succeed.
      await finishPoll(deps, agent, {
        ...rejectedData(error),
        ...(agent.cancelRequested && error.reason === "not_found"
          ? { status: "cancelled", failureReason: null }
          : {}),
        followup: Prisma.DbNull,
        followupDispatchedAt: null,
      });
      return;
    }
    if (error instanceof CloudAgentRetryLater && error.reason === "quota") {
      await quotaPoll(deps, agent, error);
      return;
    }
    // Provider response bodies and secrets never enter logs, cards, or model context.
    if (error instanceof CloudAgentRetryLater && error.reason === "credential")
      getLogger().warn("cloud agent credential rejected; check the provider connection");
    else getLogger().warn("cloud agent operation deferred to reconciliation");
    if (error instanceof CloudAgentRetryLater) await outagePoll(deps, agent, error.retryAfterMs);
    else await retryPoll(deps, agent);
  } finally {
    // A concurrent user action can change version while remote I/O is in flight.
    // Release only our lease, preserving that action's pending intent and due date.
    await deps.prisma.cloudAgent.updateMany({
      where: { id: agent.id, leaseToken: token },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
  }
}

function fence(agent: CloudAgent) {
  return { id: agent.id, version: agent.version, leaseToken: agent.leaseToken };
}

function snapshotData(snapshot: CloudAgentSnapshot): Prisma.CloudAgentUpdateManyMutationInput {
  return {
    ...(snapshot.title ? { title: snapshot.title } : {}),
    status: snapshot.status,
    failureReason: null,
    resultText: snapshot.result ?? null,
    ...(snapshot.url ? { url: cloudAgentUrl(snapshot.url) ?? "" } : {}),
    branch: snapshot.branch,
    prUrl: snapshot.prUrl ? (cloudAgentHttpsUrl(snapshot.prUrl) ?? "") : undefined,
    latestRunId: snapshot.latestRunId,
    ...(snapshot.cursor !== undefined ? { remoteCursor: snapshot.cursor } : {}),
    ...(snapshot.attention !== undefined
      ? {
          attention: snapshot.attention.length
            ? (snapshot.attention as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        }
      : {}),
    ...(snapshot.historyGap ? { historyGapAt: new Date() } : {}),
  };
}

/** The provider's own reason travels with the terminal status, so the bot can say why. */
function rejectedData(error: CloudAgentRequestRejected) {
  return {
    status: error.reason === "expired" ? "expired" : "failed",
    failureReason: error.detail?.slice(0, MAX_FAILURE_REASON) || null,
  };
}

async function retryPoll(
  deps: CloudAgentDeps,
  agent: CloudAgent,
  retryAfterMs?: number,
  data: Prisma.CloudAgentUpdateManyMutationInput = {},
) {
  const backoff = Math.min(60_000, 5_000 * 2 ** Math.min(agent.errorCount, 4));
  // Honor a provider's Retry-After, bounded so one response cannot park an agent for long.
  const delay =
    retryAfterMs === undefined ? backoff : Math.min(15 * 60_000, Math.max(backoff, retryAfterMs));
  const nextPollAt = new Date(Date.now() + delay);
  const saved = await deps.prisma.cloudAgent.updateMany({
    where: fence(agent),
    data: {
      ...data,
      nextPollAt,
      errorCount: { increment: 1 },
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  if (saved.count) await enqueueCloudAgent(deps, agent.id, nextPollAt);
  return saved.count > 0;
}

/**
 * A launch waiting for model quota. Nothing was sent, so the launch can start over or be
 * cancelled while it waits, and it is no outage: the note says why and until when.
 */
async function quotaPoll(deps: CloudAgentDeps, agent: CloudAgent, error: CloudAgentRetryLater) {
  const nextPollAt = new Date(Date.now() + (error.retryAfterMs ?? 15 * 60_000));
  // Only our lease guards this, so a cancel that moved the version still finds nothing dispatched.
  await deps.prisma.cloudAgent.updateMany({
    where: { id: agent.id, leaseToken: agent.leaseToken },
    data: { launchDispatched: false, launchNote: error.note ?? null },
  });
  const saved = await deps.prisma.cloudAgent.updateMany({
    where: fence(agent),
    data: {
      nextPollAt,
      errorCount: 0,
      retryingSince: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  if (saved.count) await enqueueCloudAgent(deps, agent.id, nextPollAt);
}

/**
 * A retryable failure. Once they have run unbroken past the threshold the card says so and the
 * owner hears once, without waking the bot; a success (finishPoll) clears it and a new outage
 * starts over.
 */
async function outagePoll(deps: CloudAgentDeps, agent: CloudAgent, retryAfterMs?: number) {
  const now = new Date();
  const since = agent.retryingSince ?? now;
  const unreachable =
    !agent.unreachableSince && now.getTime() - since.getTime() >= UNREACHABLE_AFTER_MS;
  const saved = await retryPoll(deps, agent, retryAfterMs, {
    retryingSince: since,
    ...(unreachable ? { unreachableSince: now } : {}),
  });
  if (!saved || !unreachable) return;
  await repaintCloudAgentCard(deps, agent.id);
  await notifyCloudAgentUnreachable(
    { prisma: deps.prisma, events: deps.events, notifications: deps.notifications },
    agent,
  ).catch(() => getLogger().warn("cloud agent unreachable notice failed"));
}

/** The card follows the row when only its outage state changed. */
async function repaintCloudAgentCard(deps: CloudAgentDeps, agentId: string) {
  const seq = await deps.prisma.$transaction(async (tx) => {
    const saved = await tx.cloudAgent.findUnique({ where: { id: agentId } });
    if (!saved) return undefined;
    // Same lock order as finishPoll: thread first, then the message.
    await tx.thread.updateMany({
      where: { id: saved.threadId, spaceId: saved.spaceId },
      data: { nextEventSeq: { increment: 0 } },
    });
    const message = await tx.message.findFirst({
      where: { id: saved.messageId ?? "", threadId: saved.threadId },
    });
    if (!message) return undefined;
    const nextBlock = cloudAgentBlock(saved);
    const blocks = (message.blocks as MessageBlock[]).map((block) =>
      block.kind === "cloud_agent" && block.agentId === saved.id ? nextBlock : block,
    );
    if (JSON.stringify(blocks) === JSON.stringify(message.blocks)) return undefined;
    await tx.message.update({ where: { id: message.id }, data: { blocks } });
    const event = await appendEventInTransaction(tx, {
      spaceId: saved.spaceId,
      threadId: saved.threadId,
      botId: saved.botId,
      type: "thread.cloud_agent",
      payload: { messageId: message.id, ...nextBlock },
    });
    return event.seq;
  });
  const agent = await deps.prisma.cloudAgent.findUnique({
    where: { id: agentId },
    select: { threadId: true },
  });
  if (seq !== undefined && agent)
    await deps.events.notify(agent.threadId, seq).catch(() => undefined);
}

async function finishPoll(
  deps: CloudAgentDeps,
  agent: CloudAgent,
  data: Prisma.CloudAgentUpdateManyMutationInput,
  abandoned = false,
  missed: CloudAgentAttention[] = [],
) {
  const committed = await deps.prisma.$transaction(async (tx) => {
    // Same lock order as clearing chat: thread first, then message/run changes.
    const thread = await tx.thread.updateMany({
      where: {
        id: agent.threadId,
        spaceId: agent.spaceId,
      },
      data: { nextEventSeq: { increment: 0 } },
    });
    const message = thread.count
      ? await tx.message.findFirst({
          where: {
            id: agent.messageId ?? "",
            threadId: agent.threadId,
          },
        })
      : null;
    const [member, bot] = await Promise.all([
      tx.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: agent.spaceId, userId: agent.userId } },
        select: { id: true },
      }),
      tx.bot.findFirst({
        where: { id: agent.botId, spaceId: agent.spaceId, archivedAt: null },
        select: { id: true },
      }),
    ]);
    const detached = abandoned || !message || !member || !bot;
    const status = typeof data.status === "string" ? data.status : agent.status;
    const terminal = status !== "running";
    const cancelRequested =
      !terminal && (detached || data.cancelRequested === true || agent.cancelRequested);
    const nextPollAt = terminal ? null : new Date(Date.now() + 5_000);
    const updated = await tx.cloudAgent.updateMany({
      where: fence(agent),
      data: {
        ...data,
        cancelRequested,
        nextPollAt,
        // A queued request cancelled before it started ends here, off the queue.
        ...(terminal ? { queuedAt: null } : {}),
        errorCount: 0,
        retryingSince: null,
        unreachableSince: null,
        leaseToken: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (!updated.count) return null;
    const saved = await tx.cloudAgent.findUniqueOrThrow({ where: { id: agent.id } });
    let seq: number | undefined;
    const wakeRunIds: string[] = [];
    let goalId: string | undefined;
    let goalBackupKey: string | undefined;
    // Events for the cards a job helper's wakes left in the chat, announced with the rest.
    const wakeSeqs: number[] = [];
    const wakeOptions = { jobThread: true, seqs: wakeSeqs };
    if (message && !detached) {
      const nextBlock = cloudAgentBlock(saved);
      const blocks = (message.blocks as MessageBlock[]).map((block) =>
        block.kind === "cloud_agent" && block.agentId === agent.id ? nextBlock : block,
      );
      if (JSON.stringify(blocks) !== JSON.stringify(message.blocks)) {
        await tx.message.update({ where: { id: message.id }, data: { blocks } });
        const event = await appendEventInTransaction(tx, {
          spaceId: agent.spaceId,
          threadId: agent.threadId,
          botId: agent.botId,
          type: "thread.cloud_agent",
          payload: { messageId: message.id, ...nextBlock },
        });
        seq = event.seq;
      }
      // A live goal starts its own supervisory turn; otherwise the owner hears as usual.
      const goal = await tx.scopedGoal.findUnique({ where: { agentId: agent.id } });
      // The agent stopping is when its goal's gates are worth observing.
      if (terminal && goalDrivesAgent(goal) && goal.nextAttemptAt) {
        goalId = goal.id;
        await tx.scopedGoal.update({ where: { id: goal.id }, data: { nextAttemptAt: new Date() } });
        goalBackupKey = await recordScopedGoalBackup(deps, tx, goal.id);
      }
      if (terminal && !goalDrivesAgent(goal) && saved.wakeGeneration < saved.generation) {
        // Provider text is untrusted. Wake with local identity and status only.
        wakeRunIds.push(
          ...(await createCloudAgentWake(
            tx,
            saved,
            terminalWakePrompt(saved),
            `cloud-agent-wake-run:${agent.id}:${saved.generation}`,
            wakeOptions,
          )),
        );
        await tx.cloudAgent.update({
          where: { id: agent.id },
          data: { wakeGeneration: saved.generation, wakeAttempts: 1 },
        });
      }
      // Each new question or approval wakes the bot once; the request id is the dedupe key.
      for (const requestId of newAttention(agent.attention, saved.attention)) {
        wakeRunIds.push(
          ...(await createCloudAgentWake(
            tx,
            saved,
            attentionWakePrompt(agent.id, requestId),
            `cloud-agent-attention:${agent.id}:${requestId}`,
            wakeOptions,
          )),
        );
      }
      // A closed blocker only matters if the agent did not keep working or finish normally.
      for (const { requestId } of saved.status === "running" || saved.status === "finished"
        ? []
        : missed) {
        wakeRunIds.push(
          ...(await createCloudAgentWake(
            tx,
            saved,
            `Cloud agent ${agent.id} had a question or approval (${requestId}) that closed unanswered. Use cloud_agent_status to check whether it is still working.`,
            `cloud-agent-attention:${agent.id}:${requestId}`,
            wakeOptions,
          )),
        );
      }
    }
    const promotedId =
      terminal && agent.status === "running"
        ? await promoteQueuedCloudAgent(tx, agent.providerKey, agent.botId)
        : undefined;
    return {
      seq: wakeSeqs.length ? Math.max(seq ?? 0, ...wakeSeqs) : seq,
      wakeRunIds,
      nextPollAt,
      promotedId,
      goalId,
      goalBackupKey,
    };
  });
  if (!committed) return;
  if (committed.promotedId) await enqueueCloudAgent(deps, committed.promotedId);
  if (committed.seq !== undefined)
    await deps.events.notify(agent.threadId, committed.seq).catch(() => undefined);
  for (const wakeRunId of new Set(committed.wakeRunIds)) {
    // The existing run reconciler recovers a queued wake after an enqueue failure.
    await deps.jobs.enqueue(runContinueJob(wakeRunId)).catch(() => {
      getLogger().warn("cloud agent wake deferred to reconciliation");
    });
  }
  if (committed.nextPollAt) await enqueueCloudAgent(deps, agent.id, committed.nextPollAt);
  // Only this agent's goal is looked at, from here; its backup job and the reconciler cover a crash.
  else if (committed.goalId) startScopedGoal(deps, committed.goalId, committed.goalBackupKey);
}

type Tx = Parameters<Parameters<CloudAgentDeps["prisma"]["$transaction"]>[0]>[0];

export function attentionIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item?.requestId === "string" ? [item.requestId as string] : [],
      )
    : [];
}

function newAttention(before: unknown, after: unknown): string[] {
  const seen = new Set(attentionIds(before));
  return attentionIds(after).filter((id) => !seen.has(id));
}

export interface CloudAgentWakeOptions {
  /** Run the wake in the agent's own helper thread when the deployment turns that on. */
  jobThread?: boolean;
  /** Collects the event seq of each card posted to the chat, for the caller to announce. */
  seqs?: number[];
}

/**
 * Preserve each wake identity, folding it into an unstarted run in the same bot/thread.
 * The thread lock serializes deduplication and appends across pollers and reconcilers.
 */
export async function createCloudAgentWake(
  tx: Tx,
  agent: CloudAgent,
  prompt: string,
  clientNonce: string,
  options: CloudAgentWakeOptions = {},
): Promise<string[]> {
  // Use the same thread-first lock order as polling and chat clearing. Reconciler retries
  // also come here; no in-process lock can protect wakes created on another instance.
  await lockCloudAgentWakeThread(tx, agent);
  const existing = await tx.run.findFirst({
    where: { spaceId: agent.spaceId, ...cloudAgentWakeNonceWhere(clientNonce) },
    select: { id: true },
  });
  if (existing) return [];
  const job = options.jobThread && cloudAgentJobThreadsEnabled();
  const threadId = job ? await jobThreadFor(tx, agent) : agent.threadId;
  const queued = await tx.run.findFirst({
    where: {
      spaceId: agent.spaceId,
      userId: agent.userId,
      botId: agent.botId,
      threadId,
      trigger: job ? BACKGROUND_HELPER_TRIGGER : "cloud_agent",
      status: "queued",
      startedAt: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, taskId: true, clientNonce: true, cloudAgentWakeNonces: true },
  });
  if (queued) {
    // Claiming the run competes on this row. If it won, its prompt is immutable and the new
    // wake needs another run. If we win, the claimant reads the appended prompt after commit.
    const appended = await tx.run.updateMany({
      where: { id: queued.id, status: "queued", startedAt: null },
      data: {
        cloudAgentWakeNonces: [...cloudAgentWakeNonces(queued), clientNonce],
      },
    });
    if (appended.count) {
      const task = await tx.task.findUniqueOrThrow({ where: { id: queued.taskId } });
      await tx.task.update({
        where: { id: task.id },
        data: { prompt: `${task.prompt}\n\n${prompt}` },
      });
      return [queued.id];
    }
  }
  // A job helper's one result lands on a card in the main chat, which its run settles.
  const card = job ? await postJobHelperCard(tx, agent, clientNonce) : undefined;
  if (card) options.seqs?.push(card.seq);
  const task = await tx.task.create({
    data: {
      spaceId: agent.spaceId,
      botId: agent.botId,
      threadId,
      userId: agent.userId,
      prompt: job ? await jobHelperTaskPrompt(tx, agent, [prompt]) : prompt,
      status: "queued",
    },
  });
  const run = await tx.run.create({
    data: {
      spaceId: agent.spaceId,
      botId: agent.botId,
      threadId,
      userId: agent.userId,
      taskId: task.id,
      status: "queued",
      trigger: job ? BACKGROUND_HELPER_TRIGGER : "cloud_agent",
      clientNonce,
      cloudAgentWakeNonces: [clientNonce],
      ...(card ? { sourceMessageId: card.messageId } : {}),
    },
  });
  return [run.id];
}

/** Primary nonces also cover runs written by the previous release. */
export function cloudAgentWakeNonceWhere(clientNonce: string): Prisma.RunWhereInput {
  return { OR: [{ clientNonce }, { cloudAgentWakeNonces: { has: clientNonce } }] };
}

export async function lockCloudAgentWakeThread(
  tx: Tx,
  agent: Pick<CloudAgent, "spaceId" | "threadId">,
) {
  await tx.thread.updateMany({
    where: { id: agent.threadId, spaceId: agent.spaceId },
    data: { nextEventSeq: { increment: 0 } },
  });
}
