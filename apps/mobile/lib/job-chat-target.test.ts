import type { CloudAgentJob } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { jobChatTarget } from "./job-chat-target";

const job: CloudAgentJob = {
  agentId: "job",
  title: "Job",
  status: "finished",
  url: "",
  botId: "bot",
  botName: "Helper",
  threadId: "thread",
};
it("opens the originating group instead of the launching bot's private chat", () => {
  expect(jobChatTarget({ ...job, groupId: "group", groupName: "Team" })).toEqual({
    groupId: "group",
    name: "Team",
  });
});
it("keeps private jobs in the bot's chat", () => {
  expect(jobChatTarget(job)).toEqual({ botId: "bot", name: "Helper" });
});
