import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/session';
import { Pool } from 'pg';
import { Queue } from 'bullmq';
import { createCipheriv, randomBytes } from 'crypto';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL });
  return _pool;
}

let _queue: Queue | null = null;
function getQueue() {
  if (!_queue) {
    const url = new URL(process.env.REDIS_URL!);
    _queue = new Queue('migration-orchestrator', {
      connection: { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined },
    });
  }
  return _queue;
}

function encryptionKey() {
  const raw = process.env.MIGRATION_ENCRYPTION_KEY ?? '';
  return Buffer.from(raw.padEnd(32).slice(0, 32));
}

function encryptCredentials(creds: Record<string, string>): Buffer {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(creds), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

async function ensureTables() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_host TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      total_users INT,
      completed_users INT NOT NULL DEFAULT 0,
      failed_users INT NOT NULL DEFAULT 0,
      imported_messages INT NOT NULL DEFAULT 0,
      imported_bytes BIGINT NOT NULL DEFAULT 0,
      error_message TEXT,
      credentials_enc BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      migration_job_id UUID NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
      source_email TEXT NOT NULL,
      target_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      imported_messages INT NOT NULL DEFAULT 0,
      failed_messages INT NOT NULL DEFAULT 0,
      imported_bytes BIGINT NOT NULL DEFAULT 0,
      error_message TEXT,
      checkpoint_json JSONB,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      target_account_id TEXT,
      UNIQUE(migration_job_id, source_email)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_events (
      id BIGSERIAL PRIMARY KEY,
      migration_job_id UUID NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
      migration_user_id UUID REFERENCES migration_users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function testConnection(sourceType: string, credentials: Record<string, string>) {
  const required: Record<string, string[]> = {
    cpanel: ['host', 'adminUser', 'adminToken', 'masterPass'],
    gsuite: ['domain', 'serviceAccountJson', 'adminEmail'],
    zoho: ['domain', 'orgId', 'accessToken'],
    dovecot: ['host', 'masterUser', 'masterPass'],
  };
  const missing = (required[sourceType] ?? []).filter(k => !credentials[k]?.trim());
  if (missing.length > 0) return { ok: false, message: `Missing required fields: ${missing.join(', ')}` };
  if (sourceType === 'gsuite') {
    try { JSON.parse(credentials.serviceAccountJson); } catch {
      return { ok: false, message: 'Service account JSON is invalid' };
    }
  }
  return { ok: true, message: 'Credentials saved (live validation runs when job starts)' };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isAuthError(auth)) return auth;

  await ensureTables();

  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');
  if (jobId) {
    const { rows } = await getPool().query(
      `SELECT j.*, json_agg(u ORDER BY u.source_email) FILTER (WHERE u.id IS NOT NULL) as users
       FROM migration_jobs j LEFT JOIN migration_users u ON u.migration_job_id = j.id
       WHERE j.id = $1 AND j.workspace_id = $2 GROUP BY j.id`,
      [jobId, auth.domain]
    );
    return NextResponse.json(rows[0] ?? null);
  }

  const { rows } = await getPool().query(
    'SELECT * FROM migration_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 20',
    [auth.domain]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isAuthError(auth)) return auth;

  const body = await request.json() as { action: string; sourceType: string; credentials: Record<string, string>; jobId?: string };
  const { action, sourceType, credentials, jobId } = body;

  if (action === 'test') {
    const result = await testConnection(sourceType, credentials);
    return NextResponse.json(result);
  }

  if (action === 'cancel' && jobId) {
    await getPool().query(
      `UPDATE migration_jobs SET status = 'cancelled' WHERE id = $1 AND workspace_id = $2`,
      [jobId, auth.domain]
    );
    return NextResponse.json({ ok: true });
  }

  if (action === 'start') {
    await ensureTables();
    const credEnc = encryptCredentials(credentials);
    const { rows: [job] } = await getPool().query(
      `INSERT INTO migration_jobs (workspace_id, initiated_by, source_type, source_host, credentials_enc)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [auth.domain, auth.email, sourceType, credentials.host ?? credentials.domain ?? '', credEnc]
    );
    const queue = getQueue();
    await queue.add('orchestrate', { jobId: job.id, workspaceId: auth.domain, sourceType }, {
      attempts: 3, backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: false, removeOnFail: false,
    });
    return NextResponse.json({ jobId: job.id });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
