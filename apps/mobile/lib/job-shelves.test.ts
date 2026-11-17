import type { CloudAgentJob } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { jobIsClearable, jobListItems } from "./job-shelves";

const NOW = Date.parse("2026-11-15T15:00:00");
const job = (id: string, extra: Partial<CloudAgentJob> = {}): CloudAgentJob => ({
  agentId: id,
  title: id,
  status: "running",
  url: "",
  botId: "bot",
  botName: "Bot",
  threadId: "thread",
  ...extra,
});
const label = (item: ReturnType<typeof jobListItems>[number]) =>
  item.kind === "job" ? item.job.agentId : item.shelf;

it("orders the shelves needs you, working, today, earlier and drops empty ones", () => {
  const items = jobListItems(
    [
      job("old", { status: "finished", endedAt: "2026-11-08T10:00:00" }),
      job("done", { status: "finished", endedAt: "2026-11-15T09:00:00" }),
      job("run"),
      job("ask", { needsInput: true }),
      job("queued", { queued: true }),
    ],
    NOW,
  );
  expect(items.map(label)).toEqual([
    "needsYou",
    "ask",
    "working",
    "run",
    "queued",
    "today",
    "done",
    "earlier",
    "old",
  ]);
  expect(jobListItems([job("run")], NOW).map((item) => item.kind)).toEqual(["header", "job"]);
});

it("puts the job that ended last first on a finished shelf", () => {
  const items = jobListItems(
    [
      job("early", { status: "finished", endedAt: "2026-11-15T08:00:00" }),
      job("late", { status: "failed", endedAt: "2026-11-15T12:00:00" }),
    ],
    NOW,
  );
  expect(items.map(label)).toEqual(["today", "late", "early"]);
});

it("counts a finished job with an owner question on Needs you, and will not clear it", () => {
  const blocked = job("blocked", { status: "finished", ownerQuestion: "Which branch?" });
  expect(jobListItems([blocked], NOW)[0]).toMatchObject({ shelf: "needsYou", count: 1 });
  expect(jobIsClearable(blocked)).toBe(false);
  expect(jobIsClearable(job("run"))).toBe(false);
  expect(jobIsClearable(job("over", { status: "cancelled" }))).toBe(true);
});

it("keeps a usage-limit pause on Working, not Needs you, and will not clear it", () => {
  const paused = job("paused", { quotaResetsAt: "2026-11-17T16:30:00.000Z" });
  expect(jobListItems([paused], NOW).map(label)).toEqual(["working", "paused"]);
  expect(jobIsClearable(paused)).toBe(false);
});

it("keeps a finished job under review on Working, not clearable, until the review ends", () => {
  const checking = job("review", {
    status: "finished",
    review: "checking",
    endedAt: "2026-11-15T09:00:00",
  });
  expect(jobListItems([checking], NOW).map(label)).toEqual(["working", "review"]);
  expect(jobIsClearable(checking)).toBe(false);
  const reviewed = { ...checking, review: "accepted" as const };
  expect(jobListItems([reviewed], NOW).map(label)).toEqual(["today", "review"]);
  expect(jobIsClearable(reviewed)).toBe(true);
});
