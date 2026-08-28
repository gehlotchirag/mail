import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { Pool } from 'pg';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL });
  return _pool;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { rows } = await getPool().query(
    `SELECT j.*, json_agg(u ORDER BY u.source_email) FILTER (WHERE u.id IS NOT NULL) AS users
     FROM migration_jobs j
     LEFT JOIN migration_users u ON u.migration_job_id = j.id
     WHERE j.id = $1 AND j.workspace_id = $2
     GROUP BY j.id`,
    [id, session.orgId]
  );
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
