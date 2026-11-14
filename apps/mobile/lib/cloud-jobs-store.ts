import type { CloudAgentJob } from "@rakazo/contracts";
import { cloudAgentShelf, cloudAgentState } from "@rakazo/core";
import { rpc } from "./api";

type Snapshot = { jobs: CloudAgentJob[] | null; error: unknown };

let snapshot: Snapshot = { jobs: null, error: null };
let inFlight: Promise<void> | null = null;
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

/** One load at a time, shared by the home header's count and the Jobs screen. */
export function refreshCloudJobs(): Promise<void> {
  inFlight ??= rpc("cloudAgents/list", undefined)
    .then((jobs) => publish({ jobs, error: null }))
    .catch((error: unknown) => publish({ jobs: snapshot.jobs, error }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Forget the jobs when the account changes, so another account never sees them. */
export function resetCloudJobs() {
  publish({ jobs: null, error: null });
}

export function needsYouCount(jobs: CloudAgentJob[] | null): number {
  return (jobs ?? []).filter((job) => cloudAgentShelf(cloudAgentState(job)) === "needsYou").length;
}
