import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { getRedisConnection } from '../queues/connection.js';
import { decryptCredentials } from '../lib/crypto.js';
import {
  getMigrationJob, updateUserStatus, updateUserCheckpoint,
  appendMigrationEvent, incrementJobUserCounts, isJobCancelled,
} from '../db/queries.js';
import { buildImapCredentials, FOLDER_ROLE_MAP } from '../imap/master-user.js';
import { ensureAccountExists, resolveMailboxId } from '../stalwart/account-manager.js';
import {
  fetchZohoFolders, fetchZohoMessageIds,
  zohoApiBase, type ZohoCreds,
} from '../imap/providers/zoho.js';
import pool from '../db/pool.js';

export async function userMigrationProcessor(job: Job): Promise<void> {
  const {
    jobId, userId, sourceEmail, targetEmail, sourceType, zohoAccountId,
  } = job.data as {
    jobId: string; userId: string; sourceEmail: string;
    targetEmail: string; sourceType: string; zohoAccountId?: string;
  };
  console.log(`[user-migration] ${sourceEmail} → ${targetEmail} (${sourceType})`);

  if (await isJobCancelled(jobId)) return;

  const dbJob = await getMigrationJob(jobId);
  if (!dbJob) throw new Error(`Job ${jobId} not found`);
  const creds = decryptCredentials(Buffer.from(dbJob.credentials_enc));

  await updateUserStatus(userId, 'creating', { started_at: new Date() });
  await appendMigrationEvent(jobId, userId, 'user_started', { sourceEmail, targetEmail });

  // Create Arham account
  let accountId: string;
  try {
    accountId = await ensureAccountExists(targetEmail, targetEmail.split('@')[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: `Account creation failed: ${msg}` });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  }

  await updateUserStatus(userId, 'migrating', { target_account_id: accountId });

  if (sourceType === 'zoho') {
    await migrateZohoUser({
      jobId, userId, sourceEmail, accountId,
      creds: creds as unknown as ZohoCreds,
      zohoAccountId: zohoAccountId ?? sourceEmail,
    });
  } else {
    await migrateImapUser({ jobId, userId, sourceEmail, accountId, sourceType, creds });
  }

  await updateUserStatus(userId, 'completed', { completed_at: new Date() });
  await incrementJobUserCounts(jobId, 1, 0);
  await appendMigrationEvent(jobId, userId, 'user_completed', { sourceEmail, targetEmail });

  // Mark job completed when all users done
  const { rows: [counts] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','skipped')) AS pending,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) AS total
     FROM migration_users WHERE migration_job_id = $1`, [jobId],
  );
  if (Number(counts?.pending ?? 1) === 0) {
    const finalStatus = Number(counts?.failed) > 0 && Number(counts?.failed) === Number(counts?.total)
      ? 'failed' : 'completed';
    const { rows: [j] } = await pool.query('SELECT status FROM migration_jobs WHERE id = $1', [jobId]);
    if (j?.status !== 'cancelled') {
      await pool.query(
        'UPDATE migration_jobs SET status = $1, completed_at = NOW() WHERE id = $2',
        [finalStatus, jobId],
      );
      await appendMigrationEvent(jobId, null, 'job_completed', { status: finalStatus });
    }
  }
}

// ── Zoho REST API path ─────────────────────────────────────────────────────────

async function migrateZohoUser(params: {
  jobId: string; userId: string; sourceEmail: string;
  accountId: string; creds: ZohoCreds; zohoAccountId: string;
}): Promise<void> {
  const { jobId, userId, sourceEmail, accountId, creds, zohoAccountId } = params;

  const { rows: [userRow] } = await pool.query(
    'SELECT checkpoint_json FROM migration_users WHERE id = $1', [userId],
  );
  // checkpoint: { [folderId]: lastProcessedOffset }
  const checkpoint: Record<string, number> = userRow?.checkpoint_json ?? {};

  let folders;
  try {
    folders = await fetchZohoFolders(creds, zohoAccountId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: msg, completed_at: new Date() });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  }

  const messageQueue = new Queue('message-import', { connection: getRedisConnection() });

  for (const folder of folders) {
    if (await isJobCancelled(jobId)) break;

    const mailboxId = await resolveMailboxId(accountId, folder.folderName, FOLDER_ROLE_MAP);
    let start = checkpoint[folder.folderId] ?? 0;

    while (true) {
      if (await isJobCancelled(jobId)) break;

      const { messages, hasMore } = await fetchZohoMessageIds(creds, zohoAccountId, folder.folderId, start);
      if (messages.length === 0) break;

      // Enqueue in batches of 50
      for (let i = 0; i < messages.length; i += 50) {
        const batch = messages.slice(i, i + 50);
        await messageQueue.add('import-batch', {
          jobId, userId, accountId, mailboxId,
          folderName: folder.folderName,
          sourceType: 'zoho',
          // Zoho-specific fields
          zohoApiBase: zohoApiBase(creds),
          zohoOrgId: creds.orgId,
          zohoAccountId,
          zohoAccessToken: creds.accessToken,
          zohoBatch: batch, // { messageId, receivedTime, isRead, isFlagged }[]
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        });
      }

      start += messages.length;
      checkpoint[folder.folderId] = start;
      await updateUserCheckpoint(userId, checkpoint);

      if (!hasMore) break;
    }
  }

  await messageQueue.close();
}

// ── IMAP path (cPanel / Dovecot) ──────────────────────────────────────────────

async function migrateImapUser(params: {
  jobId: string; userId: string; sourceEmail: string;
  accountId: string; sourceType: string; creds: Record<string, string>;
}): Promise<void> {
  const { jobId, userId, sourceEmail, accountId, sourceType, creds } = params;

  let imapCreds;
  try {
    imapCreds = buildImapCredentials(sourceType, creds, sourceEmail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: msg, completed_at: new Date() });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  }

  const { rows: [userRow] } = await pool.query(
    'SELECT checkpoint_json FROM migration_users WHERE id = $1', [userId],
  );
  const checkpoint: Record<string, number> = userRow?.checkpoint_json ?? {};

  const client = new ImapFlow({
    host: imapCreds.host,
    port: imapCreds.port,
    secure: imapCreds.secure,
    auth: imapCreds.auth,
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const folders = await client.list();
    const messageQueue = new Queue('message-import', { connection: getRedisConnection() });

    for (const folder of folders) {
      if (await isJobCancelled(jobId)) break;

      const folderName = folder.path;
      const lastUid = checkpoint[folderName] ?? 0;

      const lock = await client.getMailboxLock(folderName);
      try {
        const uids: number[] = [];
        for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true })) {
          uids.push(msg.uid);
        }
        if (uids.length === 0) continue;

        const mailboxId = await resolveMailboxId(accountId, folderName, FOLDER_ROLE_MAP);

        for (let i = 0; i < uids.length; i += 50) {
          const batch = uids.slice(i, i + 50);
          await messageQueue.add('import-batch', {
            jobId, userId, accountId, mailboxId, folderName,
            sourceType,
            uids: batch,
            imapHost: imapCreds.host,
            imapPort: imapCreds.port,
            imapSecure: imapCreds.secure,
            imapUser: imapCreds.auth.user,
            imapPass: imapCreds.auth.pass,
          }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: { count: 100 },
            removeOnFail: false,
          });
        }

        checkpoint[folderName] = uids[uids.length - 1];
        await updateUserCheckpoint(userId, checkpoint);
      } finally {
        lock.release();
      }
    }

    await messageQueue.close();
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: msg, completed_at: new Date() });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  }
}
