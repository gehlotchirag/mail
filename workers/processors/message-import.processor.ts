import type { Job } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { uploadBlob, importEmail } from '../stalwart/email-importer.js';
import { incrementUserProgress, appendMigrationEvent, isJobCancelled } from '../db/queries.js';
import { decryptField } from '../lib/crypto.js';
import { buildImapCredentials, resolveImapAuth } from '../imap/master-user.js';
import { buildImapTlsOptions, parseAllowInsecureTls } from '../lib/imap-tls.js';
import { withRetry, isImapRateLimit, sleep } from '../lib/retry.js';
import { refreshZohoToken } from '../imap/providers/zoho.js';
import type { ZohoMsgSummary } from '../imap/providers/zoho.js';

export async function messageImportProcessor(job: Job): Promise<void> {
  const { sourceType } = job.data as { sourceType?: string };

  if (sourceType === 'zoho') {
    return processZohoBatch(job);
  }
  return processImapBatch(job);
}

// ── Zoho REST API batch ────────────────────────────────────────────────────────

async function processZohoBatch(job: Job): Promise<void> {
  const {
    jobId, userId, accountId, mailboxId, folderName,
    zohoApiBase, zohoOrgId, zohoAccountId, zohoRegion, zohoBatch,
    // Encrypted credential fields (S-2)
    zohoAccessTokenEnc, zohoRefreshTokenEnc, zohoClientIdEnc, zohoClientSecretEnc,
    // Legacy unencrypted fallback for jobs enqueued before this change
    zohoAccessToken: zohoAccessTokenLegacy,
  } = job.data as {
    jobId: string; userId: string; accountId: string; mailboxId: string; folderName: string;
    zohoApiBase: string; zohoOrgId: string; zohoAccountId: string; zohoRegion?: string;
    zohoBatch: ZohoMsgSummary[];
    zohoAccessTokenEnc?: string; zohoRefreshTokenEnc?: string;
    zohoClientIdEnc?: string; zohoClientSecretEnc?: string;
    zohoAccessToken?: string; // legacy
  };

  if (await isJobCancelled(jobId)) return;

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
  let importedMessages = 0;
  let failedMessages = 0;
  let importedBytes = 0;
  let progressBatch = 0;

  for (const msg of zohoBatch) {
    if (await isJobCancelled(jobId)) break;

    try {
      const raw = await withRetry(async () => {
        const res = await fetch(
          `${zohoApiBase}/organization/${zohoOrgId}/accounts/${zohoAccountId}/messages/content/${msg.messageId}?include=raw`,
          { headers: { Authorization: authHeader } },
        );
        if (res.status === 429) throw Object.assign(new Error('rate limit'), { code: 'RATE_LIMIT' });
        if (res.status === 401) throw Object.assign(new Error('token expired'), { code: 'TOKEN_EXPIRED' });
        if (!res.ok) throw new Error(`Zoho content error: ${res.status} ${res.statusText}`);
        const data = await res.json() as { data?: { content?: string } };
        const rawStr = data.data?.content;
        if (!rawStr) throw new Error(`No raw content for message ${msg.messageId}`);
        return Buffer.from(rawStr, 'base64');
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

      importedMessages++;
      importedBytes += size;
      progressBatch++;

      if (progressBatch >= 10) {
        await incrementUserProgress(userId, progressBatch, 0);
        progressBatch = 0;
      }
    } catch (err) {
      failedMessages++;
      const isRateLimit =
        err instanceof Error && (err.message.includes('rate limit') || err.message.includes('429'));
      if (isRateLimit) await sleep(30_000);
      console.warn(`[message-import:zoho] ${msg.messageId} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (progressBatch > 0) await incrementUserProgress(userId, progressBatch, importedBytes);

  // Always log the event so partial failures are visible (E-1)
  if (importedMessages > 0 || failedMessages > 0) {
    await appendMigrationEvent(jobId, userId, 'message_batch', {
      folder: folderName, imported: importedMessages, failed: failedMessages,
      bytes: importedBytes, source: 'zoho',
    });
  }

  // Fail the job if every message in the batch failed — triggers BullMQ retry (E-1)
  if (failedMessages > 0 && importedMessages === 0) {
    throw new Error(`All ${failedMessages} messages in batch failed — will retry`);
  }
}

// ── IMAP batch ────────────────────────────────────────────────────────────────

async function processImapBatch(job: Job): Promise<void> {
  const {
    jobId, userId, accountId, mailboxId, folderName,
    uids, imapHost, imapPort, imapSecure,
    sourceType, sourceEmail, imapCredsEnc, allowInsecureTls,
    // Legacy plaintext fields for batches enqueued before credentials were encrypted
    imapUser: imapUserLegacy, imapPass: imapPassLegacy,
  } = job.data as {
    jobId: string; userId: string; accountId: string; mailboxId: string; folderName: string;
    uids: number[]; imapHost: string; imapPort: number; imapSecure: boolean;
    sourceType?: string; sourceEmail?: string; imapCredsEnc?: string; allowInsecureTls?: boolean;
    imapUser?: string; imapPass?: string; // legacy
  };

  if (await isJobCancelled(jobId)) return;

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
  let importedMessages = 0;
  let failedMessages = 0;
  let importedBytes = 0;
  let progressBatch = 0;

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
        if (!msg || !msg.source) continue;

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

        importedMessages++;
        importedBytes += size;
        progressBatch++;

        if (progressBatch >= 10) {
          await incrementUserProgress(userId, progressBatch, 0);
          progressBatch = 0;
        }
      } catch (msgErr) {
        failedMessages++;
        if (isImapRateLimit(msgErr)) await sleep(30_000);
        console.warn(`[message-import] UID ${uid} failed: ${msgErr instanceof Error ? msgErr.message : msgErr}`);
      }
    }
  } finally {
    lock.release();
    try { await client.logout(); } catch { /* ignore */ }
  }

  if (progressBatch > 0) await incrementUserProgress(userId, progressBatch, importedBytes);

  if (importedMessages > 0 || failedMessages > 0) {
    await appendMigrationEvent(jobId, userId, 'message_batch', {
      folder: folderName, imported: importedMessages, failed: failedMessages, bytes: importedBytes,
    });
  }

  // Fail the batch if nothing landed — triggers the BullMQ retry/backoff (E-1)
  if (failedMessages > 0 && importedMessages === 0) {
    throw new Error(`All ${failedMessages} messages in batch failed — will retry`);
  }
}
