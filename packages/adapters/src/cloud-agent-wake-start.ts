import { runContinueJob } from "@rakazo/adapter-kit";
import { isJobHelperRun } from "@rakazo/core";
import type { CloudAgent, Run } from "@rakazo/db";
import {
  appendEventInTransaction,
  cancelRunsInTransaction,
  createPendingSteeringRun,
} from "@rakazo/db";
import { returnHelperOutcome } from "./background-helpers.js";
import { jobHelperTaskPrompt } from "./cloud-agent-job-thread.js";
import type { ExecutorDeps } from "./executor-deps.js";

/** The primary nonce keeps wakes from older workers readable. */
export function cloudAgentWakeNonces(run: Pick<Run, "clientNonce" | "cloudAgentWakeNonces">) {
  return [...new Set([...(run.clientNonce ? [run.clientNonce] : []), ...run.cloudAgentWakeNonces])];
}

export function cloudAgentWakeIsCurrent(
  nonce: string,
  agents: ReadonlyMap<string, Pick<CloudAgent, "generation" | "status" | "verdict" | "attention">>,
) {
  const [kind, agentId, ...parts] = nonce.split(":");
  if (kind !== "cloud-agent-attention" && kind !== "cloud-agent-wake-run") return true;
  const agent = agents.get(agentId!);
  if (!agent) return false;
  if (kind === "cloud-agent-wake-run") {
    return agent.generation === Number(parts[0]) && agent.status !== "running" && !agent.verdict;
  }
  const requestId = parts.join(":").replace(/:r\d+$/, "");
  return (
    Array.isArray(agent.attention) &&
    agent.attention.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        "requestId" in item &&
        item.requestId === requestId,
    )
  );
}

export function attentionWakePrompt(agentId: string, requestId: string) {
  return `Cloud agent ${agentId} needs input (${requestId}). Use cloud_agent_status; answer a question with cloud_agent_reply, or ask the owner to decide an approval where the agent runs.`;
}

export function terminalWakePrompt(agent: Pick<CloudAgent, "id" | "status">) {
  return `Cloud agent ${agent.id} is ${agent.status}. Use cloud_agent_status to inspect its result, then cloud_agent_report your verdict.`;
}

/** Cancel an obsolete first wake before computer setup, history loading or any model call. */
export async function cancelStaleCloudAgentWake(
  deps: Pick<ExecutorDeps, "prisma" | "jobs"> & { events: Pick<ExecutorDeps["events"], "notify"> },
  run: Run,
  lease: { owner: string; fence: number },
): Promise<boolean> {
  // A resumed turn may already have effects to finish; its original trigger no longer gates it.
  const job = isJobHelperRun(run);
  if ((run.trigger !== "cloud_agent" && !job) || run.startedAt) return false;
  const result = await deps.prisma.$transaction(async (tx) => {
    // Match polling/clearing's thread -> run order. This also seals a coalesced prompt against
    // an appender that read the run before the executor claimed it.
    await tx.thread.updateMany({
      where: { id: run.threadId, spaceId: run.spaceId },
      data: { nextEventSeq: { increment: 0 } },
    });
    const locked = await tx.run.updateMany({
      where: { id: run.id, status: "running", leaseOwner: lease.owner, leaseFence: lease.fence },
      data: { leaseFence: { increment: 0 } },
    });
    if (!locked.count) return { stopped: true };
    const current = await tx.run.findUniqueOrThrow({ where: { id: run.id } });
    const nonces = cloudAgentWakeNonces(current);
    // Unknown legacy triggers are left to the existing executor.
    if (!nonces.length) return { stopped: false };
    const agents = await tx.cloudAgent.findMany({
      where: {
        id: { in: nonces.map((nonce) => nonce.split(":")[1]!).filter(Boolean) },
        spaceId: run.spaceId,
        userId: run.userId,
        botId: run.botId,
        // A job helper's wakes belong to the agent whose helper thread it runs in.
        ...(job ? { jobThreadId: run.threadId } : { threadId: run.threadId }),
      },
    });
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const currentNonces = nonces.filter((nonce) => cloudAgentWakeIsCurrent(nonce, byId));
    if (currentNonces.length) {
      // A burst can include an answered question and its terminal result. Remove the obsolete
      // instruction from that batch so the model only receives work that still needs attention.
      const prompts = currentNonces.map((nonce) => {
        const [kind, agentId, ...parts] = nonce.split(":");
        const agent = byId.get(agentId!);
        if (!agent) return undefined;
        if (kind === "cloud-agent-wake-run") return terminalWakePrompt(agent);
        if (kind === "cloud-agent-attention")
          return attentionWakePrompt(agent.id, parts.join(":").replace(/:r\d+$/, ""));
        return undefined;
      });
      if (prompts.every((prompt) => prompt !== undefined)) {
        // A job helper starts from the agent's record as it is now, not as the wake left it.
        const [agent] = agents;
        await tx.task.update({
          where: { id: current.taskId },
          data: {
            prompt:
              job && agent
                ? await jobHelperTaskPrompt(tx, agent, prompts as string[])
                : prompts.join("\n\n"),
          },
        });
      }
      return { stopped: false };
    }
    const [cancelled] = await cancelRunsInTransaction(tx, [current], new Date());
    if (!cancelled) return { stopped: true };
    const event = await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId: run.botId,
      runId: run.id,
      type: "run.cancelled",
      payload: {},
    });
    // A helper thread takes no steering, and its card is settled below.
    const continuationId = job ? undefined : await createPendingSteeringRun(tx, run);
    return { stopped: true, seq: event.seq, continuationId };
  });
  if (result.seq !== undefined)
    await deps.events.notify(run.threadId, result.seq).catch(() => undefined);
  if (result.continuationId) await deps.jobs.enqueue(runContinueJob(result.continuationId));
  if (job && result.stopped && result.seq !== undefined) {
    await returnHelperOutcome(deps, run, { status: "stopped", text: "" }).catch(() => undefined);
  }
  return result.stopped;
}
