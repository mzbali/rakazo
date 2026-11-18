-- Data only: ended jobs still asking their owner a question are checked once more, so one the
-- owner already settled or archived in its provider lets the question go. If the previous
-- release's worker picks one up during the deploy, it reads the job's current state from the
-- provider once, as it does for ended work, wakes nobody (the work was already reported), and
-- leaves its next poll empty again.
UPDATE "cloud_agents"
SET "nextPollAt" = now()
WHERE "status" <> 'running'
  AND "ownerQuestion" IS NOT NULL
  AND "clearedAt" IS NULL
  AND "remoteId" IS NOT NULL
  AND "nextPollAt" IS NULL;
