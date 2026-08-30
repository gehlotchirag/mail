import 'dotenv/config';
import { Worker } from 'bullmq';
import { getRedisConnection } from './queues/connection.js';
import { runMigrations } from './db/pool.js';
import { orchestratorProcessor } from './processors/orchestrator.processor.js';
import { userMigrationProcessor } from './processors/user-migration.processor.js';
import { messageImportProcessor, handleBatchFinalFailure } from './processors/message-import.processor.js';
import { startStuckUserReaper } from './lib/reaper.js';

const QUEUE_TYPE = process.env.QUEUE_TYPE ?? process.argv.find(a => a.startsWith('--queue='))?.split('=')[1] ?? 'orchestrator';
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

async function main() {
  console.log(`[worker] Starting queue=${QUEUE_TYPE} concurrency=${CONCURRENCY}`);

  await runMigrations();
  console.log('[worker] DB migrations applied');

  const connection = getRedisConnection();
  let worker: Worker;
  let stopReaper: (() => void) | null = null;

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
        // User jobs now only enumerate folders/messages and fan the work out to
        // message-import, so they finish in seconds-to-minutes rather than hours.
        lockDuration: 900_000, // 15min — folder/UID enumeration only
      });
      // Re-enqueue users a crashed worker left stranded in 'migrating'
      stopReaper = startStuckUserReaper();
      break;
    case 'messages':
    case 'message-import':
      worker = new Worker('message-import', messageImportProcessor, {
        connection,
        concurrency: CONCURRENCY,
        stalledInterval: 30_000,
        lockDuration: 600_000, // 10min per batch
      });
      // A batch that burns every attempt is the one place mail can go missing.
      // Record it as unimported so the user's folder checkpoint stays parked
      // behind those messages and the user is not left waiting on a batch that
      // will never come back.
      worker.on('failed', (job, err) => {
        if (!job) return;
        // BullMQ sets finishedOn only when it is done retrying (and bumps
        // attemptsMade before emitting), so both signals mean "no further
        // attempt" — including an UnrecoverableError thrown before the
        // attempts are used up.
        const terminal = Boolean(job.finishedOn) || job.attemptsMade >= (job.opts?.attempts ?? 1);
        if (!terminal) return;
        void handleBatchFinalFailure(job, err).catch(e =>
          console.error(`[message-import] Failed to record batch failure: ${e instanceof Error ? e.message : e}`));
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
    stopReaper?.();
    await worker.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`[worker] Listening on queue "${QUEUE_TYPE === 'users' ? 'user-migration' : QUEUE_TYPE === 'messages' ? 'message-import' : 'migration-orchestrator'}"`);
}

main().catch(err => { console.error('Worker startup failed:', err); process.exit(1); });
