import {
  settleMessageBatch, decrementPendingBatches, folderImportWatermark,
  advanceFolderCheckpoint, type BatchOutcome,
} from '../db/queries.js';
import { finishUserIfDone } from './user-completion.js';

// A batch is the unit the rest of the system reasons about: a user's folder
// checkpoint only advances over batches that imported every message they were
// given, and the user is only completed once no batch is outstanding. Settling is
// therefore the single place both of those move — from the worker that ran the
// batch, from the retry-exhausted handler, or from the reaper.

/**
 * Sequence-to-checkpoint offset. IMAP enumerates by UID and resumes at
 * `lastUid + 1`, so the checkpoint stores the last imported UID. Zoho paginates
 * by list offset and resumes at `start`, so it stores one past the last index.
 */
export function checkpointOffsetFor(sourceType: string | undefined): number {
  return sourceType === 'zoho' ? 1 : 0;
}

/**
 * How a finished (non-throwing) batch should be recorded. `accountedFor` is the
 * number of messages whose fate is settled and unrecoverable-by-retry: imported
 * plus vanished-at-source. Only a batch that accounts for every message it was
 * given may move its folder's checkpoint.
 */
export function outcomeFor(accountedFor: number, expected: number): BatchOutcome {
  return accountedFor >= expected ? 'imported' : 'partial';
}

export async function settleBatch(args: {
  batchId?: string; jobId: string; userId: string; sourceType?: string;
  sourceEmail?: string; outcome: BatchOutcome;
  imported: number; failed: number; vanished?: number; error?: string;
}): Promise<void> {
  const { batchId, jobId, userId, sourceType, sourceEmail, outcome, imported, failed, error } = args;
  const vanished = args.vanished ?? 0;

  if (!batchId) {
    // Enqueued before batch accounting existed. Nothing to settle, and nothing to
    // hold the user open either — those legacy jobs completed their users eagerly.
    console.warn('[batch] no batchId on this job (pre-accounting enqueue) — settlement skipped');
    return;
  }

  const settled = await settleMessageBatch(batchId, outcome, imported, failed, vanished, error);
  // Null means another run of the same batch already settled it: the counters
  // below have already been applied, and applying them twice would complete the
  // user early.
  if (!settled) return;

  if (outcome === 'imported') {
    // Advance the folder checkpoint over the unbroken prefix of fully-imported
    // batches — never past a batch that failed or only partly landed.
    const watermark = await folderImportWatermark(settled.migration_user_id, settled.folder_key);
    if (watermark !== null) {
      await advanceFolderCheckpoint(
        settled.migration_user_id, settled.folder_key,
        watermark + checkpointOffsetFor(sourceType),
      );
    }
  }

  const { pending, enqueueComplete } = await decrementPendingBatches(settled.migration_user_id);
  if (pending === 0 && enqueueComplete) {
    await finishUserIfDone(jobId, userId, sourceEmail);
  }
}
