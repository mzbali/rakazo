import { createHash } from "node:crypto";
import type { AdapterContext, ArtifactStore, CloudAgentSnapshot } from "@rakazo/adapter-kit";
import { ARTIFACT_NAME_MAX_LENGTH } from "@rakazo/contracts";
import type { CloudAgent, Prisma, PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { ObserverEgress } from "./scoped-goal-observers.js";
import { fetchSafeHttpRequest } from "./web-ssrf.js";

/** Where a finished job's proof comes from, and what is needed to read it. */
export interface CloudAgentProofDeps {
  prisma: Pick<PrismaClient, "cloudAgent" | "artifact">;
  artifacts?: Pick<ArtifactStore, "put" | "remove">;
  /** Test seam for the GitHub reads; the safe egress checks still apply. */
  proofEgress?: ObserverEgress;
}

export type ProofImage = { source: string; artifactId: string; name: string; mimeType: string };
export type ChecksState = "passing" | "failing" | "running";

/** The card shows this many screenshots, so no more are copied. */
export const PROOF_IMAGES_MAX = 3;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const JSON_MAX_BYTES = 512 * 1024;
const GITHUB_TIMEOUT_MS = 5_000;
const IMAGE_TIMEOUT_MS = 10_000;
/** GitHub's unauthenticated limit is shared by the whole server, so a running job reads its checks rarely. */
export const CHECKS_REFRESH_MS = 5 * 60_000;
const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

const PULL_REQUEST_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/;
const IMAGE_URL = /https:\/\/raw\.githubusercontent\.com\/[^\s)"'<>\]]+/g;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i;

export function parseGithubPullRequest(url: string | null | undefined) {
  const match = url ? PULL_REQUEST_URL.exec(url) : null;
  return match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : undefined;
}

/**
 * The screenshots a text cites: only links into the pull request's own repository on its
 * `pr-assets` branch (where `pr-shot` puts them). Any other host, repository or branch is ignored,
 * as is a local file path.
 */
export function trustedImageUrls(text: string, repo: { owner: string; repo: string }): string[] {
  const prefix = `/${repo.owner}/${repo.repo}/pr-assets/`.toLowerCase();
  const urls = new Set<string>();
  for (const found of text.match(IMAGE_URL) ?? []) {
    let url: URL;
    try {
      url = new URL(found.replace(/[.,;]+$/, ""));
    } catch {
      continue;
    }
    if (
      url.hostname === "raw.githubusercontent.com" &&
      url.pathname.toLowerCase().startsWith(prefix) &&
      IMAGE_EXTENSION.test(url.pathname)
    )
      urls.add(`${url.origin}${url.pathname}`);
  }
  return [...urls];
}

/** What the pull request's checks add up to: a failure wins, then anything still going; none means unknown. */
export function checksFromRuns(
  runs: Array<{ status?: unknown; conclusion?: unknown }>,
): ChecksState | undefined {
  if (!runs.length) return undefined;
  if (runs.some((run) => FAILED_CONCLUSIONS.has(String(run.conclusion)))) return "failing";
  if (runs.some((run) => run.status !== "completed")) return "running";
  return "passing";
}

/** The image kind from its first bytes, never from what the server called it. */
export function sniffImageType(bytes: Uint8Array): string | undefined {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return undefined;
}

export function storedProofImages(agent: Pick<CloudAgent, "proofImages">): ProofImage[] {
  return Array.isArray(agent.proofImages) ? (agent.proofImages as ProofImage[]) : [];
}

async function get(
  url: string,
  egress: ObserverEgress | undefined,
  timeoutMs: number,
  maxBytes: number,
) {
  try {
    const response = await fetchSafeHttpRequest(
      url,
      { method: "GET", headers: { accept: "application/vnd.github+json" } },
      { ...egress, timeoutMs, maxBytes },
    );
    return response.status === 200 && !response.truncated ? response.body : undefined;
  } catch {
    // A private repository answers 404 and a blocked or slow host throws: no proof, no harm.
    return undefined;
  }
}

async function getJson(url: string, egress: ObserverEgress | undefined) {
  const body = await get(url, egress, GITHUB_TIMEOUT_MS, JSON_MAX_BYTES);
  if (!body) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Brings the job's proof up to date from its pull request, on the poll that already runs: the
 * check result (read at most every few minutes while the job runs, and once more when it ends)
 * and, once it has finished, the screenshots its pull request and final report cite. It writes
 * the row itself and never throws, so a GitHub outage or a private repository cannot hold up the job.
 */
export async function refreshCloudAgentProof(
  deps: CloudAgentProofDeps,
  agent: CloudAgent,
  snapshot: Pick<CloudAgentSnapshot, "status" | "prUrl" | "result">,
  context: AdapterContext,
  now = new Date(),
) {
  try {
    const pr = parseGithubPullRequest(snapshot.prUrl ?? agent.prUrl);
    if (!pr) return;
    const finished = snapshot.status === "finished";
    const known = storedProofImages(agent);
    const wantsImages = finished && known.length < PROOF_IMAGES_MAX;
    const ended = snapshot.status !== "running" && agent.status === "running";
    const wantsChecks =
      ended ||
      !agent.checksAt ||
      (snapshot.status === "running" &&
        now.getTime() - agent.checksAt.getTime() >= CHECKS_REFRESH_MS);
    if (!wantsImages && !wantsChecks) return;
    const base = `https://api.github.com/repos/${pr.owner}/${pr.repo}`;
    const egress = deps.proofEgress;
    const pull = (await getJson(`${base}/pulls/${pr.number}`, egress)) as
      | {
          body?: unknown;
          head?: { sha?: unknown };
        }
      | undefined;
    const data: Prisma.CloudAgentUpdateInput = {};
    if (wantsChecks) {
      const sha = typeof pull?.head?.sha === "string" ? pull.head.sha : "";
      const checks = /^[0-9a-f]{40}$/i.test(sha)
        ? ((await getJson(`${base}/commits/${sha}/check-runs?per_page=100`, egress)) as
            | {
                check_runs?: Array<{ status?: unknown; conclusion?: unknown }>;
              }
            | undefined)
        : undefined;
      // A failed read keeps what the card showed; only a read that finds no checks clears it.
      if (checks) data.checksState = checksFromRuns(checks.check_runs ?? []) ?? null;
      data.checksAt = now;
    }
    if (wantsImages && pull) {
      const comments = (await getJson(
        `${base}/issues/${pr.number}/comments?per_page=100`,
        egress,
      )) as Array<{ body?: unknown }> | undefined;
      const text = [
        snapshot.result,
        typeof pull.body === "string" ? pull.body : "",
        ...(Array.isArray(comments)
          ? comments.map((c) => (typeof c.body === "string" ? c.body : ""))
          : []),
      ].join("\n");
      const added = await copyImages(
        deps,
        agent,
        pr,
        trustedImageUrls(text, pr).filter((url) => !known.some((image) => image.source === url)),
        PROOF_IMAGES_MAX - known.length,
        egress,
        context,
      );
      if (added.length) data.proofImages = [...known, ...added] as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length)
      await deps.prisma.cloudAgent.update({ where: { id: agent.id }, data });
  } catch (error) {
    getLogger().warn("cloud_agent.proof_unavailable", { error });
  }
}

/** Downloads each image once and keeps it in the app's own storage, on the bot's files. */
async function copyImages(
  deps: CloudAgentProofDeps,
  agent: CloudAgent,
  pr: { repo: string; number: number },
  urls: string[],
  room: number,
  egress: ObserverEgress | undefined,
  context: AdapterContext,
): Promise<ProofImage[]> {
  const { repo, number } = pr;
  const added: ProofImage[] = [];
  if (!deps.artifacts) return added;
  for (const source of urls) {
    if (added.length >= room) break;
    const bytes = await get(source, egress, IMAGE_TIMEOUT_MS, IMAGE_MAX_BYTES);
    const mimeType = bytes && sniffImageType(bytes);
    if (!bytes || !mimeType) continue;
    // A file's name is unique among a bot's files, and screenshots reuse names across pull requests.
    const name = `${repo}-pr-${number}-${source.split("/").pop() || "screenshot"}`.slice(
      0,
      ARTIFACT_NAME_MAX_LENGTH,
    );
    const stored = await deps.artifacts.put({ name, mimeType, bytes }, context);
    const row = await deps.prisma.artifact
      .create({
        data: {
          spaceId: agent.spaceId,
          userId: agent.userId,
          botId: agent.botId,
          name,
          mimeType,
          size: bytes.byteLength,
          hash: createHash("sha256").update(bytes).digest("hex"),
          storageKey: stored.id,
        },
      })
      .catch(async (error: unknown) => {
        await deps.artifacts?.remove(stored.id, context).catch(() => undefined);
        throw error;
      });
    added.push({ source, artifactId: row.id, name, mimeType });
  }
  return added;
}
