// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CloudAgentCard } from "./CloudAgentCard";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
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
    resultExcerpt: "Added the README.",
  });
  expect(done.textContent).toContain("Done");
  expect(done.textContent).toContain("Added the README.");
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
  expect(card.textContent).toContain("Checks unknown");
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
