import type { CloudAgentJob, RunActivityRow } from "@rakazo/contracts";
import { cloudAgentShelf, cloudAgentState } from "@rakazo/core";

const JOB_RUN_PREFIX = "job:";

/**
 * The jobs still going or waiting on the owner as activity rows, so home files a bot under
 * Needs attention or Working by its T3 job as well as by its own turn. The line is the job's
 * question while it waits and its title while it works.
 */
export function jobActivityRuns(jobs: readonly CloudAgentJob[] | null): RunActivityRow[] {
  return (jobs ?? []).flatMap((job) => {
    const state = cloudAgentState(job);
    const shelf = cloudAgentShelf(state);
    if (shelf === "done") return [];
    return [
      {
        runId: `${JOB_RUN_PREFIX}${job.agentId}`,
        botId: job.botId,
        botName: job.botName,
        groupId: job.groupId ?? null,
        groupName: job.groupName ?? null,
        threadId: job.threadId,
        status: shelf === "needsYou" ? "waiting_input" : state === "queued" ? "queued" : "running",
        trigger: "cloud_agent",
        notificationsEnabled: false,
        promptSnippet:
          shelf === "needsYou" ? (job.ownerQuestion ?? job.question?.text ?? job.title) : job.title,
        agentMessage: null,
        updatedAt: job.startedAt ?? new Date(0).toISOString(),
      } satisfies RunActivityRow,
    ];
  });
}

/** The job behind an activity row from `jobActivityRuns`, if it is one. */
export function jobForRun(
  runId: string,
  jobs: readonly CloudAgentJob[] | null,
): CloudAgentJob | undefined {
  if (!runId.startsWith(JOB_RUN_PREFIX)) return undefined;
  return jobs?.find((job) => job.agentId === runId.slice(JOB_RUN_PREFIX.length));
}
