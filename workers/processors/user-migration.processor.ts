import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { getRedisConnection } from '../queues/connection.js';
import { decryptCredentials, encryptField } from '../lib/crypto.js';
import {
  getMigrationJob, updateUserStatus, getUserCheckpoint,
  appendMigrationEvent, incrementJobUserCounts, isJobCancelled,
  registerMessageBatch, attachBatchBullJob, voidMessageBatch,
  findUnsettledBatches, discardDeadBatches, markUserEnqueueComplete, setUserBullJobId,
} from '../db/queries.js';
import { buildImapCredentials, resolveImapAuth, FOLDER_ROLE_MAP } from '../imap/master-user.js';
import { buildImapTlsOptions, parseAllowInsecureTls } from '../lib/imap-tls.js';
import { startHeartbeat } from '../lib/heartbeat.js';
import { finishUserIfDone } from '../lib/user-completion.js';
import { PageGuard, pageSignature } from '../lib/pagination.js';
import { isJobStillLive, batchJobId } from '../lib/bull-liveness.js';
import { ensureAccountExists, resolveMailboxId } from '../stalwart/account-manager.js';
import {
  fetchZohoFolders, fetchZohoMessageIds, refreshZohoToken,
  zohoApiBase, type ZohoCreds,
} from '../imap/providers/zoho.js';

const BATCH_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

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
  if (job.id) await setUserBullJobId(userId, String(job.id));
  await appendMigrationEvent(jobId, userId, 'user_started', { sourceEmail, targetEmail });

  // Liveness signal for the reaper: while this beats, the user is alive and must
  // not be re-enqueued no matter how long enumeration takes.
  const stopHeartbeat = startHeartbeat(userId);

  try {
    // First thing: this attempt supersedes any batch a previous attempt left
    // unsettled. Their ranges are about to be re-enumerated from the checkpoint,
    // which never advanced past them. Done before anything slow, so a straggler
    // from the old attempt cannot settle into this attempt's accounting and
    // complete the user while it is still enumerating.
    // Only batches BullMQ has genuinely lost are discarded. One whose job is
    // still queued keeps its row: it will import its range and settle it, and
    // re-enumeration of that range is a no-op because the batch is identified
    // by the range (004) and its job id is deterministic. Dropping live rows
    // here is what caused every message in an already-enqueued folder to be
    // imported twice on a retry.
    const carriedOver = await findUnsettledBatches(userId);
    const deadIds: string[] = [];
    if (carriedOver.length > 0) {
      const probe = new Queue('message-import', { connection: getRedisConnection() });
      try {
        for (const b of carriedOver) {
          if (!await isJobStillLive(probe, b.bull_job_id, 'user-migration')) deadIds.push(b.id);
        }
      } finally {
        await probe.close();
      }
    }
    const dropped = await discardDeadBatches(userId, deadIds);
    if (carriedOver.length > 0) {
      console.warn(
        `[user-migration] ${sourceEmail}: ${carriedOver.length} unsettled batch(es) from a ` +
        `previous attempt — ${dropped} had no live job and will be re-enumerated, ` +
        `${carriedOver.length - dropped} are still running and were left alone`,
      );
    }

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
  } finally {
    stopHeartbeat();
  }

  // Enumeration is done — the user is NOT. Everything this job produced is still
  // sitting on the message-import queue; the user stays 'importing' and only the
  // settling of its last batch completes it (see lib/user-completion.ts). The
  // one case that completes right here is a mailbox that enqueued nothing.
  const { pending } = await markUserEnqueueComplete(userId);
  await appendMigrationEvent(jobId, userId, 'user_enqueued', {
    sourceEmail, targetEmail, pendingBatches: pending,
  });
  console.log(
    `[user-migration] ${sourceEmail}: enumeration complete — ${pending} batch(es) outstanding`,
  );

  await finishUserIfDone(jobId, userId, sourceEmail);
}

/**
 * Register a batch, then enqueue it. Registration first, so a batch can never be
 * on the queue without the accounting row that stops the user completing before
 * it lands. If the enqueue fails the registration is rolled back.
 */
async function enqueueBatch(
  queue: Queue,
  reg: {
    jobId: string; userId: string; folderKey: string; folderName: string;
    seqStart: number; seqEnd: number; messageCount: number;
  },
  payload: Record<string, unknown>,
): Promise<void> {
  const { batchId, created } = await registerMessageBatch(reg);
  if (!created) {
    // This range is already registered and still owned by a live batch from the
    // attempt we superseded. Enqueuing again would import its messages twice.
    return;
  }
  try {
    const queued = await queue.add(
      'import-batch',
      { ...payload, batchId },
      {
        ...BATCH_JOB_OPTS,
        // Same range => same id, and BullMQ refuses a duplicate id. Belt and
        // braces with the range constraint above.
        jobId: batchJobId(reg.userId, reg.folderKey, reg.seqStart, reg.seqEnd),
      },
    );
    if (queued.id) await attachBatchBullJob(batchId, String(queued.id));
  } catch (err) {
    await voidMessageBatch(batchId, reg.userId).catch(() => { /* best effort */ });
    throw err;
  }
}

// ── Zoho REST API path ─────────────────────────────────────────────────────────

// Hard stop for a provider that never says "no more pages" (C7). 200 messages a
// page — 5000 pages is a million messages in one folder, far past any real
// mailbox, so hitting it means the cursor is broken, not that the mailbox is big.
const ZOHO_MAX_PAGES = Number(process.env.ZOHO_MAX_PAGES ?? 5000);
const ZOHO_BATCH_SIZE = Number(process.env.ZOHO_BATCH_SIZE ?? 50);

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

  try {
    for (const folder of folders) {
      if (await isJobCancelled(jobId)) break;

      const mailboxId = await resolveMailboxId(accountId, folder.folderName, FOLDER_ROLE_MAP);
      // Zoho paginates by offset, so the checkpoint is "next offset to fetch".
      let start = checkpoint[folder.folderId] ?? 0;
      const guard = new PageGuard(ZOHO_MAX_PAGES, `zoho ${sourceEmail} folder ${folder.folderName}`);

      while (true) {
        if (await isJobCancelled(jobId)) break;

        const { messages, hasMore } = await fetchZohoMessageIds(
          { ...creds, accessToken: freshToken }, zohoAccountId, folder.folderId, start,
        );
        if (messages.length === 0) break;

        // Signature over the page's contents: a provider that keeps handing back
        // the same page while claiming hasMore would otherwise loop forever.
        const verdict = guard.next(pageSignature(
          messages[0].messageId,
          messages[messages.length - 1].messageId,
          messages.length,
        ));
        if (!verdict.ok) {
          console.error(`[user-migration] ABORTING FOLDER — ${verdict.detail}`);
          await appendMigrationEvent(jobId, userId, 'pagination_aborted', {
            sourceEmail, folder: folder.folderName, reason: verdict.reason,
            detail: verdict.detail, pagesFetched: guard.pagesFetched, offset: start,
          });
          break;
        }

        for (let i = 0; i < messages.length; i += ZOHO_BATCH_SIZE) {
          const batch = messages.slice(i, i + ZOHO_BATCH_SIZE);
          await enqueueBatch(messageQueue, {
            jobId, userId,
            folderKey: folder.folderId,
            folderName: folder.folderName,
            seqStart: start + i,
            seqEnd: start + i + batch.length - 1,
            messageCount: batch.length,
          }, {
            jobId, userId, accountId, mailboxId,
            folderName: folder.folderName,
            folderKey: folder.folderId,
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
          });
        }

        start += messages.length;
        // NOTE: the checkpoint is deliberately NOT advanced here. It moves only as
        // batches report messages actually imported (see settleBatchOutcome).

        if (!hasMore) break;
      }
    }
  } finally {
    await messageQueue.close();
  }
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
        const slice = uids.slice(i, i + IMAP_BATCH_SIZE);
        await enqueueBatch(messageQueue, {
          jobId, userId,
          folderKey: folderName,
          folderName,
          seqStart: slice[0],
          seqEnd: slice[slice.length - 1],
          messageCount: slice.length,
        }, {
          jobId, userId, accountId, mailboxId, folderName,
          folderKey: folderName,
          sourceType,
          sourceEmail,
          uids: slice,
          imapHost: imapCreds.host,
          imapPort: imapCreds.port,
          imapSecure: imapCreds.secure,
          // Encrypted source credentials (S-2) — never plaintext in Redis
          imapCredsEnc,
          allowInsecureTls,
        });
        batches++;
      }

      // NOTE: no checkpoint write here. Enqueuing is not importing — the folder's
      // checkpoint advances only over batches that reported every message
      // imported, so a batch that exhausts its retries is re-enumerated on the
      // next run instead of being silently skipped.
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
