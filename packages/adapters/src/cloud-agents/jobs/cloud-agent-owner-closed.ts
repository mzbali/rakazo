import type { AdapterContext, CloudAgentProvider } from "@rakazo/adapter-kit";
import { CloudAgentRetryLater } from "@rakazo/adapter-kit";
import type { CloudAgent, HeldLease } from "@rakazo/db";
import { assertLeaseHeld } from "@rakazo/db";
import { repaintCloudAgentCard } from "../cloud-agent-poll.js";
import type { CloudAgentDeps } from "../cloud-agent-service.js";
import { enqueueCloudAgent } from "../cloud-agent-service.js";

/** How often ended work with a question for the owner is checked for being closed remotely. */
export const OWNER_CLOSED_POLL_MS = 5 * 60_000;
/** How long after the work ended that check goes on; the question then stays until answered. */
const OWNER_CLOSED_WATCH_MS = 7 * 24 * 60 * 60_000;

/** When ended work with an owner question is next checked, or never. */
export function ownerClosedPollAt(endedAt: Date | null, now = Date.now()): Date | null {
  if (endedAt && now - endedAt.getTime() > OWNER_CLOSED_WATCH_MS) return null;
  return new Date(now + OWNER_CLOSED_POLL_MS);
}

/**
 * Ended work whose review left the owner a question. Once the owner settles or archives it in
 * the provider with nothing open there, they have dealt with it: the question goes and the job
 * leaves their list, so neither the list nor the chat says it needs them.
 */
export async function ownerClosedPoll(
  deps: CloudAgentDeps,
  agent: CloudAgent & { lease: HeldLease },
  provider: Pick<CloudAgentProvider, "ownerClosed">,
  context: AdapterContext,
) {
  const watched =
    agent.ownerQuestion && agent.remoteId && !agent.clearedAt && provider.ownerClosed
      ? ownerClosedPollAt(agent.endedAt)
      : null;
  let closed = false;
  // A review still running decides the question first; the next check looks again.
  if (watched && !agent.reviewingAt) {
    try {
      closed = await provider.ownerClosed!(agent.remoteId!, context);
    } catch (error) {
      // An outage only delays the check; the ended job has nothing else to recover.
      if (!(error instanceof CloudAgentRetryLater)) throw error;
    }
  }
  const nextPollAt = closed ? null : watched;
  const saved = await deps.prisma.$transaction(async (tx) => {
    await assertLeaseHeld(tx, agent.lease);
    return tx.cloudAgent.updateMany({
      where: { id: agent.id, version: agent.version },
      data: {
        nextPollAt,
        ...(closed
          ? { ownerQuestion: null, clearedAt: new Date(), version: { increment: 1 } }
          : {}),
      },
    });
  });
  if (!saved.count) return;
  if (closed) await repaintCloudAgentCard(deps, agent.id);
  else if (nextPollAt) await enqueueCloudAgent(deps, agent.id, nextPollAt);
}
