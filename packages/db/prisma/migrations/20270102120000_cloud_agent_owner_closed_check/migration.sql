-- deferred
-- Data only: ended jobs still asking their owner a question are checked once more, so one the
-- owner already settled or archived in its provider lets the question go. Deferred so that only
-- a release with that check picks these rows up: an older worker would poll one as ordinary
-- ended work and leave its next poll empty, and the question would stay.
UPDATE "cloud_agents"
SET "nextPollAt" = now()
WHERE "status" <> 'running'
  AND "ownerQuestion" IS NOT NULL
  AND "clearedAt" IS NULL
  AND "remoteId" IS NOT NULL
  AND "nextPollAt" IS NULL;
