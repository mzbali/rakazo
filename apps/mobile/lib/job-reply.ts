import type { MessageBlock } from "@rakazo/contracts";

type Job = Extract<MessageBlock, { kind: "cloud_agent" }>;

/** Where a reply to a job's card goes: an answer to its question, or an instruction to the work. */
export type JobReplyTarget =
  | { mode: "answer"; agentId: string; requestId: string }
  | { mode: "steer"; agentId: string };

/**
 * A reply to a card goes to its job while the job can take it: its open question gets the text as
 * the answer, running work gets it as an instruction. A finished job, a card of several jobs and a
 * job waiting on something the owner decides elsewhere leave the reply with the bot.
 */
export function jobReplyTarget(
  message: { blocks: readonly MessageBlock[] } | null | undefined,
): JobReplyTarget | undefined {
  const jobs = (message?.blocks ?? []).filter(
    (block): block is Job => block.kind === "cloud_agent",
  );
  if (jobs.length !== 1) return undefined;
  const job = jobs[0]!;
  if (job.status !== "running" || job.queued || job.launchFailed || job.unreachableSince)
    return undefined;
  if (job.question)
    return { mode: "answer", agentId: job.agentId, requestId: job.question.requestId };
  if (job.needsInput || job.ownerQuestion) return undefined;
  return { mode: "steer", agentId: job.agentId };
}
