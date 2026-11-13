-- Additive only: the previous release ignores this column and still reads every row as before.
ALTER TABLE "cloud_agents" ADD COLUMN "failureReason" TEXT;
