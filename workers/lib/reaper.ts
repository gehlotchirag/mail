import { Queue } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import {
  findStuckUserCandidates, claimStuckUserForRetry, failStuckUser,
  findAbandonedBatches, findCompletableImportingUsers, appendMigrationEvent,
  incrementJobUserCounts, finalizeJobIfComplete, type StuckMigrationUser,
} from '../db/queries.js';
import { finishUserIfDone } from './user-completion.js';
import { HEARTBEAT_STALE_MS } from './heartbeat.js';
import { settleBatch } from './batch-settlement.js';

// A user row sits in 'creating'/'migrating' only while a worker is actively
// discovering folders and enqueuing batches; its message batches then carry the
// work while the row sits in 'importing'. If a worker dies mid-user the row never
// leaves that state, the job's pending count never reaches zero, and the
// customer's progress screen hangs forever. Sweep those rows back into the queue.
//
// Age alone is NOT evidence of death — a large mailbox can legitimately take
// hours. Reclaiming a live user duplicates every message it has already imported,
// so the sweep demands two independent signals before touching anything: the
// row's heartbeat has gone stale, AND BullMQ no longer holds a live job for it.
const SWEEP_INTERVAL_MS = Number(process.env.REAPER_INTERVAL_MS ?? 300_000);      // 5 min
const STUCK_AFTER_MS    = Number(process.env.REAPER_STUCK_AFTER_MS ?? 1_800_000); // 30 min
const MAX_USER_RETRIES  = Number(process.env.REAPER_MAX_RETRIES ?? 3);
const SWEEP_BATCH       = Number(process.env.REAPER_BATCH_SIZE ?? 100);
// Batches sit in a queue that may legitimately be hours deep, so they get a much
// longer grace period than users before their absence from BullMQ counts.
const BATCH_STUCK_AFTER_MS = Number(process.env.REAPER_BATCH_STUCK_AFTER_MS ?? 21_600_000); // 6h

// States in which BullMQ still intends to run (or is running) the job.
const LIVE_JOB_STATES = new Set([
  'active', 'waiting', 'waiting-children', 'delayed', 'prioritized', 'paused', 'repeat',
]);

/**
 * Is BullMQ still holding this job? Errors answer "yes": refusing to reap on an
 * inconclusive check costs a delay, wrongly reaping costs duplicated mail.
 */
async function isJobStillLive(queue: Queue, bullJobId: string | null): Promise<boolean> {
  if (!bullJobId) return false;
  try {
    const job = await queue.getJob(bullJobId);
    if (!job) return false;
    const state = await job.getState();
    return LIVE_JOB_STATES.has(state);
  } catch (err) {
    console.warn(
      `[reaper] Could not determine state of job ${bullJobId} ` +
      `(${err instanceof Error ? err.message : err}) — assuming alive`,
    );
    return true;
  }
}

async function requeueUser(queue: Queue, user: StuckMigrationUser): Promise<void> {
  await queue.add('migrate-user', {
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
}

export async function sweepStuckUsers(): Promise<{ requeued: number; failed: number; skipped: number }> {
  const userQueue = new Queue('user-migration', { connection: getRedisConnection() });
  let requeued = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const candidates = await findStuckUserCandidates(STUCK_AFTER_MS, HEARTBEAT_STALE_MS, SWEEP_BATCH);
    for (const user of candidates) {
      if (await isJobStillLive(userQueue, user.bull_job_id)) {
        skipped++;
        console.log(
          `[reaper] ${user.source_email} looks old but its job ${user.bull_job_id} is still ` +
          'live in BullMQ — leaving it alone',
        );
        continue;
      }

      if (user.retry_count < MAX_USER_RETRIES) {
        if (!await claimStuckUserForRetry(user.id, STUCK_AFTER_MS, HEARTBEAT_STALE_MS, MAX_USER_RETRIES)) {
          skipped++; // another reaper got it, or it came back to life
          continue;
        }
        await requeueUser(userQueue, user);
        requeued++;
        console.warn(
          `[reaper] Re-enqueued stuck user ${user.source_email} ` +
          `(job ${user.migration_job_id}, attempt ${user.retry_count}/${MAX_USER_RETRIES})`,
        );
        continue;
      }

      if (await failStuckUser(user.id, STUCK_AFTER_MS, HEARTBEAT_STALE_MS, MAX_USER_RETRIES)) {
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
    }
  } finally {
    await userQueue.close();
  }

  if (requeued > 0 || failed > 0) {
    console.log(`[reaper] User sweep complete — requeued=${requeued} failed=${failed} skipped=${skipped}`);
  }
  return { requeued, failed, skipped };
}

/**
 * Batches whose BullMQ job has vanished — the queue was flushed, Redis lost data,
 * or the job failed in a way that never reached the failure handler. Left alone,
 * each one keeps its user in 'importing' forever. Settling them as failed both
 * frees the user and, because the folder checkpoint never advanced past them,
 * leaves the messages to be re-fetched by a re-run rather than lost.
 */
export async function sweepAbandonedBatches(): Promise<{ settled: number; skipped: number }> {
  const messageQueue = new Queue('message-import', { connection: getRedisConnection() });
  let settled = 0;
  let skipped = 0;

  try {
    const batches = await findAbandonedBatches(BATCH_STUCK_AFTER_MS, SWEEP_BATCH);
    for (const batch of batches) {
      if (await isJobStillLive(messageQueue, batch.bull_job_id)) { skipped++; continue; }

      await settleBatch({
        batchId: batch.id,
        jobId: batch.migration_job_id,
        userId: batch.migration_user_id,
        sourceEmail: batch.source_email,
        outcome: 'failed',
        imported: 0,
        failed: batch.message_count,
        error: 'Batch job disappeared from the queue before it ran',
      });
      settled++;
      console.error(
        `[reaper] Batch ${batch.id} (${batch.source_email}, ${batch.folder_name}, ` +
        `${batch.message_count} message(s)) vanished from the queue — ` +
        'marked unimported so a re-run retries it',
      );
    }
  } finally {
    await messageQueue.close();
  }

  if (settled > 0) console.log(`[reaper] Batch sweep complete — settled=${settled} skipped=${skipped}`);
  return { settled, skipped };
}

/**
 * Users whose batches have all settled but whose completion never fired — the
 * one-in-a-thousand crash between settling a batch and completing its user. The
 * job's progress would otherwise sit at 99% forever with nothing left to run.
 */
export async function sweepCompletableUsers(): Promise<number> {
  const users = await findCompletableImportingUsers(SWEEP_BATCH);
  let completed = 0;
  for (const user of users) {
    const result = await finishUserIfDone(user.migration_job_id, user.id, user.source_email);
    if (result) {
      completed++;
      console.warn(
        `[reaper] Completed ${user.source_email} whose batches had all settled ` +
        '— its completion had been lost',
      );
    }
  }
  return completed;
}

/** Starts the periodic sweep; returns a stop function for graceful shutdown. */
export function startStuckUserReaper(): () => void {
  console.log(
    `[reaper] Stuck-work sweep every ${SWEEP_INTERVAL_MS}ms ` +
    `(user threshold ${STUCK_AFTER_MS}ms, heartbeat stale after ${HEARTBEAT_STALE_MS}ms, ` +
    `batch threshold ${BATCH_STUCK_AFTER_MS}ms, max ${MAX_USER_RETRIES} retries)`,
  );

  let running = false;
  const tick = async () => {
    if (running) return; // never overlap sweeps
    running = true;
    try {
      await sweepStuckUsers();
      await sweepAbandonedBatches();
      await sweepCompletableUsers();
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
