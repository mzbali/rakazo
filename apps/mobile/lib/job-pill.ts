import type { CloudAgentJob } from "@rakazo/contracts";
import { jobBaseShelf } from "./job-shelves";

export type JobPill =
  | { kind: "needsYou"; job: CloudAgentJob }
  | { kind: "working"; count: number; job: CloudAgentJob };

type Chat = { botId?: string; groupId?: string };

/**
 * The chat's jobs that are going or waiting on the owner, those that need them first and then
 * oldest first. A job still being checked counts as going: its card says "Checking", not "Done".
 */
export function activeChatJobs(jobs: readonly CloudAgentJob[] | null, chat: Chat): CloudAgentJob[] {
  const started = (job: CloudAgentJob) => Date.parse(job.startedAt ?? "") || 0;
  return (jobs ?? [])
    .filter((job) =>
      chat.groupId ? job.groupId === chat.groupId : !job.groupId && job.botId === chat.botId,
    )
    .filter((job) => jobBaseShelf(job) !== "done")
    .sort(
      (a, b) =>
        Number(jobBaseShelf(b) === "needsYou") - Number(jobBaseShelf(a) === "needsYou") ||
        started(a) - started(b),
    );
}

/**
 * What the chat's pill says about its jobs: "Needs you" while one waits on the owner, else how
 * many are working, with the one that started first for its clock. Nothing once all are over.
 */
export function jobPill(jobs: readonly CloudAgentJob[] | null, chat: Chat): JobPill | null {
  const active = activeChatJobs(jobs, chat);
  const waiting = active.find((job) => jobBaseShelf(job) === "needsYou");
  if (waiting) return { kind: "needsYou", job: waiting };
  return active[0] ? { kind: "working", count: active.length, job: active[0] } : null;
}
