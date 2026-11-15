import type { CloudAgentJob } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { jobPill } from "./job-pill";

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
