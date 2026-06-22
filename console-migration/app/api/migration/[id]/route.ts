import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/session';
import { Pool } from 'pg';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL });
  return _pool;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const { rows } = await getPool().query(
    `SELECT j.*, json_agg(u ORDER BY u.source_email) FILTER (WHERE u.id IS NOT NULL) as users
     FROM migration_jobs j LEFT JOIN migration_users u ON u.migration_job_id = j.id
     WHERE j.id = $1 AND j.workspace_id = $2 GROUP BY j.id`,
    [id, auth.domain]
  );
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
