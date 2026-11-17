import type { CloudAgentJob } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { activeChatJobs, jobPill } from "./job-pill";

const job = (id: string, extra: Partial<CloudAgentJob> = {}): CloudAgentJob => ({
  agentId: id,
  title: id,
  status: "running",
  url: "https://example.com",
  botId: "bot",
  botName: "Bot",
  threadId: "thread",
  ...extra,
});

it("says Needs you while a job waits, even with others working", () => {
  const pill = jobPill([job("a"), job("b", { needsInput: true })], { botId: "bot" });
  expect(pill).toMatchObject({ kind: "needsYou", job: { agentId: "b" } });
});

it("counts the working jobs and points at the one that started first", () => {
  const pill = jobPill(
    [
      job("late", { startedAt: "2026-11-15T10:10:00Z" }),
      job("early", { startedAt: "2026-11-15T10:00:00Z" }),
      job("over", { status: "finished" }),
    ],
    { botId: "bot" },
  );
  expect(pill).toMatchObject({ kind: "working", count: 2, job: { agentId: "early" } });
});

it("shows nothing once every job is over, and ignores other chats", () => {
  expect(jobPill([job("over", { status: "finished" })], { botId: "bot" })).toBeNull();
  expect(jobPill([job("a", { botId: "other" })], { botId: "bot" })).toBeNull();
  expect(jobPill([job("a", { groupId: "g" })], { botId: "bot" })).toBeNull();
  expect(jobPill([job("a", { groupId: "g" })], { groupId: "g" })).not.toBeNull();
  expect(jobPill(null, { botId: "bot" })).toBeNull();
});

it("counts a paused job as working, and a question on another job still wins", () => {
  const paused = job("paused", { quotaResetsAt: "2026-11-17T15:00:00.000Z" });
  expect(jobPill([paused], { botId: "bot" })).toMatchObject({
    kind: "working",
    count: 1,
    job: { agentId: "paused" },
  });
  expect(jobPill([paused, job("ask", { needsInput: true })], { botId: "bot" })).toMatchObject({
    kind: "needsYou",
    job: { agentId: "ask" },
  });
});

it("counts a finished job still being checked as working", () => {
  const pill = jobPill([job("review", { status: "finished", review: "checking" })], {
    botId: "bot",
  });
  expect(pill).toMatchObject({ kind: "working", count: 1 });
});

it("counts a finished job that is still being checked, as its card says Checking", () => {
  const pill = jobPill([job("a", { status: "finished", review: "checking" }), job("b")], {
    botId: "bot",
  });
  expect(pill).toMatchObject({ kind: "working", count: 2 });
});

it("lists the jobs that need the owner first, then the oldest going", () => {
  const jobs = [
    job("late", { startedAt: "2026-11-15T10:10:00Z" }),
    job("early", { startedAt: "2026-11-15T10:00:00Z" }),
    job("asks", { startedAt: "2026-11-15T10:20:00Z", needsInput: true }),
    job("over", { status: "finished" }),
  ];
  expect(activeChatJobs(jobs, { botId: "bot" }).map((item) => item.agentId)).toEqual([
    "asks",
    "early",
    "late",
  ]);
});
