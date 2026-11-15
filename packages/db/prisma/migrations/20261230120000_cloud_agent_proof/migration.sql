-- Additive only: the previous release ignores these columns.
ALTER TABLE "cloud_agents" ADD COLUMN "checksState" TEXT,
ADD COLUMN "checksAt" TIMESTAMP(3),
ADD COLUMN "proofImages" JSONB;
