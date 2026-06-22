import { NextRequest, NextResponse } from 'next/server';
import { readStalwartAuthContext } from '@/lib/stalwart/auth-context';
import { Pool } from 'pg';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await readStalwartAuthContext(0);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const workspaceId = ctx.username.split('@')[1] ?? ctx.username;
  const pool = getPool();

  const { rows: [job] } = await pool.query(
    `SELECT id, workspace_id, initiated_by, source_type, source_host, status,
            total_users, completed_users, failed_users, imported_messages, imported_bytes,
            error_message, created_at, started_at, completed_at
     FROM migration_jobs WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { rows: users } = await pool.query(
    `SELECT id, source_email, target_email, status, imported_messages, failed_messages,
            imported_bytes, error_message, started_at, completed_at
     FROM migration_users WHERE migration_job_id = $1 ORDER BY created_at`,
    [id]
  );

  return NextResponse.json({ ...job, users });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await readStalwartAuthContext(0);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { action } = await request.json().catch(() => ({ action: '' }));
  const workspaceId = ctx.username.split('@')[1] ?? ctx.username;
  const pool = getPool();

  if (action !== 'pause' && action !== 'resume') {
    return NextResponse.json({ error: 'action must be pause or resume' }, { status: 400 });
  }

  const newStatus = action === 'pause' ? 'paused' : 'migrating';
  const { rowCount } = await pool.query(
    'UPDATE migration_jobs SET status = $1 WHERE id = $2 AND workspace_id = $3',
    [newStatus, id, workspaceId]
  );
  if (!rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true, status: newStatus });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await readStalwartAuthContext(0);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const workspaceId = ctx.username.split('@')[1] ?? ctx.username;
  const pool = getPool();

  const { rowCount } = await pool.query(
    "UPDATE migration_jobs SET status = 'cancelled' WHERE id = $1 AND workspace_id = $2 AND status NOT IN ('completed', 'cancelled')",
    [id, workspaceId]
  );
  if (!rowCount) return NextResponse.json({ error: 'Not found or already finished' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
