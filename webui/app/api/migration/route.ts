import { NextRequest, NextResponse } from 'next/server';
import { readStalwartAuthContext } from '@/lib/stalwart/auth-context';
import { Pool } from 'pg';
import { Queue } from 'bullmq';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// PG pool (lazy singleton per request — Next.js standalone has no module-level cache across requests)
let _pool: Pool | null = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

// BullMQ queue (Next.js side only enqueues — workers consume)
let _queue: Queue | null = null;
function getQueue() {
  if (!_queue) {
    const url = new URL(process.env.REDIS_URL!);
    _queue = new Queue('migration-orchestrator', {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined,
      },
    });
  }
  return _queue;
}

function encryptCredentials(creds: Record<string, string>): Buffer {
  const key = Buffer.from(process.env.SESSION_SECRET!.padEnd(32).slice(0, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(creds), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptCredentials(buf: Buffer): Record<string, string> {
  const key = Buffer.from(process.env.SESSION_SECRET!.padEnd(32).slice(0, 32));
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(decipher.update(enc) + decipher.final('utf8'));
}

async function testConnection(sourceType: string, credentials: Record<string, string>): Promise<{ ok: boolean; userCount?: number; message?: string }> {
  // Call the worker HTTP health endpoint if running, or do a lightweight pre-flight
  // For now: validate required fields per source type and return optimistic result
  // Workers do the actual IMAP test — this endpoint just validates structure
  const required: Record<string, string[]> = {
    cpanel: ['host', 'adminUser', 'adminToken', 'masterPass'],
    gsuite: ['domain', 'serviceAccountJson', 'adminEmail'],
    zoho:   ['domain', 'orgId', 'accessToken'],
    dovecot: ['host', 'masterUser', 'masterPass'],
  };
  const missing = (required[sourceType] ?? []).filter(k => !credentials[k]?.trim());
  if (missing.length > 0) return { ok: false, message: `Missing required fields: ${missing.join(', ')}` };

  // For GSuite validate the JSON parses
  if (sourceType === 'gsuite') {
    try { JSON.parse(credentials.serviceAccountJson); } catch {
      return { ok: false, message: 'Service account JSON is invalid' };
    }
  }

  // Attempt a real test via the worker test endpoint if configured
  const workerUrl = process.env.WORKER_TEST_URL;
  if (workerUrl) {
    try {
      const r = await fetch(`${workerUrl}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType, credentials }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) return await r.json();
    } catch { /* worker not reachable, fall through */ }
  }

  return { ok: true, userCount: undefined, message: 'Credentials validated (live test runs when job starts)' };
}

export async function GET(request: NextRequest) {
  const ctx = await readStalwartAuthContext(0);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = ctx.username.split('@')[1] ?? ctx.username;
  const pool = getPool();

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        initiated_by TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_host TEXT NOT NULL,
        credentials_enc BYTEA NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        total_users INT,
        completed_users INT NOT NULL DEFAULT 0,
        failed_users INT NOT NULL DEFAULT 0,
        imported_messages BIGINT NOT NULL DEFAULT 0,
        imported_bytes BIGINT NOT NULL DEFAULT 0,
        error_message TEXT,
        bull_job_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )
    `);

    const { rows } = await pool.query(
      `SELECT id, workspace_id, initiated_by, source_type, source_host, status,
              total_users, completed_users, failed_users, imported_messages, imported_bytes,
              error_message, created_at, started_at, completed_at
       FROM migration_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [workspaceId]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('migration GET error:', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await readStalwartAuthContext(0);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { sourceType, credentials, testOnly } = body as {
    sourceType: string;
    credentials: Record<string, string>;
    testOnly?: boolean;
  };

  if (!sourceType || !credentials) return NextResponse.json({ error: 'sourceType and credentials required' }, { status: 400 });

  const testResult = await testConnection(sourceType, credentials);
  if (testOnly) return NextResponse.json(testResult);
  if (!testResult.ok) return NextResponse.json({ error: testResult.message ?? 'Connection test failed' }, { status: 400 });

  const workspaceId = ctx.username.split('@')[1] ?? ctx.username;
  const pool = getPool();

  // Ensure tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_host TEXT NOT NULL,
      credentials_enc BYTEA NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total_users INT,
      completed_users INT NOT NULL DEFAULT 0,
      failed_users INT NOT NULL DEFAULT 0,
      imported_messages BIGINT NOT NULL DEFAULT 0,
      imported_bytes BIGINT NOT NULL DEFAULT 0,
      error_message TEXT,
      bull_job_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      migration_job_id UUID NOT NULL,
      source_email TEXT NOT NULL,
      target_email TEXT NOT NULL,
      target_account_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      imported_messages INT NOT NULL DEFAULT 0,
      failed_messages INT NOT NULL DEFAULT 0,
      imported_bytes BIGINT NOT NULL DEFAULT 0,
      checkpoint_json JSONB NOT NULL DEFAULT '{}',
      error_message TEXT,
      retry_count INT NOT NULL DEFAULT 0,
      bull_job_id TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_events (
      id BIGSERIAL PRIMARY KEY,
      migration_job_id UUID NOT NULL,
      user_id UUID,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const sourceHost = credentials.host ?? credentials.domain ?? sourceType;
  const credsEnc = encryptCredentials(credentials);

  const { rows } = await pool.query(
    `INSERT INTO migration_jobs (workspace_id, initiated_by, source_type, source_host, credentials_enc)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [workspaceId, ctx.username, sourceType, sourceHost, credsEnc]
  );
  const jobId = rows[0].id as string;

  // Enqueue orchestrator job
  try {
    const queue = getQueue();
    const bullJob = await queue.add('orchestrate', { jobId, workspaceId, sourceType, stalwartUrl: process.env.STALWART_URL ?? 'http://localhost:18080' });
    await pool.query('UPDATE migration_jobs SET bull_job_id = $1, status = $2 WHERE id = $3', [bullJob.id, 'discovering', jobId]);
  } catch (err) {
    console.error('Failed to enqueue migration job:', err);
    await pool.query("UPDATE migration_jobs SET status = 'failed', error_message = $1 WHERE id = $2", ['Queue unavailable — workers may not be running', jobId]);
  }

  return NextResponse.json({ jobId }, { status: 201 });
}
