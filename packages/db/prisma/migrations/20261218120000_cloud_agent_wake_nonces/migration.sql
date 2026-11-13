-- Additive: older workers continue to use the primary clientNonce.
ALTER TABLE "runs" ADD COLUMN "cloudAgentWakeNonces" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
