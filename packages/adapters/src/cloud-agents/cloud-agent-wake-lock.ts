import type { CloudAgent, Prisma } from "@rakazo/db";

/** Primary nonces also cover runs written by the previous release. */
export function cloudAgentWakeNonceWhere(clientNonce: string): Prisma.RunWhereInput {
  return { OR: [{ clientNonce }, { cloudAgentWakeNonces: { has: clientNonce } }] };
}

/** Serialize wake creation with anything else writing this chat. */
export async function lockCloudAgentWakeThread(
  tx: Prisma.TransactionClient,
  agent: Pick<CloudAgent, "spaceId" | "threadId">,
) {
  await tx.thread.updateMany({
    where: { id: agent.threadId, spaceId: agent.spaceId },
    data: { nextEventSeq: { increment: 0 } },
  });
}
