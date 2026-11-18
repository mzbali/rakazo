import type { CloudAgent } from "@rakazo/db";

/** Recovery is explicit request linkage, never inferred from a title or launch time. */
export function failedStartRecovery(agent: Pick<CloudAgent, "id" | "status" | "remoteId">) {
  if (agent.status !== "failed" || agent.remoteId) return undefined;
  return {
    tool: "cloud_agent_launch",
    arguments: { replaces: agent.id },
    instruction:
      "No remote thread was created. To retry this same request, call cloud_agent_launch with the corrected launch arguments and this replaces id. This keeps the existing chat card and records the failed attempt in its details. Do not launch it as a separate request. If you cannot launch from this review, return these retry arguments to the lead bot.",
  };
}

export function failedStartRecoveryPrompt(agent: Pick<CloudAgent, "id" | "status" | "remoteId">) {
  const retry = failedStartRecovery(agent);
  return retry ? `Failed-start recovery: ${JSON.stringify(retry)}` : "";
}
