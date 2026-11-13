-- AlterTable
ALTER TABLE "cloud_agents" ADD COLUMN "retryingSince" TIMESTAMP(3),
ADD COLUMN "unreachableSince" TIMESTAMP(3);
