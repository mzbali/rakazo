import type { AdapterContext } from "@rakazo/adapter-kit";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { bestEffort } from "@rakazo/logging";
import { messageBot } from "../../messaging/bot-messages.js";
import type { ExecutorDeps } from "../../runs/executor/executor-deps.js";
import { missingGoalEvidence } from "../../scoped-goal-service.js";
import { CorrectionNotQueued, correctionRefusal } from "../cloud-agent-correction.js";
import type { CloudAgentConnection } from "../cloud-agent-factory.js";
import { cloudAgentsEnabled, USER_CLOUD_AGENT_KEY_PREFIX } from "../cloud-agent-factory.js";
import { readCloudAgentFollowup } from "../cloud-agent-followup.js";
import { repaintCloudAgentCard } from "../cloud-agent-poll.js";
import type { CloudAgentDeps } from "../cloud-agent-service.js";
import {
  cloudAgentFor,
  correctedBrief,
  correctionLead,
  enqueueCloudAgent,
  lockBotSlots,
  queueCloudAgentFollowupInTransaction,
} from "../cloud-agent-service.js";
import { CLOUD_AGENT_REPORT_USAGE, cloudAgentReportSchema } from "../cloud-agent-tools.js";
import { settleAcceptedCloudAgent } from "./cloud-agent-settle.js";

/**
 * The bot's verdict on a finished request. Finishing is not acceptance: only this records it,
 * and a request another bot asked for sends that bot the verdict once per piece of work.
 */
export async function reportCloudAgent(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs" | "runLease"> &
    Pick<CloudAgentDeps, "cloudAgent"> &
    Partial<Pick<CloudAgentDeps, "userCloudAgents">> & { deployment?: CloudAgentConnection | null },
  context: AdapterContext & { botId: string; botName?: string },
  run: { id: string; threadId: string },
  args: Record<string, unknown>,
) {
  const connection = cloudAgentsEnabled(deps.cloudAgent, context.spaceId) ? deps.cloudAgent : null;
  if (!connection) return { error: "Cloud agents are not configured for this space." };
  const parsed = cloudAgentReportSchema.safeParse(args);
  if (!parsed.success) return { error: CLOUD_AGENT_REPORT_USAGE };
  const report = parsed.data;
  const agent = await deps.prisma.cloudAgent.findFirst({
    where: {
      id: report.id,
      // Agents launched on any environment the actor connected report like the current one's.
      OR: [
        { providerKey: connection.key },
        { providerKey: { startsWith: USER_CLOUD_AGENT_KEY_PREFIX } },
        ...(deps.deployment && cloudAgentsEnabled(deps.deployment, context.spaceId)
          ? [{ providerKey: deps.deployment.key }]
          : []),
      ],
      spaceId: context.spaceId,
      userId: context.userId,
      botId: context.botId,
    },
  });
  if (!agent) return { error: "Unknown cloud agent, or another bot launched it." };
  const correction = report.verdict === "rejected" ? report.correction : undefined;
  // A replay of a correction that already went back: the work is running again and still holds
  // this report's summary. Only the message to the asking bot may be left to send.
  const sentBack = Boolean(
    correction &&
      agent.status === "running" &&
      agent.corrections > 0 &&
      agent.verdictSummary === report.summary &&
      (agent.followupBrief?.startsWith(correctionLead(correction)) ||
        [undefined, correction].includes(readCloudAgentFollowup(agent)?.prompt)),
  );
  if (agent.status === "running" && !sentBack)
    return { error: "Report once the cloud agent has finished." };
  // Done means the evidence says so, not the agent's or the bot's word.
  const missing =
    report.verdict === "accepted" && (await missingGoalEvidence(deps.prisma, agent.id));
  if (missing)
    return {
      error: `This agent's release goal is not complete. Missing evidence: ${missing.join(", ")}.`,
    };
  if (correction && !sentBack) {
    const refusal = await correctionRefusal(deps, agent, context);
    if (refusal) return { error: refusal };
  }
  // One verdict per piece of work, so the asking bot never holds a different one than the record.
  // A follow-up accepted meanwhile starts new work, which this verdict is not about. A correction
  // is queued in the same transaction, so a replay finds the work already moved on and queues none.
  const record = (tx: Prisma.TransactionClient | PrismaClient) =>
    tx.cloudAgent.updateMany({
      where: {
        id: agent.id,
        generation: agent.generation,
        status: { not: "running" },
        verdict: null,
      },
      data: {
        verdict: report.verdict,
        verdictSummary: report.summary,
        ownerQuestion: report.ownerQuestion ?? null,
      },
    });
  let recorded: { count: number };
  try {
    recorded = sentBack
      ? { count: 0 }
      : correction
        ? await deps.prisma.$transaction(async (tx) => {
            // The slot lock comes first, as in the queue helper and direct tracking.
            await lockBotSlots(tx, agent.botId);
            const result = await record(tx);
            if (!result.count) return result;
            const queued = await queueCloudAgentFollowupInTransaction(
              tx,
              agent,
              { prompt: correction },
              false,
              agent.corrections + 1,
              correctedBrief(agent, correction),
            );
            if (!queued.count) throw new CorrectionNotQueued();
            return result;
          })
        : await record(deps.prisma);
  } catch (error) {
    if (error instanceof CorrectionNotQueued)
      return { error: "The cloud agent changed; check its status and report again." };
    throw error;
  }
  if (recorded.count && correction) await enqueueCloudAgent(deps, agent.id);
  if (!recorded.count && !sentBack) {
    const current = await deps.prisma.cloudAgent.findUniqueOrThrow({ where: { id: agent.id } });
    if (current.generation !== agent.generation || current.status === "running")
      return { error: "The cloud agent changed; check its status and report again." };
    if (current.verdict !== report.verdict || current.verdictSummary !== report.summary)
      return { error: `Already reported ${current.verdict} for this work.` };
  }
  // The question belongs on the job's card too, whatever the helper's own result says.
  if (recorded.count) await repaintCloudAgentCard(deps, agent.id);
  // Only the call that recorded the verdict settles, so a replay never does it twice.
  if (recorded.count && report.verdict === "accepted" && agent.status === "finished") {
    const owner =
      (await bestEffort("load cloud agent connection", cloudAgentFor(deps, agent))) ?? null;
    if (owner)
      await settleAcceptedCloudAgent(owner, agent.remoteId, {
        operationId: agent.id,
        traceId: agent.id,
        spaceId: agent.spaceId,
        userId: agent.userId,
        botId: agent.botId,
        signal: AbortSignal.timeout(60_000),
      });
  }
  let delivered: boolean | undefined;
  if (agent.originBotId && agent.originBotId !== agent.botId) {
    const sent = await messageBot(
      deps,
      {
        id: run.id,
        spaceId: agent.spaceId,
        threadId: run.threadId,
        botId: agent.botId,
        userId: agent.userId,
        // The asking bot's message, so the verdict reads as the reply to its request.
        sourceMessageId: agent.originMessageId,
      },
      { id: agent.botId, name: context.botName ?? "" },
      {
        bot_id: agent.originBotId,
        message: correction
          ? `Request "${agent.title}" (${agent.id}) was not accepted and has been sent back to the agent: ${report.summary}\nIt is working again; its final verdict will follow.`
          : `Request "${agent.title}" (${agent.id}) ${report.verdict.replace("_", " ")}: ${report.summary}${report.ownerQuestion ? `\nQuestion for the owner: ${report.ownerQuestion}` : ""}`,
        // Sent back work is not finished, so the asking bot has nothing to relay yet.
        intent: correction ? "status" : "result",
        deliveryKey: `cloud-agent-report:${agent.id}:${sentBack ? agent.generation - 1 : agent.generation}`,
      },
    );
    delivered = sent.ok;
    if (!sent.ok) return { error: `Recorded, but not delivered: ${sent.error}` };
  }
  return {
    id: agent.id,
    verdict: report.verdict,
    ...(delivered ? { delivered } : {}),
    ...(correction ? { sentBack: true } : {}),
    // The owner reads the result, so it ends with the decision they are asked to make.
    ...(report.ownerQuestion
      ? {
          ownerQuestion: report.ownerQuestion,
          note: "End your result with this question for the owner, word for word.",
        }
      : {}),
  };
}
