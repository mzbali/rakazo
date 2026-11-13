import { randomUUID } from "node:crypto";
import type { AgentRunRequest } from "@rakazo/adapter-kit";
import type { CorrectedClaimJudge } from "@rakazo/core";
import {
  CORRECTED_CLAIMS,
  CORRECTED_CLAIMS_RUBRIC,
  CORRECTED_CLAIMS_RUBRIC_VERSION,
  configureCorrectedClaimJudge,
} from "@rakazo/core";
import { currentDbContext } from "@rakazo/db";
import { z } from "zod";
import { hasRepeatedTopLevelKey } from "./auto-review.js";
import { resolveDeploymentModel } from "./deployment-model.js";
import { resolveMemberMainModel } from "./model-roles.js";
import { resolvedModelRunFields, resolveModelKeyMaterial } from "./run-model.js";

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
export function createCorrectedClaimJudge(
  resolve: () => Promise<AgentRunRequest["model"]>,
): CorrectedClaimJudge {
  return async (input) => {
    const selected = await resolve();
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
        model: selected,
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
}
export const deploymentCorrectedClaimJudge = createCorrectedClaimJudge(async () => {
  const model = resolveDeploymentModel();
  if (!model.configured)
    throw new Error(
      "Configure a deployment model or a scoped main model connection for fact checking.",
    );
  return { provider: model.provider, id: model.model, apiKey: model.key, thinkingLevel: null };
});
export function configureCorrectedClaimsConnections(
  deps: Parameters<typeof resolveModelKeyMaterial>[0],
): void {
  if (process.env.RAKAZO_CORRECTED_CLAIMS_ENABLED !== "true") return;
  configureCorrectedClaimJudge(
    createCorrectedClaimJudge(async () => {
      const scope = currentDbContext();
      if (scope?.kind !== "tenant")
        throw new Error("Fact checking requires a member and space context.");
      const main = await resolveMemberMainModel(deps, scope);
      if (!main?.credential)
        throw new Error("Choose a connected main model in this space before using fact checking.");
      const material = await resolveModelKeyMaterial(
        deps,
        scope.userId,
        scope.spaceId,
        main.credential,
        main.provider,
        main.modelId,
        undefined,
        { requireStoredSecret: true },
      );
      return {
        provider: main.provider,
        id: main.modelId,
        ...resolvedModelRunFields({
          ...material,
          apiKey: material.apiKey,
          callObserver: undefined,
        }),
        thinkingLevel: material.thinkingLevel ?? null,
      };
    }),
  );
}
/** Call after the entrypoint loads its environment: static imports run before `loadRootEnv`. */
export function configureCorrectedClaimsFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  configureCorrectedClaimJudge(
    env.RAKAZO_CORRECTED_CLAIMS_ENABLED === "true" ? deploymentCorrectedClaimJudge : undefined,
  );
}
