import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentBlockFromPayload } from "@rakazo/core";
import type { CloudAgent, Prisma } from "@rakazo/db";
import { appendEventInTransaction } from "@rakazo/db";

type CardDb = Pick<Prisma.TransactionClient, "cloudAgent" | "message">;

/** How far back a card follows replacements; older attempts stay in the table only. */
const MAX_ATTEMPTS = 5;

const VERDICTS = ["accepted", "rejected", "needs_owner"] as const;

/**
 * The job as its card and jobs row show it. `previous` is the attempts this one replaced, oldest
 * first. The hidden review shows as a field of the job, never as a card of its own.
 */
export function cloudAgentBlock(agent: CloudAgent, previous: CloudAgent[] = []) {
  const review = agent.reviewingAt
    ? "checking"
    : VERDICTS.find((verdict) => verdict === agent.verdict);
  return cloudAgentBlockFromPayload({
    ...agent,
    agentId: agent.id,
    note: agent.launchNote,
    startedAt: agent.createdAt,
    endedAt: agent.endedAt,
    progress: agent.status === "running" ? agent.progressText : undefined,
    resultExcerpt: agent.status === "finished" ? agent.resultText : undefined,
    projectName: agent.projectName,
    queued: agent.queuedAt !== null,
    needsInput: Array.isArray(agent.attention) && agent.attention.length > 0,
    // Refused before any remote work existed: there is nothing for the owner to open or answer.
    launchFailed: agent.status === "failed" && !agent.remoteId,
    review,
    attempts: previous.map((attempt) => ({
      agentId: attempt.id,
      status: attempt.status,
      failureReason: attempt.failureReason,
      startedAt: attempt.createdAt.toISOString(),
    })),
  });
}

/** The attempts `agent` replaced, found only through explicit replacement links, oldest first. */
export async function previousAttempts(
  db: Pick<CardDb, "cloudAgent">,
  agent: Pick<CloudAgent, "replacesId">,
) {
  const chain: CloudAgent[] = [];
  for (let next = agent.replacesId; next && chain.length < MAX_ATTEMPTS; ) {
    const prior = await db.cloudAgent.findUnique({ where: { id: next } });
    if (!prior) break;
    chain.unshift(prior);
    next = prior.replacesId;
  }
  return chain;
}

/** The card's block for the agent, with the attempts it replaced. */
export async function cloudAgentCardBlock(db: Pick<CardDb, "cloudAgent">, agent: CloudAgent) {
  return cloudAgentBlock(agent, agent.replacesId ? await previousAttempts(db, agent) : []);
}

/**
 * Repaint the agent's card in its chat from the row, in the caller's transaction and under the
 * chat's lock. Returns the event seq to announce, or nothing when the card already shows the row.
 */
export async function paintCloudAgentCard(tx: Prisma.TransactionClient, agentId: string) {
  let agent = await tx.cloudAgent.findUnique({ where: { id: agentId } });
  const messageId = agent?.messageId;
  if (!agent || !messageId) return undefined;
  // Every status change repaints, so this is where the end of the work is stamped (and cleared
  // when a follow-up starts it again). The card's clock reads it.
  const ended = agent.status === "running" ? null : (agent.endedAt ?? new Date());
  if (ended?.getTime() !== agent.endedAt?.getTime())
    agent = await tx.cloudAgent.update({ where: { id: agent.id }, data: { endedAt: ended } });
  const message = await tx.message.findFirst({
    where: { id: messageId, threadId: agent.threadId },
  });
  if (!message) return undefined;
  const next = await cloudAgentCardBlock(tx, agent);
  const blocks = (message.blocks as MessageBlock[]).map((block) =>
    block.kind === "cloud_agent" && block.agentId === agent.id ? next : block,
  );
  if (JSON.stringify(blocks) === JSON.stringify(message.blocks)) return undefined;
  await tx.message.update({ where: { id: message.id }, data: { blocks } });
  const event = await appendEventInTransaction(tx, {
    spaceId: agent.spaceId,
    threadId: agent.threadId,
    botId: agent.botId,
    type: "thread.cloud_agent",
    payload: { messageId: message.id, ...next },
  });
  return event.seq;
}
