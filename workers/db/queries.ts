import pool from './pool.js';

export async function getMigrationJob(id: string) {
  const { rows: [row] } = await pool.query(
    `SELECT id, workspace_id, source_type, source_host, credentials_enc, status,
            total_users, completed_users, failed_users, imported_messages, imported_bytes
     FROM migration_jobs WHERE id = $1`, [id]
  );
  return row ?? null;
}

export async function updateJobStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  const sets = ['status = $2'];
  const vals: unknown[] = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = $${i++}`); vals.push(v); }
  await pool.query(`UPDATE migration_jobs SET ${sets.join(', ')} WHERE id = $1`, vals);
}

export async function setJobTotalUsers(id: string, total: number) {
  await pool.query('UPDATE migration_jobs SET total_users = $2 WHERE id = $1', [id, total]);
}

export async function upsertMigrationUser(jobId: string, sourceEmail: string, targetEmail: string): Promise<string> {
  const { rows: [row] } = await pool.query(
    `INSERT INTO migration_users (migration_job_id, source_email, target_email)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [jobId, sourceEmail, targetEmail]
  );
  if (row) return row.id as string;
  // Already exists — return existing id
  const { rows: [existing] } = await pool.query(
    'SELECT id FROM migration_users WHERE migration_job_id = $1 AND source_email = $2',
    [jobId, sourceEmail]
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
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = $${i++}`); vals.push(v); }
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
    'INSERT INTO migration_events (migration_job_id, user_id, event_type, payload) VALUES ($1, $2, $3, $4)',
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
