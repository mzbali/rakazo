import { allowedAppLink } from "@rakazo/chat-ui/native";
import { cloudAgentHttpsUrl } from "@rakazo/core";

/** Where a job's two actions go: its thread in T3, and the pull request it opened. */
export function jobLinks(job: { url: string; prUrl?: string; launchFailed?: boolean }) {
  return {
    t3: job.launchFailed ? undefined : (cloudAgentHttpsUrl(job.url) ?? allowedAppLink(job.url)),
    pr: cloudAgentHttpsUrl(job.prUrl),
  };
}
