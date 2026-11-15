import type { CloudAgentPullRequest } from "@rakazo/adapter-kit";
import { z } from "zod";

const pullRequestsSchema = z.object({
  thread: z.object({
    pullRequests: z
      .array(
        z.object({
          url: z.string(),
          number: z.number(),
          repository: z.string(),
          state: z.string(),
          mergeCommitSha: z.string().nullish(),
          watching: z.boolean().optional(),
        }),
      )
      .default([]),
  }),
});

export type ThreadPullRequest = CloudAgentPullRequest & { watching: boolean };

/** The pull requests a `t3_thread_read` lists on the thread. */
export function parsePullRequests(read: unknown): ThreadPullRequest[] {
  return pullRequestsSchema
    .parse(read)
    .thread.pullRequests.map(({ mergeCommitSha, state, watching, ...pr }) => ({
      ...pr,
      state: state === "merged" || state === "closed" ? state : "open",
      watching: watching === true,
      ...(mergeCommitSha ? { mergeCommitSha } : {}),
    }));
}

/** The pull request the card shows: the one being watched, else the newest the thread has. */
export function shownPullRequest(all: ThreadPullRequest[]) {
  const shown = all.findLast((pr) => pr.watching && pr.state === "open") ?? all.at(-1);
  return shown
    ? { prUrl: shown.url, prState: shown.state, watching: shown.watching && shown.state === "open" }
    : {};
}
