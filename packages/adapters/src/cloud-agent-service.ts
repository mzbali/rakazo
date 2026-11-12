import type { AdapterContext, JobPublisher } from "@rakazo/adapter-kit";
import { cloudAgentPollJob, runContinueJob } from "@rakazo/adapter-kit";
import { cloudAgentBlockFromPayload } from "@rakazo/core";
import type { CloudAgent, PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  THREAD_LOCK_TRANSACTION_OPTIONS,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { messageBot } from "./bot-messages.js";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { cloudAgentsEnabled } from "./cloud-agent-factory.js";
import { createCloudAgentWake } from "./cloud-agent-poll.js";
import {
  cloudAgentLaunchSchema,
  cloudAgentReplySchema,
  cloudAgentReportSchema,
} from "./cloud-agent-tools.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { runLeaseFor } from "./run-messages.js";

export interface CloudAgentDeps {
  prisma: PrismaClient;
  jobs: JobPublisher;
  events: Pick<ThreadEvents, "notify">;
  cloudAgent: CloudAgentConnection | null | undefined;
  runLease?: ExecutorDeps["runLease"];
}

/** A bot runs at most this many requests at once; later ones wait their turn in order. */
export const CLOUD_AGENT_ACTIVE_LIMIT = 2;

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
  deps: CloudAgentDeps,
  context: AdapterContext & { botId: string; botName?: string },
  run: { id: string; threadId: string; spaceId?: string; userId?: string },
  name: string,
  args: Record<string, unknown>,
  origin?: CloudAgentOrigin,
) {
  const connection = deps.cloudAgent;
  if (!connection || !cloudAgentsEnabled(connection, context.spaceId)) {
    return { error: "Cloud agents are not configured for this space." };
  }
  let agent: CloudAgent;
  if (name === "cloud_agent_launch") {
    const request = cloudAgentLaunchSchema.parse(args);
    const result = await deps.prisma.$transaction(async (tx) => {
      // Serialize with clearThread before creating either the intent or its card.
      await tx.thread.update({
        where: { id: run.threadId, spaceId: context.spaceId },
        data: { nextMessageSeq: { increment: 0 } },
      });
      // Same-key launches from two chats meet here, so the second finds the first.
      await lockBotSlots(tx, context.botId);
      const existing =
        (await tx.cloudAgent.findUnique({ where: { operationKey: context.operationId } })) ??
        (request.requestKey
          ? await tx.cloudAgent.findUnique({
              where: {
                spaceId_botId_requestKey: {
                  spaceId: context.spaceId,
                  botId: context.botId,
                  requestKey: request.requestKey,
                },
              },
            })
          : null);
      if (existing) {
        if (
          existing.spaceId !== context.spaceId ||
          existing.userId !== context.userId ||
          existing.providerKey !== connection.key
        ) {
          throw new Error("Cloud agent operation scope changed");
        }
        return { agent: existing };
      }
      const { requestKey, agreement, acceptance, ...launchRequest } = request;
      const queued =
        (await activeCloudAgentCount(tx, connection.key, context.botId)) >=
        CLOUD_AGENT_ACTIVE_LIMIT;
      const created = await tx.cloudAgent.create({
        data: {
          operationKey: context.operationId,
          providerKey: connection.key,
          spaceId: context.spaceId,
          userId: context.userId,
          botId: context.botId,
          threadId: run.threadId,
          title: request.prompt.split(/\r?\n/, 1)[0]!.slice(0, 80),
          launchRequest,
          requestKey,
          agreement,
          acceptance,
          originBotId: origin?.botId,
          originMessageId: origin?.messageId,
          ...(queued ? { queuedAt: new Date(), nextPollAt: null } : {}),
        },
      });
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
        providerKey: connection.key,
        spaceId: context.spaceId,
        userId: context.userId,
      },
    });
    if (!owned) return { error: "Unknown cloud agent." };
    agent = owned;
    if (name === "cloud_agent_reply") {
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
      const { id: _id, ...followup } = cloudAgentReplySchema.parse(args);
      const current = agent;
      const updated = await deps.prisma.$transaction(async (tx) => {
        // A follow-up restarts finished work, so it takes a slot like a launch; an answer keeps its own.
        await lockBotSlots(tx, current.botId);
        const queued =
          !blocked &&
          (await activeCloudAgentCount(tx, current.providerKey, current.botId)) >=
            CLOUD_AGENT_ACTIVE_LIMIT;
        return tx.cloudAgent.updateMany({
          where: { id: current.id, version: current.version },
          data: {
            followup,
            followupDispatchedAt: null,
            status: "running",
            // An answer continues the same piece of work; a follow-up starts the next one.
            ...(blocked ? {} : { generation: { increment: 1 }, wakeAttempts: 0, verdict: null }),
            version: { increment: 1 },
            ...(queued ? { queuedAt: new Date(), nextPollAt: null } : { nextPollAt: new Date() }),
            errorCount: 0,
          },
        });
      });
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
  return cloudAgentStatusResult(agent);
}

export function cloudAgentStatusResult(agent: CloudAgent) {
  const { kind: _kind, agentId, ...snapshot } = cloudAgentBlock(agent);
  return {
    id: agentId,
    ...snapshot,
    ...(agent.attention ? { attention: agent.attention } : {}),
    ...(agent.historyGapAt ? { historyGap: true } : {}),
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

export async function reconcileCloudAgents(
  deps: Pick<CloudAgentDeps, "prisma" | "jobs" | "cloudAgent">,
) {
  if (!deps.cloudAgent) return;
  const due = await deps.prisma.cloudAgent.findMany({
    where: {
      providerKey: deps.cloudAgent.key,
      nextPollAt: { lte: new Date() },
      ...(deps.cloudAgent.spaceId ? { spaceId: deps.cloudAgent.spaceId } : {}),
    },
    orderBy: [{ nextPollAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true },
  });
  for (const agent of due) await enqueueCloudAgent(deps, agent.id);
  // A crash between a request finishing and the next one starting leaves a free slot unused.
  const waiting = await deps.prisma.cloudAgent.findMany({
    where: {
      providerKey: deps.cloudAgent.key,
      status: "running",
      queuedAt: { not: null },
    },
    distinct: ["botId"],
    select: { botId: true },
    take: 100,
  });
  for (const { botId } of waiting) {
    const promoted = await deps.prisma.$transaction((tx) =>
      promoteQueuedCloudAgent(tx, deps.cloudAgent!.key, botId),
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
async function retryFailedCloudAgentWakes(
  deps: Pick<CloudAgentDeps, "prisma" | "jobs" | "cloudAgent">,
) {
  // Start from failed wake runs, so finished requests still awaiting a verdict never crowd them out.
  const failed = await deps.prisma.run.findMany({
    where: {
      trigger: "cloud_agent",
      status: "failed",
      clientNonce: { startsWith: "cloud-agent-wake-run:" },
      updatedAt: { gte: new Date(Date.now() - WAKE_RETRY_WINDOW_MS) },
    },
    select: { clientNonce: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const ids = [...new Set(failed.map((run) => run.clientNonce!.split(":")[1]!))];
  const candidates = await deps.prisma.cloudAgent.findMany({
    where: {
      id: { in: ids },
      providerKey: deps.cloudAgent!.key,
      status: { not: "running" },
      wakeAttempts: { gte: 1, lt: CLOUD_AGENT_WAKE_ATTEMPTS },
      verdict: null,
    },
  });
  for (const agent of candidates) {
    if (agent.wakeGeneration !== agent.generation) continue;
    const base = `cloud-agent-wake-run:${agent.id}:${agent.generation}`;
    const nonce = agent.wakeAttempts === 1 ? base : `${base}:r${agent.wakeAttempts - 1}`;
    const last = await deps.prisma.run.findFirst({
      where: { spaceId: agent.spaceId, clientNonce: nonce },
      select: { status: true },
    });
    if (last?.status !== "failed") continue;
    // A cleared chat, archived bot or departed owner gets no wake, as a first wake would not.
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
    if (!card || !member || !bot) continue;
    const runId = await deps.prisma.$transaction(async (tx) => {
      const claimed = await tx.cloudAgent.updateMany({
        where: { id: agent.id, wakeAttempts: agent.wakeAttempts },
        data: { wakeAttempts: { increment: 1 } },
      });
      if (!claimed.count) return undefined;
      const [created] = await createCloudAgentWake(
        tx,
        agent,
        `Cloud agent ${agent.id} is ${agent.status}. Use cloud_agent_status to inspect its result, then cloud_agent_report your verdict.`,
        `${base}:r${agent.wakeAttempts}`,
      );
      return created;
    });
    if (runId) await deps.jobs.enqueue(runContinueJob(runId)).catch(() => undefined);
  }
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
    Pick<CloudAgentDeps, "cloudAgent">,
  context: AdapterContext & { botId: string; botName?: string },
  run: { id: string; threadId: string },
  args: Record<string, unknown>,
) {
  const connection = deps.cloudAgent;
  if (!connection || !cloudAgentsEnabled(connection, context.spaceId)) {
    return { error: "Cloud agents are not configured for this space." };
  }
  const report = cloudAgentReportSchema.parse(args);
  const agent = await deps.prisma.cloudAgent.findFirst({
    where: {
      id: report.id,
      providerKey: connection.key,
      spaceId: context.spaceId,
      botId: context.botId,
    },
  });
  if (!agent) return { error: "Unknown cloud agent, or another bot launched it." };
  if (agent.status === "running") return { error: "Report once the cloud agent has finished." };
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
