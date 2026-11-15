-- Additive only: the previous release ignores this column and still lists every row.
ALTER TABLE "cloud_agents" ADD COLUMN "clearedAt" TIMESTAMP(3);
