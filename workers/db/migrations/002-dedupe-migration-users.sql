-- 002 — collapse duplicate migration_users rows, then enforce uniqueness.
--
-- Why: upsertMigrationUser() relies on ON CONFLICT to make orchestrator retries
-- idempotent, but there was no unique constraint for it to fire against, so every
-- retry inserted a second row for the same (job, source_email) and the "already
-- exists" fallback was dead code. Adding the index blindly would throw on any
-- database that already accumulated duplicates — and because migrations run at
-- worker boot, that would stop the workers from starting. So dedupe first, in the
-- same transaction as the index creation: either both happen or neither does.
--
-- Keeper selection: the row that has imported the most messages wins (it owns the
-- most useful checkpoint), ties broken by age. The mapping is materialised once,
-- before anything is rewritten, so later steps cannot change who the keeper is.
-- Losers' counters are rolled into the keeper and their events repointed, so no
-- history disappears.
--
-- NOTE: a queued BullMQ user-migration job that still references a deleted
-- duplicate id will fail on its next DB write and be retried/reaped against the
-- surviving row. That is a one-off at upgrade time and is preferable to leaving
-- duplicate rows that double-count a job's progress forever.

CREATE TEMP TABLE migration_user_dupes_002 ON COMMIT DROP AS
  WITH ranked AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
             PARTITION BY migration_job_id, source_email
             ORDER BY imported_messages DESC, created_at ASC, id ASC
           ) AS keep_id
      FROM migration_users
  )
  SELECT id, keep_id FROM ranked WHERE id <> keep_id;

-- 1. Repoint events onto the keeper (both the current and the legacy column).
UPDATE migration_events e
   SET migration_user_id = d.keep_id
  FROM migration_user_dupes_002 d
 WHERE e.migration_user_id = d.id;

UPDATE migration_events e
   SET user_id = d.keep_id
  FROM migration_user_dupes_002 d
 WHERE e.user_id = d.id;

-- 2. Roll the duplicates' progress counters into the keeper.
UPDATE migration_users k
   SET imported_messages = k.imported_messages + r.imported_messages,
       failed_messages   = k.failed_messages   + r.failed_messages,
       imported_bytes    = k.imported_bytes    + r.imported_bytes
  FROM (
    SELECT d.keep_id,
           SUM(u.imported_messages) AS imported_messages,
           SUM(u.failed_messages)   AS failed_messages,
           SUM(u.imported_bytes)    AS imported_bytes
      FROM migration_user_dupes_002 d
      JOIN migration_users u ON u.id = d.id
     GROUP BY d.keep_id
  ) r
 WHERE k.id = r.keep_id;

-- 3. Drop the duplicates.
DELETE FROM migration_users
 WHERE id IN (SELECT id FROM migration_user_dupes_002);

-- 4. Now the constraint can be created safely, and ON CONFLICT has a target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_users_job_source
  ON migration_users (migration_job_id, source_email);
