-- Additive only: the previous release ignores these columns and still reads every row as before.
ALTER TABLE "cloud_agents"
  ADD COLUMN "replacesId" TEXT,
  ADD COLUMN "reviewingAt" TIMESTAMP(3);

CREATE INDEX "cloud_agents_replacesId_idx" ON "cloud_agents"("replacesId");
