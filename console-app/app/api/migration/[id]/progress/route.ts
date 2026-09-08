import { getSession } from '@/lib/auth';
import { Pool } from 'pg';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL, ssl: { rejectUnauthorized: false } });
  return _pool;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'));

      let done = false;
      while (!done) {
        try {
          const { rows: [job] } = await getPool().query(
            `SELECT j.id, j.source_type, j.source_host,
                    j.status, j.total_users, j.completed_users, j.failed_users,
                    j.imported_messages, j.imported_bytes, j.error_message,
                    json_agg(u ORDER BY u.source_email) FILTER (WHERE u.id IS NOT NULL) AS users,
                    (SELECT json_agg(ev)
                     FROM (
                       SELECT e.id, e.event_type, e.payload, e.created_at,
                              mu.source_email AS user_email
                       FROM migration_events e
                       LEFT JOIN migration_users mu ON mu.id = e.migration_user_id
                       WHERE e.migration_job_id = $1
                       ORDER BY e.id DESC LIMIT 25
                     ) ev) AS recent_events
             FROM migration_jobs j
             LEFT JOIN migration_users u ON u.migration_job_id = j.id
             WHERE j.id = $1 AND j.workspace_id = $2
             GROUP BY j.id`,
            [id, session.orgId]
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
      'X-Accel-Buffering': 'no',
    },
  });
}
