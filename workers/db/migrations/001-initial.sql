CREATE TABLE IF NOT EXISTS migration_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  initiated_by     TEXT NOT NULL,
  source_type      TEXT NOT NULL,
  source_host      TEXT NOT NULL,
  credentials_enc  BYTEA NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  total_users      INT,
  completed_users  INT NOT NULL DEFAULT 0,
  failed_users     INT NOT NULL DEFAULT 0,
  imported_messages BIGINT NOT NULL DEFAULT 0,
  imported_bytes   BIGINT NOT NULL DEFAULT 0,
  error_message    TEXT,
  bull_job_id      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS migration_users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_job_id  UUID NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
  source_email      TEXT NOT NULL,
  target_email      TEXT NOT NULL,
  target_account_id TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  imported_messages INT NOT NULL DEFAULT 0,
  failed_messages   INT NOT NULL DEFAULT 0,
  imported_bytes    BIGINT NOT NULL DEFAULT 0,
  checkpoint_json   JSONB NOT NULL DEFAULT '{}',
  error_message     TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  bull_job_id       TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_events (
  id                BIGSERIAL PRIMARY KEY,
  migration_job_id  UUID NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES migration_users(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mj_workspace ON migration_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mj_status    ON migration_jobs(status);
CREATE INDEX IF NOT EXISTS idx_mu_job       ON migration_users(migration_job_id);
CREATE INDEX IF NOT EXISTS idx_mu_status    ON migration_users(status);
CREATE INDEX IF NOT EXISTS idx_me_job       ON migration_events(migration_job_id, id DESC);

-- ── Idempotent column additions (safe to re-run) ──────────────────────────────

-- Per-job opt-in to skip TLS certificate verification against the SOURCE mail
-- server. Defaults to FALSE: certificates are verified unless an operator has
-- explicitly recorded an exception for a broken legacy server on this job.
ALTER TABLE migration_jobs
  ADD COLUMN IF NOT EXISTS allow_insecure_tls BOOLEAN NOT NULL DEFAULT FALSE;

-- Provider-side account handle for the user (e.g. the Zoho numeric accountId).
-- Persisted so a re-enqueued/reaped user job can be rebuilt from the DB alone.
ALTER TABLE migration_users
  ADD COLUMN IF NOT EXISTS source_account_ref TEXT;

-- The console creates migration_events with "migration_user_id"; older worker
-- installs created it as "user_id". Add the column the queries actually use.
ALTER TABLE migration_events
  ADD COLUMN IF NOT EXISTS migration_user_id UUID REFERENCES migration_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mu_stuck ON migration_users(status, started_at);
