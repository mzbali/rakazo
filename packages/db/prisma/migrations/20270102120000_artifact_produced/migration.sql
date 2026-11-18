-- A bot's own file, recorded where the row is created. Null on rows the previous
-- release still inserts, and on uploads, which never set it. The list treats a null
-- row from a run as made, so a file attached during the rollout stays listed.
ALTER TABLE "artifacts" ADD COLUMN "produced" BOOLEAN;

-- Rows attached during a run were listed as made. Keep that for files we cannot
-- prove were only collected, so an existing document stays under Made by bots.
UPDATE "artifacts" SET "produced" = true WHERE "runId" IS NOT NULL;

-- A saved web image's effect result names the artifact in an embed, which stays
-- readable. A plaintext image block with a page source is the same kind of file.
-- Sealed message blocks keep the page source inside the seal, so those rows are
-- classified only when the effect result is still here. A file a computer
-- downloaded and attached has no such record and stays with the run backfill.
UPDATE "artifacts" AS artifact
SET "produced" = false
WHERE artifact.id IN (
  SELECT matched[1]
  FROM "external_effects" AS effect
  CROSS JOIN LATERAL regexp_matches(
    effect.result::text,
    '\]\(image:([A-Za-z0-9_-]+)\)',
    'g'
  ) AS matched
  WHERE effect.kind = 'save_web_images'
    AND effect.result IS NOT NULL
);

UPDATE "artifacts" AS artifact
SET "produced" = false
WHERE EXISTS (
  SELECT 1
  FROM "messages" AS message
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(message.blocks) = 'array' THEN message.blocks
      ELSE '[]'::jsonb
    END
  ) AS block
  WHERE block->>'kind' = 'image'
    AND block->>'artifactId' = artifact.id
    AND jsonb_typeof(block->'source') = 'object'
);
