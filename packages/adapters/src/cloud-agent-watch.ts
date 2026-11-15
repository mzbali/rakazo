import type { CloudAgentSnapshot } from "@rakazo/adapter-kit";
import type { CloudAgent } from "@rakazo/db";

/** How long a job may only watch its pull request before it is handed back. */
export const WATCH_LIMIT_MS = 24 * 3_600_000;

/** Whether the job has only been waiting on its watched pull request for longer than it may. */
export function watchOutlasted(
  snapshot: Pick<CloudAgentSnapshot, "status" | "watchIdle">,
  agent: Pick<CloudAgent, "watchingSince">,
  now = new Date(),
) {
  return (
    snapshot.status === "running" &&
    snapshot.watchIdle === true &&
    agent.watchingSince !== null &&
    now.getTime() - agent.watchingSince.getTime() >= WATCH_LIMIT_MS
  );
}
