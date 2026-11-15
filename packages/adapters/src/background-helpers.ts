import { runContinueJob } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import {
  ACTIVE_RUN_STATUSES,
  BACKGROUND_HELPER_TRIGGER,
  HELPER_RESULT_TRIGGER,
  isConversationalRun,
  STOPPED_HELPER_RESULT,
} from "@rakazo/core";
import type { Prisma } from "@rakazo/db";
import {
  appendEventInTransaction,
  assertRunCanWriteHistory,
  createThreadMessageInTransaction,
  markThreadUnreadForMembers,
  THREAD_LOCK_TRANSACTION_OPTIONS,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import {
  BACKGROUND_HELPER_CHAT_REQUIRED,
  backgroundHelperLimitNote,
  helperPrompt,
  resultPrompt,
  startedNote,
} from "./background-helpers.prompt.js";
import { paintCloudAgentCard } from "./cloud-agent-card.js";
import { failedStartRecoveryPrompt } from "./cloud-agent-recovery.prompt.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { helperResultText, MAX_PARALLEL_SUBAGENTS } from "./pi-runtime-subagent.js";
import type { RunContext } from "./run-context.js";
import { runLeaseFor } from "./run-messages.js";

const RESULT_LIMIT = 12_000;

// Stop only settles a card, so it brings no job queue.
type HelperDeps = Pick<ExecutorDeps, "prisma"> & {
  events: Pick<ExecutorDeps["events"], "notify">;
  jobs?: ExecutorDeps["jobs"];
};
type HelperBlock = Extract<MessageBlock, { kind: "subagent" }>;

/**
 * Start run_subagent with background true: a helper run in a thread of its own, so this chat
 * stays free, and a running card here that its result settles later.
 */
/**
 * A helper reads the bot's memory and its result comes back only to the app chat, so only a turn
 * in the bot's own app chat may start one, by whichever space member sent it; a result coming
 * back never starts the next.
 */
export function backgroundHelpersAllowed(turn: {
  threadBotId: string | null;
  botId: string;
  trigger: string;
}): boolean {
  return (
    turn.threadBotId === turn.botId &&
    turn.trigger !== "messaging" &&
    turn.trigger !== HELPER_RESULT_TRIGGER &&
    isConversationalRun(turn.trigger)
  );
}

export async function startBackgroundHelper(
  ctx: RunContext,
  input: {
    name: string;
    task: string;
    instructions: string;
    modelProvider: string;
    modelId: string;
    executionId: string;
    effectKey: string;
  },
) {
  const { deps, run, runId, bot, thread } = ctx;
  if (
    !backgroundHelpersAllowed({ threadBotId: thread.botId, botId: bot.id, trigger: run.trigger })
  ) {
    return {
      error: BACKGROUND_HELPER_CHAT_REQUIRED,
    };
  }
  if (Boolean(input.modelProvider) !== Boolean(input.modelId)) {
    return { error: "model_provider and model_id must both be set" };
  }
  const clientNonce = `background-helper:${input.effectKey}`;
  const started = { ok: true as const, name: input.name, note: startedNote(input.name) };
  const card: HelperBlock = {
    kind: "subagent",
    agentId: input.executionId,
    name: input.name,
    task: input.task,
    status: "running",
  };
  const committed = await deps.prisma.$transaction(async (tx) => {
    // Every start goes through this chat, so its lock makes the replay check and the cap exact
    // even when one turn starts several helpers at once.
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${thread.id} FOR UPDATE`;
    if (
      await tx.run.findFirst({ where: { spaceId: run.spaceId, clientNonce }, select: { id: true } })
    )
      return null;
    const running = await tx.run.count({
      where: {
        botId: bot.id,
        trigger: BACKGROUND_HELPER_TRIGGER,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
    });
    if (running >= MAX_PARALLEL_SUBAGENTS) return "full" as const;
    // Only this turn's live worker may start one, but the card is not part of the turn: a turn
    // ending settles its own helper cards as stopped, while this helper keeps working.
    await assertRunCanWriteHistory(tx, runId, { lease: runLeaseFor(deps, runId) });
    const message = await createThreadMessageInTransaction(tx, {
      threadId: thread.id,
      role: "bot",
      blocks: [card],
      botId: bot.id,
      markUnread: false,
    });
    const event = await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: thread.id,
      botId: bot.id,
      type: "thread.message.created",
      payload: { messageId: message.id, role: "bot", blocks: [card] },
    });
    // The helper's own thread: no chat list shows it, nothing sent to the bot waits behind the
    // helper, and it goes when the bot is deleted.
    const helperThread = await tx.thread.create({
      data: { spaceId: run.spaceId, userId: run.userId, helperBotId: bot.id },
      select: { id: true },
    });
    const task = await tx.task.create({
      data: {
        spaceId: run.spaceId,
        botId: bot.id,
        threadId: helperThread.id,
        userId: run.userId,
        prompt: helperPrompt(input),
        status: "queued",
      },
    });
    const helperRun = await tx.run.create({
      data: {
        spaceId: run.spaceId,
        botId: bot.id,
        threadId: helperThread.id,
        taskId: task.id,
        userId: run.userId,
        status: "queued",
        trigger: BACKGROUND_HELPER_TRIGGER,
        sourceMessageId: message.id,
        clientNonce,
        ...(input.modelProvider
          ? { modelProvider: input.modelProvider, modelId: input.modelId, modelPinned: true }
          : {}),
      },
      select: { id: true },
    });
    return { eventSeq: event.seq, helperRunId: helperRun.id };
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  if (committed === "full") {
    return {
      error: backgroundHelperLimitNote(MAX_PARALLEL_SUBAGENTS),
    };
  }
  if (!committed) return started;
  await deps.events.notify(thread.id, committed.eventSeq).catch((error) => {
    getLogger().error("background helper card notification", error);
  });
  await deps.jobs.enqueue(runContinueJob(committed.helperRunId)).catch((error) => {
    // The queued run is durable; the job reconciler repairs a missed wake.
    getLogger().error("background helper enqueue", error);
  });
  return started;
}

/**
 * Settle a finished helper's card and bring its result back to the chat that started it as a
 * new turn. Each helper returns once; a helper the user stopped only settles its card.
 */
export async function returnHelperOutcome(
  deps: HelperDeps,
  run: {
    id: string;
    spaceId: string;
    botId: string;
    userId: string;
    sourceMessageId?: string | null;
  },
  outcome: { status: "completed" | "failed" | "stopped"; text: string },
) {
  // The card's chat, read first so the lock below can come before any other row.
  const source = run.sourceMessageId
    ? await deps.prisma.message.findUnique({
        where: { id: run.sourceMessageId },
        select: { threadId: true },
      })
    : null;
  const jobAgentId = jobAgentIdOf(
    await deps.prisma.run.findUnique({
      where: { id: run.id },
      select: { clientNonce: true },
    }),
  );
  const committed = await deps.prisma.$transaction(async (tx) => {
    // Same lock order as clearing chat (and the cloud-agent wake): thread first.
    if (source) await tx.$queryRaw`SELECT id FROM threads WHERE id = ${source.threadId} FOR UPDATE`;
    const claimed = await tx.run.updateMany({
      where: {
        id: run.id,
        trigger: BACKGROUND_HELPER_TRIGGER,
        status: { in: ["completed", "failed", "cancelled"] },
        botOutcomeReturnedAt: null,
      },
      data: { botOutcomeReturnedAt: new Date() },
    });
    if (claimed.count !== 1 || !source || !run.sourceMessageId) return null;
    const card = await tx.message.findFirst({
      where: { id: run.sourceMessageId, threadId: source.threadId },
      select: { id: true, threadId: true, seq: true, blocks: true },
    });
    const blocks = Array.isArray(card?.blocks) ? (card.blocks as MessageBlock[]) : [];
    const helper = blocks.find((block): block is HelperBlock => block.kind === "subagent");
    // A cloud agent's job review ran on the job's own card, which has no helper card of its own.
    const job = jobAgentId
      ? blocks.find(
          (block): block is JobBlock =>
            block.kind === "cloud_agent" && block.agentId === jobAgentId,
        )
      : undefined;
    // The chat was cleared since, or the job's card moved on to a newer attempt: nothing is left
    // to settle or answer.
    if (!card || (!helper && !job)) return null;
    const name = helper?.name ?? job!.title;
    const question =
      outcome.status === "stopped" || !jobAgentId
        ? undefined
        : await jobOwnerQuestion(tx, jobAgentId);
    const failedJob = jobAgentId
      ? await tx.cloudAgent.findUnique({
          where: { id: jobAgentId },
          select: { id: true, status: true, remoteId: true },
        })
      : null;
    const recovery = failedJob ? failedStartRecoveryPrompt(failedJob) : "";
    const helperText =
      outcome.status === "stopped"
        ? STOPPED_HELPER_RESULT
        : helperResultText(outcome.text.trim() || "done.", undefined, RESULT_LIMIT);
    // The owner must see what they are asked to decide, even when the helper left it out.
    const result = [
      question && !helperText.includes(question)
        ? `${helperText}\n\nNeeds you: ${question}`
        : helperText,
      recovery,
    ]
      .filter(Boolean)
      .join("\n\n");
    let eventSeq: number;
    if (helper) {
      const settled: HelperBlock = {
        ...helper,
        status: outcome.status === "completed" ? "completed" : "failed",
        progress: undefined,
        result,
      };
      const nextBlocks = blocks.map((block) => (block === helper ? settled : block));
      await tx.message.update({
        where: { id: card.id },
        data: { blocks: nextBlocks as Prisma.InputJsonValue },
      });
      eventSeq = (
        await appendEventInTransaction(tx, {
          spaceId: run.spaceId,
          threadId: card.threadId,
          botId: run.botId,
          type: "thread.message.updated",
          payload: { messageId: card.id, role: "bot", blocks: nextBlocks },
        })
      ).seq;
    } else {
      // Another wake may still be checking this job; only the last review clears the state.
      const pendingReviews = await tx.run.count({
        where: {
          id: { not: run.id },
          spaceId: run.spaceId,
          status: { in: ["queued", "running"] },
          OR: JOB_WAKE_KINDS.map((kind) => ({
            clientNonce: { startsWith: `${kind}:${jobAgentId}:` },
          })),
        },
      });
      if (!pendingReviews)
        await tx.cloudAgent.updateMany({ where: { id: jobAgentId }, data: { reviewingAt: null } });
      eventSeq = (await paintCloudAgentCard(tx, jobAgentId!)) ?? card.seq;
    }
    const event = { seq: eventSeq };
    if (outcome.status === "stopped") return { threadId: card.threadId, eventSeq: event.seq };
    // A cloud agent's job helper answers on the card alone, so the main chat does not run for a
    // result unless the helper failed or left the owner something to decide.
    if (jobAgentId && (await jobResultSettlesAlone(tx, jobAgentId))) {
      await markThreadUnreadForMembers(tx, {
        threadId: card.threadId,
        spaceId: run.spaceId,
        seq: card.seq,
      });
      return { threadId: card.threadId, eventSeq: event.seq };
    }
    // Like the cloud-agent wake: only for a person still in the space and a bot still active
    // there. In a shared space that bot may be another member's; the turn runs as this person.
    const [member, bot] = await Promise.all([
      tx.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: run.spaceId, userId: run.userId } },
        select: { id: true },
      }),
      tx.bot.findFirst({
        where: { id: run.botId, spaceId: run.spaceId, archivedAt: null },
        select: { id: true },
      }),
    ]);
    if (!member || !bot) return { threadId: card.threadId, eventSeq: event.seq };
    const task = await tx.task.create({
      data: {
        spaceId: run.spaceId,
        botId: run.botId,
        threadId: card.threadId,
        userId: run.userId,
        prompt: resultPrompt(name, outcome.status, result),
        status: "queued",
      },
    });
    const wake = await tx.run.create({
      data: {
        spaceId: run.spaceId,
        botId: run.botId,
        threadId: card.threadId,
        taskId: task.id,
        userId: run.userId,
        status: "queued",
        trigger: HELPER_RESULT_TRIGGER,
        clientNonce: `helper-result:${run.id}`,
      },
      select: { id: true },
    });
    return { threadId: card.threadId, eventSeq: event.seq, wakeRunId: wake.id };
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  if (!committed) return;
  await deps.events.notify(committed.threadId, committed.eventSeq).catch((error) => {
    getLogger().error("background helper card notification", error);
  });
  if (committed.wakeRunId) {
    // A missed enqueue is repaired by the job reconciler, like any queued run.
    await deps.jobs?.enqueue(runContinueJob(committed.wakeRunId)).catch((error) => {
      getLogger().error("background helper result enqueue", error);
    });
  }
}

type JobBlock = Extract<MessageBlock, { kind: "cloud_agent" }>;

const JOB_WAKE_KINDS = ["cloud-agent-wake-run", "cloud-agent-attention"];

/** The cloud agent a job helper run reviews, from the wake identity it was created with. */
function jobAgentIdOf(run: { clientNonce: string | null } | null) {
  const [kind, agentId] = run?.clientNonce?.split(":") ?? [];
  return kind && agentId && JOB_WAKE_KINDS.includes(kind) ? agentId : undefined;
}

/** The decision a job helper's last verdict left for the owner, if the helper reviewed a job. */
async function jobOwnerQuestion(tx: Prisma.TransactionClient, agentId: string) {
  const agent = await tx.cloudAgent.findUnique({
    where: { id: agentId },
    select: { ownerQuestion: true },
  });
  return agent?.ownerQuestion ?? undefined;
}

/**
 * A job helper's result stays on the job's card, a failure included (the wake retries on its
 * own), unless it left an open question or approval the owner has to decide.
 */
async function jobResultSettlesAlone(tx: Prisma.TransactionClient, agentId: string) {
  const agent = await tx.cloudAgent.findUnique({
    where: { id: agentId },
    select: { attention: true, followup: true, status: true, remoteId: true },
  });
  if (!agent || (agent.status === "failed" && !agent.remoteId)) return false;
  const open = Array.isArray(agent.attention) && agent.attention.length > 0;
  return !open || agent.followup != null;
}
