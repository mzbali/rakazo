-- Additive only: the previous release ignores these columns and still reads every row as before.
ALTER TABLE "cloud_agents"
  ADD COLUMN "quotaResetsAt" TIMESTAMP(3),
  ADD COLUMN "quotaContinuedFor" TIMESTAMP(3);
