import type { AdapterContext } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import type { CloudAgent, Prisma } from "@rakazo/db";
import { appendEventInTransaction } from "@rakazo/db";
import { cloudAgentBlock, previousAttempts } from "./cloud-agent-card.js";
import type { CloudAgentDeps, PostedCard } from "./cloud-agent-service.js";
import { runLeaseFor } from "./run-messages.js";

type Tx = Prisma.TransactionClient;

/** How many replacements are followed to the current attempt. */
const MAX_CHAIN = 20;

/** A launch that cannot go on; `rejected` says why to the bot. */
export interface RejectedLaunch {
  rejected: string;
}

/** An attempt that never started anything remote: the provider refused the launch. */
export function failedLaunch(agent: Pick<CloudAgent, "status" | "remoteId">) {
  return agent.status === "failed" && !agent.remoteId;
}

/**
 * What a launch with a request key or a `replaces` id continues. A same-key or same-id launch
 * of a live or started agent returns that agent; of an attempt that failed to start, it makes
 * the next attempt, and an attempt already replaced returns the one that replaced it.
 */
export async function replacedAttempt(
  tx: Tx,
  context: { spaceId: string; userId: string; botId: string },
  request: { requestKey?: string; replaces?: string },
  keyed: CloudAgent | null,
): Promise<PostedCard | RejectedLaunch | { replaces?: CloudAgent }> {
  const named = request.replaces
    ? await tx.cloudAgent.findFirst({
        where: {
          id: request.replaces,
          spaceId: context.spaceId,
          userId: context.userId,
          botId: context.botId,
        },
      })
    : null;
  if (request.replaces && !named) return { rejected: "Unknown cloud agent to replace." };
  const prior = named ?? keyed;
  if (!prior) return {};
  if (keyed && keyed.spaceId !== context.spaceId)
    throw new Error("Cloud agent operation scope changed");
  // Launching the same request again finds the attempt that is current for it: the end of the
  // replacement chain, however many attempts it has had.
  let current = prior;
  for (let depth = 0; depth < MAX_CHAIN; depth += 1) {
    const successor = await tx.cloudAgent.findFirst({
      where: { replacesId: current.id },
      orderBy: { createdAt: "desc" },
    });
    if (!successor) break;
    current = successor;
  }
  if (current !== prior) return { agent: current };
  if (!failedLaunch(prior)) {
    if (named) return { rejected: "Only an agent that failed to start can be replaced." };
    return { agent: prior };
  }
  // The key belongs to the current attempt, so the new one takes it over.
  if (prior.requestKey && prior.requestKey === request.requestKey)
    await tx.cloudAgent.update({ where: { id: prior.id }, data: { requestKey: null } });
  return { replaces: prior };
}

/**
 * The replacement attempt keeps the request's one card: it shows the new attempt, with the
 * earlier ones in its details. A card in another chat, or one that is gone, gets a new card.
 */
export async function takeOverCloudAgentCard(
  tx: Tx,
  deps: Pick<CloudAgentDeps, "runLease">,
  context: AdapterContext & { botId: string },
  run: { id: string; threadId: string },
  created: CloudAgent,
  replaced: CloudAgent,
): Promise<PostedCard | undefined> {
  const card = replaced.messageId
    ? await tx.message.findFirst({ where: { id: replaced.messageId, threadId: run.threadId } })
    : null;
  if (!card) return undefined;
  const next = cloudAgentBlock(created, await previousAttempts(tx, created));
  const blocks = (card.blocks as MessageBlock[]).map((block) =>
    block.kind === "cloud_agent" && block.agentId === replaced.id ? next : block,
  );
  await tx.message.update({ where: { id: card.id }, data: { blocks } });
  const saved = await tx.cloudAgent.update({
    where: { id: created.id },
    data: { messageId: card.id },
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: context.spaceId,
    threadId: run.threadId,
    botId: context.botId,
    runId: run.id,
    lease: runLeaseFor(deps, run.id),
    type: "thread.message.updated",
    payload: { messageId: card.id, role: "bot", blocks },
  });
  return { agent: saved, seq: event.seq };
}
