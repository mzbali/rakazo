import type { CloudAgentJob } from "@rakazo/contracts";
import { cloudAgentShelf, cloudAgentState } from "@rakazo/core";

export type JobShelf = "needsYou" | "working" | "today" | "earlier";

export type JobListItem =
  | { kind: "header"; shelf: JobShelf; count: number }
  | { kind: "job"; job: CloudAgentJob };

const ORDER: JobShelf[] = ["needsYou", "working", "today", "earlier"];

function endedAt(job: CloudAgentJob): number {
  const time = Date.parse(job.endedAt ?? job.startedAt ?? "");
  return Number.isNaN(time) ? 0 : time;
}

/** Finished jobs split by the day they ended; the rest sit by what they wait on. */
export function jobShelf(job: CloudAgentJob, now: number): JobShelf {
  const shelf = cloudAgentShelf(cloudAgentState(job));
  if (shelf !== "done") return shelf;
  return new Date(endedAt(job)).toDateString() === new Date(now).toDateString()
    ? "today"
    : "earlier";
}

/** The jobs as one flat list of shelf headers and rows; finished shelves run newest end first. */
export function jobListItems(jobs: CloudAgentJob[], now = Date.now()): JobListItem[] {
  const shelves = new Map<JobShelf, CloudAgentJob[]>(ORDER.map((shelf) => [shelf, []]));
  for (const job of jobs) shelves.get(jobShelf(job, now))!.push(job);
  const items: JobListItem[] = [];
  for (const shelf of ORDER) {
    const inShelf = shelves.get(shelf)!;
    if (inShelf.length === 0) continue;
    if (shelf === "today" || shelf === "earlier") inShelf.sort((a, b) => endedAt(b) - endedAt(a));
    items.push({ kind: "header", shelf, count: inShelf.length });
    for (const job of inShelf) items.push({ kind: "job", job });
  }
  return items;
}

/** Whether a job is over, so the owner can clear it from the list. */
export function jobIsClearable(job: CloudAgentJob): boolean {
  const shelf = cloudAgentShelf(cloudAgentState(job));
  return shelf === "done";
}
