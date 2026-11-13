-- Sole statement so the index builds without blocking run writes.
CREATE INDEX CONCURRENTLY "runs_cloudAgentWakeNonces_idx" ON "runs" USING GIN ("cloudAgentWakeNonces");
