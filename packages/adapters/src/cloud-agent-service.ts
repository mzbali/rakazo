import type { AdapterContext, JobPublisher, NotificationProvider } from "@rakazo/adapter-kit";
import { cloudAgentPollJob, runContinueJob } from "@rakazo/adapter-kit";
import { BACKGROUND_HELPER_TRIGGER, cloudAgentBlockFromPayload } from "@rakazo/core";
import type { CloudAgent, Prisma, PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  THREAD_LOCK_TRANSACTION_OPTIONS,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { messageBot } from "./bot-messages.js";
import type {
  CloudAgentActor,
  CloudAgentConnection,
  UserCloudAgents,
} from "./cloud-agent-factory.js";
import { cloudAgentsEnabled, USER_CLOUD_AGENT_KEY_PREFIX } from "./cloud-agent-factory.js";
import { cloudAgentJobThreadsEnabled, MAX_LAUNCH_BRIEF } from "./cloud-agent-job-thread.js";
import {
  attentionIds,
  cloudAgentWakeNonceWhere,
  createCloudAgentWake,
  lockCloudAgentWakeThread,
} from "./cloud-agent-poll.js";
import {
  cloudAgentLaunchSchema,
  cloudAgentReplySchema,
  cloudAgentReportSchema,
} from "./cloud-agent-tools.js";
import {
  attentionWakePrompt,
  cloudAgentWakeNonces,
  terminalWakePrompt,
} from "./cloud-agent-wake-start.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { runLeaseFor } from "./run-messages.js";
import { goalDrivesAgent, missingGoalEvidence, SCOPED_GOAL_NONCE } from "./scoped-goal-service.js";

export interface CloudAgentDeps {
  prisma: PrismaClient;
  jobs: JobPublisher;
  events: Pick<ThreadEvents, "notify"> & Partial<Pick<ThreadEvents, "publishChatAlert">>;
  /** Tells the owner a cloud agent is unreachable; absent leaves the card as the only sign. */
  notifications?: NotificationProvider;
  cloudAgent: CloudAgentConnection | null | undefined;
  userCloudAgents?: UserCloudAgents;
  runLease?: ExecutorDeps["runLease"];
}

/** A bot runs at most this many requests at once; later ones wait their turn in order. */
export const CLOUD_AGENT_ACTIVE_LIMIT = 2;

type Connections = Partial<Pick<CloudAgentDeps, "cloudAgent" | "userCloudAgents" | "prisma">>;

/** Where an actor's new agents run: their own connected environment, else the deployment's. */
export async function cloudAgentForActor(
  deps: Connections,
  actor: CloudAgentActor & { botIds?: string[] },
) {
  // The deployment's own T3 provider reaches the same T3 as a user-connected one, but forwards the
  // launch's model, workspace and modes, caps the runtime mode and reports the model started.
  if (await deploymentT3Serves(deps, actor)) return deps.cloudAgent!;
  const own = await deps.userCloudAgents?.forActor(actor).catch((error: unknown) => {
    getLogger().warn("cloud_agent.user_connections_unavailable", { error });
    return null;
  });
  return own ?? (cloudAgentsEnabled(deps.cloudAgent, actor.spaceId) ? deps.cloudAgent! : null);
}

/** Whether the deployment's T3 provider is in this Space and every named bot may use it. */
async function deploymentT3Serves(
  deps: Connections,
  actor: CloudAgentActor & { botIds?: string[] },
) {
  const deployment = deps.cloudAgent;
  if (!deployment?.key.startsWith("t3:") || !cloudAgentsEnabled(deployment, actor.spaceId))
    return false;
  if (!actor.botIds?.length || !deployment.enabledForBot) return true;
  const { prisma } = deps;
  if (!prisma) return false;
  const served = await Promise.all(
    actor.botIds.map((botId) => deployment.enabledForBot!(prisma, actor.spaceId, botId)),
  ).catch(() => [false]);
  return served.every(Boolean);
}

/** Everywhere the actor's agents may send work: each environment they connected, and the deployment's. */
export async function cloudAgentsForActor(deps: Connections, actor: CloudAgentActor) {
  const own =
    (await deps.userCloudAgents?.listForActor(actor).catch((error: unknown) => {
      getLogger().warn("cloud_agent.user_connections_unavailable", { error });
      return null;
    })) ?? [];
  return cloudAgentsEnabled(deps.cloudAgent, actor.spaceId) ? [...own, deps.cloudAgent!] : own;
}

/** The connection an agent was launched on, while it may still be used for it. */
export async function cloudAgentFor(
  deps: Connections,
  agent: Pick<CloudAgent, "providerKey"> & CloudAgentActor,
) {
  if (deps.cloudAgent?.key === agent.providerKey)
    return cloudAgentsEnabled(deps.cloudAgent, agent.spaceId) ? deps.cloudAgent : null;
  const { spaceId, userId } = agent;
  return (await deps.userCloudAgents?.forKey(agent.providerKey, { spaceId, userId })) ?? null;
}

export function cloudAgentBlock(agent: CloudAgent) {
  return cloudAgentBlockFromPayload({
    ...agent,
    agentId: agent.id,
    queued: agent.queuedAt !== null,
    needsInput: Array.isArray(agent.attention) && agent.attention.length > 0,
  });
}

/** The bot whose request this is, when another bot's message started the run. */
export interface CloudAgentOrigin {
  botId: string;
  messageId: string;
}

/** Queue an intent only after scope and owner checks. The worker owns remote I/O. */
export async function executeCloudAgentTool(
  /** `deployment`: the deployment's connection when the run's own is the user's environment. */
  deps: CloudAgentDeps & { deployment?: CloudAgentConnection | null },
  context: AdapterContext & { botId: string; botName?: string },
  run: {
    id: string;
    threadId: string;
    spaceId?: string;
    userId?: string;
    clientNonce?: string | null;
  },
  name: string,
  args: Record<string, unknown>,
  origin?: CloudAgentOrigin,
) {
  const connection = cloudAgentsEnabled(deps.cloudAgent, context.spaceId) ? deps.cloudAgent : null;
  const cleanup = name === "cloud_agent_status" || name === "cloud_agent_cancel";
  if (!connection && !cleanup) {
    return { error: "Cloud agents are not configured for this space." };
  }
  let agent: CloudAgent;
  let clampNote: string | undefined;
  if (name === "cloud_agent_launch") {
    const request = cloudAgentLaunchSchema.parse(args);
    const modes = ["approval-required", "auto-accept-edits", "auto", "full-access"] as const;
    const ceiling = connection!.provider.describe().capabilities.runtimeModeCeiling ?? "auto";
    if (request.runtimeMode && modes.indexOf(request.runtimeMode) > modes.indexOf(ceiling)) {
      request.runtimeMode = ceiling;
      clampNote = `Runtime mode clamped to ${ceiling}.`;
    }
    const result = await deps.prisma.$transaction(async (tx): Promise<PostedCard> => {
      // Serialize with clearThread before creating either the intent or its card.
      await tx.thread.update({
        where: { id: run.threadId, spaceId: context.spaceId },
        data: { nextMessageSeq: { increment: 0 } },
      });
      // Same-key launches from one member's chats meet here, so the second finds the first.
      await lockBotSlots(tx, context.botId);
      const existing =
        (await tx.cloudAgent.findUnique({ where: { operationKey: context.operationId } })) ??
        (request.requestKey
          ? await tx.cloudAgent.findUnique({
              where: {
                spaceId_userId_botId_requestKey: {
                  spaceId: context.spaceId,
                  userId: context.userId,
                  botId: context.botId,
                  requestKey: request.requestKey,
                },
              },
            })
          : null);
      if (existing) {
        if (existing.spaceId !== context.spaceId || existing.userId !== context.userId) {
          throw new Error("Cloud agent operation scope changed");
        }
        // A retry returns the agent it started even when new agents now go elsewhere, as after a
        // T3 Code grant lapsed; the agent's poll reaches it through its own provider key.
        return { agent: existing };
      }
      const { requestKey, agreement, acceptance, ...launchRequest } = request;
      const queued =
        (await activeCloudAgentCount(tx, connection!.key, context.botId)) >=
        CLOUD_AGENT_ACTIVE_LIMIT;
      const created = await tx.cloudAgent.create({
        data: {
          operationKey: context.operationId,
          providerKey: connection!.key,
          spaceId: context.spaceId,
          userId: context.userId,
          botId: context.botId,
          threadId: run.threadId,
          title: request.prompt.split(/\r?\n/, 1)[0]!.slice(0, 80),
          launchRequest,
          // The launch request is cleared once sent; a job thread's helper still needs the brief.
          ...(cloudAgentJobThreadsEnabled()
            ? { launchBrief: request.prompt.slice(0, MAX_LAUNCH_BRIEF) }
            : {}),
          requestKey,
          agreement,
          acceptance,
          originBotId: origin?.botId,
          originMessageId: origin?.messageId,
          ...(queued ? { queuedAt: new Date(), nextPollAt: null } : {}),
        },
      });
      return postCloudAgentCard(tx, deps, context, run, created);
    }, THREAD_LOCK_TRANSACTION_OPTIONS);
    agent = result.agent;
    if (result.seq !== undefined)
      await deps.events
        .notify(run.threadId, result.seq, result.firstResponseRunId)
        .catch(() => undefined);
  } else {
    const owned = await deps.prisma.cloudAgent.findFirst({
      where: {
        id: String(args.id).trim(),
        // The actor's agents wherever they run, not only where new agents go.
        OR: [
          ...(connection ? [{ providerKey: connection.key }] : []),
          { providerKey: { startsWith: USER_CLOUD_AGENT_KEY_PREFIX } },
          ...(deps.deployment && cloudAgentsEnabled(deps.deployment, context.spaceId)
            ? [{ providerKey: deps.deployment.key }]
            : []),
        ],
        spaceId: context.spaceId,
        userId: context.userId,
      },
    });
    if (!owned) return { error: "Unknown cloud agent." };
    agent = owned;
    if (name === "cloud_agent_reply") {
      if (agent.providerKey.startsWith(USER_CLOUD_AGENT_KEY_PREFIX)) {
        // A follow-up stays with the bot whose identity the worker will reauthorize.
        if (
          agent.botId !== context.botId ||
          !(await deps.userCloudAgents?.forKey(agent.providerKey, {
            spaceId: context.spaceId,
            userId: context.userId,
            botIds: [context.botId],
          }))
        )
          return { error: "Unknown cloud agent." };
      }
      // A blocked agent is still running; answering its question is the way forward.
      const blocked = openQuestion(agent) !== undefined;
      if (
        (agent.status === "running" && !blocked) ||
        agent.followup ||
        agent.cancelRequested ||
        !agent.remoteId
      ) {
        return { error: "Wait for the current cloud agent operation to finish." };
      }
      const { id: _id, ...prompt } = cloudAgentReplySchema.parse(args);
      // A goal continuation's follow-up is dropped if the owner stops the goal before it is sent.
      const followup = run.clientNonce?.startsWith(SCOPED_GOAL_NONCE)
        ? { ...prompt, goalRunId: run.id }
        : prompt;
      const updated = await queueCloudAgentFollowup(deps.prisma, agent, followup, blocked);
      if (!updated.count) return { error: "Cloud agent changed; check its status and try again." };
    } else if (name === "cloud_agent_cancel") {
      await deps.prisma.cloudAgent.update({
        where: { id: agent.id },
        data: { cancelRequested: true, version: { increment: 1 }, nextPollAt: new Date() },
      });
    }
    agent = await deps.prisma.cloudAgent.findUniqueOrThrow({ where: { id: agent.id } });
  }
  if (agent.nextPollAt) await enqueueCloudAgent(deps, agent.id);
  return { ...cloudAgentStatusResult(agent), ...(clampNote ? { note: clampNote } : {}) };
}

/**
 * Queues a message for the agent's next poll to send. A follow-up restarts finished work, so it
 * takes a slot like a launch; an answer to an open question keeps its own. The caller enqueues
 * the poll when `count` is 1.
 */
export async function queueCloudAgentFollowup(
  prisma: PrismaClient,
  agent: CloudAgent,
  followup: Prisma.InputJsonValue,
  answer = false,
) {
  return prisma.$transaction((tx) =>
    queueCloudAgentFollowupInTransaction(tx, agent, followup, answer),
  );
}

/** The same, inside a transaction that records something else with it. */
export async function queueCloudAgentFollowupInTransaction(
  tx: Prisma.TransactionClient,
  agent: CloudAgent,
  followup: Prisma.InputJsonValue,
  answer = false,
) {
  await lockBotSlots(tx, agent.botId);
  const queued =
    !answer &&
    (await activeCloudAgentCount(tx, agent.providerKey, agent.botId)) >= CLOUD_AGENT_ACTIVE_LIMIT;
  return tx.cloudAgent.updateMany({
    where: { id: agent.id, version: agent.version },
    data: {
      followup,
      followupDispatchedAt: null,
      status: "running",
      // An answer continues the same piece of work; a follow-up starts the next one.
      ...(answer ? {} : { generation: { increment: 1 }, wakeAttempts: 0, verdict: null }),
      version: { increment: 1 },
      ...(queued ? { queuedAt: new Date(), nextPollAt: null } : { nextPollAt: new Date() }),
      errorCount: 0,
    },
  });
}

/**
 * Tracks remote work the bot started or messaged with the provider's own tools, so its result
 * wakes the bot as a launch's does. Work the row already follows is left as it is; finished work
 * the bot messaged again starts its next piece, and work whose card is gone or in another chat
 * moves to this chat with a new card, since a row without one is cancelled.
 */
export async function trackDirectCloudAgent(
  deps: CloudAgentDeps,
  context: AdapterContext & { botId: string },
  run: { id: string; threadId: string },
  direct: { remoteId: string; title: string },
) {
  const connection = deps.cloudAgent;
  if (!connection || !cloudAgentsEnabled(connection, context.spaceId)) return;
  const where = {
    providerKey: connection.key,
    spaceId: context.spaceId,
    userId: context.userId,
    botId: context.botId,
    remoteId: direct.remoteId,
  };
  const result = await deps.prisma.$transaction(async (tx): Promise<PostedCard> => {
    // Serialize with clearThread and other calls from this chat before reading or writing.
    await tx.thread.update({
      where: { id: run.threadId, spaceId: context.spaceId },
      data: { nextMessageSeq: { increment: 0 } },
    });
    // Same-thread calls from the bot's other chats meet here, so the second finds the first.
    await lockBotSlots(tx, context.botId);
    // A replayed call finds the row it made the first time.
    const replayed = await tx.cloudAgent.findUnique({
      where: { operationKey: context.operationId },
    });
    if (replayed) return { agent: replayed };
    // The poller fences on version and may commit between this read and the write, so a lost
    // fence reads the row again rather than leaving the work untracked.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await tx.cloudAgent.findFirst({ where });
      if (!existing) {
        const created = await tx.cloudAgent.create({
          data: {
            ...where,
            operationKey: context.operationId,
            threadId: run.threadId,
            title: direct.title.slice(0, 80),
            launchRequest: {},
            launchDispatched: true,
          },
        });
        return postCloudAgentCard(tx, deps, context, run, created);
      }
      const card = existing.messageId
        ? await tx.message.findFirst({
            where: { id: existing.messageId, threadId: existing.threadId },
            select: { threadId: true },
          })
        : null;
      const running = existing.status === "running";
      if (running && card) {
        // Running work keeps waking the chat that already follows it. The version still moves,
        // so a poll that read the thread before this message cannot commit it as finished.
        const fenced = await tx.cloudAgent.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { version: { increment: 1 }, nextPollAt: new Date() },
        });
        if (!fenced.count) continue;
        return { agent: await tx.cloudAgent.findUniqueOrThrow({ where: { id: existing.id } }) };
      }
      const moved = card?.threadId !== run.threadId;
      const updated = await tx.cloudAgent.updateMany({
        where: { id: existing.id, version: existing.version },
        data: {
          ...(running ? {} : { generation: { increment: 1 }, wakeAttempts: 0, verdict: null }),
          status: "running",
          threadId: run.threadId,
          ...(moved ? { messageId: null } : {}),
          cancelRequested: false,
          version: { increment: 1 },
          nextPollAt: new Date(),
          errorCount: 0,
        },
      });
      if (!updated.count) continue;
      const revived = await tx.cloudAgent.findUniqueOrThrow({ where: { id: existing.id } });
      return moved ? postCloudAgentCard(tx, deps, context, run, revived) : { agent: revived };
    }
    throw new Error("Cloud agent kept changing while it was being tracked.");
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  if (result.seq !== undefined)
    await deps.events
      .notify(run.threadId, result.seq, result.firstResponseRunId)
      .catch(() => undefined);
  await enqueueCloudAgent(deps, result.agent.id);
}

interface PostedCard {
  agent: CloudAgent;
  seq?: number;
  firstResponseRunId?: string;
}

/** The agent's card in the chat; a row without one reads as a cleared chat and is cancelled. */
async function postCloudAgentCard(
  tx: Tx,
  deps: CloudAgentDeps,
  context: AdapterContext & { botId: string },
  run: { id: string; threadId: string },
  created: CloudAgent,
): Promise<PostedCard> {
  const blocks = [cloudAgentBlock(created)];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: run.threadId,
    botId: context.botId,
    runId: run.id,
    role: "bot",
    blocks,
    lease: runLeaseFor(deps, run.id),
  });
  const saved = await tx.cloudAgent.update({
    where: { id: created.id },
    data: { messageId: message.id },
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: context.spaceId,
    threadId: run.threadId,
    botId: context.botId,
    runId: run.id,
    lease: runLeaseFor(deps, run.id),
    type: "thread.message.created",
    payload: { messageId: message.id, role: "bot", blocks },
  });
  return {
    agent: saved,
    seq: event.seq,
    firstResponseRunId: event.firstResponse ? run.id : undefined,
  };
}

export function cloudAgentStatusResult(agent: CloudAgent) {
  const { kind: _kind, agentId, ...snapshot } = cloudAgentBlock(agent);
  return {
    id: agentId,
    ...snapshot,
    ...(agent.attention ? { attention: agent.attention } : {}),
    ...(agent.historyGapAt ? { historyGap: true } : {}),
    ...(agent.failureReason ? { failureReason: agent.failureReason } : {}),
    // What the agent last said, as outside text to judge, not to obey.
    ...(agent.resultText ? { untrustedResult: agent.resultText } : {}),
    ...(agent.launchNote ? { note: agent.launchNote } : {}),
    ...(agent.verdict ? { verdict: agent.verdict } : {}),
    ...(agent.agreement ? { agreement: agent.agreement } : {}),
    ...(agent.acceptance ? { acceptance: agent.acceptance } : {}),
    ...(agent.originBotId ? { originBotId: agent.originBotId } : {}),
    // The provider's own id, for reading its questions and result with that provider's tools.
    ...(agent.remoteId ? { remoteId: agent.remoteId } : {}),
    ...(agent.cancelRequested ? { cancellationPending: true } : {}),
    ...(agent.followupDispatchedAt ? { followupPending: true } : {}),
  };
}

/** The row is the outbox; queue failure leaves recoverable intent for the reconciler. */
export async function enqueueCloudAgent(
  deps: Pick<CloudAgentDeps, "jobs">,
  agentId: string,
  availableAt?: Date,
) {
  await deps.jobs.enqueue(cloudAgentPollJob({ agentId }, availableAt)).catch(() => {
    getLogger().warn("cloud agent scheduling deferred to reconciliation");
  });
}

type Reconciled = Pick<CloudAgentDeps, "prisma" | "jobs" | "cloudAgent" | "userCloudAgents"> &
  Partial<Pick<CloudAgentDeps, "events">>;

/** The agents this deployment polls: its own connection's, and every user-connected environment's. */
function reconciledKeys(deps: Pick<CloudAgentDeps, "cloudAgent" | "userCloudAgents">) {
  return [
    ...(deps.cloudAgent
      ? [
          {
            providerKey: deps.cloudAgent.key,
            ...(deps.cloudAgent.spaceId ? { spaceId: deps.cloudAgent.spaceId } : {}),
          },
        ]
      : []),
    ...(deps.userCloudAgents ? [{ providerKey: { startsWith: USER_CLOUD_AGENT_KEY_PREFIX } }] : []),
  ];
}

export async function reconcileCloudAgents(deps: Reconciled) {
  const keys = reconciledKeys(deps);
  if (!keys.length) return;
  const due = await deps.prisma.cloudAgent.findMany({
    where: { OR: keys, nextPollAt: { lte: new Date() } },
    orderBy: [{ nextPollAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true },
  });
  for (const agent of due) await enqueueCloudAgent(deps, agent.id);
  // A crash between a request finishing and the next one starting leaves a free slot unused.
  const queued = await deps.prisma.cloudAgent.groupBy({
    by: ["providerKey", "botId"],
    where: { OR: keys, status: "running", queuedAt: { not: null } },
  });
  // Bots whose slots are all busy are skipped before the batch limit, so they never hide one
  // with a free slot.
  const full = await deps.prisma.cloudAgent.groupBy({
    by: ["providerKey", "botId"],
    where: {
      OR: keys,
      status: "running",
      queuedAt: null,
      botId: { in: queued.map((row) => row.botId) },
    },
    _count: { _all: true },
    having: { botId: { _count: { gte: CLOUD_AGENT_ACTIVE_LIMIT } } },
  });
  const busy = new Set(full.map((row) => `${row.providerKey}\n${row.botId}`));
  const waiting = queued
    .filter((row) => !busy.has(`${row.providerKey}\n${row.botId}`))
    .slice(0, 100);
  for (const { providerKey, botId } of waiting) {
    const promoted = await deps.prisma.$transaction((tx) =>
      promoteQueuedCloudAgent(tx, providerKey, botId),
    );
    if (promoted) await enqueueCloudAgent(deps, promoted);
  }
  await retryFailedCloudAgentWakes(deps);
}

const CLOUD_AGENT_WAKE_ATTEMPTS = 3;
// Retries happen within a few reconciler passes; an older failure has already told the owner.
const WAKE_RETRY_WINDOW_MS = 24 * 60 * 60_000;

/**
 * A finished request's wake run can fail (a model outage) before the bot ever reads the result.
 * Queue another, up to three in all; the failure notice of the last one tells the owner.
 */
async function retryFailedCloudAgentWakes(deps: Reconciled) {
  // Start from failed wake runs, so finished requests still awaiting a verdict never crowd them out.
  const failed = await recentFailedWakes(deps, "cloud-agent-wake-run:");
  const ids = [...new Set(failed.map((run) => run.clientNonce!.split(":")[1]!))];
  const candidates = await deps.prisma.cloudAgent.findMany({
    where: {
      id: { in: ids },
      OR: reconciledKeys(deps),
      status: { not: "running" },
      wakeAttempts: { gte: 1, lt: CLOUD_AGENT_WAKE_ATTEMPTS },
      verdict: null,
    },
  });
  for (const agent of candidates) {
    if (goalDrivesAgent(await deps.prisma.scopedGoal.findUnique({ where: { agentId: agent.id } })))
      continue;
    if (agent.wakeGeneration !== agent.generation) continue;
    const base = `cloud-agent-wake-run:${agent.id}:${agent.generation}`;
    const nonce = agent.wakeAttempts === 1 ? base : `${base}:r${agent.wakeAttempts - 1}`;
    const last = await deps.prisma.run.findFirst({
      where: { spaceId: agent.spaceId, ...cloudAgentWakeNonceWhere(nonce) },
      select: { status: true },
    });
    if (last?.status !== "failed" || !(await canWake(deps, agent))) continue;
    const seqs: number[] = [];
    const runId = await deps.prisma.$transaction(async (tx) => {
      await lockCloudAgentWakeThread(tx, agent);
      const claimed = await tx.cloudAgent.updateMany({
        // The same finished piece: a continuation since then has its own wake and attempts.
        where: {
          id: agent.id,
          wakeAttempts: agent.wakeAttempts,
          generation: agent.generation,
          wakeGeneration: agent.generation,
          status: agent.status,
          verdict: null,
        },
        data: { wakeAttempts: { increment: 1 } },
      });
      if (!claimed.count) return undefined;
      const [created] = await createCloudAgentWake(
        tx,
        agent,
        terminalWakePrompt(agent),
        `${base}:r${agent.wakeAttempts}`,
        { jobThread: true, seqs },
      );
      return created;
    });
    if (seqs.length) await notifyJobCards(deps, agent, seqs);
    if (runId) await deps.jobs.enqueue(runContinueJob(runId)).catch(() => undefined);
  }
  await retryFailedAttentionWakes(deps);
}

/**
 * A question or approval's wake can fail the same way. Retry while it is still open, up to three
 * wakes in all; each retry's key is the last one's plus a count, so a retry is made only once.
 */
async function retryFailedAttentionWakes(deps: Reconciled) {
  const retries = (await recentFailedWakes(deps, "cloud-agent-attention:")).flatMap((run) => {
    const [, agentId, ...rest] = run.clientNonce!.split(":");
    const retry = /:r(\d+)$/.exec(run.clientNonce!);
    const attempt = retry ? Number(retry[1]) + 1 : 1;
    if (attempt >= CLOUD_AGENT_WAKE_ATTEMPTS) return [];
    const requestId = rest.join(":").replace(/:r\d+$/, "");
    const nonce = `cloud-agent-attention:${agentId}:${requestId}:r${attempt}`;
    return [{ agentId: agentId!, requestId, nonce }];
  });
  if (!retries.length) return;
  // Retries already made and blockers no longer open are dropped here, before any per-wake work.
  const [made, agents] = await Promise.all([
    deps.prisma.run.findMany({
      where: {
        OR: [
          { clientNonce: { in: retries.map((retry) => retry.nonce) } },
          { cloudAgentWakeNonces: { hasSome: retries.map((retry) => retry.nonce) } },
        ],
      },
      select: { clientNonce: true, cloudAgentWakeNonces: true },
    }),
    deps.prisma.cloudAgent.findMany({
      where: {
        id: { in: retries.map((retry) => retry.agentId) },
        OR: reconciledKeys(deps),
        status: "running",
      },
    }),
  ]);
  const madeNonces = new Set(made.flatMap(cloudAgentWakeNonces));
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  for (const { agentId, requestId, nonce } of retries) {
    const agent = byId.get(agentId);
    if (madeNonces.has(nonce) || !agent || !attentionIds(agent.attention).includes(requestId))
      continue;
    if (!(await canWake(deps, agent))) continue;
    const seqs: number[] = [];
    const runId = await deps.prisma
      .$transaction((tx) =>
        createCloudAgentWake(tx, agent, attentionWakePrompt(agent.id, requestId), nonce, {
          jobThread: true,
          seqs,
        }),
      )
      // A concurrent reconciler made the same retry; the nonce is unique per space.
      .catch(() => []);
    if (seqs.length && runId.length) await notifyJobCards(deps, agent, seqs);
    for (const id of runId) await deps.jobs.enqueue(runContinueJob(id)).catch(() => undefined);
  }
}

/**
 * Every wake run that failed within the retry window. Read in full, not a recent batch, since
 * failures already retried or past their last attempt would otherwise fill the batch each pass.
 */
async function recentFailedWakes(deps: Pick<CloudAgentDeps, "prisma">, prefix: string) {
  const runs = await deps.prisma.run.findMany({
    where: {
      // A job helper's wake is a helper run; only wakes carry nonces.
      trigger: { in: ["cloud_agent", BACKGROUND_HELPER_TRIGGER] },
      status: "failed",
      updatedAt: { gte: new Date(Date.now() - WAKE_RETRY_WINDOW_MS) },
    },
    select: { clientNonce: true, cloudAgentWakeNonces: true },
  });
  return runs.flatMap((run) =>
    cloudAgentWakeNonces(run).flatMap((clientNonce) =>
      clientNonce?.startsWith(prefix) ? [{ clientNonce }] : [],
    ),
  );
}

/** Announce the cards a retried job wake posted to the chat. */
async function notifyJobCards(
  deps: Partial<Pick<CloudAgentDeps, "events">>,
  agent: CloudAgent,
  seqs: number[],
) {
  await deps.events?.notify(agent.threadId, Math.max(...seqs)).catch(() => undefined);
}

/** A cleared chat, archived bot or departed owner gets no wake, as a first wake would not. */
async function canWake(deps: Pick<CloudAgentDeps, "prisma">, agent: CloudAgent) {
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
      select: { id: true },
    }),
  ]);
  return Boolean(card && member && bot);
}

/** The first open question, which a reply answers. Approvals stay with the owner on the provider. */
export function openQuestion(
  agent: Pick<CloudAgent, "attention">,
): { requestId: string; threadId?: string } | undefined {
  const attention = Array.isArray(agent.attention)
    ? (agent.attention as Array<{ requestId?: unknown; kind?: unknown; threadId?: unknown }>)
    : [];
  const question = attention.find((item) => item.kind === "question");
  if (typeof question?.requestId !== "string") return undefined;
  return {
    requestId: question.requestId,
    ...(typeof question.threadId === "string" ? { threadId: question.threadId } : {}),
  };
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function lockBotSlots(tx: Tx, botId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cloud-agent-slots:${botId}`}))`;
}

/** Rows holding a slot: running and launched or launching, including blocked ones. */
export async function activeCloudAgentCount(
  tx: Tx,
  providerKey: string,
  botId: string,
): Promise<number> {
  return tx.cloudAgent.count({
    where: { providerKey, botId, status: "running", queuedAt: null },
  });
}

/** Start the oldest queued request of a bot with a free slot. Caller enqueues the returned id. */
export async function promoteQueuedCloudAgent(tx: Tx, providerKey: string, botId: string) {
  await lockBotSlots(tx, botId);
  if ((await activeCloudAgentCount(tx, providerKey, botId)) >= CLOUD_AGENT_ACTIVE_LIMIT) return;
  const next = await tx.cloudAgent.findFirst({
    where: { providerKey, botId, status: "running", queuedAt: { not: null } },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
  if (!next) return;
  await tx.cloudAgent.update({
    where: { id: next.id },
    data: { queuedAt: null, nextPollAt: new Date(), version: { increment: 1 } },
  });
  return next.id;
}

/**
 * The bot's verdict on a finished request. Finishing is not acceptance: only this records it,
 * and a request another bot asked for sends that bot the verdict once per piece of work.
 */
export async function reportCloudAgent(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs" | "runLease"> &
    Pick<CloudAgentDeps, "cloudAgent"> & { deployment?: CloudAgentConnection | null },
  context: AdapterContext & { botId: string; botName?: string },
  run: { id: string; threadId: string },
  args: Record<string, unknown>,
) {
  const connection = cloudAgentsEnabled(deps.cloudAgent, context.spaceId) ? deps.cloudAgent : null;
  if (!connection) return { error: "Cloud agents are not configured for this space." };
  const report = cloudAgentReportSchema.parse(args);
  const agent = await deps.prisma.cloudAgent.findFirst({
    where: {
      id: report.id,
      // Agents launched on any environment the actor connected report like the current one's.
      OR: [
        { providerKey: connection.key },
        { providerKey: { startsWith: USER_CLOUD_AGENT_KEY_PREFIX } },
        ...(deps.deployment && cloudAgentsEnabled(deps.deployment, context.spaceId)
          ? [{ providerKey: deps.deployment.key }]
          : []),
      ],
      spaceId: context.spaceId,
      userId: context.userId,
      botId: context.botId,
    },
  });
  if (!agent) return { error: "Unknown cloud agent, or another bot launched it." };
  if (agent.status === "running") return { error: "Report once the cloud agent has finished." };
  // Done means the evidence says so, not the agent's or the bot's word.
  const missing =
    report.verdict === "accepted" && (await missingGoalEvidence(deps.prisma, agent.id));
  if (missing)
    return {
      error: `This agent's release goal is not complete. Missing evidence: ${missing.join(", ")}.`,
    };
  // One verdict per piece of work, so the asking bot never holds a different one than the record.
  // A follow-up accepted meanwhile starts new work, which this verdict is not about.
  const recorded = await deps.prisma.cloudAgent.updateMany({
    where: {
      id: agent.id,
      generation: agent.generation,
      status: { not: "running" },
      verdict: null,
    },
    data: { verdict: report.verdict, verdictSummary: report.summary },
  });
  if (!recorded.count) {
    const current = await deps.prisma.cloudAgent.findUniqueOrThrow({ where: { id: agent.id } });
    if (current.generation !== agent.generation || current.status === "running")
      return { error: "The cloud agent changed; check its status and report again." };
    if (current.verdict !== report.verdict || current.verdictSummary !== report.summary)
      return { error: `Already reported ${current.verdict} for this work.` };
  }
  let delivered: boolean | undefined;
  if (agent.originBotId && agent.originBotId !== agent.botId) {
    const sent = await messageBot(
      deps,
      {
        id: run.id,
        spaceId: agent.spaceId,
        threadId: run.threadId,
        botId: agent.botId,
        userId: agent.userId,
        // The asking bot's message, so the verdict reads as the reply to its request.
        sourceMessageId: agent.originMessageId,
      },
      { id: agent.botId, name: context.botName ?? "" },
      {
        bot_id: agent.originBotId,
        message: `Request "${agent.title}" (${agent.id}) ${report.verdict.replace("_", " ")}: ${report.summary}`,
        intent: "result",
        deliveryKey: `cloud-agent-report:${agent.id}:${agent.generation}`,
      },
    );
    delivered = sent.ok;
    if (!sent.ok) return { error: `Recorded, but not delivered: ${sent.error}` };
  }
  return { id: agent.id, verdict: report.verdict, ...(delivered ? { delivered } : {}) };
}
