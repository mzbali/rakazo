-- Additive only: the previous release ignores these columns.
ALTER TABLE "cloud_agents" ADD COLUMN "prState" TEXT,
ADD COLUMN "prWatching" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "watchingSince" TIMESTAMP(3);
