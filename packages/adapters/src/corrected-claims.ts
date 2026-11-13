import { randomUUID } from "node:crypto";
import type { CorrectedClaimJudge } from "@rakazo/core";
import {
  CORRECTED_CLAIMS,
  CORRECTED_CLAIMS_RUBRIC,
  CORRECTED_CLAIMS_RUBRIC_VERSION,
  configureCorrectedClaimJudge,
} from "@rakazo/core";
import { z } from "zod";
import { hasRepeatedTopLevelKey } from "./auto-review.js";
import { resolveDeploymentModel } from "./deployment-model.js";

const Verdict = z
  .object({ status: z.enum(["accepted", "rejected", "unqualified"]), reason: z.string().max(2000) })
  .strict();
export function parseCorrectedClaimVerdict(text: string) {
  try {
    const result = Verdict.safeParse(JSON.parse(text));
    if (!result.success || hasRepeatedTopLevelKey(text)) throw new Error("Invalid verdict");
    return result.data;
  } catch {
    return { status: "unqualified" as const, reason: "Invalid fact checker response." };
  }
}
/** Deployment opt-in reuses the generic deployment connection, including local models. */
export const deploymentCorrectedClaimJudge: CorrectedClaimJudge = async (input) => {
  const model = resolveDeploymentModel();
  if (!model.configured)
    return { status: "unqualified", reason: "Fact checker connection unavailable." };
  const { PiAgentRuntime } = await import("./pi-runtime.js");
  const runtime = new PiAgentRuntime();
  const operationId = `corrected-claims:${randomUUID()}`;
  const signal = AbortSignal.timeout(30000);
  let text = "";
  for await (const event of runtime.run(
    {
      runId: operationId,
      botId: "fact-check",
      threadId: operationId,
      prompt: JSON.stringify({
        rubricVersion: CORRECTED_CLAIMS_RUBRIC_VERSION,
        facts: CORRECTED_CLAIMS,
        ...input,
      }),
      instructions: CORRECTED_CLAIMS_RUBRIC,
      history: [],
      tools: [],
      model: { provider: model.provider, id: model.model, apiKey: model.key, thinkingLevel: null },
      usageOperationKind: "setup",
      onUsage: async (usage) => {
        // biome-ignore lint/suspicious/noConsole: Separate opt-in judge usage from agent costs without document contents.
        console.info(JSON.stringify({ operationId, operation: "corrected-claims", usage }));
      },
    },
    { operationId, traceId: operationId, signal },
  )) {
    if (event.type === "done") text = event.text ?? "";
  }
  if (signal.aborted) return { status: "unqualified", reason: "Fact checker timed out." };
  return parseCorrectedClaimVerdict(text.trim());
};
if (process.env.RAKAZO_CORRECTED_CLAIMS_ENABLED === "true")
  configureCorrectedClaimJudge(deploymentCorrectedClaimJudge);
