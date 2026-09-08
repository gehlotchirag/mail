import type { Job } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { uploadBlob, importEmail } from '../stalwart/email-importer.js';
import { incrementUserProgress, appendMigrationEvent, isJobCancelled } from '../db/queries.js';
import { decryptField } from '../lib/crypto.js';
import { buildImapCredentials, resolveImapAuth } from '../imap/master-user.js';
import { buildImapTlsOptions, parseAllowInsecureTls } from '../lib/imap-tls.js';
import { withRetry, isImapRateLimit, sleep } from '../lib/retry.js';
import { ProgressAccumulator } from '../lib/progress.js';
import { settleBatch, outcomeFor } from '../lib/batch-settlement.js';
import { refreshZohoToken } from '../imap/providers/zoho.js';
import type { ZohoMsgSummary } from '../imap/providers/zoho.js';

const PROGRESS_FLUSH_EVERY = Number(process.env.PROGRESS_FLUSH_EVERY ?? 10);

export async function messageImportProcessor(job: Job): Promise<void> {
  const { sourceType, imapCredsEnc } = job.data as { sourceType?: string; imapCredsEnc?: string };

  // IMAP-based Zoho batches (personal accounts) carry imapCredsEnc, not zohoBatch.
  if (sourceType === 'zoho' && !imapCredsEnc) {
    return processZohoBatch(job);
  }
  return processImapBatch(job);
}

/**
 * Called from the worker's `failed` event once BullMQ has burned every attempt.
 * This is the moment mail would otherwise go missing: without it the batch row
 * stays 'pending' forever, the user never completes, and (in the old code, where
 * the checkpoint had already jumped past these messages) a re-run skipped them.
 */
export async function handleBatchFinalFailure(job: Job, err: Error): Promise<void> {
  const { batchId, jobId, userId, sourceType, sourceEmail, folderName, uids, zohoBatch } =
    job.data as {
      batchId?: string; jobId: string; userId: string; sourceType?: string;
      sourceEmail?: string; folderName?: string; uids?: number[]; zohoBatch?: unknown[];
    };
  if (!batchId || !jobId || !userId) return;

  const size = uids?.length ?? zohoBatch?.length ?? 0;
  console.error(
    `[message-import] Batch ${job.id} (${folderName ?? '?'}, ${size} message(s)) ` +
    `permanently failed after ${job.attemptsMade} attempt(s): ${err.message}`,
  );

  await settleBatch({
    batchId, jobId, userId, sourceType, sourceEmail,
    outcome: 'failed', imported: 0, failed: size,
    error: err.message.slice(0, 500),
  });

  await appendMigrationEvent(jobId, userId, 'batch_failed', {
    folder: folderName, messages: size, error: err.message.slice(0, 500),
  }).catch(() => { /* event logging must not mask the failure */ });
}

// ── Zoho REST API batch ────────────────────────────────────────────────────────

async function processZohoBatch(job: Job): Promise<void> {
  const {
    jobId, userId, accountId, mailboxId, folderName, batchId,
    zohoApiBase, zohoOrgId, zohoAccountId, zohoRegion, zohoIsPersonal, zohoBatch,
    // Encrypted credential fields (S-2)
    zohoAccessTokenEnc, zohoRefreshTokenEnc, zohoClientIdEnc, zohoClientSecretEnc,
    // Legacy unencrypted fallback for jobs enqueued before this change
    zohoAccessToken: zohoAccessTokenLegacy,
  } = job.data as {
    jobId: string; userId: string; accountId: string; mailboxId: string; folderName: string;
    batchId?: string;
    zohoApiBase: string; zohoOrgId: string; zohoAccountId: string; zohoRegion?: string; zohoIsPersonal?: boolean;
    zohoBatch: ZohoMsgSummary[];
    zohoAccessTokenEnc?: string; zohoRefreshTokenEnc?: string;
    zohoClientIdEnc?: string; zohoClientSecretEnc?: string;
    zohoAccessToken?: string; // legacy
  };

  if (await isJobCancelled(jobId)) {
    await settleBatch({
      batchId, jobId, userId, sourceType: 'zoho', outcome: 'cancelled',
      imported: 0, failed: 0, error: 'job cancelled',
    });
    return;
  }

  // Decrypt access token (Z-1 + S-2): refresh at start of each batch so expired tokens self-heal
  const rawToken = zohoAccessTokenEnc ? decryptField(zohoAccessTokenEnc) : (zohoAccessTokenLegacy ?? '');
  const region = zohoRegion ?? 'com';

  let accessToken = rawToken;
  if (zohoRefreshTokenEnc) {
    try {
      accessToken = await refreshZohoToken({
        domain: '', orgId: zohoOrgId,
        accessToken: rawToken,
        refreshToken: decryptField(zohoRefreshTokenEnc),
        clientId: zohoClientIdEnc ? decryptField(zohoClientIdEnc) : undefined,
        clientSecret: zohoClientSecretEnc ? decryptField(zohoClientSecretEnc) : undefined,
        region,
      });
    } catch (err) {
      console.warn(`[message-import:zoho] token refresh failed, using existing: ${err instanceof Error ? err.message : err}`);
    }
  }

  const authHeader = `Zoho-oauthtoken ${accessToken}`;
  let failedMessages = 0;
  // Messages and bytes are flushed together — see lib/progress.ts for the bug
  // this replaces.
  const progress = new ProgressAccumulator(
    PROGRESS_FLUSH_EVERY,
    (messages, bytes) => incrementUserProgress(userId, messages, bytes),
  );

  try {
    for (const msg of zohoBatch) {
      if (await isJobCancelled(jobId)) break;

      try {
        const raw = await withRetry(async () => {
          // `/messages/{id}/originalmessage` — verified against the live API.
          // The previous `/messages/content/{id}?include=raw` 404s on every message,
          // and `/folders/{fid}/messages/{id}/content` returns the RENDERED HTML body
          // rather than the raw message, which would lose headers, attachments and
          // threading. Only originalmessage returns full RFC822.
          const res = await fetch(
            zohoIsPersonal
              ? `${zohoApiBase}/accounts/${zohoAccountId}/messages/${msg.messageId}/originalmessage`
              : `${zohoApiBase}/organization/${zohoOrgId}/accounts/${zohoAccountId}/messages/${msg.messageId}/originalmessage`,
            { headers: { Authorization: authHeader } },
          );
          if (res.status === 429) throw Object.assign(new Error('rate limit'), { code: 'RATE_LIMIT' });
          if (res.status === 401) throw Object.assign(new Error('token expired'), { code: 'TOKEN_EXPIRED' });
          if (!res.ok) throw new Error(`Zoho content error: ${res.status} ${res.statusText}`);
          const data = await res.json() as { data?: { content?: string } };
          const rawStr = data.data?.content;
          if (!rawStr) throw new Error(`No raw content for message ${msg.messageId}`);
          // originalmessage returns the RFC822 message as plain text, not base64.
          // Decoding it as base64 silently produced garbage bytes.
          return Buffer.from(rawStr, 'utf8');
        }, { maxAttempts: 3, baseDelayMs: 5000 });

        const { blobId, size } = await withRetry(
          () => uploadBlob(accountId, raw),
          { maxAttempts: 3, baseDelayMs: 2000 },
        );

        const flags = new Set<string>();
        if (msg.isRead) flags.add('\\Seen');
        if (msg.isFlagged) flags.add('\\Flagged');

        const receivedAt = msg.receivedTime ? new Date(msg.receivedTime) : undefined;

        await withRetry(
          () => importEmail({ accountId, blobId, mailboxId, flags, receivedAt }),
          { maxAttempts: 3, baseDelayMs: 2000 },
        );

        await progress.record(size);
      } catch (err) {
        failedMessages++;
        const isRateLimit =
          err instanceof Error && (err.message.includes('rate limit') || err.message.includes('429'));
        if (isRateLimit) await sleep(30_000);
        console.warn(`[message-import:zoho] ${msg.messageId} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    // Whatever landed is recorded even if the batch is about to throw.
    await progress.drain().catch(err =>
      console.error(`[message-import:zoho] progress flush failed: ${err instanceof Error ? err.message : err}`));
  }

  const { messages: importedMessages, bytes: importedBytes } = progress.totals;

  // Always log the event so partial failures are visible (E-1)
  if (importedMessages > 0 || failedMessages > 0) {
    await appendMigrationEvent(jobId, userId, 'message_batch', {
      folder: folderName, imported: importedMessages, failed: failedMessages,
      bytes: importedBytes, source: 'zoho',
    });
  }

  // Fail the job if every message in the batch failed — triggers BullMQ retry (E-1).
  // Deliberately settled by the retry-exhausted handler, not here: an unsettled
  // batch keeps the user open and the folder checkpoint parked behind it.
  if (failedMessages > 0 && importedMessages === 0) {
    throw new Error(`All ${failedMessages} messages in batch failed — will retry`);
  }

  await settleBatch({
    batchId, jobId, userId, sourceType: 'zoho',
    outcome: outcomeFor(importedMessages, zohoBatch.length),
    imported: importedMessages, failed: failedMessages, vanished: 0,
    error: failedMessages > 0 ? `${failedMessages} message(s) failed` : undefined,
  });
}

// ── IMAP batch ────────────────────────────────────────────────────────────────

async function processImapBatch(job: Job): Promise<void> {
  const {
    jobId, userId, accountId, mailboxId, folderName, batchId,
    uids, imapHost, imapPort, imapSecure,
    sourceType, sourceEmail, imapCredsEnc, allowInsecureTls,
    // Legacy plaintext fields for batches enqueued before credentials were encrypted
    imapUser: imapUserLegacy, imapPass: imapPassLegacy,
  } = job.data as {
    jobId: string; userId: string; accountId: string; mailboxId: string; folderName: string;
    batchId?: string;
    uids: number[]; imapHost: string; imapPort: number; imapSecure: boolean;
    sourceType?: string; sourceEmail?: string; imapCredsEnc?: string; allowInsecureTls?: boolean;
    imapUser?: string; imapPass?: string; // legacy
  };

  if (await isJobCancelled(jobId)) {
    await settleBatch({
      batchId, jobId, userId, sourceType, sourceEmail, outcome: 'cancelled',
      imported: 0, failed: 0, error: 'job cancelled',
    });
    return;
  }

  let host = imapHost;
  let port = imapPort;
  let secure = imapSecure;
  let auth: { user: string; pass?: string; accessToken?: string };

  if (imapCredsEnc && sourceType && sourceEmail) {
    // Credentials travel through Redis AES-256-GCM encrypted (S-2) and are only
    // turned back into an IMAP login here.
    const creds = JSON.parse(decryptField(imapCredsEnc)) as Record<string, string>;
    const built = buildImapCredentials(sourceType, creds, sourceEmail);
    host = built.host;
    port = built.port;
    secure = built.secure;
    auth = await resolveImapAuth(built);
  } else if (imapUserLegacy && imapPassLegacy) {
    console.warn(
      `[message-import] Batch ${job.id} carries legacy plaintext IMAP credentials — ` +
      'draining old queue entry. New batches encrypt them.',
    );
    auth = { user: imapUserLegacy, pass: imapPassLegacy };
  } else {
    throw new Error(`[message-import] Batch ${job.id} has no usable IMAP credentials`);
  }

  const client = new ImapFlow({
    host, port, secure,
    auth,
    logger: false,
    tls: buildImapTlsOptions(
      parseAllowInsecureTls(allowInsecureTls),
      `${sourceType ?? 'imap'} ${host} (${sourceEmail ?? auth.user})`,
    ),
  });

  await withRetry(() => client.connect(), { maxAttempts: 3, baseDelayMs: 5000 });

  const lock = await client.getMailboxLock(folderName);
  let failedMessages = 0;
  // Messages the source no longer has. They are gone, not lost: retrying cannot
  // bring them back, so they are allowed to move the checkpoint — but they are
  // counted and reported rather than silently skipped.
  let vanishedMessages = 0;
  const progress = new ProgressAccumulator(
    PROGRESS_FLUSH_EVERY,
    (messages, bytes) => incrementUserProgress(userId, messages, bytes),
  );

  try {
    for (const uid of uids) {
      if (await isJobCancelled(jobId)) break;

      try {
        // envelope: true fixes I-1 (receivedAt was always undefined without it)
        const msg = await client.fetchOne(
          String(uid),
          { source: true, flags: true, envelope: true },
          { uid: true },
        );
        // A UID that no longer resolves was deleted at the source between
        // enumeration and now.
        if (!msg || !msg.source) {
          vanishedMessages++;
          console.warn(
            `[message-import] UID ${uid} in ${folderName} no longer exists at the source — skipped`,
          );
          continue;
        }

        const rawSource = msg.source as Buffer;
        const msgFlags = msg.flags ?? new Set<string>();
        const receivedAt = msg.envelope?.date;

        const { blobId, size } = await withRetry(
          () => uploadBlob(accountId, rawSource),
          { maxAttempts: 3, baseDelayMs: 2000 },
        );

        await withRetry(
          () => importEmail({ accountId, blobId, mailboxId, flags: msgFlags, receivedAt }),
          { maxAttempts: 3, baseDelayMs: 2000 },
        );

        await progress.record(size);
      } catch (msgErr) {
        failedMessages++;
        if (isImapRateLimit(msgErr)) await sleep(30_000);
        console.warn(`[message-import] UID ${uid} failed: ${msgErr instanceof Error ? msgErr.message : msgErr}`);
      }
    }
  } finally {
    lock.release();
    try { await client.logout(); } catch { /* ignore */ }
    await progress.drain().catch(err =>
      console.error(`[message-import] progress flush failed: ${err instanceof Error ? err.message : err}`));
  }

  const { messages: importedMessages, bytes: importedBytes } = progress.totals;

  if (importedMessages > 0 || failedMessages > 0 || vanishedMessages > 0) {
    await appendMigrationEvent(jobId, userId, 'message_batch', {
      folder: folderName, imported: importedMessages, failed: failedMessages,
      vanished: vanishedMessages, bytes: importedBytes,
    });
  }

  // Fail the batch if nothing landed — triggers the BullMQ retry/backoff (E-1).
  // Settlement is left to the retry-exhausted handler for the same reason as above.
  if (failedMessages > 0 && importedMessages === 0) {
    throw new Error(`All ${failedMessages} messages in batch failed — will retry`);
  }

  await settleBatch({
    batchId, jobId, userId, sourceType, sourceEmail,
    outcome: outcomeFor(importedMessages + vanishedMessages, uids.length),
    imported: importedMessages, failed: failedMessages, vanished: vanishedMessages,
    error: failedMessages > 0 ? `${failedMessages} message(s) failed` : undefined,
  });
}
