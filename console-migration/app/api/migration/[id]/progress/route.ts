import { NextRequest } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/session';
import { Pool } from 'pg';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL });
  return _pool;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (isAuthError(auth)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { id } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'));
      };
      let done = false;
      while (!done) {
        try {
          const { rows: [job] } = await getPool().query(
            `SELECT j.status, j.total_users, j.completed_users, j.failed_users,
                    j.imported_messages, j.imported_bytes, j.error_message,
                    json_agg(u ORDER BY u.source_email) FILTER (WHERE u.id IS NOT NULL) as users
             FROM migration_jobs j LEFT JOIN migration_users u ON u.migration_job_id = j.id
             WHERE j.id = $1 AND j.workspace_id = $2 GROUP BY j.id`,
            [id, auth.domain]
          );
          if (!job) { send({ error: 'not found' }); break; }
          send(job);
          if (['completed', 'failed', 'cancelled'].includes(job.status)) done = true;
        } catch (e) {
          send({ error: String(e) });
          done = true;
        }
        if (!done) await new Promise(r => setTimeout(r, 4000));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
