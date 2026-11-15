-- Additive only: the previous release ignores these columns and still reads every row as before.
ALTER TABLE "cloud_agents"
  ADD COLUMN "questionPrompt" TEXT,
  ADD COLUMN "ownerAnswer" TEXT,
  ADD COLUMN "steeredAt" TIMESTAMP(3);
