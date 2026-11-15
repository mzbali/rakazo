import { useSyncExternalStore } from "react";
import { cloudJobsSnapshot, refreshCloudJobs, subscribeCloudJobs } from "./cloud-jobs-store";
import { useRosterSignals } from "./roster-signals";

/** The jobs, re-read when the server's live stream says a chat changed, not on a timer. */
export function useCloudJobs(enabled = true) {
  useRosterSignals(refreshCloudJobs, enabled);
  return useSyncExternalStore(subscribeCloudJobs, cloudJobsSnapshot, cloudJobsSnapshot);
}
