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
