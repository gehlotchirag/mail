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

export async function upsertMigrationUser(
  jobId: string, sourceEmail: string, targetEmail: string, sourceAccountRef?: string,
): Promise<string> {
  const { rows: [row] } = await pool.query(
    `INSERT INTO migration_users (migration_job_id, source_email, target_email, source_account_ref)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [jobId, sourceEmail, targetEmail, sourceAccountRef ?? null]
  );
  if (row) return row.id as string;
  // Already exists — refresh the provider handle and return existing id
  const { rows: [existing] } = await pool.query(
    `UPDATE migration_users SET source_account_ref = COALESCE($3, source_account_ref)
     WHERE migration_job_id = $1 AND source_email = $2
     RETURNING id`,
    [jobId, sourceEmail, sourceAccountRef ?? null]
  );
  return existing.id as string;
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

export async function updateUserCheckpoint(id: string, checkpoint: Record<string, number>) {
  await pool.query(
    'UPDATE migration_users SET checkpoint_json = $2 WHERE id = $1',
    [id, JSON.stringify(checkpoint)]
  );
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
}

/**
 * Claim users left mid-flight by a crashed worker and reset them to 'pending'.
 * The UPDATE is the claim — a row can only be handed to one reaper.
 */
export async function claimStuckUsersForRetry(
  stuckAfterMs: number, maxRetries: number, limit: number,
): Promise<StuckMigrationUser[]> {
  const { rows } = await pool.query(
    `UPDATE migration_users u
        SET status = 'pending', retry_count = u.retry_count + 1
       FROM migration_jobs j
      WHERE u.id IN (
              SELECT s.id FROM migration_users s
                JOIN migration_jobs sj ON sj.id = s.migration_job_id
               WHERE s.status IN ('creating','migrating')
                 AND s.started_at IS NOT NULL
                 AND s.started_at < NOW() - ($1::text || ' milliseconds')::interval
                 AND s.retry_count < $2
                 AND sj.status NOT IN ('completed','failed','cancelled')
               ORDER BY s.started_at
               LIMIT $3
            )
        AND j.id = u.migration_job_id
  RETURNING u.id, u.migration_job_id, u.source_email, u.target_email,
            u.source_account_ref, u.retry_count,
            j.source_type, j.workspace_id`,
    [String(stuckAfterMs), maxRetries, limit],
  );
  return rows as StuckMigrationUser[];
}

/** Users that have burned through their retries — give up and report failure. */
export async function failExhaustedStuckUsers(
  stuckAfterMs: number, maxRetries: number, limit: number,
): Promise<Array<{ id: string; migration_job_id: string; source_email: string }>> {
  const { rows } = await pool.query(
    `UPDATE migration_users u
        SET status = 'failed', completed_at = NOW(),
            error_message = COALESCE(u.error_message,
              'Abandoned by reaper: stuck in migration after ' || u.retry_count || ' attempt(s)')
      WHERE u.id IN (
              SELECT s.id FROM migration_users s
                JOIN migration_jobs sj ON sj.id = s.migration_job_id
               WHERE s.status IN ('creating','migrating')
                 AND s.started_at IS NOT NULL
                 AND s.started_at < NOW() - ($1::text || ' milliseconds')::interval
                 AND s.retry_count >= $2
                 AND sj.status NOT IN ('completed','failed','cancelled')
               ORDER BY s.started_at
               LIMIT $3
            )
  RETURNING u.id, u.migration_job_id, u.source_email`,
    [String(stuckAfterMs), maxRetries, limit],
  );
  return rows as Array<{ id: string; migration_job_id: string; source_email: string }>;
}
