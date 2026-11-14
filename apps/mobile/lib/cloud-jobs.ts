import { useSyncExternalStore } from "react";
import { cloudJobsSnapshot, refreshCloudJobs, subscribeCloudJobs } from "./cloud-jobs-store";
import { useForegroundPoll } from "./foreground-poll";

/** The jobs, kept fresh while the calling screen is in front and the app is open. */
export function useCloudJobs(intervalMs: number, enabled = true) {
  useForegroundPoll(refreshCloudJobs, intervalMs, enabled);
  return useSyncExternalStore(subscribeCloudJobs, cloudJobsSnapshot, cloudJobsSnapshot);
}
