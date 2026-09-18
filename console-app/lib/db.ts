import { Pool } from 'pg';

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    })
  : new Pool({
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT ?? '25060'),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE ?? 'console',
      ssl: { rejectUnauthorized: false },
      max: 5,
    });

export async function query<T = Record<string, unknown>>(
  sql: string, params?: unknown[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string, params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// Runs schema migrations once per process lifecycle — call at app startup only
let _initialized: Promise<void> | null = null;
export function ensureDb(): Promise<void> {
  if (!_initialized) _initialized = initDb().catch(e => { _initialized = null; throw e; });
  return _initialized;
}

export async function initDb(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS domains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain TEXT UNIQUE NOT NULL,
      flux_domain_id TEXT,
      verified BOOLEAN DEFAULT FALSE,
      verify_token TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_suppressions (
      -- Scoped to the sending org: one tenant's hard bounce must not appear in
      -- another tenant's list, nor stop them mailing the same address.
      -- NULL means the sending domain resolved to no org (platform mail), which
      -- no tenant can read.
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      reason TEXT NOT NULL,
      sub_type TEXT,
      suppressed BOOLEAN NOT NULL DEFAULT TRUE,
      diagnostic TEXT,
      feedback_id TEXT,
      source TEXT,
      ses_message_id TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Adopt an existing dev table created before scoping existed.
  await query(`ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS org_id UUID`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone TEXT`);
  await query(`CREATE INDEX IF NOT EXISTS idx_organizations_phone ON organizations (phone)`);
  await query(`ALTER TABLE email_suppressions DROP CONSTRAINT IF EXISTS email_suppressions_pkey`);
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppressions_org_email
     ON email_suppressions (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), email)`
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_email_suppressions_suppressed
     ON email_suppressions (org_id, suppressed, last_seen_at DESC)`
  );

  // SNS delivers at least once; the message id makes replays a no-op.
  await query(`
    CREATE TABLE IF NOT EXISTS ses_notifications (
      sns_message_id TEXT PRIMARY KEY,
      topic_arn TEXT,
      event_type TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'trial',
      max_users INTEGER NOT NULL DEFAULT 3,
      razorpay_subscription_id TEXT,
      razorpay_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'trial',
      trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
      current_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
    ON password_reset_tokens (token) WHERE NOT used
  `);

  // Email ownership. Signups before this column existed were never asked to confirm
  // an address, so they are grandfathered in below — flipping them to unverified
  // would lock working tenants out of adding domains for something they were never
  // given the chance to do.
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verification_backfilled BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`
    UPDATE organizations
       SET email_verified = TRUE, email_verified_at = NOW(), verification_backfilled = TRUE
     WHERE NOT email_verified AND NOT verification_backfilled
       AND created_at < NOW() - INTERVAL '1 minute'
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash
    ON email_verification_tokens (token_hash) WHERE NOT used
  `);

  // Reset tokens are now stored as a SHA-256 digest, so a leaked database row is not
  // itself a usable reset link. The plaintext column is kept for the (short-lived)
  // tokens issued before this change; nothing writes to it any more.
  await query(`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT`);
  await query(`ALTER TABLE password_reset_tokens ALTER COLUMN token DROP NOT NULL`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
    ON password_reset_tokens (token_hash)
  `);
}
