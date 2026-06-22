import { NextRequest } from 'next/server';
import { readStalwartAuthContext } from '@/lib/stalwart/auth-context';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.MIGRATION_PG_URL, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await readStalwartAuthContext(0);
  if (!ctx) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  const workspaceId = ctx.username.split('@')[1] ?? ctx.username;
  const pool = getPool();

  // Verify job belongs to this workspace
  const { rows: [job] } = await pool.query(
    'SELECT id, status FROM migration_jobs WHERE id = $1 AND workspace_id = $2',
    [id, workspaceId]
  );
  if (!job) return new Response('Not found', { status: 404 });

  let lastEventId = 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ }
      };
      const heartbeat = () => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { /* closed */ }
      };

      // Send current snapshot immediately
      const { rows: users } = await pool.query(
        `SELECT id, source_email, target_email, status, imported_messages, failed_messages,
                imported_bytes, error_message, started_at, completed_at
         FROM migration_users WHERE migration_job_id = $1 ORDER BY created_at`,
        [id]
      );
      send({ type: 'snapshot', users });

      let closed = false;
      request.signal.addEventListener('abort', () => { closed = true; });

      // Poll migration_events every 1s for new events
      const pollInterval = setInterval(async () => {
        if (closed) { clearInterval(pollInterval); clearInterval(heartbeatInterval); return; }
        try {
          const { rows: events } = await pool.query(
            `SELECT id, event_type, user_id, payload FROM migration_events
             WHERE migration_job_id = $1 AND id > $2 ORDER BY id LIMIT 100`,
            [id, lastEventId]
          );
          for (const ev of events) {
            lastEventId = ev.id;
            send({ type: ev.event_type, userId: ev.user_id, ...ev.payload });
            if (ev.event_type === 'job_completed' || ev.event_type === 'job_failed') {
              closed = true;
              clearInterval(pollInterval);
              clearInterval(heartbeatInterval);
              try { controller.close(); } catch { /* already closed */ }
              return;
            }
          }
        } catch { /* db error, keep trying */ }
      }, 1000);

      // Heartbeat every 25s to prevent nginx/proxy timeout
      const heartbeatInterval = setInterval(heartbeat, 25000);

      request.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        clearInterval(heartbeatInterval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
