import type { CloudAgentJob } from "@rakazo/contracts";

/** The conversation that launched the job, including jobs launched by a bot in a group. */
export function jobChatTarget(job: CloudAgentJob) {
  return job.groupId
    ? { groupId: job.groupId, name: job.groupName ?? job.botName }
    : { botId: job.botId, name: job.botName };
}
