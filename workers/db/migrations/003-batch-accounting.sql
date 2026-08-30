-- 003 — outstanding-batch accounting, folder watermarks and worker heartbeats.
--
-- The user-migration job no longer imports mail itself; it enumerates a mailbox
-- and fans batches out to the message-import queue. Three things follow:
--
--   * a folder's checkpoint may only advance over messages a batch actually
--     imported (migration_batches records the range each batch covers and how it
--     ended, so the checkpoint is a watermark over the fully-imported prefix);
--   * a user is only 'completed' when its batches have settled, not when they
--     have been enqueued (pending_batches + enqueue_complete);
--   * the reaper needs a liveness signal to tell a slow-but-healthy job from a
--     dead one (heartbeat_at), otherwise it duplicates a live user's mail.

ALTER TABLE migration_users
  ADD COLUMN IF NOT EXISTS pending_batches     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enqueue_complete    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS unimported_messages INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heartbeat_at        TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS migration_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_job_id  UUID NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
  migration_user_id UUID NOT NULL REFERENCES migration_users(id) ON DELETE CASCADE,
  -- Stable key for the folder: the IMAP folder path, or the Zoho folderId.
  folder_key        TEXT NOT NULL,
  folder_name       TEXT NOT NULL,
  -- Inclusive range this batch covers, in whatever ordering the source enumerates
  -- by: IMAP UIDs, or Zoho listing offsets. Both only ever increase.
  seq_start         BIGINT NOT NULL,
  seq_end           BIGINT NOT NULL,
  message_count     INT NOT NULL,
  -- pending | imported | partial | failed | cancelled
  status            TEXT NOT NULL DEFAULT 'pending',
  imported_count    INT NOT NULL DEFAULT 0,
  failed_count      INT NOT NULL DEFAULT 0,
  -- Messages that no longer exist at the source (deleted between enumeration and
  -- import). Retrying cannot bring them back, so they must not hold the folder's
  -- checkpoint behind them — but they are counted and reported, never hidden.
  vanished_count    INT NOT NULL DEFAULT 0,
  bull_job_id       TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at        TIMESTAMPTZ
);

-- Watermark lookups: (user, folder) ordered by range.
CREATE INDEX IF NOT EXISTS idx_mb_user_folder
  ON migration_batches (migration_user_id, folder_key, seq_end);
-- Reaper sweep over batches that never settled.
CREATE INDEX IF NOT EXISTS idx_mb_pending
  ON migration_batches (created_at) WHERE status = 'pending';
-- Per-user aggregate when a user finishes.
CREATE INDEX IF NOT EXISTS idx_mb_user ON migration_batches (migration_user_id);
