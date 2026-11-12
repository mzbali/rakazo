-- Additive only: the previous release ignores these columns and still reads every row as before.
ALTER TABLE "cloud_agents"
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "attention" JSONB,
  ADD COLUMN "remoteCursor" INTEGER,
  ADD COLUMN "historyGapAt" TIMESTAMP(3),
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "agreement" TEXT,
  ADD COLUMN "acceptance" TEXT,
  ADD COLUMN "originBotId" TEXT,
  ADD COLUMN "originMessageId" TEXT,
  ADD COLUMN "verdict" TEXT,
  ADD COLUMN "verdictSummary" TEXT,
  ADD COLUMN "wakeAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "cloud_agents_spaceId_botId_requestKey_key"
  ON "cloud_agents"("spaceId", "botId", "requestKey");
CREATE INDEX "cloud_agents_botId_queuedAt_idx" ON "cloud_agents"("botId", "queuedAt");
