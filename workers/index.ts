import 'dotenv/config';
import { Worker } from 'bullmq';
import { getRedisConnection } from './queues/connection.js';
import { runMigrations } from './db/pool.js';
import { orchestratorProcessor } from './processors/orchestrator.processor.js';
import { userMigrationProcessor } from './processors/user-migration.processor.js';
import { messageImportProcessor } from './processors/message-import.processor.js';

const QUEUE_TYPE = process.env.QUEUE_TYPE ?? process.argv.find(a => a.startsWith('--queue='))?.split('=')[1] ?? 'orchestrator';
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

async function main() {
  console.log(`[worker] Starting queue=${QUEUE_TYPE} concurrency=${CONCURRENCY}`);

  await runMigrations();
  console.log('[worker] DB migrations applied');

  const connection = getRedisConnection();
  let worker: Worker;

  switch (QUEUE_TYPE) {
    case 'orchestrator':
      worker = new Worker('migration-orchestrator', orchestratorProcessor, {
        connection,
        concurrency: CONCURRENCY,
        stalledInterval: 30_000,
      });
      break;
    case 'users':
    case 'user-migration':
      worker = new Worker('user-migration', userMigrationProcessor, {
        connection,
        concurrency: CONCURRENCY,
        stalledInterval: 60_000,
        lockDuration: 3_600_000, // 1h — IMAP sessions are long
      });
      break;
    case 'messages':
    case 'message-import':
      worker = new Worker('message-import', messageImportProcessor, {
        connection,
        concurrency: CONCURRENCY,
        stalledInterval: 30_000,
        lockDuration: 600_000, // 10min per batch
      });
      break;
    default:
      console.error(`Unknown QUEUE_TYPE: ${QUEUE_TYPE}. Use orchestrator | users | messages`);
      process.exit(1);
  }

  worker.on('completed', job => console.log(`[${QUEUE_TYPE}] Job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[${QUEUE_TYPE}] Job ${job?.id} failed:`, err.message));
  worker.on('error', err => console.error(`[${QUEUE_TYPE}] Worker error:`, err));

  async function shutdown() {
    console.log('[worker] Shutting down gracefully…');
    await worker.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`[worker] Listening on queue "${QUEUE_TYPE === 'users' ? 'user-migration' : QUEUE_TYPE === 'messages' ? 'message-import' : 'migration-orchestrator'}"`);
}

main().catch(err => { console.error('Worker startup failed:', err); process.exit(1); });
