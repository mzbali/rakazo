import type { AdapterContext, CloudAgentProvider } from "@rakazo/adapter-kit";
import type { ScopedGoalScope } from "@rakazo/contracts";
import { z } from "zod";
import type { SafeWebFetchOptions } from "./web-ssrf.js";
import { fetchSafeHttpRequest } from "./web-ssrf.js";

type Requirement = ScopedGoalScope["requirements"][number];
export type ObservedResult = Record<string, unknown>;
export type ObserverEgress = Pick<SafeWebFetchOptions, "fetch" | "resolveHostname" | "timeoutMs">;

/** Observations the reconciler runs itself; any other tool still needs the bot to report it. */
export const PULL_REQUEST_OBSERVER = "agent_pull_request";
export const HTTP_OBSERVER = "http_check";
export const isCodeObserver = (tool: string) =>
  tool === PULL_REQUEST_OBSERVER || tool === HTTP_OBSERVER;

export interface ObserverEnv {
  scope: ScopedGoalScope;
  provider?: CloudAgentProvider;
  remoteId: string;
  context: AdapterContext;
  egress?: ObserverEgress;
}

const MAX_BODY_BYTES = 256 * 1024;
const GITHUB_TIMEOUT_MS = 5_000;
const HTTP_TIMEOUT_MS = 10_000;
const pullRequestRequest = z.object({ pullRequest: z.url().optional() }).strict();
const httpRequest = z
  .object({
    url: z.url(),
    jsonPath: z.array(z.string().max(200)).max(20).optional(),
    revisionPath: z.array(z.string().max(200)).max(20).optional(),
  })
  .strict();

/** Never throws: a failed observation is a result that satisfies nothing. */
export async function observe(requirement: Requirement, env: ObserverEnv): Promise<ObservedResult> {
  try {
    return requirement.tool === PULL_REQUEST_OBSERVER
      ? await observePullRequest(requirement.request, env)
      : await observeHttp(requirement.request, env);
  } catch (error) {
    return { error: error instanceof Error ? error.message.slice(0, 500) : "Observation failed" };
  }
}

async function observePullRequest(request: unknown, env: ObserverEnv): Promise<ObservedResult> {
  const { pullRequest } = pullRequestRequest.parse(request);
  const { scope, provider } = env;
  if (pullRequest && !scope.pullRequests.includes(pullRequest))
    return { error: "Pull request is not in the approved scope" };
  if (!provider?.pullRequests)
    return { error: "The agent's provider does not report pull requests" };
  const listed = await provider.pullRequests(env.remoteId, env.context);
  const candidates = listed.filter((pr) =>
    pullRequest
      ? pr.url === pullRequest
      : !scope.pullRequests.length || scope.pullRequests.includes(pr.url),
  );
  const [pr] = candidates;
  if (candidates.length !== 1 || !pr) return { found: false, count: candidates.length };
  const sha =
    pr.state === "merged" ? (pr.mergeCommitSha ?? (await githubMergeSha(pr.url, env))) : undefined;
  return {
    found: true,
    url: pr.url,
    number: pr.number,
    repository: pr.repository,
    state: pr.state,
    merged: pr.state === "merged",
    ...(sha ? { mergeCommitSha: sha } : {}),
  };
}

/** One unauthenticated read, for public repositories; any failure just means no SHA. */
async function githubMergeSha(url: string, env: ObserverEnv): Promise<string | undefined> {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(url);
  if (!match) return undefined;
  try {
    const response = await fetchSafeHttpRequest(
      `https://api.github.com/repos/${match[1]}/${match[2]}/pulls/${match[3]}`,
      { method: "GET", headers: { accept: "application/vnd.github+json" } },
      { ...env.egress, timeoutMs: GITHUB_TIMEOUT_MS, maxBytes: MAX_BODY_BYTES },
    );
    if (response.status !== 200) return undefined;
    const body = JSON.parse(new TextDecoder().decode(response.body)) as {
      merged?: unknown;
      merge_commit_sha?: unknown;
    };
    return body.merged === true &&
      typeof body.merge_commit_sha === "string" &&
      /^[0-9a-f]{40}$/i.test(body.merge_commit_sha)
      ? body.merge_commit_sha.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

/** The approved requirements are the allowlist; private and internal hosts are refused as web fetches are. */
async function observeHttp(request: unknown, env: ObserverEnv): Promise<ObservedResult> {
  const input = httpRequest.parse(request);
  const approved = env.scope.requirements.some(
    (r) => r.tool === HTTP_OBSERVER && r.request.url === input.url,
  );
  if (!approved) return { error: "URL is not in the approved scope" };
  const response = await fetchSafeHttpRequest(
    input.url,
    { method: "GET", headers: { accept: "application/json" } },
    {
      ...env.egress,
      timeoutMs: env.egress?.timeoutMs ?? HTTP_TIMEOUT_MS,
      maxBytes: MAX_BODY_BYTES,
    },
  );
  let json: unknown;
  if (input.jsonPath || input.revisionPath) {
    try {
      json = JSON.parse(new TextDecoder().decode(response.body));
    } catch {
      json = undefined;
    }
  }
  const value = input.jsonPath ? primitiveAt(json, input.jsonPath) : undefined;
  const revision = input.revisionPath ? primitiveAt(json, input.revisionPath) : undefined;
  return {
    url: response.url,
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    ...(value !== undefined ? { value } : {}),
    ...(revision !== undefined ? { revision: String(revision) } : {}),
  };
}

function primitiveAt(json: unknown, path: readonly string[]) {
  let value = json;
  for (const key of path) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return ["string", "number", "boolean"].includes(typeof value)
    ? (value as string | number | boolean)
    : undefined;
}
