import { useSyncExternalStore } from "react";
import { useRosterSignals } from "./api/roster-signals";
import { cloudJobsSnapshot, refreshCloudJobs, subscribeCloudJobs } from "./cloud-jobs-store";

/** The jobs, re-read when the server's live stream says a chat changed, not on a timer. */
export function useCloudJobs(enabled = true) {
  useRosterSignals(refreshCloudJobs, enabled);
  return useSyncExternalStore(subscribeCloudJobs, cloudJobsSnapshot, cloudJobsSnapshot);
}
