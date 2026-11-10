-- Additive: an operator can let a bot fetch any site without the new-site check.
ALTER TABLE "bots" ADD COLUMN "openWeb" BOOLEAN NOT NULL DEFAULT false;
