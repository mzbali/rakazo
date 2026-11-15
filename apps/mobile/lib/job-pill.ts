import type { CloudAgentJob } from "@rakazo/contracts";
import { jobBaseShelf } from "./job-shelves";

export type JobPill =
  | { kind: "needsYou"; job: CloudAgentJob }
  | { kind: "working"; count: number; job: CloudAgentJob };

/**
 * What the chat's pill says about its jobs: "Needs you" while one waits on the owner, else how
 * many are working, with the one that started first as the job to open. Nothing once all are over.
 */
export function jobPill(
  jobs: readonly CloudAgentJob[] | null,
  chat: { botId?: string; groupId?: string },
): JobPill | null {
  const inChat = (jobs ?? []).filter((job) =>
    chat.groupId ? job.groupId === chat.groupId : !job.groupId && job.botId === chat.botId,
  );
  const shelf = jobBaseShelf;
  const waiting = inChat.find((job) => shelf(job) === "needsYou");
  if (waiting) return { kind: "needsYou", job: waiting };
  const working = inChat.filter((job) => shelf(job) === "working");
  const first = working.reduce<CloudAgentJob | undefined>(
    (oldest, job) =>
      !oldest || Date.parse(job.startedAt ?? "") < Date.parse(oldest.startedAt ?? "")
        ? job
        : oldest,
    undefined,
  );
  return first ? { kind: "working", count: working.length, job: first } : null;
}
