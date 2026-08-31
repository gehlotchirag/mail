-- A batch is identified by the range it covers, not by when it was enqueued.
--
-- Without this, a user job retried by BullMQ (attempts: 5) re-enumerates from
-- the checkpoint — which deliberately never advanced past unsettled batches —
-- and registers a SECOND row for a range whose first batch is still queued.
-- Both jobs then import the same messages, and the duplicate row inflates
-- pending_batches so the user never completes.
--
-- Made unique so registration can be ON CONFLICT DO NOTHING, which together
-- with the deterministic BullMQ job id makes re-enumeration a no-op instead of
-- a duplicate import.

BEGIN;

-- Defensive: 003 shipped without this constraint, so an already-migrated
-- database may hold duplicate ranges. Keep the row that got furthest, fold its
-- siblings' counters into it, and drop the rest — same shape as 002.
WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (
           PARTITION BY migration_user_id, folder_key, seq_start, seq_end
           ORDER BY (status = 'imported') DESC, imported_count DESC, created_at ASC
         ) AS keeper_id
  FROM migration_batches
),
losers AS (
  SELECT id, keeper_id FROM ranked WHERE id <> keeper_id
),
rolled AS (
  UPDATE migration_batches b
     SET imported_count = b.imported_count + agg.imported,
         failed_count   = b.failed_count   + agg.failed,
         vanished_count = b.vanished_count + agg.vanished
    FROM (
      SELECT l.keeper_id,
             SUM(x.imported_count) AS imported,
             SUM(x.failed_count)   AS failed,
             SUM(x.vanished_count) AS vanished
        FROM losers l JOIN migration_batches x ON x.id = l.id
       GROUP BY l.keeper_id
    ) agg
   WHERE b.id = agg.keeper_id
  RETURNING b.id
)
DELETE FROM migration_batches WHERE id IN (SELECT id FROM losers);

CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_batches_range
  ON migration_batches (migration_user_id, folder_key, seq_start, seq_end);

-- pending_batches may have been inflated by the duplicates just removed, so
-- recompute it from what actually remains outstanding.
UPDATE migration_users u
   SET pending_batches = COALESCE(c.n, 0)
  FROM (
    SELECT migration_user_id, COUNT(*) AS n
      FROM migration_batches
     WHERE status = 'pending'
     GROUP BY migration_user_id
  ) c
 WHERE u.id = c.migration_user_id
   AND u.pending_batches <> COALESCE(c.n, 0);

COMMIT;
