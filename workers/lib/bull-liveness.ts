import { createHash } from 'node:crypto';
import type { Queue } from 'bullmq';

// States in which BullMQ still intends to run (or is running) the job.
const LIVE_JOB_STATES = new Set([
  'active', 'waiting', 'waiting-children', 'delayed', 'prioritized', 'paused', 'repeat',
]);

/**
 * Is BullMQ still holding this job?
 *
 * Errors answer "yes". Refusing to act on an inconclusive check costs a delay;
 * acting on a wrong "dead" answer costs duplicated mail, because the work this
 * guards is either re-enqueued (the reaper) or re-enumerated (a retrying user
 * job) while the original is still running.
 */
export async function isJobStillLive(
  queue: Queue, bullJobId: string | null, context = 'bull',
): Promise<boolean> {
  if (!bullJobId) return false;
  try {
    const job = await queue.getJob(bullJobId);
    if (!job) return false;
    return LIVE_JOB_STATES.has(await job.getState());
  } catch (err) {
    console.warn(
      `[${context}] Could not determine state of job ${bullJobId} ` +
      `(${err instanceof Error ? err.message : err}) — assuming alive`,
    );
    return true;
  }
}

/**
 * Deterministic BullMQ job id for a batch covering an inclusive source range.
 *
 * Two enqueues of the same range produce the same id, and BullMQ refuses to add
 * a job whose id already exists — so a user job that is retried while its
 * previous attempt's batches are still queued cannot import those messages a
 * second time. The folder key is hashed because it is a raw IMAP path and may
 * contain anything.
 */
export function batchJobId(
  userId: string, folderKey: string, seqStart: number, seqEnd: number,
): string {
  const folder = createHash('sha1').update(folderKey).digest('hex').slice(0, 12);
  return `b-${userId}-${folder}-${seqStart}-${seqEnd}`;
}
