// @vitest-environment jsdom

import { formatCloudAgentResumeAt } from "@rakazo/core";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CloudAgentCard } from "./messages/CloudAgentCard";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
}));

async function render(block: Parameters<typeof CloudAgentCard>[0]["block"]) {
  const container = document.createElement("div");
  await act(async () => createRoot(container).render(<CloudAgentCard block={block} />));
  return container;
}

const running = {
  kind: "cloud_agent" as const,
  agentId: "agent-1",
  title: "Add a README",
  status: "running" as const,
  url: "https://t3.example.test/thread-1",
};

it("says a reachable agent is working and an unreachable one resumes when it is back", async () => {
  expect((await render(running)).textContent).toContain("Working");
  const text = (await render({ ...running, unreachableSince: "2026-11-13T10:05:00.000Z" }))
    .textContent;
  expect(text).toContain("Working");
  expect(text).toContain("Resumes when it's back");
  expect(text).not.toContain("unreachable");
});

it("shows the latest progress while it works and drops it once it is done", async () => {
  const live = await render({ ...running, progress: "Reading the router" });
  expect(live.textContent).toContain("Reading the router");
  const done = await render({
    ...running,
    status: "finished",
    progress: "Reading the router",
  });
  expect(done.textContent).toContain("Done");
  expect(done.textContent).not.toContain("Reading the router");
});

it("never shows a raw status word", async () => {
  const raw = /running|finished|cancelled|failed|expired|needs input|queued|unreachable/;
  for (const block of [
    running,
    { ...running, queued: true },
    { ...running, review: "checking" as const },
    { ...running, needsInput: true },
    { ...running, status: "finished" as const },
    { ...running, status: "failed" as const },
    { ...running, status: "failed" as const, launchFailed: true },
    { ...running, status: "cancelled" as const },
    { ...running, status: "expired" as const },
  ]) {
    expect((await render(block)).textContent, block.status).not.toMatch(raw);
  }
});

it("offers Open in T3 and View PR with the pull request chip", async () => {
  const card = await render({
    ...running,
    status: "finished",
    prUrl: "https://github.com/acme/app/pull/12",
  });
  const links = [...card.querySelectorAll("a")].map((link) => [link.textContent, link.href]);
  expect(links).toEqual([
    ["Open in T3", "https://t3.example.test/thread-1"],
    ["View PR", "https://github.com/acme/app/pull/12"],
  ]);
  expect(card.textContent).toContain("PR #12");
  expect(card.textContent).not.toContain("Checks");
});

it("keeps the model and folder off the card face", async () => {
  const text = (
    await render({
      ...running,
      note: "Picked claude-sonnet-5-5 on main (simple).",
      projectName: "app",
      branch: "feature/x",
    })
  ).textContent;
  expect(text).not.toMatch(/Sonnet|simple|feature\/x|app$/);
});

it("holds the clock still once the work has ended", async () => {
  const text = (
    await render({
      ...running,
      status: "finished",
      startedAt: "2026-11-13T10:00:00.000Z",
      endedAt: "2026-11-13T10:12:00.000Z",
    })
  ).textContent;
  expect(text).toContain("12m");
});

it("says when a paused job resumes, quietly, without a progress line", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T12:00:00.000Z"));
  try {
    const reset = "2026-11-17T18:30:00.000Z";
    const card = await render({
      ...running,
      startedAt: "2026-11-17T11:00:00.000Z",
      quotaResetsAt: reset,
      progress: "Reading the router",
    });
    expect(card.textContent).toContain("Resumes");
    expect(card.textContent).toContain(formatCloudAgentResumeAt(reset, Date.now()));
    expect(card.textContent).not.toContain("Working");
    expect(card.textContent).not.toContain("Needs you");
    expect(card.textContent).not.toContain("Reading the router");
  } finally {
    vi.useRealTimers();
  }
});

it("shows the needs-you state only once, followed by the question", async () => {
  const card = await render({ ...running, ownerQuestion: "Which branch should ship?" });
  expect(card.textContent).toContain("Which branch should ship?");
  expect(card.textContent?.match(/Needs you/g)).toHaveLength(1);
});

it("hides a refused launch's thread action even if a stale URL is present", async () => {
  const card = await render({ ...running, status: "failed", launchFailed: true });
  expect(card.querySelector("a")).toBeNull();
});

it.each(["cancelled", "failed", "expired"] as const)(
  "opens a %s job only with a thread URL",
  async (status) => {
    expect((await render({ ...running, status, url: "" })).querySelector("a")).toBeNull();
    expect((await render({ ...running, status })).querySelector("a")?.textContent).toBe(
      "Open in T3",
    );
  },
);

it("shows one pull request line with the checks and the watch, and merged when it landed", async () => {
  const watched = {
    ...running,
    prUrl: "https://github.com/example/demo/pull/72",
    checks: "running" as const,
    watching: true,
  };
  const watchedText = (await render(watched)).textContent;
  expect(watchedText).toContain("PR #72checks running");
  // Watching is said once, in the activity line, and the pull request number once.
  expect(watchedText).toContain("watching PR");
  expect(watchedText?.match(/PR #72/g)).toHaveLength(1);
  const landed = { ...watched, status: "finished" as const, prState: "merged" as const };
  const text = (await render({ ...landed, watching: undefined })).textContent;
  expect(text).toContain("PR #72merged");
  expect(text).not.toContain("checks");
});

it("counts the thread's work and the pull requests it watches on one line", async () => {
  const pr = (number: number) => ({
    url: `https://github.com/example/demo/pull/${number}`,
    number,
    state: "open" as const,
    watching: true,
  });
  const text = (
    await render({
      ...running,
      work: [
        { kind: "subagent", label: "Review" },
        { kind: "subagent", label: "Tests" },
        { kind: "command", label: "pnpm test" },
      ],
      pullRequests: [pr(71), pr(72), pr(73)],
    })
  ).textContent;
  expect(text).toContain("2 subagents");
  expect(text).toContain("1 command");
  expect(text).toContain("watching 3 PRs");
});
