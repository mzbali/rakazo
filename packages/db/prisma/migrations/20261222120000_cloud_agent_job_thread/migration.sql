-- A cloud agent's wakes run in a hidden helper thread of their own, created on its first wake.
ALTER TABLE "cloud_agents" ADD COLUMN "jobThreadId" TEXT;
ALTER TABLE "cloud_agents" ADD COLUMN "launchBrief" TEXT;
