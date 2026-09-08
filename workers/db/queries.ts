import pool from './pool.js';

export async function getMigrationJob(id: string) {
  const { rows: [row] } = await pool.query(
    `SELECT id, workspace_id, source_type, source_host, credentials_enc, status,
            total_users, completed_users, failed_users, imported_messages, imported_bytes,
            allow_insecure_tls
     FROM migration_jobs WHERE id = $1`, [id]
  );
  return row ?? null;
}

const ALLOWED_JOB_COLS = new Set(['started_at', 'completed_at', 'error_message']);
const ALLOWED_USER_COLS = new Set(['started_at', 'completed_at', 'error_message', 'target_account_id']);

export async function updateJobStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  const sets = ['status = $2'];
  const vals: unknown[] = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(extra)) {
    if (!ALLOWED_JOB_COLS.has(k)) throw new Error(`Invalid column for migration_jobs: ${k}`);
    sets.push(`${k} = $${i++}`); vals.push(v);
  }
  await pool.query(`UPDATE migration_jobs SET ${sets.join(', ')} WHERE id = $1`, vals);
}

export async function setJobTotalUsers(id: string, total: number) {
  await pool.query('UPDATE migration_jobs SET total_users = $2 WHERE id = $1', [id, total]);
}

/**
 * Idempotent per (job, source_email) — migration 002 dedupes any historical
 * duplicates and adds the unique index this ON CONFLICT fires against, so an
 * orchestrator retry now updates the existing row instead of inserting a twin.
 */
export async function upsertMigrationUser(
  jobId: string, sourceEmail: string, targetEmail: string, sourceAccountRef?: string,
): Promise<string> {
  const { rows: [row] } = await pool.query(
    `INSERT INTO migration_users (migration_job_id, source_email, target_email, source_account_ref)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (migration_job_id, source_email) DO UPDATE
       SET source_account_ref = COALESCE(EXCLUDED.source_account_ref, migration_users.source_account_ref),
           target_email       = EXCLUDED.target_email
     RETURNING id`,
    [jobId, sourceEmail, targetEmail, sourceAccountRef ?? null]
  );
  return row.id as string;
}

export async function getMigrationUsers(jobId: string) {
  const { rows } = await pool.query(
    `SELECT id, source_email, target_email, status, target_account_id, checkpoint_json, retry_count
     FROM migration_users WHERE migration_job_id = $1 AND status NOT IN ('completed', 'skipped')
     ORDER BY created_at`,
    [jobId]
  );
  return rows;
}

/**
 * Store the password a migrated mailbox was created with, encrypted with the same
 * key that protects the source credentials. Without this the account exists but
 * nobody — not even the org admin — can tell the user how to sign in, which is
 * unworkable past a handful of mailboxes.
 *
 * Encrypted rather than plaintext because it is a live credential at rest; the org
 * admin can already reset any of these passwords, so revealing it to them later
 * grants no privilege they did not have.
 */
export async function setUserTempPassword(id: string, password: string): Promise<void> {
  const { encryptField } = await import('../lib/crypto.js');
  await pool.query('UPDATE migration_users SET temp_password_enc = $2 WHERE id = $1', [id, encryptField(password)]);
}

export async function updateUserStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  const sets = ['status = $2'];
  const vals: unknown[] = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(extra)) {
    if (!ALLOWED_USER_COLS.has(k)) throw new Error(`Invalid column for migration_users: ${k}`);
    sets.push(`${k} = $${i++}`); vals.push(v);
  }
  await pool.query(`UPDATE migration_users SET ${sets.join(', ')} WHERE id = $1`, vals);
}

/**
 * Advance one folder's checkpoint, never lowering it.
 *
 * The read-modify-write of the whole checkpoint blob is deliberately avoided:
 * message-import workers settle batches concurrently, and a blind overwrite would
 * lose a sibling folder's progress. jsonb_set touches only this folder's key, and
 * the WHERE clause makes the update monotonic.
 */
export async function advanceFolderCheckpoint(
  userId: string, folderKey: string, value: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE migration_users
        SET checkpoint_json = jsonb_set(
              COALESCE(checkpoint_json, '{}'::jsonb), ARRAY[$2::text], to_jsonb($3::bigint), true)
      WHERE id = $1
        AND COALESCE((checkpoint_json ->> $2::text)::bigint, -1) < $3::bigint`,
    [userId, folderKey, value],
  );
  return (rowCount ?? 0) > 0;
}

export async function incrementUserProgress(id: string, messages: number, bytes: number) {
  await pool.query(
    'UPDATE migration_users SET imported_messages = imported_messages + $2, imported_bytes = imported_bytes + $3 WHERE id = $1',
    [id, messages, bytes]
  );
  // Also roll up to parent job
  const { rows: [user] } = await pool.query('SELECT migration_job_id FROM migration_users WHERE id = $1', [id]);
  if (user) {
    await pool.query(
      'UPDATE migration_jobs SET imported_messages = imported_messages + $2, imported_bytes = imported_bytes + $3 WHERE id = $1',
      [user.migration_job_id, messages, bytes]
    );
  }
}

export async function incrementJobUserCounts(jobId: string, completed: number, failed: number) {
  await pool.query(
    'UPDATE migration_jobs SET completed_users = completed_users + $2, failed_users = failed_users + $3 WHERE id = $1',
    [jobId, completed, failed]
  );
}

export async function appendMigrationEvent(jobId: string, userId: string | null, eventType: string, payload: Record<string, unknown>) {
  await pool.query(
    'INSERT INTO migration_events (migration_job_id, migration_user_id, event_type, payload) VALUES ($1, $2, $3, $4)',
    [jobId, userId, eventType, JSON.stringify(payload)]
  );
  // Prune events older than last 1000 per job
  await pool.query(
    `DELETE FROM migration_events WHERE migration_job_id = $1 AND id NOT IN (
       SELECT id FROM migration_events WHERE migration_job_id = $1 ORDER BY id DESC LIMIT 1000
     )`,
    [jobId]
  );
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
  const { rows: [row] } = await pool.query('SELECT status FROM migration_jobs WHERE id = $1', [jobId]);
  return row?.status === 'cancelled';
}

export async function getUserCheckpoint(userId: string): Promise<Record<string, number>> {
  const { rows: [row] } = await pool.query(
    'SELECT checkpoint_json FROM migration_users WHERE id = $1', [userId],
  );
  return row?.checkpoint_json ?? {};
}

// ── Outstanding-batch accounting ──────────────────────────────────────────────
//
// A user-migration job only enumerates a mailbox; the mail itself is imported by
// message-import batches that finish minutes or hours later. Every enqueued batch
// is recorded here so that (a) a folder checkpoint advances only over messages a
// batch actually imported and (b) the user is completed only once every batch has
// settled. Without both, a batch that exhausts its retries silently vanishes and
// the job reports 100% while thousands of messages are still queued.

export type BatchOutcome = 'imported' | 'partial' | 'failed' | 'cancelled';

export interface SettledBatch {
  migration_user_id: string;
  migration_job_id: string;
  folder_key: string;
  folder_name: string;
  seq_start: string;
  seq_end: string;
  message_count: number;
}

/**
 * Clear batches left over from a previous attempt at this user.
 *
 * Called when a user-migration job (re)starts enumeration. Every row that is not
 * 'imported' belongs to an attempt being superseded: enumeration resumes from the
 * checkpoint, which by construction sits below all of them, so their ranges are
 * about to be re-covered. Keeping them would double-count the unimported total
 * and — worse — leave a permanently failed row wedged in front of the watermark,
 * blocking the checkpoint even after the retry imported those messages.
 *
 * 'imported' rows are kept: they are what holds the watermark in place.
 */
export interface UnsettledBatch {
  id: string;
  bull_job_id: string | null;
  folder_key: string;
  seq_start: string;
  seq_end: string;
}

/** Batches from a previous attempt that have not reached a terminal state. */
export async function findUnsettledBatches(userId: string): Promise<UnsettledBatch[]> {
  const { rows } = await pool.query(
    `SELECT id, bull_job_id, folder_key, seq_start, seq_end
       FROM migration_batches
      WHERE migration_user_id = $1 AND status = 'pending'`,
    [userId],
  );
  return rows as UnsettledBatch[];
}

/**
 * Discard batch rows whose BullMQ job is gone, and resync the pending counter.
 *
 * Deliberately NOT a blanket reset. A user job retried by BullMQ runs while its
 * previous attempt's batches may still be queued; deleting those rows would
 * strand their settlement (the job settles a row that no longer exists, so
 * pending_batches never drops and the user never completes) on top of letting
 * re-enumeration import their messages twice. Only genuinely dead batches are
 * dropped, so their ranges — still behind the checkpoint — get re-enumerated.
 */
export async function discardDeadBatches(userId: string, deadIds: string[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let dropped = 0;
    if (deadIds.length > 0) {
      const { rowCount } = await client.query(
        `DELETE FROM migration_batches
          WHERE migration_user_id = $1 AND id = ANY($2::uuid[]) AND status = 'pending'`,
        [userId, deadIds],
      );
      dropped = rowCount ?? 0;
    }
    // enqueue_complete goes back to false because this attempt is about to
    // enumerate again; the counter is recomputed rather than zeroed.
    await client.query(
      `UPDATE migration_users u
          SET enqueue_complete = FALSE,
              pending_batches = (
                SELECT COUNT(*) FROM migration_batches b
                 WHERE b.migration_user_id = u.id AND b.status = 'pending'
              )
        WHERE u.id = $1`,
      [userId],
    );
    await client.query('COMMIT');
    return dropped;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* ignore */ });
    throw err;
  } finally {
    client.release();
  }
}

export async function registerMessageBatch(reg: {
  jobId: string; userId: string; folderKey: string; folderName: string;
  seqStart: number; seqEnd: number; messageCount: number;
}): Promise<{ batchId: string; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A batch is its range (004). A retrying user job re-enumerates from a
    // checkpoint that deliberately never advanced past unsettled batches, so it
    // re-registers ranges whose first batch may still be queued. DO NOTHING
    // makes that a no-op rather than a duplicate row and a duplicate import.
    const { rows: [inserted] } = await client.query(
      `INSERT INTO migration_batches
         (migration_job_id, migration_user_id, folder_key, folder_name,
          seq_start, seq_end, message_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (migration_user_id, folder_key, seq_start, seq_end) DO NOTHING
       RETURNING id`,
      [reg.jobId, reg.userId, reg.folderKey, reg.folderName,
       reg.seqStart, reg.seqEnd, reg.messageCount],
    );
    if (!inserted) {
      // Already registered by the attempt we superseded. Leave its accounting
      // alone — that batch is still the one that will settle this range.
      const { rows: [existing] } = await client.query(
        `SELECT id FROM migration_batches
          WHERE migration_user_id = $1 AND folder_key = $2
            AND seq_start = $3 AND seq_end = $4`,
        [reg.userId, reg.folderKey, reg.seqStart, reg.seqEnd],
      );
      await client.query('COMMIT');
      return { batchId: String(existing.id), created: false };
    }
    const row = inserted;
    await client.query(
      'UPDATE migration_users SET pending_batches = pending_batches + 1 WHERE id = $1',
      [reg.userId],
    );
    await client.query('COMMIT');
    return { batchId: String(row.id), created: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* ignore */ });
    throw err;
  } finally {
    client.release();
  }
}

export async function attachBatchBullJob(batchId: string, bullJobId: string): Promise<void> {
  await pool.query('UPDATE migration_batches SET bull_job_id = $2 WHERE id = $1', [batchId, bullJobId]);
}

/** Undo a registration whose enqueue never made it onto the queue. */
export async function voidMessageBatch(batchId: string, userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `DELETE FROM migration_batches WHERE id = $1 AND status = 'pending'`, [batchId],
    );
    if (rowCount) {
      await client.query(
        'UPDATE migration_users SET pending_batches = GREATEST(pending_batches - 1, 0) WHERE id = $1',
        [userId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* ignore */ });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record a batch's final outcome. The UPDATE is the claim — it only fires on a
 * row still 'pending', so a batch that runs twice (BullMQ retry after a crash
 * that happened between settling and acking) is counted exactly once.
 */
export async function settleMessageBatch(
  batchId: string, outcome: BatchOutcome,
  imported: number, failed: number, vanished: number, errorMessage?: string,
): Promise<SettledBatch | null> {
  const { rows: [row] } = await pool.query(
    `UPDATE migration_batches
        SET status = $2, imported_count = $3, failed_count = $4, vanished_count = $5,
            error_message = $6, settled_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING migration_user_id, migration_job_id, folder_key, folder_name,
                seq_start, seq_end, message_count`,
    [batchId, outcome, imported, failed, vanished, errorMessage ?? null],
  );
  return (row as SettledBatch | undefined) ?? null;
}

export async function decrementPendingBatches(
  userId: string,
): Promise<{ pending: number; enqueueComplete: boolean }> {
  const { rows: [row] } = await pool.query(
    `UPDATE migration_users SET pending_batches = GREATEST(pending_batches - 1, 0)
      WHERE id = $1 RETURNING pending_batches, enqueue_complete`,
    [userId],
  );
  return {
    pending: Number(row?.pending_batches ?? 0),
    enqueueComplete: Boolean(row?.enqueue_complete),
  };
}

/**
 * Highest sequence number in a folder that is covered by an unbroken prefix of
 * fully-imported batches — i.e. the last message we can prove landed. Anything at
 * or after the first not-fully-imported batch stays behind the checkpoint so a
 * re-run picks it up again. Returns null when nothing has been proven yet.
 */
export async function folderImportWatermark(
  userId: string, folderKey: string,
): Promise<number | null> {
  const { rows: [row] } = await pool.query(
    `SELECT MAX(seq_end) AS watermark
       FROM migration_batches
      WHERE migration_user_id = $1 AND folder_key = $2 AND status = 'imported'
        AND seq_end < COALESCE(
              (SELECT MIN(seq_start) FROM migration_batches
                WHERE migration_user_id = $1 AND folder_key = $2 AND status <> 'imported'),
              9223372036854775807)`,
    [userId, folderKey],
  );
  return row?.watermark === null || row?.watermark === undefined ? null : Number(row.watermark);
}

/**
 * Mark enumeration finished. Until this flips, the user cannot complete no matter
 * how many batches have settled — otherwise a fast first batch would "finish" a
 * user whose remaining folders have not even been walked yet.
 */
export async function markUserEnqueueComplete(
  userId: string,
): Promise<{ pending: number }> {
  const { rows: [row] } = await pool.query(
    `UPDATE migration_users
        SET enqueue_complete = TRUE,
            status = CASE WHEN pending_batches > 0 AND status IN ('creating','migrating')
                          THEN 'importing' ELSE status END
      WHERE id = $1
      RETURNING pending_batches`,
    [userId],
  );
  return { pending: Number(row?.pending_batches ?? 0) };
}

export interface UserCompletion {
  status: string;
  imported: number;
  unimported: number;
  /** Messages that no longer existed at the source — gone, not lost. */
  vanished: number;
  badBatches: number;
}

/**
 * Complete a user iff enumeration is done and no batch is outstanding. Atomic:
 * whichever settling worker (or the enumerator, for an empty mailbox) sees the
 * last condition fall wins the UPDATE, and only that caller bumps the job's
 * user counters. Returns null for everyone else.
 *
 * Messages that no batch managed to import are surfaced rather than swallowed:
 * they are stored on unimported_messages and spelled out in error_message, and
 * the folder checkpoints deliberately still sit behind them so a re-run retries.
 */
export async function tryCompleteUser(userId: string): Promise<UserCompletion | null> {
  const { rows: [row] } = await pool.query(
    `WITH agg AS (
       SELECT COALESCE(SUM(imported_count), 0)::bigint AS imported,
              COALESCE(SUM(GREATEST(message_count - imported_count - vanished_count, 0)), 0)::bigint
                AS unimported,
              COALESCE(SUM(vanished_count), 0)::bigint AS vanished,
              COUNT(*) FILTER (WHERE status <> 'imported')::bigint AS bad_batches
         FROM migration_batches WHERE migration_user_id = $1
     )
     UPDATE migration_users u
        SET status = CASE WHEN agg.unimported > 0 AND agg.imported = 0 THEN 'failed'
                          ELSE 'completed' END,
            completed_at = NOW(),
            unimported_messages = agg.unimported,
            error_message = CASE
              WHEN agg.unimported = 0 THEN u.error_message
              ELSE agg.unimported || ' message(s) could not be imported across '
                   || agg.bad_batches || ' batch(es); folder checkpoints were held back '
                   || 'so a re-run of this user will retry them'
            END
       FROM agg
      WHERE u.id = $1
        AND u.enqueue_complete
        AND u.status IN ('creating', 'migrating', 'importing')
        -- The authoritative test is "no batch row is still open", not the
        -- pending_batches counter: a worker that dies between settling a batch
        -- and decrementing the counter would otherwise strand the user forever.
        AND NOT EXISTS (
              SELECT 1 FROM migration_batches b
               WHERE b.migration_user_id = u.id AND b.status = 'pending')
      RETURNING u.status, agg.imported, agg.unimported, agg.vanished, agg.bad_batches`,
    [userId],
  );
  if (!row) return null;
  return {
    status: row.status as string,
    imported: Number(row.imported),
    unimported: Number(row.unimported),
    vanished: Number(row.vanished),
    badBatches: Number(row.bad_batches),
  };
}

/**
 * Users whose batches have all settled but which were never completed — the
 * safety net for a decrement lost to a crash. The reaper retries completion for
 * these; tryCompleteUser() is idempotent, so a false positive costs one UPDATE.
 */
export async function findCompletableImportingUsers(
  limit: number,
): Promise<Array<{ id: string; migration_job_id: string; source_email: string }>> {
  const { rows } = await pool.query(
    `SELECT u.id, u.migration_job_id, u.source_email
       FROM migration_users u
       JOIN migration_jobs j ON j.id = u.migration_job_id
      WHERE u.status = 'importing'
        AND u.enqueue_complete
        AND j.status NOT IN ('completed','failed','cancelled')
        AND NOT EXISTS (
              SELECT 1 FROM migration_batches b
               WHERE b.migration_user_id = u.id AND b.status = 'pending')
      LIMIT $1`,
    [limit],
  );
  return rows as Array<{ id: string; migration_job_id: string; source_email: string }>;
}

/** Liveness signal for the reaper — written while a user job is enumerating. */
export async function heartbeatUser(userId: string): Promise<void> {
  await pool.query('UPDATE migration_users SET heartbeat_at = NOW() WHERE id = $1', [userId]);
}

export async function setUserBullJobId(userId: string, bullJobId: string): Promise<void> {
  await pool.query(
    'UPDATE migration_users SET bull_job_id = $2, heartbeat_at = NOW() WHERE id = $1',
    [userId, bullJobId],
  );
}

/**
 * Atomic completion: only one worker wins the UPDATE, so the job reports its
 * final status exactly once no matter how many workers finish concurrently.
 */
export async function finalizeJobIfComplete(jobId: string): Promise<void> {
  const { rows: [counts] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','skipped')) AS pending,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) AS total
     FROM migration_users WHERE migration_job_id = $1`, [jobId],
  );
  if (Number(counts?.pending ?? 1) !== 0) return;

  const finalStatus = Number(counts?.failed) > 0 && Number(counts?.failed) === Number(counts?.total)
    ? 'failed' : 'completed';
  const { rows } = await pool.query(
    `UPDATE migration_jobs SET status = $1, completed_at = NOW()
     WHERE id = $2 AND status NOT IN ('completed','failed','cancelled')
     RETURNING id`,
    [finalStatus, jobId],
  );
  if (rows.length > 0) {
    await appendMigrationEvent(jobId, null, 'job_completed', { status: finalStatus });
  }
}

export interface StuckMigrationUser {
  id: string;
  migration_job_id: string;
  source_email: string;
  target_email: string;
  source_account_ref: string | null;
  source_type: string;
  workspace_id: string;
  retry_count: number;
  bull_job_id: string | null;
}

// Age alone does not mean dead. A user row is only a reaping candidate when its
// worker has also stopped heartbeating; the caller then confirms against BullMQ
// before claiming it. 'importing' is deliberately not a candidate state — no
// worker owns a user while its batches are queued, so liveness there is a
// property of the batches (see findAbandonedBatches).
const STUCK_CANDIDATE_SQL = `
  FROM migration_users s
  JOIN migration_jobs sj ON sj.id = s.migration_job_id
 WHERE s.status IN ('creating','migrating')
   AND s.started_at IS NOT NULL
   AND s.started_at < NOW() - ($1::text || ' milliseconds')::interval
   AND COALESCE(s.heartbeat_at, s.started_at) < NOW() - ($2::text || ' milliseconds')::interval
   AND sj.status NOT IN ('completed','failed','cancelled')`;

/**
 * Users that look dead: old, silent, and still holding a non-terminal status.
 * Read-only — the caller checks BullMQ for a live job before claiming.
 */
export async function findStuckUserCandidates(
  stuckAfterMs: number, heartbeatStaleMs: number, limit: number,
): Promise<StuckMigrationUser[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.migration_job_id, s.source_email, s.target_email,
            s.source_account_ref, s.retry_count, s.bull_job_id,
            sj.source_type, sj.workspace_id
     ${STUCK_CANDIDATE_SQL}
     ORDER BY s.started_at
     LIMIT $3`,
    [String(stuckAfterMs), String(heartbeatStaleMs), limit],
  );
  return rows as StuckMigrationUser[];
}

/**
 * Claim one dead user and reset it to 'pending'. The UPDATE re-checks the
 * liveness predicate, so a user that started heartbeating again between the scan
 * and the claim — or that another reaper already took — is left alone.
 */
export async function claimStuckUserForRetry(
  userId: string, stuckAfterMs: number, heartbeatStaleMs: number, maxRetries: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE migration_users u
        SET status = 'pending', retry_count = u.retry_count + 1, heartbeat_at = NULL
      WHERE u.id = (SELECT s.id ${STUCK_CANDIDATE_SQL} AND s.id = $3 AND s.retry_count < $4)`,
    [String(stuckAfterMs), String(heartbeatStaleMs), userId, maxRetries],
  );
  return (rowCount ?? 0) > 0;
}

/** A user that has burned through its retries — give up and report failure. */
export async function failStuckUser(
  userId: string, stuckAfterMs: number, heartbeatStaleMs: number, maxRetries: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE migration_users u
        SET status = 'failed', completed_at = NOW(),
            error_message = COALESCE(u.error_message,
              'Abandoned by reaper: stuck in migration after ' || u.retry_count || ' attempt(s)')
      WHERE u.id = (SELECT s.id ${STUCK_CANDIDATE_SQL} AND s.id = $3 AND s.retry_count >= $4)`,
    [String(stuckAfterMs), String(heartbeatStaleMs), userId, maxRetries],
  );
  return (rowCount ?? 0) > 0;
}

export interface AbandonedBatch {
  id: string;
  migration_job_id: string;
  migration_user_id: string;
  source_email: string;
  folder_name: string;
  message_count: number;
  bull_job_id: string | null;
}

/**
 * Batches still 'pending' long after they were enqueued. Their BullMQ job may
 * simply be waiting behind a deep queue, so the caller must confirm the job is
 * really gone before settling them — otherwise the user would be completed while
 * mail is still landing.
 */
export async function findAbandonedBatches(
  olderThanMs: number, limit: number,
): Promise<AbandonedBatch[]> {
  const { rows } = await pool.query(
    `SELECT b.id, b.migration_job_id, b.migration_user_id, b.folder_name,
            b.message_count, b.bull_job_id, u.source_email
       FROM migration_batches b
       JOIN migration_users u ON u.id = b.migration_user_id
       JOIN migration_jobs j ON j.id = b.migration_job_id
      WHERE b.status = 'pending'
        AND b.created_at < NOW() - ($1::text || ' milliseconds')::interval
        AND j.status NOT IN ('completed','failed','cancelled')
      ORDER BY b.created_at
      LIMIT $2`,
    [String(olderThanMs), limit],
  );
  return rows as AbandonedBatch[];
}
