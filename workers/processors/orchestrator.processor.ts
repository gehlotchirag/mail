import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import { decryptCredentials } from '../lib/crypto.js';
import { getMigrationJob, updateJobStatus, setJobTotalUsers, upsertMigrationUser, appendMigrationEvent, isJobCancelled } from '../db/queries.js';
import { discoverCpanelUsers } from '../imap/providers/cpanel.js';
import { discoverDovecotUsers } from '../imap/providers/dovecot.js';
import { discoverZohoAccounts, type ZohoCreds } from '../imap/providers/zoho.js';
import { discoverGSuiteUsers } from '../imap/providers/gsuite.js';

export async function orchestratorProcessor(job: Job): Promise<void> {
  const { jobId, workspaceId, sourceType } = job.data as { jobId: string; workspaceId: string; sourceType: string };
  console.log(`[orchestrator] Starting job ${jobId} type=${sourceType}`);

  const dbJob = await getMigrationJob(jobId);
  if (!dbJob) throw new Error(`Job ${jobId} not found in DB`);

  const creds = decryptCredentials(Buffer.from(dbJob.credentials_enc));
  await updateJobStatus(jobId, 'discovering', { started_at: new Date() });

  // Discover all users on the source server
  // For Zoho we also need the numeric accountId for subsequent API calls
  let sourceUsers: string[];
  const zohoAccountIdMap = new Map<string, string>(); // email → zoho accountId

  try {
    switch (sourceType) {
      case 'cpanel':  sourceUsers = await discoverCpanelUsers(creds as never); break;
      case 'dovecot': sourceUsers = discoverDovecotUsers(creds as never); break;
      case 'zoho': {
        const accounts = await discoverZohoAccounts(creds as unknown as ZohoCreds);
        sourceUsers = accounts.map(a => a.email);
        for (const a of accounts) zohoAccountIdMap.set(a.email, a.accountId);
        break;
      }
      case 'gsuite':  sourceUsers = await discoverGSuiteUsers(creds as never); break;
      default: throw new Error(`Unknown source type: ${sourceType}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobStatus(jobId, 'failed', { error_message: `Discovery failed: ${msg}` });
    throw err;
  }

  console.log(`[orchestrator] Discovered ${sourceUsers.length} users for job ${jobId}`);
  await setJobTotalUsers(jobId, sourceUsers.length);

  // Upsert migration_users rows (idempotent — safe to retry)
  const userIds: Array<{ id: string; sourceEmail: string; targetEmail: string }> = [];
  for (const sourceEmail of sourceUsers) {
    if (await isJobCancelled(jobId)) { await updateJobStatus(jobId, 'cancelled'); return; }
    const targetEmail = sourceEmail;
    const userId = await upsertMigrationUser(jobId, sourceEmail, targetEmail);
    userIds.push({ id: userId, sourceEmail, targetEmail });
  }

  // Enqueue user-migration jobs
  const userQueue = new Queue('user-migration', { connection: getRedisConnection() });
  for (const { id: userId, sourceEmail, targetEmail } of userIds) {
    await userQueue.add('migrate-user', {
      jobId,
      userId,
      sourceEmail,
      targetEmail,
      sourceType,
      workspaceId,
      // Zoho-specific: numeric account ID needed for mailbox API calls
      zohoAccountId: zohoAccountIdMap.get(sourceEmail),
    }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: false,
      removeOnFail: false,
    });
  }
  await userQueue.close();

  await updateJobStatus(jobId, 'migrating');
  await appendMigrationEvent(jobId, null, 'discovery_complete', { userCount: sourceUsers.length });
  console.log(`[orchestrator] Job ${jobId} — enqueued ${userIds.length} user-migration jobs`);
}
