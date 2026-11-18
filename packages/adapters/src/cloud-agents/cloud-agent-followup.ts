import type { CloudAgent } from "@rakazo/db";
import { readJsonColumn } from "@rakazo/db";
import { z } from "zod";

const Followup = z
  .object({
    prompt: z.string().optional(),
    goalRunId: z.string().optional(),
    goalGate: z.string().optional(),
    steerKey: z.string().optional(),
  })
  .passthrough();

export type CloudAgentFollowup = z.infer<typeof Followup>;

/** The queued follow-up. Empty or another shape reads as nothing, and is never written back. */
export function readCloudAgentFollowup(
  agent: Pick<CloudAgent, "id" | "followup">,
): CloudAgentFollowup | null {
  if (agent.followup == null) return null;
  const parsed = readJsonColumn(
    Followup,
    agent.followup,
    { table: "cloud_agents", column: "followup", id: agent.id },
    { fallback: {} },
  );
  return parsed;
}

const AttentionItem = z.object({
  requestId: z.unknown().optional(),
  kind: z.unknown().optional(),
  threadId: z.unknown().optional(),
});

/** Open questions and approvals stored on the agent. Another shape reads as none. */
export function attentionRecords(agent: Pick<CloudAgent, "id" | "attention">) {
  return readJsonColumn(
    z.array(AttentionItem),
    agent.attention ?? [],
    { table: "cloud_agents", column: "attention", id: agent.id },
    { fallback: [] },
  );
}
