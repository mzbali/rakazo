import type { AdapterContext } from "@rakazo/adapter-kit";
import type { CloudAgent } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { USER_CLOUD_AGENT_KEY_PREFIX } from "./cloud-agent-factory.js";
import {
  CHECKS_REFRESH_WITH_TOKEN_MS,
  checksFromRuns,
  parseGithubPullRequest,
  refreshCloudAgentProof,
  storedProofImages,
  trustedImageUrls,
} from "./cloud-agent-proof.js";

const PR = "https://github.com/acme/app/pull/7";
const repo = { owner: "acme", repo: "app" };
const asset = (name: string) =>
  `https://raw.githubusercontent.com/acme/app/pr-assets/pr-7/abc123/${name}.png`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};

function setup(routes: Record<string, () => Response>, initial: Partial<CloudAgent> = {}) {
  const requested: string[] = [];
  const stored: string[] = [];
  const row = {
    id: "agent",
    spaceId: "space",
    userId: "user",
    botId: "bot",
    status: "running",
    prUrl: PR,
    providerKey: "deployment",
    proofImages: null,
    checksState: null,
    checksAt: null,
    ...initial,
  } as unknown as CloudAgent;
  const prisma = {
    cloudAgent: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        return row;
      },
    },
    artifact: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: `artifact-${stored.length}`,
        ...data,
      }),
    },
  };
  const deps = {
    prisma: prisma as never,
    artifacts: {
      put: async (artifact: { name: string }) => {
        stored.push(artifact.name);
        return { id: `key-${stored.length}`, hash: "h" };
      },
      remove: async () => undefined,
    },
    proofEgress: {
      resolveHostname: async () => [{ address: "203.0.113.10", family: 4 as const }],
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(url);
        const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
        return route ? route[1]() : new Response("not found", { status: 404 });
      }) as typeof fetch,
    },
  };
  return { row, deps, requested, stored };
}

const json = (value: unknown) => () => Response.json(value);
const api = "https://api.github.com/repos/acme/app";
const github = (checkRuns: unknown[] = [{ status: "completed", conclusion: "success" }]) => ({
  [`${api}/pulls/7`]: json({ body: `Shots ![a](${asset("home")})`, head: { sha: "a".repeat(40) } }),
  [`${api}/issues/7/comments`]: json([{ body: `![b](${asset("detail")})` }]),
  [`${api}/commits/`]: json({ check_runs: checkRuns }),
  "https://raw.githubusercontent.com/": () => new Response(PNG),
});

describe("which images are trusted", () => {
  it("takes only the pull request's own pr-assets links", () => {
    const text = [
      `![ok](${asset("home")})`,
      `https://raw.githubusercontent.com/acme/app/main/logo.png`,
      `https://raw.githubusercontent.com/other/app/pr-assets/pr-7/x/home.png`,
      `https://evil.example/acme/app/pr-assets/pr-7/x/home.png`,
      `https://raw.githubusercontent.com/acme/app/pr-assets/pr-7/x/notes.txt`,
      "/Users/me/Desktop/shot.png",
    ].join("\n");
    expect(trustedImageUrls(text, repo)).toEqual([asset("home")]);
  });

  it("reads a GitHub pull request link and nothing else", () => {
    expect(parseGithubPullRequest(PR)).toEqual({ ...repo, number: 7 });
    expect(parseGithubPullRequest("https://git.example/acme/app/pull/7")).toBeUndefined();
  });
});

describe("what the checks add up to", () => {
  it("maps passing, failing, running and unknown", () => {
    expect(checksFromRuns([{ status: "completed", conclusion: "success" }])).toBe("passing");
    expect(
      checksFromRuns([
        { status: "completed", conclusion: "skipped" },
        { status: "completed", conclusion: "failure" },
        { status: "in_progress" },
      ]),
    ).toBe("failing");
    expect(
      checksFromRuns([{ status: "completed", conclusion: "success" }, { status: "queued" }]),
    ).toBe("running");
    expect(checksFromRuns([])).toBeUndefined();
  });
});

describe("a finished job's proof", () => {
  it("copies the screenshots once and reads the checks", async () => {
    const { row, deps, requested, stored } = setup(github());
    const snapshot = { status: "finished" as const, prUrl: PR, result: `Done: ${asset("report")}` };
    await refreshCloudAgentProof(deps, row, snapshot, context);
    expect(stored).toHaveLength(3);
    expect(storedProofImages(row).map((image) => image.source)).toEqual([
      asset("report"),
      asset("home"),
      asset("detail"),
    ]);
    expect(row.checksState).toBe("passing");

    // The same poll again (a replay) fetches no image and adds none.
    const before = requested.length;
    await refreshCloudAgentProof(deps, row, snapshot, context);
    expect(stored).toHaveLength(3);
    expect(requested.slice(before).filter((url) => url.includes("raw.githubusercontent"))).toEqual(
      [],
    );
  });

  it("ignores an image on a host it does not trust", async () => {
    const { row, deps, requested } = setup({
      ...github(),
      [`${api}/pulls/7`]: json({
        body: "![x](https://evil.example/acme/app/pr-assets/pr-7/x/home.png)",
        head: { sha: "a".repeat(40) },
      }),
      [`${api}/issues/7/comments`]: json([]),
    });
    await refreshCloudAgentProof(deps, row, { status: "finished", prUrl: PR }, context);
    expect(storedProofImages(row)).toEqual([]);
    expect(requested.some((url) => url.includes("evil.example"))).toBe(false);
  });

  it("skips a private repository cleanly", async () => {
    const { row, deps } = setup({});
    await refreshCloudAgentProof(deps, row, { status: "finished", prUrl: PR }, context);
    expect(storedProofImages(row)).toEqual([]);
    expect(row.checksState).toBeNull();
  });

  it("reads the checks of a running job at most every few minutes", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const { row, deps, requested } = setup(github([{ status: "in_progress" }]));
    const snapshot = { status: "running" as const, prUrl: PR };
    await refreshCloudAgentProof(deps, row, snapshot, context, now);
    expect(row.checksState).toBe("running");
    const reads = requested.length;
    await refreshCloudAgentProof(deps, row, snapshot, context, new Date(now.getTime() + 60_000));
    expect(requested).toHaveLength(reads);
    await refreshCloudAgentProof(
      deps,
      row,
      snapshot,
      context,
      new Date(now.getTime() + 6 * 60_000),
    );
    expect(requested.length).toBeGreaterThan(reads);
  });
});

describe("a private repository's proof", () => {
  const blob = (name: string) =>
    `https://github.com/acme/app/blob/pr-assets/pr-7/abc123/${name}.png?raw=true`;
  const contents = "https://api.github.com/repos/acme/app/contents/";

  /** Records the authorization header of every request, by host. */
  function withAuth(routes: Record<string, () => Response>, initial: Partial<CloudAgent> = {}) {
    const made = setup(routes, initial);
    const auth: Array<{ host: string; authorization: string | null }> = [];
    const inner = made.deps.proofEgress.fetch;
    made.deps.proofEgress.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      auth.push({
        host: new URL(String(input)).hostname,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return inner(input, init);
    }) as typeof fetch;
    return { ...made, auth };
  }

  const privateRoutes = () => ({
    ...github(),
    [`${api}/pulls/7`]: json({
      body: `![a](${blob("home")}) ![b](${asset("public")})`,
      head: { sha: "a".repeat(40) },
    }),
    [`${api}/issues/7/comments`]: json([]),
    [contents]: () => new Response(PNG),
  });

  it("sends the token to api.github.com only, and reads blob links through the contents API", async () => {
    const { row, deps, auth, requested } = withAuth(privateRoutes());
    await refreshCloudAgentProof(
      { ...deps, githubToken: "secret-token" },
      row,
      { status: "finished", prUrl: PR },
      context,
    );
    expect(storedProofImages(row).map((image) => image.source)).toEqual([
      blob("home").replace("?raw=true", ""),
      asset("public"),
    ]);
    expect(requested).toContain(`${contents}pr-7/abc123/home.png?ref=pr-assets`);
    expect(auth.length).toBeGreaterThan(3);
    for (const { host, authorization } of auth)
      expect(authorization).toBe(host === "api.github.com" ? "Bearer secret-token" : null);
    expect(auth.some((call) => call.host === "raw.githubusercontent.com")).toBe(true);
  });

  it("changes nothing without a token: no header, blob links ignored", async () => {
    const { row, deps, auth, requested } = withAuth(privateRoutes());
    await refreshCloudAgentProof(deps, row, { status: "finished", prUrl: PR }, context);
    expect(storedProofImages(row).map((image) => image.source)).toEqual([asset("public")]);
    expect(requested.some((url) => url.startsWith(contents))).toBe(false);
    expect(auth.every((call) => call.authorization === null)).toBe(true);
  });

  it("recognises only the pull request's own blob links, and only for private repositories", () => {
    const text = [
      blob("home"),
      "https://github.com/other/app/blob/pr-assets/pr-7/x/home.png?raw=true",
      "https://github.com/acme/app/blob/main/logo.png?raw=true",
      "https://github.com/acme/app/pull/7",
    ].join("\n");
    expect(trustedImageUrls(text, repo)).toEqual([]);
    expect(trustedImageUrls(text, repo, true)).toEqual([blob("home").replace("?raw=true", "")]);
  });

  it("never uses the deployment's token for a user-connected provider's job", async () => {
    const { row, deps, auth } = withAuth(privateRoutes(), {
      providerKey: `${USER_CLOUD_AGENT_KEY_PREFIX}abc`,
    });
    await refreshCloudAgentProof(
      { ...deps, githubToken: "secret-token" },
      row,
      { status: "finished", prUrl: PR },
      context,
    );
    expect(auth.length).toBeGreaterThan(0);
    expect(auth.every((call) => call.authorization === null)).toBe(true);
    expect(storedProofImages(row).map((image) => image.source)).toEqual([asset("public")]);
  });

  it("reads the CI result from workflow runs with a token, falling back to check runs", async () => {
    const runs = `${api}/actions/runs?head_sha=${"a".repeat(40)}&per_page=30`;
    const failing = setup({
      ...github(),
      [runs]: json({ workflow_runs: [{ status: "completed", conclusion: "failure" }] }),
    });
    await refreshCloudAgentProof(
      { ...failing.deps, githubToken: "t" },
      failing.row,
      { status: "finished", prUrl: PR },
      context,
    );
    expect(failing.row.checksState).toBe("failing");

    // A page of runs over the usual JSON limit still reads.
    const big = setup({
      ...github(),
      [runs]: json({
        workflow_runs: [{ status: "completed", conclusion: "success", pad: "x".repeat(600_000) }],
      }),
    });
    await refreshCloudAgentProof(
      { ...big.deps, githubToken: "t" },
      big.row,
      { status: "finished", prUrl: PR },
      context,
    );
    expect(big.row.checksState).toBe("passing");
    expect(failing.requested.some((url) => url.includes("/check-runs"))).toBe(false);

    // The token cannot read workflow runs here, so check runs answer.
    const denied = setup({ ...github(), [runs]: () => new Response("no", { status: 403 }) });
    await refreshCloudAgentProof(
      { ...denied.deps, githubToken: "t" },
      denied.row,
      { status: "finished", prUrl: PR },
      context,
    );
    expect(denied.row.checksState).toBe("passing");

    // Without a token, check runs only, as before.
    const none = setup(github());
    await refreshCloudAgentProof(none.deps, none.row, { status: "finished", prUrl: PR }, context);
    expect(none.requested.some((url) => url.includes("/actions/runs"))).toBe(false);
  });

  it("reads a running job's checks more often with a token", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const { row, deps, requested } = setup(github([{ status: "in_progress" }]));
    const withToken = { ...deps, githubToken: "t" };
    const snapshot = { status: "running" as const, prUrl: PR };
    await refreshCloudAgentProof(withToken, row, snapshot, context, now);
    const reads = requested.length;
    await refreshCloudAgentProof(
      withToken,
      row,
      snapshot,
      context,
      new Date(now.getTime() + CHECKS_REFRESH_WITH_TOKEN_MS + 1),
    );
    expect(requested.length).toBeGreaterThan(reads);
  });
});
