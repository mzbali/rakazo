import type { CloudAgent } from "@rakazo/db";
import { USER_CLOUD_AGENT_KEY_PREFIX } from "./cloud-agent-factory.js";
import type { CloudAgentDeps } from "./cloud-agent-service.js";

/** A follow-up on a user-connected agent stays with the bot whose identity the worker will reauthorize. */
export async function keepsBotIdentity(
  deps: Partial<Pick<CloudAgentDeps, "userCloudAgents">>,
  agent: CloudAgent,
  context: { spaceId: string; userId: string; botId: string },
) {
  if (!agent.providerKey.startsWith(USER_CLOUD_AGENT_KEY_PREFIX)) return true;
  return (
    agent.botId === context.botId &&
    Boolean(
      await deps.userCloudAgents?.forKey(agent.providerKey, {
        spaceId: context.spaceId,
        userId: context.userId,
        botIds: [context.botId],
      }),
    )
  );
}

/** Corrections in a row sent back on one job before the helper has to stop or ask the owner. */
export const CLOUD_AGENT_MAX_CORRECTIONS = 2;

export class CorrectionNotQueued extends Error {}

/** Why this finished work cannot be sent back, if it cannot; sending back is a follow-up, so it meets a reply's conditions. */
export async function correctionRefusal(
  deps: Partial<Pick<CloudAgentDeps, "userCloudAgents">>,
  agent: CloudAgent,
  context: { spaceId: string; userId: string; botId: string },
) {
  if (!(await keepsBotIdentity(deps, agent, context))) return "Unknown cloud agent.";
  if (agent.followup || agent.cancelRequested || !agent.remoteId)
    return "This work cannot be sent back. Report rejected without a correction; the work stops there.";
  if (agent.corrections >= CLOUD_AGENT_MAX_CORRECTIONS)
    return `This job was already sent back ${CLOUD_AGENT_MAX_CORRECTIONS} times. Report rejected without a correction to stop, or needs_owner only if the owner has a concrete decision to make.`;
}
