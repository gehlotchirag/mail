import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { getRedisConnection } from '../queues/connection.js';
import { decryptCredentials, encryptField } from '../lib/crypto.js';
import {
  getMigrationJob, updateUserStatus, updateUserCheckpoint, getUserCheckpoint,
  appendMigrationEvent, incrementJobUserCounts, isJobCancelled, finalizeJobIfComplete,
} from '../db/queries.js';
import { buildImapCredentials, resolveImapAuth, FOLDER_ROLE_MAP } from '../imap/master-user.js';
import { buildImapTlsOptions, parseAllowInsecureTls } from '../lib/imap-tls.js';
import { ensureAccountExists, resolveMailboxId } from '../stalwart/account-manager.js';
import {
  fetchZohoFolders, fetchZohoMessageIds, refreshZohoToken,
  zohoApiBase, type ZohoCreds,
} from '../imap/providers/zoho.js';

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
  // TLS verification is on unless this job carries an explicit, recorded opt-out.
  const allowInsecureTls = parseAllowInsecureTls(dbJob.allow_insecure_tls);

  await updateUserStatus(userId, 'creating', { started_at: new Date() });
  await appendMigrationEvent(jobId, userId, 'user_started', { sourceEmail, targetEmail });

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
    await migrateImapUser({
      jobId, userId, sourceEmail, accountId, sourceType, creds, allowInsecureTls,
    });
  }

  await updateUserStatus(userId, 'completed', { completed_at: new Date() });
  await incrementJobUserCounts(jobId, 1, 0);
  await appendMigrationEvent(jobId, userId, 'user_completed', { sourceEmail, targetEmail });

  await finalizeJobIfComplete(jobId);
}

// ── Zoho REST API path ─────────────────────────────────────────────────────────

async function migrateZohoUser(params: {
  jobId: string; userId: string; sourceEmail: string;
  accountId: string; creds: ZohoCreds; zohoAccountId: string;
}): Promise<void> {
  const { jobId, userId, sourceEmail, accountId, creds, zohoAccountId } = params;

  const checkpoint = await getUserCheckpoint(userId);

  // Refresh token before enqueuing so batches start with a fresh token
  let freshToken: string;
  try {
    freshToken = await refreshZohoToken(creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: msg, completed_at: new Date() });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  }

  let folders;
  try {
    folders = await fetchZohoFolders({ ...creds, accessToken: freshToken }, zohoAccountId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: msg, completed_at: new Date() });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  }

  const messageQueue = new Queue('message-import', { connection: getRedisConnection() });

  // Encrypt sensitive tokens before storing in Redis job payloads (S-2)
  const accessTokenEnc = encryptField(freshToken);
  const refreshTokenEnc = creds.refreshToken ? encryptField(creds.refreshToken) : undefined;
  const clientIdEnc     = creds.clientId     ? encryptField(creds.clientId)     : undefined;
  const clientSecretEnc = creds.clientSecret  ? encryptField(creds.clientSecret)  : undefined;

  for (const folder of folders) {
    if (await isJobCancelled(jobId)) break;

    const mailboxId = await resolveMailboxId(accountId, folder.folderName, FOLDER_ROLE_MAP);
    let start = checkpoint[folder.folderId] ?? 0;

    while (true) {
      if (await isJobCancelled(jobId)) break;

      const { messages, hasMore } = await fetchZohoMessageIds(
        { ...creds, accessToken: freshToken }, zohoAccountId, folder.folderId, start,
      );
      if (messages.length === 0) break;

      for (let i = 0; i < messages.length; i += 50) {
        const batch = messages.slice(i, i + 50);
        await messageQueue.add('import-batch', {
          jobId, userId, accountId, mailboxId,
          folderName: folder.folderName,
          sourceType: 'zoho',
          zohoApiBase: zohoApiBase(creds),
          zohoOrgId: creds.orgId,
          zohoAccountId,
          zohoRegion: creds.region ?? 'com',
          // Encrypted credentials (S-2)
          zohoAccessTokenEnc: accessTokenEnc,
          zohoRefreshTokenEnc: refreshTokenEnc,
          zohoClientIdEnc: clientIdEnc,
          zohoClientSecretEnc: clientSecretEnc,
          zohoBatch: batch,
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

// ── IMAP path — enumerate UIDs here, fan the messages out to message-import ───
//
// Mirrors the Zoho path: this job only walks folders and enqueues batches, so it
// finishes in seconds instead of holding a multi-hour lock while it downloads a
// whole mailbox message-by-message (which BullMQ would mark stalled and retry
// mid-flight). Credentials never enter Redis in plaintext — the whole source
// credential blob is AES-256-GCM encrypted with encryptField() exactly like the
// Zoho tokens, and rebuilt inside the batch worker.

const IMAP_BATCH_SIZE = Number(process.env.IMAP_BATCH_SIZE ?? 50);

async function migrateImapUser(params: {
  jobId: string; userId: string; sourceEmail: string;
  accountId: string; sourceType: string; creds: Record<string, string>;
  allowInsecureTls: boolean;
}): Promise<void> {
  const { jobId, userId, sourceEmail, accountId, sourceType, creds, allowInsecureTls } = params;

  let imapCreds: ReturnType<typeof buildImapCredentials>;
  try {
    imapCreds = buildImapCredentials(sourceType, creds, sourceEmail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: msg, completed_at: new Date() });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  }

  const checkpoint = await getUserCheckpoint(userId);

  const client = new ImapFlow({
    host: imapCreds.host,
    port: imapCreds.port,
    secure: imapCreds.secure,
    auth: await resolveImapAuth(imapCreds),
    logger: false,
    tls: buildImapTlsOptions(allowInsecureTls, `${sourceType} ${imapCreds.host} (${sourceEmail})`),
  });

  // Encrypted once per user, reused by every batch payload (S-2).
  const imapCredsEnc = encryptField(JSON.stringify(creds));
  const messageQueue = new Queue('message-import', { connection: getRedisConnection() });

  try {
    await client.connect();
    const folders = await client.list();

    for (const folder of folders) {
      if (await isJobCancelled(jobId)) break;

      const folderName = folder.path;
      if (folder.flags?.has('\\Noselect')) continue;

      const lastUid = checkpoint[folderName] ?? 0;
      const mailboxId = await resolveMailboxId(accountId, folderName, FOLDER_ROLE_MAP);

      let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | null = null;
      try {
        lock = await client.getMailboxLock(folderName);
      } catch {
        continue; // folder not selectable — skip
      }

      let uids: number[];
      try {
        // Resume from the checkpoint: IMAP UIDs only ever increase within a folder.
        const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        // "n:*" always returns the highest UID even when it is below n — filter it out.
        uids = (found || []).filter(uid => uid > lastUid).sort((a, b) => a - b);
      } finally {
        lock.release();
      }

      if (uids.length === 0) continue;

      let batches = 0;
      for (let i = 0; i < uids.length; i += IMAP_BATCH_SIZE) {
        await messageQueue.add('import-batch', {
          jobId, userId, accountId, mailboxId, folderName,
          sourceType,
          sourceEmail,
          uids: uids.slice(i, i + IMAP_BATCH_SIZE),
          imapHost: imapCreds.host,
          imapPort: imapCreds.port,
          imapSecure: imapCreds.secure,
          // Encrypted source credentials (S-2) — never plaintext in Redis
          imapCredsEnc,
          allowInsecureTls,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        });
        batches++;
      }

      checkpoint[folderName] = uids[uids.length - 1];
      await updateUserCheckpoint(userId, checkpoint);

      await appendMigrationEvent(jobId, userId, 'folder_enqueued', {
        folder: folderName, messages: uids.length, batches, fromUid: lastUid + 1,
      });
      console.log(
        `[user-migration] ${sourceEmail} ${folderName}: enqueued ${uids.length} message(s) ` +
        `in ${batches} batch(es)`,
      );
    }

    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    await updateUserStatus(userId, 'failed', { error_message: msg, completed_at: new Date() });
    await incrementJobUserCounts(jobId, 0, 1);
    await appendMigrationEvent(jobId, userId, 'user_failed', { sourceEmail, error: msg });
    throw err;
  } finally {
    await messageQueue.close();
  }
}
