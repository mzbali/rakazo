-- Additive only: the previous release ignores this column.
ALTER TABLE "cloud_agents" ADD COLUMN "threadWork" JSONB;
