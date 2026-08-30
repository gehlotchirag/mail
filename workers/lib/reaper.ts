import { Queue } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import {
  claimStuckUsersForRetry, failExhaustedStuckUsers,
  appendMigrationEvent, incrementJobUserCounts, finalizeJobIfComplete,
} from '../db/queries.js';

// A user row sits in 'creating'/'migrating' only while a worker is actively
// discovering folders and enqueuing batches. If a worker dies mid-user the row
// never leaves that state, the job's pending count never reaches zero, and the
// customer's progress screen hangs forever. Sweep those rows back into the queue.
const SWEEP_INTERVAL_MS = Number(process.env.REAPER_INTERVAL_MS ?? 300_000);      // 5 min
const STUCK_AFTER_MS    = Number(process.env.REAPER_STUCK_AFTER_MS ?? 1_800_000); // 30 min
const MAX_USER_RETRIES  = Number(process.env.REAPER_MAX_RETRIES ?? 3);
const SWEEP_BATCH       = Number(process.env.REAPER_BATCH_SIZE ?? 100);

export async function sweepStuckUsers(): Promise<{ requeued: number; failed: number }> {
  const userQueue = new Queue('user-migration', { connection: getRedisConnection() });
  let requeued = 0;
  let failed = 0;

  try {
    const stuck = await claimStuckUsersForRetry(STUCK_AFTER_MS, MAX_USER_RETRIES, SWEEP_BATCH);
    for (const user of stuck) {
      await userQueue.add('migrate-user', {
        jobId: user.migration_job_id,
        userId: user.id,
        sourceEmail: user.source_email,
        targetEmail: user.target_email,
        sourceType: user.source_type,
        workspaceId: user.workspace_id,
        zohoAccountId: user.source_account_ref ?? undefined,
        requeuedByReaper: true,
      }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: false,
        removeOnFail: false,
      });
      await appendMigrationEvent(user.migration_job_id, user.id, 'user_requeued', {
        sourceEmail: user.source_email, reason: 'stuck', attempt: user.retry_count,
      });
      requeued++;
      console.warn(
        `[reaper] Re-enqueued stuck user ${user.source_email} ` +
        `(job ${user.migration_job_id}, attempt ${user.retry_count}/${MAX_USER_RETRIES})`,
      );
    }

    const abandoned = await failExhaustedStuckUsers(STUCK_AFTER_MS, MAX_USER_RETRIES, SWEEP_BATCH);
    for (const user of abandoned) {
      await incrementJobUserCounts(user.migration_job_id, 0, 1);
      await appendMigrationEvent(user.migration_job_id, user.id, 'user_failed', {
        sourceEmail: user.source_email, error: 'Stuck in migration — retries exhausted',
      });
      await finalizeJobIfComplete(user.migration_job_id);
      failed++;
      console.error(
        `[reaper] Gave up on stuck user ${user.source_email} (job ${user.migration_job_id}) — retries exhausted`,
      );
    }
  } finally {
    await userQueue.close();
  }

  if (requeued > 0 || failed > 0) {
    console.log(`[reaper] Sweep complete — requeued=${requeued} failed=${failed}`);
  }
  return { requeued, failed };
}

/** Starts the periodic sweep; returns a stop function for graceful shutdown. */
export function startStuckUserReaper(): () => void {
  console.log(
    `[reaper] Stuck-user sweep every ${SWEEP_INTERVAL_MS}ms ` +
    `(threshold ${STUCK_AFTER_MS}ms, max ${MAX_USER_RETRIES} retries)`,
  );

  let running = false;
  const tick = async () => {
    if (running) return; // never overlap sweeps
    running = true;
    try {
      await sweepStuckUsers();
    } catch (err) {
      console.error(`[reaper] Sweep failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
