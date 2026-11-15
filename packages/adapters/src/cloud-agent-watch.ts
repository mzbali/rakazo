import type { CloudAgentSnapshot } from "@rakazo/adapter-kit";
import type { CloudAgent } from "@rakazo/db";

/** How long a job may only watch its pull request before it is handed back. */
export const WATCH_LIMIT_MS = 24 * 3_600_000;
export const WATCH_LIMIT_RESULT =
  "Stopped waiting: the pull request was still being watched after 24 hours. The watch is still on in T3.";

/** Whether the job has only been watching its pull request for longer than it may. */
export function watchOutlasted(
  snapshot: Pick<CloudAgentSnapshot, "status" | "watching">,
  agent: Pick<CloudAgent, "watchingSince">,
  now = new Date(),
) {
  return (
    snapshot.status === "running" &&
    snapshot.watching === true &&
    agent.watchingSince !== null &&
    now.getTime() - agent.watchingSince.getTime() >= WATCH_LIMIT_MS
  );
}
