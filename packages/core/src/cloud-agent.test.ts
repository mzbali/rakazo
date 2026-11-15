import { describe, expect, it } from "vitest";
import {
  cloudAgentBlockFromPayload,
  cloudAgentElapsed,
  cloudAgentHttpsUrl,
  cloudAgentJobTone,
  cloudAgentModelLabel,
  cloudAgentPhase,
  cloudAgentProjectName,
  cloudAgentPullRequestNumber,
  cloudAgentShelf,
  cloudAgentState,
  cloudAgentTicking,
} from "./cloud-agent.js";
import { projectMessages } from "./events.js";

describe("shared cloud agent projection", () => {
  it("updates an existing card when replaying durable events", () => {
    const base = { threadId: "thread", createdAt: "2026-01-01T00:00:00Z", botId: "bot" };
    const block = cloudAgentBlockFromPayload({
      agentId: "agent",
      title: "Task",
      status: "running",
      url: "https://example.test/agent",
    });
    const messages = projectMessages([
      {
        ...base,
        id: "first",
        seq: 1,
        type: "thread.message.created",
        payload: { messageId: "card", role: "bot", blocks: [block] },
      },
      {
        ...base,
        id: "second",
        seq: 2,
        type: "thread.cloud_agent",
        payload: {
          ...block,
          messageId: "card",
          status: "finished",
          prUrl: "https://example.test/pr",
        },
      },
    ]);
    expect(messages[0]?.blocks[0]).toMatchObject({
      status: "finished",
      prUrl: "https://example.test/pr",
    });
  });
  it("normalizes invalid statuses and excludes unsafe links on every surface", () => {
    expect(
      cloudAgentBlockFromPayload({
        status: "invalid",
        url: "javascript:alert(1)",
        prUrl: "http://example.test/pr",
      }),
    ).toMatchObject({ status: "running", url: "" });
    for (const url of [
      "javascript:alert(1)",
      "file:///tmp/fake",
      "https://user:password@example.test",
      "invalid",
    ])
      expect(cloudAgentHttpsUrl(url)).toBeUndefined();
  });
});

describe("cloud agent state", () => {
  it("puts what waits on the owner first and settled statuses through unchanged", () => {
    const running = { status: "running" as const };
    expect(cloudAgentState({ ...running, needsInput: true, unreachableSince: "x" })).toBe(
      "needsInput",
    );
    expect(cloudAgentState({ ...running, unreachableSince: "x", queued: true })).toBe(
      "unreachable",
    );
    expect(cloudAgentState({ ...running, queued: true })).toBe("queued");
    expect(cloudAgentState(running)).toBe("running");
    expect(cloudAgentState({ status: "expired", needsInput: true })).toBe("expired");
  });
  it("colours attention, success and failure apart from everything else", () => {
    const running = { status: "running" as const, url: "https://x.test" };
    expect(cloudAgentJobTone({ ...running, needsInput: true })).toBe("attention");
    expect(cloudAgentJobTone({ status: "finished" })).toBe("success");
    expect(cloudAgentJobTone({ status: "finished", review: "checking" })).toBe("active");
    expect(cloudAgentJobTone({ status: "failed" })).toBe("danger");
    expect(cloudAgentJobTone({ status: "cancelled" })).toBe("muted");
    expect(cloudAgentJobTone({ status: "expired" })).toBe("muted");
  });
  it("keeps a bounded pick note and the start time, and drops bad ones", () => {
    const block = cloudAgentBlockFromPayload({
      agentId: "a",
      note: ` ${"n".repeat(500)} `,
      startedAt: new Date("2026-01-02T03:04:05Z"),
    });
    expect(block.note).toHaveLength(400);
    expect(block.startedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(
      cloudAgentBlockFromPayload({ agentId: "a", note: "  ", startedAt: "nope" }),
    ).not.toHaveProperty("note");
  });
});

describe("cloud agent job summary", () => {
  it("shelves what waits on the owner first and everything over as done", () => {
    expect(cloudAgentShelf("needsInput")).toBe("needsYou");
    expect(
      (["running", "queued", "unreachable"] as const).map((state) => cloudAgentShelf(state)),
    ).toEqual(["working", "working", "working"]);
    expect(
      (["finished", "failed", "cancelled", "expired"] as const).map((state) =>
        cloudAgentShelf(state),
      ),
    ).toEqual(["done", "done", "done", "done"]);
  });
  it("names the project from the repository link", () => {
    expect(cloudAgentProjectName("https://git.example.com/acme/app.git")).toBe("app");
    expect(cloudAgentProjectName("https://git.example.com/acme/app/")).toBe("app");
    expect(cloudAgentProjectName("http://git.example.com/acme/app")).toBeUndefined();
    expect(cloudAgentProjectName(undefined)).toBeUndefined();
  });
  it("shortens a pick note to the model and the kind of work", () => {
    expect(cloudAgentModelLabel("Picked claude-sonnet-5-5 on main (simple).")).toBe(
      "Sonnet · simple",
    );
    expect(cloudAgentModelLabel("Picked gpt-6-luna on box (hard; gpt-6-sol out of quota).")).toBe(
      "Luna · hard",
    );
    expect(cloudAgentModelLabel("No simple route is available; the default was used.")).toBe(
      undefined,
    );
    expect(cloudAgentModelLabel(undefined)).toBeUndefined();
  });
});

describe("reported owner questions after completion", () => {
  it("keeps a completed job on Needs you until its owner question is cleared", () => {
    const job = { status: "finished" as const, ownerQuestion: "Which branch should ship?" };
    expect(cloudAgentState(job)).toBe("needsInput");
    expect(cloudAgentShelf(cloudAgentState(job))).toBe("needsYou");
    expect(cloudAgentState({ ...job, ownerQuestion: undefined, needsInput: true })).toBe(
      "finished",
    );
  });

  it("never reads a failed launch as waiting on the owner, and carries attempts and review", () => {
    const failed = { status: "failed", ownerQuestion: "Retry?", launchFailed: true } as const;
    expect(cloudAgentState(failed)).toBe("failed");
    expect(cloudAgentState({ status: "failed", ownerQuestion: "Retry?" })).toBe("needsInput");
    const block = cloudAgentBlockFromPayload({
      agentId: "b",
      status: "running",
      review: "checking",
      attempts: [
        { agentId: "a", status: "failed", failureReason: "no origin" },
        { agentId: "x", status: "bogus" },
      ],
    });
    expect(block).toMatchObject({
      review: "checking",
      attempts: [{ agentId: "a", status: "failed", failureReason: "no origin" }],
    });
  });
});

describe("cloud agent phase", () => {
  const running = { status: "running" as const, url: "https://x.test" };
  it("names every job with one of the plain words, never a raw status", () => {
    expect(cloudAgentPhase({ ...running, queued: true })).toBe("starting");
    expect(cloudAgentPhase({ status: "running", url: "" })).toBe("starting");
    expect(cloudAgentPhase(running)).toBe("working");
    expect(cloudAgentPhase({ ...running, unreachableSince: "x" })).toBe("working");
    expect(cloudAgentPhase({ ...running, review: "checking" })).toBe("checking");
    expect(cloudAgentPhase({ status: "finished", review: "checking" })).toBe("checking");
    expect(cloudAgentPhase({ status: "finished", review: "accepted" })).toBe("done");
    expect(cloudAgentPhase({ ...running, needsInput: true, review: "checking" })).toBe("needsYou");
    expect(cloudAgentPhase({ status: "failed", launchFailed: true })).toBe("couldntStart");
    expect(cloudAgentPhase({ status: "failed" })).toBe("stopped");
    expect(cloudAgentPhase({ status: "cancelled" })).toBe("stopped");
    expect(cloudAgentPhase({ status: "expired" })).toBe("expired");
  });
});

describe("cloud agent clock", () => {
  const started = "2026-01-01T00:00:00.000Z";
  const at = (seconds: number) => Date.parse(started) + seconds * 1000;
  it("ticks while the job runs and holds still once it has ended", () => {
    const running = { status: "running" as const, startedAt: started };
    expect(cloudAgentTicking(running)).toBe(true);
    expect(cloudAgentElapsed(running, at(90))).toBe("1m");
    const done = {
      status: "finished" as const,
      startedAt: started,
      endedAt: new Date(at(45)).toISOString(),
    };
    expect(cloudAgentTicking(done)).toBe(false);
    expect(cloudAgentElapsed(done, at(9999))).toBe("45s");
    expect(cloudAgentElapsed({ status: "finished", startedAt: started }, at(9999))).toBeUndefined();
    expect(cloudAgentTicking({ status: "running" })).toBe(false);
  });
  it("reads the pull request number from its link", () => {
    expect(cloudAgentPullRequestNumber("https://github.com/acme/app/pull/12")).toBe(12);
    expect(cloudAgentPullRequestNumber("https://github.com/acme/app/pull/12/")).toBe(12);
    expect(cloudAgentPullRequestNumber("https://github.com/acme/app")).toBeUndefined();
    expect(cloudAgentPullRequestNumber("http://github.com/acme/app/pull/12")).toBeUndefined();
  });
  it("clips progress and the result excerpt to one bounded line", () => {
    const block = cloudAgentBlockFromPayload({
      agentId: "a",
      progress: `Reading\n\nthe   code ${"x".repeat(400)}`,
      resultExcerpt: "Shipped",
      endedAt: new Date(at(5)),
    });
    expect(block.progress).toHaveLength(240);
    expect(block.progress?.startsWith("Reading the code ")).toBe(true);
    expect(block.progress?.endsWith("…")).toBe(true);
    expect(block).toMatchObject({
      resultExcerpt: "Shipped",
      endedAt: new Date(at(5)).toISOString(),
    });
    expect(
      cloudAgentBlockFromPayload({
        agentId: "a",
        resultExcerpt: "**Fixed.** The `button` stuck.\n\n- See [the PR](https://x.test/1)",
      }).resultExcerpt,
    ).toBe("Fixed. The button stuck. See the PR");
    expect(cloudAgentBlockFromPayload({ agentId: "a", progress: "  " })).not.toHaveProperty(
      "progress",
    );
  });
});
