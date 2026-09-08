-- Add migration_user_id column to migration_events (was missing from initial schema on some deployments)
ALTER TABLE migration_events
  ADD COLUMN IF NOT EXISTS migration_user_id UUID REFERENCES migration_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_me_user ON migration_events(migration_user_id);
