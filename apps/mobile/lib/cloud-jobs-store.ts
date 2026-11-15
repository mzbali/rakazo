import type { CloudAgentJob } from "@rakazo/contracts";
import { cloudAgentShelf, cloudAgentState, createRefreshCoalescer } from "@rakazo/core";
import { rpc } from "./api";

type Snapshot = { jobs: CloudAgentJob[] | null; error: unknown };

let snapshot: Snapshot = { jobs: null, error: null };
let contextGeneration = 0;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function cloudJobsSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeCloudJobs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readCloudJobs() {
  const generation = contextGeneration;
  try {
    const jobs = await rpc("cloudAgents/list", undefined);
    if (generation === contextGeneration) publish({ jobs, error: null });
  } catch (error) {
    if (generation === contextGeneration) publish({ jobs: snapshot.jobs, error });
  }
}

// A signal that lands while a read is out gets one more read when it ends.
let refresher = createRefreshCoalescer(readCloudJobs);

/** One load at a time, shared by the home header's count and the Jobs screen. */
export function refreshCloudJobs(): Promise<void> {
  return refresher.invalidate();
}

/** Forget the jobs when the account changes, so another account never sees them. */
export function resetCloudJobs() {
  contextGeneration += 1;
  refresher.dispose();
  refresher = createRefreshCoalescer(readCloudJobs);
  publish({ jobs: null, error: null });
}

export function needsYouCount(jobs: CloudAgentJob[] | null): number {
  return (jobs ?? []).filter((job) => cloudAgentShelf(cloudAgentState(job)) === "needsYou").length;
}

/**
 * Takes a finished job off the list now and tells the server; if the server refuses, the list is
 * read again so the job comes back. The chat keeps its card either way.
 */
export async function clearCloudJob(agentId: string): Promise<void> {
  const before = snapshot;
  if (before.jobs)
    publish({ jobs: before.jobs.filter((job) => job.agentId !== agentId), error: null });
  try {
    await rpc("cloudAgents/clear", { agentId });
  } catch (error) {
    void refreshCloudJobs();
    throw error;
  }
}
