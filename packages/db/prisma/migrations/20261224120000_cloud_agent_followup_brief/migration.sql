-- What the bot's latest follow-up asked for, and the bot run that is itself waiting on the agent.
ALTER TABLE "cloud_agents" ADD COLUMN "followupBrief" TEXT;
ALTER TABLE "cloud_agents" ADD COLUMN "waitingRunId" TEXT;
CREATE INDEX "cloud_agents_waitingRunId_idx" ON "cloud_agents"("waitingRunId");
