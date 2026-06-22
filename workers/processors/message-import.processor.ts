import type { Job } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { uploadBlob, importEmail } from '../stalwart/email-importer.js';
import { incrementUserProgress, appendMigrationEvent, isJobCancelled } from '../db/queries.js';
import { withRetry, isImapRateLimit, sleep } from '../lib/retry.js';
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
    zohoApiBase, zohoOrgId, zohoAccountId, zohoAccessToken, zohoBatch,
  } = job.data as {
    jobId: string; userId: string; accountId: string; mailboxId: string; folderName: string;
    zohoApiBase: string; zohoOrgId: string; zohoAccountId: string; zohoAccessToken: string;
    zohoBatch: ZohoMsgSummary[];
  };

  if (await isJobCancelled(jobId)) return;

  const authHeader = `Zoho-oauthtoken ${zohoAccessToken}`;
  let importedMessages = 0;
  let importedBytes = 0;
  let progressBatch = 0;

  for (const msg of zohoBatch) {
    if (await isJobCancelled(jobId)) break;

    try {
      // Download raw RFC822 via Zoho org API
      const raw = await withRetry(async () => {
        const res = await fetch(
          `${zohoApiBase}/organization/${zohoOrgId}/accounts/${zohoAccountId}/messages/content/${msg.messageId}?include=raw`,
          { headers: { Authorization: authHeader } },
        );
        if (res.status === 429) throw Object.assign(new Error('rate limit'), { code: 'RATE_LIMIT' });
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

      // Map Zoho flags to IMAP flag set for flagsToKeywords() reuse
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
      const isRateLimit =
        err instanceof Error && (err.message.includes('rate limit') || err.message.includes('429'));
      if (isRateLimit) await sleep(30_000);
      console.warn(`[message-import:zoho] ${msg.messageId} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (progressBatch > 0) await incrementUserProgress(userId, progressBatch, importedBytes);

  if (importedMessages > 0) {
    await appendMigrationEvent(jobId, userId, 'message_batch', {
      folder: folderName, count: importedMessages, bytes: importedBytes, source: 'zoho',
    });
  }
}

// ── IMAP batch (cPanel / Dovecot) ─────────────────────────────────────────────

async function processImapBatch(job: Job): Promise<void> {
  const {
    jobId, userId, accountId, mailboxId, folderName,
    uids, imapHost, imapPort, imapSecure, imapUser, imapPass,
  } = job.data as {
    jobId: string; userId: string; accountId: string; mailboxId: string; folderName: string;
    uids: number[]; imapHost: string; imapPort: number; imapSecure: boolean;
    imapUser: string; imapPass: string;
  };

  if (await isJobCancelled(jobId)) return;

  const client = new ImapFlow({
    host: imapHost, port: imapPort, secure: imapSecure,
    auth: { user: imapUser, pass: imapPass },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  await withRetry(() => client.connect(), { maxAttempts: 3, baseDelayMs: 5000 });

  const lock = await client.getMailboxLock(folderName);
  let importedMessages = 0;
  let importedBytes = 0;
  let progressBatch = 0;

  try {
    for (const uid of uids) {
      if (await isJobCancelled(jobId)) break;

      try {
        const msg = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
        if (!msg || !msg.source) continue;

        const rawSource = msg.source as Buffer;
        const msgFlags = msg.flags ?? new Set<string>();
        const msgDate = msg.envelope?.date;

        const { blobId, size } = await withRetry(
          () => uploadBlob(accountId, rawSource),
          { maxAttempts: 3, baseDelayMs: 2000 },
        );

        await withRetry(
          () => importEmail({ accountId, blobId, mailboxId, flags: msgFlags, receivedAt: msgDate }),
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
        if (isImapRateLimit(msgErr)) await sleep(30_000);
        console.warn(`[message-import] UID ${uid} failed: ${msgErr instanceof Error ? msgErr.message : msgErr}`);
      }
    }
  } finally {
    lock.release();
    try { await client.logout(); } catch { /* ignore */ }
  }

  if (progressBatch > 0 || importedBytes > 0) {
    await incrementUserProgress(userId, progressBatch, importedBytes);
  }

  if (importedMessages > 0) {
    await appendMigrationEvent(jobId, userId, 'message_batch', {
      folder: folderName, count: importedMessages, bytes: importedBytes,
    });
  }
}
