-- Additive only: the previous release ignores these columns and still reads every row as before.
ALTER TABLE "cloud_agents"
  ADD COLUMN "progressText" TEXT,
  ADD COLUMN "endedAt" TIMESTAMP(3);
