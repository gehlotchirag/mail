import {
  tryCompleteUser, incrementJobUserCounts, appendMigrationEvent,
  finalizeJobIfComplete, isJobCancelled, type UserCompletion,
} from '../db/queries.js';

/**
 * Complete a user if — and only if — its enumeration has finished AND every
 * message batch it enqueued has settled.
 *
 * Called from three places, all of which may be the one that tips the balance:
 * the enumerator (an empty mailbox enqueues nothing), a message-import worker
 * finishing the last batch, and the reaper settling a batch whose worker died.
 * tryCompleteUser() is atomic, so exactly one of them gets a non-null result and
 * the job's user counters move exactly once.
 */
export async function finishUserIfDone(
  jobId: string, userId: string, sourceEmail = '',
): Promise<UserCompletion | null> {
  // A cancelled job's users are left where they are: their batches never ran, so
  // "completing" them would report an import that did not happen.
  if (await isJobCancelled(jobId)) return null;

  const completion = await tryCompleteUser(userId);
  if (!completion) return null;

  const failed = completion.status === 'failed';
  await incrementJobUserCounts(jobId, failed ? 0 : 1, failed ? 1 : 0);
  await appendMigrationEvent(jobId, userId, failed ? 'user_failed' : 'user_completed', {
    sourceEmail,
    imported: completion.imported,
    unimported: completion.unimported,
    vanished: completion.vanished,
    failedBatches: completion.badBatches,
  });

  if (completion.unimported > 0) {
    // Never let unimported mail disappear quietly — this is the line an operator
    // greps for after a migration that "succeeded".
    console.error(
      `[user-completion] ${sourceEmail || userId}: ${completion.unimported} message(s) ` +
      `NOT imported across ${completion.badBatches} unfinished batch(es) ` +
      `(${completion.imported} imported). Folder checkpoints were held back — ` +
      're-running this user will retry the missing messages.',
    );
  } else {
    console.log(
      `[user-completion] ${sourceEmail || userId}: ${completion.imported} message(s) imported` +
      (completion.vanished > 0
        ? ` (${completion.vanished} no longer existed at the source)` : ''),
    );
  }

  await finalizeJobIfComplete(jobId);
  return completion;
}
