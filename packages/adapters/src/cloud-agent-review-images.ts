import type { AgentRunRequest } from "@rakazo/adapter-kit";
import { BACKGROUND_HELPER_TRIGGER } from "@rakazo/core";
import type { Run } from "@rakazo/db";
import { storedProofImages } from "./cloud-agent-proof.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { loadCurrentTurnImages } from "./run-turn-images.js";

type Images = NonNullable<AgentRunRequest["currentTurnImages"]>;

/**
 * The images the run looks at: the turn's own, and for a job's review also the screenshots kept on
 * the job, so it judges the picture as well as the words.
 */
export async function loadRunImages(
  deps: ExecutorDeps,
  run: Pick<Run, "trigger" | "threadId" | "spaceId">,
  blocks: Parameters<typeof loadCurrentTurnImages>[1],
  context: Parameters<typeof loadCurrentTurnImages>[2],
): Promise<Images | undefined> {
  const turn = await loadCurrentTurnImages(deps, blocks, context);
  if (run.trigger !== BACKGROUND_HELPER_TRIGGER || !deps.artifacts) return turn;
  const agent = await deps.prisma.cloudAgent.findFirst({
    where: { jobThreadId: run.threadId, spaceId: run.spaceId },
    select: { proofImages: true },
  });
  const images: Images = [...(turn ?? [])];
  for (const image of storedProofImages(agent ?? { proofImages: null })) {
    const row = await deps.prisma.artifact.findFirst({
      where: { id: image.artifactId, spaceId: run.spaceId },
    });
    if (!row) continue;
    try {
      images.push({
        name: image.name,
        mimeType: image.mimeType as Images[number]["mimeType"],
        data: await deps.artifacts.get(row.storageKey, context),
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
    }
  }
  return images.length ? images : undefined;
}
