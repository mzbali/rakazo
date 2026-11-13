ALTER TABLE "external_effects" ADD COLUMN "approvedByUserId" TEXT, ADD COLUMN "approvedAt" TIMESTAMP(3);

CREATE TABLE "scoped_goals" (
 "id" TEXT PRIMARY KEY,
 "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "botId" TEXT NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
 "threadId" TEXT NOT NULL REFERENCES "threads"("id") ON DELETE CASCADE,
 "agentId" TEXT NOT NULL UNIQUE REFERENCES "cloud_agents"("id") ON DELETE CASCADE,
 "approvalEffectId" TEXT NOT NULL UNIQUE,
 "ownerSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "controlEpoch" INTEGER NOT NULL DEFAULT 0,
 "activeEpoch" INTEGER NOT NULL DEFAULT 0,
 "sourceMessageId" TEXT,
 "approval" JSONB NOT NULL,
 "scope" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'active',
 "gate" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 0,
 "attempt" INTEGER NOT NULL DEFAULT 0,
 "noProgress" INTEGER NOT NULL DEFAULT 0,
 "activeRunId" TEXT,
 "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
 "blocker" JSONB,
 "evidence" JSONB NOT NULL DEFAULT '[]',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "scoped_goals_status_nextAttemptAt_idx" ON "scoped_goals"("status", "nextAttemptAt");
CREATE INDEX "scoped_goals_spaceId_userId_botId_idx" ON "scoped_goals"("spaceId", "userId", "botId");
CREATE TABLE "scoped_goal_transitions" (
 "id" TEXT PRIMARY KEY,
 "goalId" TEXT NOT NULL REFERENCES "scoped_goals"("id") ON DELETE CASCADE,
 "spaceId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "detail" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "scoped_goal_transitions_goalId_createdAt_idx" ON "scoped_goal_transitions"("goalId", "createdAt");
ALTER TABLE "scoped_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scoped_goal_transitions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoped_goals_tenant ON "scoped_goals" USING (
 "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
 "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY scoped_goals_system ON "scoped_goals" USING ((SELECT app_rls_bypass()));
CREATE POLICY scoped_goal_transitions_tenant ON "scoped_goal_transitions" USING (
 "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
 "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY scoped_goal_transitions_system ON "scoped_goal_transitions" USING ((SELECT app_rls_bypass()));
REVOKE UPDATE, DELETE ON "scoped_goal_transitions" FROM rakazo_app;
