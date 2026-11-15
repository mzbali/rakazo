import type {
  CloudAgentPullRequest,
  CloudAgentThreadPullRequest,
  CloudAgentWork,
} from "@rakazo/adapter-kit";
import { z } from "zod";

const threadWorkSchema = z.object({
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
    pendingBackgroundTasks: z
      .array(
        z.object({
          taskId: z.string(),
          kind: z.string(),
          description: z.string().nullish(),
          childThreadId: z.string().nullish(),
        }),
      )
      .default([]),
  }),
});

export type ThreadPullRequest = CloudAgentPullRequest & { watching: boolean };

const WORK_KINDS = new Set(["subagent", "command", "monitor"]);
const WORK_LABEL_MAX = 120;

/**
 * What a `t3_thread_read` lists on the thread: its pull requests, and its background work. A
 * watched pull request is also a task there, but it is listed once, as a pull request. A child
 * thread's link is made by `childLink`.
 */
export function parseThreadWork(read: unknown, childLink: (threadId: string) => string) {
  const { thread } = threadWorkSchema.parse(read);
  const pullRequests: ThreadPullRequest[] = thread.pullRequests.map(
    ({ mergeCommitSha, state, watching, ...pr }) => ({
      ...pr,
      state: state === "merged" || state === "closed" ? state : "open",
      watching: watching === true,
      ...(mergeCommitSha ? { mergeCommitSha } : {}),
    }),
  );
  const work: CloudAgentWork[] = thread.pendingBackgroundTasks
    .filter((task) => !task.taskId.startsWith("pull-request-watch:"))
    .map((task) => {
      const url =
        task.kind === "subagent" && task.childThreadId ? childLink(task.childThreadId) : "";
      return {
        kind: WORK_KINDS.has(task.kind) ? (task.kind as CloudAgentWork["kind"]) : "background_task",
        label: (task.description?.trim().split("\n")[0] ?? "").slice(0, WORK_LABEL_MAX),
        ...(url ? { url } : {}),
      };
    });
  return { pullRequests, work };
}

/** Run statuses after which nothing is working on the thread. */
const ENDED_RUNS = new Set(["completed", "failed", "cancelled", "interrupted", "rolled_back"]);

/**
 * The pull request the card shows: the one being watched, else the newest the thread has. A watch
 * is idle when its run has ended and the thread awaits nothing but pull request watches, so
 * only the watch keeps the job open; a subagent or command still running is work, not waiting.
 */
export function shownPullRequest(
  { pullRequests, work }: ReturnType<typeof parseThreadWork>,
  run: { status: string } | null,
) {
  const listed: CloudAgentThreadPullRequest[] = pullRequests.map(
    ({ url, number, state, watching }) => ({ url, number, state, watching }),
  );
  const shown =
    pullRequests.findLast((pr) => pr.watching && pr.state === "open") ?? pullRequests.at(-1);
  if (!shown) return { work, pullRequests: listed };
  const watching = shown.watching && shown.state === "open";
  return {
    prUrl: shown.url,
    prState: shown.state,
    watching,
    watchIdle: watching && !work.length && run !== null && ENDED_RUNS.has(run.status),
    work,
    pullRequests: listed,
  };
}
