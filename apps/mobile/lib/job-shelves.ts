import type { CloudAgentJob } from "@rakazo/contracts";
import type { CloudAgentShelf } from "@rakazo/core";
import { cloudAgentShelf, cloudAgentState } from "@rakazo/core";

/** How many finished jobs show before the rest fold behind "show more". */
export const DONE_SHOWN = 5;

export type JobListItem =
  | { kind: "header"; shelf: CloudAgentShelf; count: number }
  | { kind: "job"; job: CloudAgentJob }
  | { kind: "more"; count: number };

const ORDER: CloudAgentShelf[] = ["needsYou", "working", "done"];

/** The jobs as one flat list of shelf headers and rows, each shelf newest first as given. */
export function jobListItems(jobs: CloudAgentJob[], doneExpanded: boolean): JobListItem[] {
  const shelves = new Map<CloudAgentShelf, CloudAgentJob[]>(ORDER.map((shelf) => [shelf, []]));
  for (const job of jobs) shelves.get(cloudAgentShelf(cloudAgentState(job)))!.push(job);
  const items: JobListItem[] = [];
  for (const shelf of ORDER) {
    const inShelf = shelves.get(shelf)!;
    if (inShelf.length === 0) continue;
    items.push({ kind: "header", shelf, count: inShelf.length });
    const shown = shelf === "done" && !doneExpanded ? inShelf.slice(0, DONE_SHOWN) : inShelf;
    for (const job of shown) items.push({ kind: "job", job });
    if (shown.length < inShelf.length)
      items.push({ kind: "more", count: inShelf.length - shown.length });
  }
  return items;
}
