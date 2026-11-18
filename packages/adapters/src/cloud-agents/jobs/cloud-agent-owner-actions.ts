import { ClientError } from "@rakazo/core";
import type { CloudAgent } from "@rakazo/db";
import { THREAD_LOCK_TRANSACTION_OPTIONS } from "@rakazo/db";
import { wakeRun } from "../../runs/wakeups/wake-run.js";
import { readCloudAgentFollowup } from "../cloud-agent-followup.js";
import { createCloudAgentWake, repaintCloudAgentCard } from "../cloud-agent-poll.js";
import type { CloudAgentDeps } from "../cloud-agent-service.js";
import {
  enqueueCloudAgent,
  openQuestion,
  queueCloudAgentFollowupInTransaction,
} from "../cloud-agent-service.js";

type OwnerActionDeps = Pick<CloudAgentDeps, "prisma" | "jobs" | "events">;
type Owner = { spaceId: string; userId: string };

/** Why an owner's tap on a job card was refused; the message is for the owner to read. */
export class CloudAgentOwnerActionError extends ClientError {
  readonly reason: "not_found" | "stale" | "busy" | "ended";

  constructor(reason: "not_found" | "stale" | "busy" | "ended", message: string) {
    super(reason === "not_found" ? "NOT_FOUND" : "CONFLICT", message);
    this.name = "CloudAgentOwnerActionError";
    this.reason = reason;
  }
}

export interface OwnerActionResult {
  /** True when the same tap had already been accepted; nothing was sent twice. */
  duplicate: boolean;
}

/** Only the job's own owner, in its own space, may act on it. */
async function ownedAgent(deps: OwnerActionDeps, owner: Owner, agentId: string) {
  const agent = await deps.prisma.cloudAgent.findFirst({
    where: { id: agentId, spaceId: owner.spaceId, userId: owner.userId },
  });
  if (!agent) throw new CloudAgentOwnerActionError("not_found", "Job not found.");
  return agent;
}

function queuedFollowup(agent: Pick<CloudAgent, "id" | "followup">) {
  return readCloudAgentFollowup(agent);
}

async function afterQueued(deps: OwnerActionDeps, agentId: string) {
  await repaintCloudAgentCard(deps as CloudAgentDeps, agentId);
  await enqueueCloudAgent(deps, agentId);
}

function ownerAnsweredPrompt(agent: Pick<CloudAgent, "id" | "title">, answer: string) {
  return `The owner answered the question on cloud agent ${agent.id} ("${agent.title}") from its card: "${answer}". The answer is already sent to the job. Do not answer it again. Say nothing unless the owner needs to hear something.`;
}

/**
 * The owner's tap on an answer button, or their typed answer. The job's own poll delivers it
 * through the provider, as the bot's reply would, and the bot is woken once to learn the choice.
 */
export async function answerCloudAgentQuestion(
  deps: OwnerActionDeps,
  owner: Owner,
  input: { agentId: string; requestId: string; answer: string },
): Promise<OwnerActionResult> {
  const agent = await ownedAgent(deps, owner, input.agentId);
  const question = openQuestion(agent);
  const stale = new CloudAgentOwnerActionError(
    "stale",
    "That question has already been answered or has closed.",
  );
  // The same answer already accepted: a double tap or a replay, not a second answer.
  if (queuedFollowup(agent)?.prompt === input.answer && agent.ownerAnswer === input.answer)
    return { duplicate: true };
  if (
    !question ||
    question.requestId !== input.requestId ||
    agent.status !== "running" ||
    agent.cancelRequested ||
    agent.followup ||
    !agent.remoteId
  )
    throw stale;
  const wake = await deps.prisma.$transaction(async (tx) => {
    const queued = await queueCloudAgentFollowupInTransaction(
      tx,
      agent,
      { prompt: input.answer },
      true,
    );
    if (!queued.count) return undefined;
    await tx.cloudAgent.update({
      where: { id: agent.id },
      data: { ownerAnswer: input.answer, questionPrompt: null },
    });
    return true;
  });
  if (!wake) {
    // Another tap won the version race: the same answer is a replay, any other is stale.
    const current = await ownedAgent(deps, owner, input.agentId);
    if (current.ownerAnswer === input.answer) return { duplicate: true };
    throw stale;
  }
  await afterQueued(deps, agent.id);
  // The bot keeps its own picture right: one wake per question, whatever the retries.
  const runIds = await deps.prisma.$transaction(
    async (tx) =>
      createCloudAgentWake(
        tx,
        agent,
        ownerAnsweredPrompt(agent, input.answer),
        `cloud-agent-owner-answer:${agent.id}:${input.requestId}`,
      ),
    THREAD_LOCK_TRANSACTION_OPTIONS,
  );
  for (const runId of new Set(runIds)) await wakeRun(deps.jobs, runId);
  return { duplicate: false };
}

/**
 * An instruction to a running job, queued behind its current work. `key` is the sender's own, so
 * a double tap or a retried request reaches the provider once.
 */
export async function steerCloudAgent(
  deps: OwnerActionDeps,
  owner: Owner,
  input: { agentId: string; text: string; key: string },
): Promise<OwnerActionResult> {
  const agent = await ownedAgent(deps, owner, input.agentId);
  const pending = queuedFollowup(agent);
  if (pending?.steerKey === input.key) return { duplicate: true };
  if (agent.status !== "running" || agent.cancelRequested || agent.queuedAt || !agent.remoteId)
    throw new CloudAgentOwnerActionError("ended", "That job is not running any more.");
  if (openQuestion(agent))
    throw new CloudAgentOwnerActionError("busy", "This job is waiting for your answer first.");
  if (agent.followup)
    throw new CloudAgentOwnerActionError(
      "busy",
      "The last instruction is still being delivered. Try again in a moment.",
    );
  const queued = await deps.prisma.$transaction((tx) =>
    queueCloudAgentFollowupInTransaction(
      tx,
      agent,
      { prompt: input.text, steerKey: input.key },
      true,
    ),
  );
  if (!queued.count) {
    const current = await ownedAgent(deps, owner, input.agentId);
    if (queuedFollowup(current)?.steerKey === input.key) return { duplicate: true };
    throw new CloudAgentOwnerActionError("busy", "The job changed. Try again.");
  }
  await afterQueued(deps, agent.id);
  return { duplicate: false };
}

/** Asks the provider to stop the job, as the bot's own cancel does. Stopping an ended job does nothing. */
export async function stopCloudAgent(
  deps: OwnerActionDeps,
  owner: Owner,
  input: { agentId: string },
): Promise<OwnerActionResult> {
  const agent = await ownedAgent(deps, owner, input.agentId);
  if (agent.status !== "running" || agent.cancelRequested) return { duplicate: true };
  await deps.prisma.cloudAgent.update({
    where: { id: agent.id },
    data: { cancelRequested: true, version: { increment: 1 }, nextPollAt: new Date() },
  });
  await enqueueCloudAgent(deps, agent.id);
  return { duplicate: false };
}
