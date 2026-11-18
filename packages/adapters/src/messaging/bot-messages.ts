import type { BotMessageIntent, MessageBlock } from "@rakazo/contracts";
import {
  BOT_MESSAGE_MAX_LENGTH,
  BOT_MESSAGE_TOO_LONG,
  botMessageContext,
  botMessageHopExhausted,
  botMessageWaitingText,
  buildBotMessageWakePrompt,
  clampBotMessage,
  nextBotMessageHop,
  resolveBotAddress,
  retry,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  isUniqueViolation,
  spaceTakesWork,
  storedMessageBlocks,
  THREAD_LOCK_TRANSACTION_OPTIONS,
  withTransactionRetry,
} from "@rakazo/db";
import { bestEffort, getLogger } from "@rakazo/logging";
import { runLeaseFor } from "../runs/assembly/run-messages.js";
import type { ExecutorDeps } from "../runs/executor/executor-deps.js";
import { wakeRun } from "../runs/wakeups/wake-run.js";

/**
 * The hop the current run sits at, read back from the message that woke this
 * bot. A run a person started carries no bot message, so it starts at 0.
 */
export async function currentBotMessageHop(
  prisma: PrismaClient,
  sourceMessageId: string | null | undefined,
): Promise<number> {
  if (!sourceMessageId) return 0;
  const source = await prisma.message.findUnique({
    where: { id: sourceMessageId },
    select: { blocks: true },
  });
  const blocks = source ? storedMessageBlocks({ id: sourceMessageId, blocks: source.blocks }) : [];
  return botMessageContext(blocks)?.hop ?? 0;
}

export async function loadBotMessageContext(
  prisma: PrismaClient,
  sourceMessageId: string | null | undefined,
) {
  if (!sourceMessageId) return undefined;
  const source = await prisma.message.findUnique({
    where: { id: sourceMessageId },
    select: { blocks: true, replyTo: { select: { id: true, blocks: true } } },
  });
  const context = botMessageContext(
    source ? storedMessageBlocks({ id: sourceMessageId, blocks: source.blocks }) : [],
  );
  if (!context) return undefined;
  const replyBlocks = source?.replyTo ? storedMessageBlocks(source.replyTo) : [];
  const repliesToRequest =
    (context.intent === "result" || context.intent === "status" || context.intent === "fyi") &&
    replyBlocks.some(
      (block) =>
        block.kind === "bot_message_sent" &&
        block.toBotId === context.fromBotId &&
        (block.intent === undefined || block.intent === "request" || block.intent === "question"),
    );
  return { ...context, repliesToRequest };
}

export async function messageBot(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs" | "runLease">,
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
    sourceMessageId?: string | null;
  },
  sender: { id: string; name: string },
  input: {
    bot_id?: string;
    confirm_name?: string;
    message: string;
    intent?: BotMessageIntent;
    deliveryKey?: string;
    /** Attachments filed under the recipient's chat, shown there and copied to its computer. */
    files?: Array<Extract<MessageBlock, { kind: "image" | "file" }>>;
  },
  /** `ended` or `waiting` sends a return to the requester from a run that is no longer running. */
  options?: { returnFrom?: "ended" | "waiting"; forceUnread?: boolean },
) {
  const message = String(input.message ?? "").trim();
  if (!message) return { ok: false as const, error: "message is required" };
  if (message.length > BOT_MESSAGE_MAX_LENGTH) {
    return { ok: false as const, error: BOT_MESSAGE_TOO_LONG };
  }

  const sourceContext = await loadBotMessageContext(deps.prisma, run.sourceMessageId);
  const intent = input.intent ?? "request";
  const hop = nextBotMessageHop(sourceContext?.hop);

  const candidates = await deps.prisma.bot.findMany({
    where: { spaceId: run.spaceId, archivedAt: null },
    select: { id: true, name: true, thread: { select: { id: true } } },
  });
  const target = resolveBotAddress(candidates, {
    botId: input.bot_id,
    name: input.confirm_name,
  });
  if (!target) return { ok: false as const, error: "no bot found with that id or name" };
  if (target.id === sender.id) return { ok: false as const, error: "a bot cannot message itself" };
  if (!target.thread)
    return { ok: false as const, error: `${target.name} has no chat to deliver to` };
  const returnFrom = options?.returnFrom;
  const returnsToSender =
    returnFrom !== undefined &&
    (intent === "result" || intent === "status") &&
    (sourceContext?.intent === undefined ||
      sourceContext.intent === "request" ||
      sourceContext.intent === "question") &&
    sourceContext?.fromBotId === target.id;
  if (botMessageHopExhausted(hop) && !returnsToSender) {
    return {
      ok: false as const,
      error:
        "bot-to-bot message limit reached for this chain; report back to the user instead of messaging another bot",
    };
  }

  const targetThreadId = target.thread.id;

  // A tool call can be re-executed after a lease expiry, so a delivery has to be
  // replayable: without this the recipient is messaged twice and woken twice.
  const deliveryKey = input.deliveryKey ? `bot-message:${input.deliveryKey}` : undefined;
  const replayed = () =>
    ({
      ok: true as const,
      botId: target.id,
      name: target.name,
      delivered: message,
      replayed: true as const,
      note: `Already sent to ${target.name} in this turn; it was not sent again.`,
    }) as const;

  const wakePrompt = buildBotMessageWakePrompt({ from: sender, text: message, intent });
  const outboundBlock: MessageBlock = {
    kind: "bot_message_sent",
    toBotId: target.id,
    toBotName: target.name,
    text: message,
    intent,
  };
  const files = input.files ?? [];

  let committed:
    | {
        ok: true;
        runId: string;
        targetEventSeq: number;
        senderEventSeq: number;
      }
    | {
        ok: false;
        error: string;
      }
    | {
        ok: true;
        replayed: true;
      };
  try {
    committed = await withTransactionRetry(() =>
      deps.prisma.$transaction(async (tx) => {
        if (!(await spaceTakesWork(tx, run.spaceId)))
          return { ok: false as const, error: "this Space is being deleted" };
        for (const threadId of [run.threadId, targetThreadId].sort()) {
          await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
        }
        // Claim the delivery key inside the transaction so a concurrent retry
        // either sees the winner or loses on the unique (threadId, clientNonce).
        if (deliveryKey) {
          const already = await tx.message.findUnique({
            where: { threadId_clientNonce: { threadId: targetThreadId, clientNonce: deliveryKey } },
            select: { id: true },
          });
          if (already) return { ok: true as const, replayed: true as const };
        }

        const senderStillRunning = await tx.run.findFirst({
          where: {
            id: run.id,
            spaceId: run.spaceId,
            threadId: run.threadId,
            botId: run.botId,
            userId: run.userId,
            status:
              returnFrom === "ended"
                ? { in: ["completed", "failed", "cancelled"] }
                : returnFrom === "waiting"
                  ? "waiting_input"
                  : "running",
          },
          select: { id: true },
        });
        if (!senderStillRunning)
          return { ok: false as const, error: "source run is no longer active" };

        // Re-read the target inside the transaction: it can be archived between
        // resolving it above and committing here.
        const stillAddressable = await tx.bot.findFirst({
          where: {
            id: target.id,
            spaceId: run.spaceId,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!stillAddressable)
          return { ok: false as const, error: `${target.name} is no longer available` };

        // Echo into the sender's chat in the same transaction so a failed notify
        // cannot leave one side delivered and the other blank.
        const outbound = await createThreadMessageInTransaction(tx, {
          threadId: run.threadId,
          role: "bot",
          blocks: [outboundBlock],
          botId: run.botId,
          runId: run.id,
          markUnread: options?.forceUnread === true,
          allowCancelledRun: returnFrom === "ended",
          lease: runLeaseFor(deps, run.id),
        });
        const inboundBlock: MessageBlock = {
          kind: "bot_message_received",
          fromBotId: sender.id,
          fromBotName: sender.name,
          text: message,
          hop,
          intent,
          returnToMessageId: outbound.id,
        };
        const inbound = await createThreadMessageInTransaction(tx, {
          threadId: targetThreadId,
          role: "user",
          blocks: [inboundBlock, ...files],
          replyToMessageId:
            sourceContext?.fromBotId === target.id && intent !== "fyi"
              ? sourceContext.returnToMessageId
              : undefined,
          clientNonce: deliveryKey,
          markUnread: options?.forceUnread === true,
        });
        const task = await tx.task.create({
          data: {
            spaceId: run.spaceId,
            botId: target.id,
            threadId: targetThreadId,
            userId: run.userId,
            prompt: wakePrompt,
            status: "queued",
          },
        });
        const nextRun = await tx.run.create({
          data: {
            spaceId: run.spaceId,
            botId: target.id,
            threadId: targetThreadId,
            taskId: task.id,
            userId: run.userId,
            status: "queued",
            trigger: "bot_message",
            sourceMessageId: inbound.id,
          },
          select: { id: true },
        });
        await tx.message.update({ where: { id: inbound.id }, data: { runId: nextRun.id } });
        const inboundEvent = await appendEventInTransaction(tx, {
          spaceId: run.spaceId,
          threadId: targetThreadId,
          botId: target.id,
          type: "thread.message.created",
          runId: nextRun.id,
          payload: { messageId: inbound.id, role: "user", blocks: [inboundBlock, ...files] },
        });
        const outboundEvent = await appendEventInTransaction(tx, {
          spaceId: run.spaceId,
          threadId: run.threadId,
          botId: run.botId,
          type: "thread.message.created",
          runId: run.id,
          allowCancelledRun: returnFrom === "ended",
          lease: runLeaseFor(deps, run.id),
          payload: { messageId: outbound.id, role: "bot", blocks: [outboundBlock] },
        });
        return {
          ok: true as const,
          runId: nextRun.id,
          targetEventSeq: inboundEvent.seq,
          senderEventSeq: outboundEvent.seq,
        };
      }, THREAD_LOCK_TRANSACTION_OPTIONS),
    );
  } catch (error) {
    // Two concurrent retries can both miss the in-transaction lookup; the
    // loser hits the unique key. Treat that as a successful replay.
    if (deliveryKey && isUniqueViolation(error)) {
      const winner = await deps.prisma.message.findUnique({
        where: { threadId_clientNonce: { threadId: targetThreadId, clientNonce: deliveryKey } },
        select: { id: true },
      });
      if (winner) return replayed();
    }
    throw error;
  }
  if ("replayed" in committed) return replayed();
  if (!committed.ok) return committed;

  await deps.events.notify(targetThreadId, committed.targetEventSeq).catch((error) => {
    getLogger().error("bot message realtime notification", error);
  });
  await deps.events.notify(run.threadId, committed.senderEventSeq).catch((error) => {
    getLogger().error("bot message sender echo notification", error);
  });
  await wakeRun(deps.jobs, committed.runId);
  return {
    ok: true as const,
    botId: target.id,
    name: target.name,
    delivered: message,
    note: `Sent to ${target.name}. Delivery is async; a reply wakes you later as a new message. Continue independent work; send another update later only if it adds something new.`,
  };
}

type DelegatedRun = {
  id: string;
  spaceId: string;
  threadId: string;
  botId: string;
  userId: string;
  sourceMessageId?: string | null;
};

/** The bot that handed this run its request or question, while it can still take a reply. */
async function requesterBotId(
  prisma: PrismaClient,
  run: DelegatedRun,
): Promise<string | undefined> {
  const source = await loadBotMessageContext(prisma, run.sourceMessageId);
  if (!source) return undefined;
  const sourceIntent = source.intent ?? "request";
  if (sourceIntent !== "request" && sourceIntent !== "question") return undefined;
  // messageBot reaches only active bots of this space, so an archived or deleted
  // requester can never take the reply.
  const requester = await prisma.bot.findFirst({
    where: { id: source.fromBotId, spaceId: run.spaceId, archivedAt: null },
    select: { id: true },
  });
  return requester?.id;
}

/** Return a delegated run's terminal outcome unless it already sent one explicitly. */
export async function returnBotMessageOutcome(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: DelegatedRun,
  sender: { id: string; name: string },
  text: string,
  intent: "result" | "status" = "result",
  options?: { forceUnread?: boolean },
) {
  const requesterId = await requesterBotId(deps.prisma, run);
  if (!requesterId) {
    await markBotOutcomeReturned(deps.prisma, run.id);
    // Handled: nothing to deliver. Return true so callers do not release a reservation.
    return true;
  }
  const sent = await deps.prisma.message.findMany({
    where: { threadId: run.threadId, runId: run.id },
    select: { id: true, blocks: true },
  });
  // Only an explicit result counts as a terminal outcome. Interim message_bot
  // status updates must not suppress the automatic final return.
  const alreadyReturned = sent.some((message) =>
    storedMessageBlocks(message).some(
      (block) =>
        block.kind === "bot_message_sent" &&
        block.toBotId === requesterId &&
        block.intent === "result",
    ),
  );
  // The pointer comes before the run is marked returned, so a failure here is retried by the
  // reconciler. Work this run handed to a cloud agent is reported by that agent's own wake.
  const pointToOutcome = async () => {
    // A finished agent this very run was waiting on was reported by this run, which is what its
    // wake was held back for; any other agent for the request is reported by its own wake.
    const handedOn = await deps.prisma.cloudAgent.findFirst({
      where: {
        botId: run.botId,
        originMessageId: run.sourceMessageId,
        NOT: { waitingRunId: run.id, status: { not: "running" } },
      },
      select: { id: true },
    });
    if (!handedOn)
      await postRelayPointer(deps, { sourceMessageId: run.sourceMessageId!, bot: sender });
  };
  if (alreadyReturned) {
    await pointToOutcome();
    await markBotOutcomeReturned(deps.prisma, run.id);
    return true;
  }
  const outcome = await messageBot(
    deps,
    run,
    sender,
    {
      bot_id: requesterId,
      message: clampBotMessage(text),
      intent,
      // One key per run so status vs result (executor vs reconciler) cannot double-deliver.
      deliveryKey: `auto-outcome:${run.id}`,
    },
    { returnFrom: "ended", forceUnread: options?.forceUnread },
  );
  if (!outcome.ok) return false;
  await pointToOutcome();
  await markBotOutcomeReturned(deps.prisma, run.id);
  return true;
}

const RELAY_POINTER_REQUEST_MAX = 100;

/**
 * Tell the person, in the chat they asked in, that work one bot relayed to another has finished:
 * one short line and a link to the bot that did it, not a copy of its answer. It is a plain
 * message from the asking bot, so nothing wakes and it cannot start a reply chain. The delivery
 * key is the relayed request, so any number of reports for it leave a single pointer.
 */
export async function postRelayPointer(
  deps: { prisma: PrismaClient; events: Pick<ExecutorDeps["events"], "notify"> },
  input: { sourceMessageId: string; bot: { id: string; name: string } },
) {
  let posted: { threadId: string; seq: number } | undefined;
  try {
    posted = await withTransactionRetry(() =>
      deps.prisma.$transaction(async (tx) => {
        const source = await tx.message.findUnique({
          where: { id: input.sourceMessageId },
          select: { blocks: true },
        });
        const context = botMessageContext(
          source ? storedMessageBlocks({ id: input.sourceMessageId, blocks: source.blocks }) : [],
        );
        if (!context?.returnToMessageId) return undefined;
        if (context.intent && context.intent !== "request" && context.intent !== "question")
          return undefined;
        const asked = await tx.message.findUnique({
          where: { id: context.returnToMessageId },
          select: { threadId: true, thread: { select: { spaceId: true } } },
        });
        if (!asked) return undefined;
        // The asking bot must still be active and own the chat the request was sent from.
        const requester = await tx.bot.findFirst({
          where: {
            id: context.fromBotId,
            spaceId: asked.thread.spaceId,
            archivedAt: null,
            thread: { id: asked.threadId },
          },
          select: { id: true },
        });
        if (!requester || !(await spaceTakesWork(tx, asked.thread.spaceId))) return undefined;
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${asked.threadId} FOR UPDATE`;
        const clientNonce = `relay-pointer:${input.sourceMessageId}`;
        const already = await tx.message.findUnique({
          where: { threadId_clientNonce: { threadId: asked.threadId, clientNonce } },
          select: { id: true },
        });
        if (already) return undefined;
        const request = clampBotMessage(context.text).replace(/\s+/g, " ");
        const summary =
          request.length > RELAY_POINTER_REQUEST_MAX
            ? `${request.slice(0, RELAY_POINTER_REQUEST_MAX - 1).trimEnd()}…`
            : request;
        // The bot is a mention block, which web and mobile both open as that bot's chat.
        const blocks: MessageBlock[] = [
          { kind: "text", text: `${input.bot.name} finished: ${summary}` },
          { kind: "child_bot", botId: input.bot.id, name: input.bot.name, status: "created" },
        ];
        const message = await createThreadMessageInTransaction(tx, {
          threadId: asked.threadId,
          role: "bot",
          blocks,
          botId: requester.id,
          clientNonce,
        });
        const event = await appendEventInTransaction(tx, {
          spaceId: asked.thread.spaceId,
          threadId: asked.threadId,
          botId: requester.id,
          type: "thread.message.created",
          payload: { messageId: message.id, role: "bot", blocks },
        });
        return { threadId: asked.threadId, seq: event.seq };
      }, THREAD_LOCK_TRANSACTION_OPTIONS),
    );
  } catch (error) {
    // A concurrent report claimed the same pointer first.
    if (isUniqueViolation(error)) return;
    throw error;
  }
  if (posted)
    await deps.events.notify(posted.threadId, posted.seq).catch((error) => {
      getLogger().error("relay pointer realtime notification", error);
    });
}

/**
 * Tell the requester a delegated run is waiting on the user, so it can say so instead of
 * hearing nothing until the user answers. `waitId` is the paused attempt: one notice per wait.
 */
export async function reportBotMessageWait(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs" | "runLease">,
  run: DelegatedRun & { trigger: string },
  sender: { id: string; name: string },
  ask: string,
  waitId: string,
) {
  if (run.trigger !== "bot_message") return;
  // The delivery key makes a repeat a replay, so any failure is worth another try.
  await bestEffort(
    "bot message wait notice",
    retry(() => sendWaitNotice(deps, run, sender, ask, waitId), {
      attempts: 3,
      retryable: () => true,
    }),
  );
}

async function sendWaitNotice(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs" | "runLease">,
  run: DelegatedRun,
  sender: { id: string; name: string },
  ask: string,
  waitId: string,
) {
  const requesterId = await requesterBotId(deps.prisma, run);
  if (!requesterId) return;
  const sent = await messageBot(
    deps,
    run,
    sender,
    {
      bot_id: requesterId,
      message: clampBotMessage(botMessageWaitingText(ask)),
      intent: "status",
      deliveryKey: `waiting:${waitId}`,
    },
    { returnFrom: "waiting", forceUnread: true },
  );
  if (!sent.ok) getLogger().warn("bot message wait notice not sent", { error: sent.error });
}

async function markBotOutcomeReturned(prisma: PrismaClient, runId: string) {
  await prisma.run.updateMany({
    where: {
      id: runId,
      status: { in: ["completed", "failed", "cancelled"] },
      botOutcomeReturnedAt: null,
    },
    data: { botOutcomeReturnedAt: new Date() },
  });
}
