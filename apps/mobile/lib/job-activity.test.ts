import type { CloudAgentJob } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { jobActivityRuns } from "./job-activity";

const job = (extra: Partial<CloudAgentJob> = {}): CloudAgentJob => ({
  agentId: "paused",
  title: "Rewrite the search index",
  status: "running",
  url: "",
  botId: "bot",
  botName: "Bot",
  threadId: "thread",
  ...extra,
});

it("counts a usage-limit pause as working, not as waiting on the owner", () => {
  const [paused] = jobActivityRuns([job({ quotaResetsAt: "2026-11-17T15:00:00.000Z" })]);
  expect(paused).toMatchObject({ status: "running", promptSnippet: "Rewrite the search index" });
  const [waiting] = jobActivityRuns([job({ needsInput: true, ownerQuestion: "Which branch?" })]);
  expect(waiting?.status).toBe("waiting_input");
});
