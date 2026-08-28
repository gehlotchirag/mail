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
}
