import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { Pool } from 'pg';
import { Queue } from 'bullmq';
import { createCipheriv, randomBytes, randomUUID } from 'crypto';
import { getActiveSub, subErrorResponse, countOrgMailboxes } from '@/lib/subscription';
import { resolvePlanLimits } from '@/lib/plans';
import { ensureDomainsForOrg } from '@/lib/domain-provisioning';
import { query as consoleQuery } from '@/lib/db';
import { fetchAllZohoAccounts } from '@/lib/zoho-accounts';
import { cachedRawAccountsFor } from '@/lib/discovery-runs';
import {
  createDiscoveryRun, getDiscoveryRun, recentDiscoveryFor, inFlightDiscoveryFor,
  finishDiscovery, failDiscovery, saveDiscoveryToDb, loadDiscoveryFromDb,
} from '@/lib/discovery-runs';

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) _pool = new Pool({
    connectionString: process.env.MIGRATION_PG_URL,
    ssl: { rejectUnauthorized: false },
  });
  return _pool;
}

let _queue: Queue | null = null;
function getQueue() {
  if (!_queue) {
    const url = new URL(process.env.REDIS_URL!);
    _queue = new Queue('migration-orchestrator', {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined,
      },
    });
  }
  return _queue;
}

function encryptionKey() {
  const raw = process.env.MIGRATION_ENCRYPTION_KEY ?? '';
  return Buffer.from(raw.padEnd(32).slice(0, 32));
}

function encryptCredentials(creds: Record<string, string>): Buffer {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(creds), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

async function ensureTables() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_host TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      total_users INT,
      completed_users INT NOT NULL DEFAULT 0,
      failed_users INT NOT NULL DEFAULT 0,
      imported_messages INT NOT NULL DEFAULT 0,
      imported_bytes BIGINT NOT NULL DEFAULT 0,
      error_message TEXT,
      credentials_enc BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      migration_job_id UUID NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
      source_email TEXT NOT NULL,
      target_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      imported_messages INT NOT NULL DEFAULT 0,
      failed_messages INT NOT NULL DEFAULT 0,
      imported_bytes BIGINT NOT NULL DEFAULT 0,
      error_message TEXT,
      checkpoint_json JSONB,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      target_account_id TEXT,
      UNIQUE(migration_job_id, source_email)
    )
  `);
  // Sign-in credential for a mailbox this migration created, encrypted at rest.
  // Added after the fact, so existing deployments pick it up here.
  await pool.query(
    'ALTER TABLE migration_users ADD COLUMN IF NOT EXISTS temp_password_enc BYTEA'
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_events (
      id BIGSERIAL PRIMARY KEY,
      migration_job_id UUID NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
      migration_user_id UUID REFERENCES migration_users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Listing a Zoho organisation costs ~110 seconds, so the result is cached. It
  // used to live only in process memory, which meant every deploy or crash forced
  // a fresh crawl — and any action that depended on it silently re-listed.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zoho_discovery_cache (
      workspace_id  UUID NOT NULL,
      zoho_org_id   TEXT NOT NULL,
      accounts      JSONB NOT NULL,
      mailboxes     JSONB NOT NULL,
      partial       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, zoho_org_id)
    )
  `);

  // Progress for IMAP/password runs. These execute inside the web process, so a
  // restart aborts them; persisting the state at least means the operator can see
  // how far a run got instead of watching a spinner that will never resolve.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imap_runs (
      id            UUID PRIMARY KEY,
      workspace_id  UUID NOT NULL,
      zoho_org_id   TEXT NOT NULL,
      mode          TEXT NOT NULL,
      status        TEXT NOT NULL,
      total         INTEGER NOT NULL DEFAULT 0,
      processed     INTEGER NOT NULL DEFAULT 0,
      changed       INTEGER NOT NULL DEFAULT 0,
      unchanged     INTEGER NOT NULL DEFAULT 0,
      failed        INTEGER NOT NULL DEFAULT 0,
      mailboxes     JSONB,
      error         TEXT,
      started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at   TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_imap_runs_ws ON imap_runs (workspace_id, started_at DESC)`);

  // A run still marked 'running' from a previous process cannot be making progress:
  // the loop that owned it died with that process. Mark it so, once, at startup —
  // otherwise the UI polls a run that will never finish.
  const stale = await pool.query(
    `UPDATE imap_runs SET status='interrupted', finished_at=NOW(),
            error='The server restarted while this run was in progress. Anything already changed is listed below; re-run for the rest.'
      WHERE status='running' RETURNING id`
  );
  if (stale.rowCount) {
    console.warn(`[imap-runs] marked ${stale.rowCount} run(s) interrupted after restart`);
  }
}

function testConnection(sourceType: string, credentials: Record<string, string>) {
  const required: Record<string, string[]> = {
    cpanel:  ['host', 'adminUser', 'adminToken', 'masterPass'],
    gsuite:  ['domain', 'serviceAccountJson', 'adminEmail'],
    zoho:    ['domain', 'orgId', 'accessToken'],
    dovecot: ['host', 'masterUser', 'masterPass'],
  };
  const missing = (required[sourceType] ?? []).filter(k => !credentials[k]?.trim());
  if (missing.length > 0) return { ok: false, message: `Missing required fields: ${missing.join(', ')}` };
  if (sourceType === 'gsuite') {
    try { JSON.parse(credentials.serviceAccountJson); } catch {
      return { ok: false, message: 'Service account JSON is invalid — must be valid JSON' };
    }
  }
  return { ok: true, message: 'Credentials validated — job will connect when it starts' };
}

/**
 * The distinct mail domains a Zoho organisation actually spans.
 *
 * A Zoho org routinely hosts several domains, and every member on a secondary one
 * used to fail individually with `Domain "x" not found in Flux server` once the
 * migration was already running. Asking Zoho up front turns N confusing per-user
 * failures into one decision made before any work starts.
 *
 * Best effort: if Zoho will not answer we return null and let the migration proceed
 * as before, rather than blocking an import on a pre-flight.
 */
/** Turns Zoho's raw account rows into the shape the console works with. */
function buildOrgView(accounts: Array<Record<string, unknown>>, partial: boolean) {
  const mailboxes: ZohoMailbox[] = [];
  // Counted per domain, not just as a total: a customer selecting one domain out of
  // an organisation needs to size THAT domain against their seats, and the org-wide
  // total would refuse imports that comfortably fit.
  const perDomain: Record<string, number> = {};

  for (const acct of accounts) {
    const candidates = [
      acct.incomingUserName, acct.mailboxAddress, acct.primaryEmailAddress,
      ...(Array.isArray(acct.emailAddress)
        ? (acct.emailAddress as Array<{ mailId?: string; isPrimary?: boolean }>)
            .filter(e => e.isPrimary).map(e => e.mailId)
        : []),
    ];
    const email = candidates.find((c): c is string => typeof c === 'string' && c.includes('@'));
    if (!email) continue;
    const domain = email.split('@')[1].toLowerCase();
    perDomain[domain] = (perDomain[domain] ?? 0) + 1;

    const usedKb = typeof acct.usedStorage === 'number' ? acct.usedStorage : undefined;
    mailboxes.push({
      email: email.toLowerCase(),
      displayName: typeof acct.displayName === 'string' && acct.displayName.trim()
        ? acct.displayName.trim()
        : String(acct.accountDisplayName ?? '').trim(),
      domain,
      imapEnabled: acct.imapAccessEnabled === true,
      role: typeof acct.role === 'string' ? acct.role : undefined,
      tfaEnabled: acct.tfaEnabled === true,
      imapBlocked: acct.imapBlocked === true,
      usedStorageMb: usedKb != null ? Math.round(usedKb / 1024) : undefined,
    });
  }

  mailboxes.sort((a, b) => a.email.localeCompare(b.email));
  return { mailboxes, domains: Object.keys(perDomain), userCount: mailboxes.length, perDomain, partial, raw: accounts };
}

export interface ZohoMailbox {
  email: string;
  displayName: string;
  domain: string;
  /** Whether IMAP is currently switched on for this mailbox, per Zoho. */
  imapEnabled: boolean;
  /** Zoho's own role string — 'super_admin' for the org owner. */
  role?: string;
  /**
   * Two-factor authentication. Zoho then requires an APP-SPECIFIC password for
   * IMAP, which only the user can create — an admin cannot. So a bulk migration
   * cannot read these mailboxes, and says so before the run rather than after.
   */
  tfaEnabled?: boolean;
  /** IMAP disabled at policy level; the per-user switch cannot override it. */
  imapBlocked?: boolean;
  /** Zoho reports this in KB. */
  usedStorageMb?: number;
}

async function discoverZohoOrg(
  credentials: Record<string, string>,
  opts?: {
    deadlineMs?: number;
    onProgress?: (found: number) => void;
    /** Skip the Zoho crawl entirely and use rows already listed elsewhere. */
    preFetched?: Array<Record<string, unknown>>;
  },
): Promise<{
  mailboxes: ZohoMailbox[];
  domains: string[];
  userCount: number;
  perDomain: Record<string, number>;
  /** Zoho's listing was cut short; the rows are real but incomplete. */
  partial: boolean;
  /** The untouched Zoho rows, cached so follow-up actions need not re-crawl. */
  raw: Array<Record<string, unknown>>;
} | null> {
  const { orgId, accessToken, region } = credentials;
  if (!orgId || !accessToken) return null;
  const base = `https://mail.zoho.${region || 'in'}/api`;
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' };

  try {
    // Guarded paging — see lib/zoho-accounts. A single page silently drops
    // everything past the 200th mailbox; an unguarded loop hangs forever on an org
    // whose count is an exact multiple of the page size.
    // A completed listing from the mailbox picker is authoritative and free; the
    // start action reusing it is what stops a second, slower crawl from timing out
    // half way and then rejecting picked mailboxes as "not found".
    if (opts?.preFetched?.length) {
      return buildOrgView(opts.preFetched, false);
    }

    const fetched = await fetchAllZohoAccounts({
      base, orgId, headers,
      deadlineMs: opts?.deadlineMs,
      onProgress: opts?.onProgress,
    });

    let accounts: Array<Record<string, unknown>>;
    let partial = false;
    if (fetched.ok) {
      accounts = fetched.accounts as unknown as Array<Record<string, unknown>>;
      partial = fetched.truncated;
    } else {
      // The org endpoint is not available to every Zoho account — a personal or
      // free plan has no organisation API at all and answers 404. The worker has
      // always fallen back to the single-mailbox endpoint in that case; the console
      // did not, so discovery just failed and the mailbox picker never appeared.
      console.warn(`[migration discover] org listing failed (${fetched.error}${fetched.detail ? ' — ' + fetched.detail : ''}); trying the personal /accounts endpoint`);
      try {
        const solo = await fetch(`${base}/accounts`, { headers });
        if (!solo.ok) {
          const body = await solo.text().catch(() => '');
          console.error(`[migration discover] personal /accounts also failed: HTTP ${solo.status} ${body.slice(0, 200)}`);
          return null;
        }
        accounts = ((await solo.json()) as { data?: Array<Record<string, unknown>> }).data ?? [];
        // One mailbox from the personal endpoint is NOT the organisation — flag it
        // so the UI can say the list is incomplete rather than implying the org
        // really has a single user.
        partial = true;
        console.log(`[migration discover] personal endpoint returned ${accounts.length} mailbox(es) (partial)`);
      } catch (e) {
        console.error('[migration discover] personal /accounts threw:', e instanceof Error ? e.message : e);
        return null;
      }
    }

    return buildOrgView(accounts, partial);
  } catch (err) {
    console.warn('[migration] Zoho pre-flight failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Domains the caller chose to import, or null for "everything in the org". */
function selectedDomains(credentials: Record<string, string>): Set<string> | null {
  const list = (credentials.importDomains ?? '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureTables();
    const { rows } = await getPool().query(
      // `credential_count` drives the "Download CSV" link. The list previously
      // returned no per-user data at all, so the UI could never tell that a job
      // held sign-in details and the download simply never appeared in History —
      // even though the passwords were sitting there.
      `SELECT j.id, j.workspace_id, j.initiated_by, j.source_type, j.source_host, j.status,
              j.total_users, j.completed_users, j.failed_users, j.imported_messages,
              j.imported_bytes, j.error_message, j.created_at, j.started_at, j.completed_at,
              (SELECT COUNT(*) FROM migration_users u
                WHERE u.migration_job_id = j.id AND u.temp_password_enc IS NOT NULL
              )::int AS credential_count
       FROM migration_jobs j WHERE j.workspace_id = $1 ORDER BY j.created_at DESC LIMIT 20`,
      [session.orgId]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[migration GET] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json() as {
      action: string;
      sourceType: string;
      credentials: Record<string, string>;
      jobId?: string;
    };
    const { action, sourceType, credentials, jobId } = body;

    if (action === 'test') {
      return NextResponse.json(testConnection(sourceType, credentials));
    }

    // Read-only: what does this Zoho organisation actually contain? Lets the UI
    // offer a per-domain choice before anything is provisioned or any password is
    // touched, which is the only point at which "import just this one domain" can
    // still be expressed.
    if (action === 'discover') {
      if (sourceType !== 'zoho') {
        return NextResponse.json({ error: 'Discovery is only available for Zoho.' }, { status: 400 });
      }
      const dOrgId = credentials?.orgId;
      if (!dOrgId) return NextResponse.json({ error: 'Connect your Zoho account first.' }, { status: 400 });

      // Reuse a recent listing, or join one already in flight, rather than starting
      // a fresh multi-minute crawl for every page load or second tab.
      const cached = recentDiscoveryFor(session.orgId, dOrgId);
      if (cached?.result) return NextResponse.json({ runId: cached.id, status: 'done', ...cached.result });
      const running = inFlightDiscoveryFor(session.orgId, dOrgId);
      if (running) return NextResponse.json({ runId: running.id, status: 'running', found: running.found });

      // Durable cache: survives the restarts that used to force a fresh two-minute
      // crawl every time the process bounced.
      await ensureTables();
      const stored = await loadDiscoveryFromDb(getPool(), session.orgId, dOrgId);
      if (stored) {
        const sub0 = await getActiveSub(session.orgId).catch(() => null);
        const lim0 = resolvePlanLimits(sub0 ?? { plan: 'trial', max_users: 0 });
        const owned0 = await consoleQuery<{ domain: string }>(
          'SELECT domain FROM domains WHERE org_id = $1', [session.orgId]);
        const ownedSet0 = new Set(owned0.map(d => d.domain.toLowerCase()));
        const mbs = stored.mailboxes as Array<{ domain: string }>;
        const perDomain0: Record<string, number> = {};
        for (const m of mbs) perDomain0[m.domain] = (perDomain0[m.domain] ?? 0) + 1;
        console.log(`[migration discover] served ${mbs.length} mailboxes from the stored listing `
          + `(${stored.ageMinutes.toFixed(0)}m old) — no crawl needed`);
        return NextResponse.json({
          status: 'done',
          totalUsers: mbs.length,
          seatsInUse: await countOrgMailboxes(session.orgId).catch(() => 0),
          maxUsers: lim0.maxUsers,
          maxDomains: lim0.maxDomains,
          domains: Object.keys(perDomain0)
            .map(d => ({ domain: d, userCount: perDomain0[d], alreadyAdded: ownedSet0.has(d) }))
            .sort((a, b) => b.userCount - a.userCount),
          mailboxes: stored.mailboxes,
          partial: stored.partial,
          fromCache: true,
        });
      }

      // Detached, because Zoho took over 40 seconds to list a 200-mailbox org —
      // longer than the request could survive. Doing it inline is what made the
      // per-person picker fall back to a single mailbox.
      const run = createDiscoveryRun(randomUUID(), session.orgId, dOrgId);
      void runDiscovery(run, credentials, session.orgId);
      return NextResponse.json({ runId: run.id, status: 'running', found: 0 });
    }

    if (action === 'discover-status') {
      const { runId } = body as unknown as { runId?: string };
      const run = runId ? getDiscoveryRun(runId) : undefined;
      if (!run || run.workspaceId !== session.orgId) {
        return NextResponse.json({ error: 'That lookup expired — reconnect Zoho to try again.' }, { status: 404 });
      }
      if (run.status === 'error') return NextResponse.json({ status: 'error', error: run.error }, { status: 200 });
      if (run.status === 'running') return NextResponse.json({ status: 'running', found: run.found });
      return NextResponse.json({ status: 'done', ...run.result });
    }

    if (action === 'cancel' && jobId) {
      await getPool().query(
        `UPDATE migration_jobs SET status = 'cancelled' WHERE id = $1 AND workspace_id = $2 AND status NOT IN ('completed','failed','cancelled')`,
        [jobId, session.orgId]
      );
      // Also remove the BullMQ job so the worker never un-cancels it
      try {
        const q = getQueue();
        const bullJob = await q.getJob(`job-${jobId}`);
        if (bullJob) await bullJob.remove();
        // Also remove any jobs without the prefix
        const bullJob2 = await q.getJob(jobId);
        if (bullJob2) await bullJob2.remove();
      } catch (e) {
        console.warn('[migration cancel] could not remove BullMQ job:', e instanceof Error ? e.message : e);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'start') {
      // Check subscription is active before starting a migration
      let sub;
      try {
        sub = await getActiveSub(session.orgId);
      } catch (subErr) {
        console.error('[migration POST] getActiveSub failed:', subErr);
        sub = null;
      }
      if (!sub) {
        console.log('[migration POST] no active sub for orgId:', session.orgId, '— allowing migration anyway');
        // Allow migration even without subscription for admin-controlled feature
      }

      try {
        await ensureTables();
      } catch (tableErr) {
        console.error('[migration POST] ensureTables failed:', tableErr);
        throw tableErr;
      }

      // Prevent concurrent migrations per org — max 1 active job at a time
      const { rows: activeJobs } = await getPool().query<{
        id: string; status: string; total_users: number; completed_users: number;
        failed_users: number; created_at: string; stalled: boolean;
      }>(
        `SELECT id, status, total_users, completed_users, failed_users, created_at,
                (COALESCE(failed_users,0) >= COALESCE(total_users,0) AND COALESCE(total_users,0) > 0)
                  AS stalled
           FROM migration_jobs
          WHERE workspace_id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')
          ORDER BY created_at DESC`,
        [session.orgId]
      );
      if (activeJobs.length > 0) {
        const blocking = activeJobs[0];
        // Identify the case where the job cannot progress — every user has already
        // failed — because that is indistinguishable from a healthy run in the old
        // message, and it left the operator with no way forward but a DB edit.
        return NextResponse.json({
          error: blocking.stalled
            ? `A previous import is still marked in progress, but all ${blocking.total_users} of its users `
              + 'have already failed, so it cannot finish. Cancel it to start a new one.'
            : 'A migration is already in progress. Cancel or wait for it to complete.',
          blockingJobId: blocking.id,
          blockingJobStalled: blocking.stalled,
          blockingJobStatus: blocking.status,
          blockingJobUsers: { total: blocking.total_users, completed: blocking.completed_users, failed: blocking.failed_users },
        }, { status: 409 });
      }

      // Pre-flight: make every domain this source spans usable BEFORE any user job
      // runs, within the organisation's plan. Doing it here rather than mid-migration
      // means the customer gets one clear answer — including an upgrade prompt naming
      // the exact domains that do not fit — instead of a run that half-succeeds.
      let domainReport: Awaited<ReturnType<typeof ensureDomainsForOrg>> | null = null;
      if (sourceType === 'zoho') {
        // Reuse the picker's completed listing. Crawling this org takes ~110
        // seconds, so re-listing here raced the request timeout, came back with a
        // partial list, and then rejected picked mailboxes that were simply on a
        // page it never reached.
        let cached = cachedRawAccountsFor(session.orgId, credentials.orgId ?? '') as
          Array<Record<string, unknown>> | undefined;
        if (!cached?.length) {
          const stored = await loadDiscoveryFromDb(getPool(), session.orgId, credentials.orgId ?? '');
          if (stored) {
            cached = stored.accounts as Array<Record<string, unknown>>;
            console.log(`[migration] start reusing stored listing of ${cached.length} accounts`);
          }
        }
        const org = await discoverZohoOrg(credentials, { preFetched: cached });
        // An explicit mailbox list wins over the domain scope, matching the worker's
        // own precedence — otherwise the pre-flight would provision (and charge for)
        // domains whose users were never ticked.
        const pickedEmails = selectedDomains({ importDomains: credentials.importEmails ?? '' });
        const chosen = pickedEmails
          ? new Set([...pickedEmails].map(e => e.split('@')[1] ?? '').filter(Boolean))
          : selectedDomains(credentials);
        // Everything below is scoped to what the customer picked. Without this,
        // connecting a Zoho org to import one domain would provision every other
        // domain in that org onto this platform — including ones the customer has
        // nothing to do with — and create mailboxes for all of their users.
        // When specific mailboxes were ticked, the domains to provision come from
        // those addresses — not from the crawl. That makes the whole pre-flight
        // independent of how well (or whether) Zoho listed the organisation, which
        // matters because listing it takes ~110 seconds and can fail outright.
        const found = pickedEmails
          ? [...(chosen ?? [])]
          : (org?.domains ?? []).filter(d => !chosen || chosen.has(d));

        // Only meaningful against a COMPLETE listing. Validating picks against a
        // truncated crawl rejected real mailboxes purely because the listing gave
        // up before reaching their page — which is exactly what blocked an import
        // of nine users that all existed.
        if (pickedEmails && org && !org.partial) {
          const known = new Set(org.mailboxes.map(m => m.email));
          const missing = [...pickedEmails].filter(e => !known.has(e));
          if (missing.length) {
            return NextResponse.json({
              error: `Zoho has no mailbox for ${missing.slice(0, 5).join(', ')}`
                   + (missing.length > 5 ? ` and ${missing.length - 5} more` : '') + '.',
              unknownEmails: missing,
            }, { status: 400 });
          }
        } else if (pickedEmails && org?.partial) {
          console.warn('[migration] listing was partial — skipping the picked-mailbox existence check');
        }

        if (!pickedEmails && chosen && org) {
          const unknown = [...chosen].filter(d => !org.domains.includes(d));
          if (unknown.length) {
            return NextResponse.json({
              error: `Zoho has no mailboxes on ${unknown.join(', ')}. `
                   + `This organisation covers: ${org.domains.join(', ')}.`,
              unknownDomains: unknown,
              availableDomains: org.domains,
            }, { status: 400 });
          }
        }

        if (found.length) {
          const limits = resolvePlanLimits(sub ?? { plan: 'trial', max_users: 0 });

          // Size the whole import against the plan BEFORE provisioning anything.
          // Without this a trial organisation could import forty mailboxes: nothing
          // downstream re-checks the seat count, because account creation happens in
          // the worker, which has no access to billing.
          const existingUsers = await countOrgMailboxes(session.orgId);
          // Only the selected domains' mailboxes are coming across, so only they
          // count against the seat limit.
          const incoming = pickedEmails
            ? pickedEmails.size
            : chosen
              ? found.reduce((n, d) => n + (org?.perDomain[d] ?? 0), 0)
              : (org?.userCount ?? 0);
          if (incoming > 0 && existingUsers + incoming > limits.maxUsers) {
            return NextResponse.json({
              error:
                `This account has ${incoming} mailboxes and your plan allows ${limits.maxUsers}`
                + (existingUsers ? ` (${existingUsers} already in use)` : '')
                + '. Upgrade to import all of them.',
              limitReached: true,
              userCount: incoming,
              existingUsers,
              maxUsers: limits.maxUsers,
              plan: limits.plan,
            }, { status: 403 });
          }

          domainReport = await ensureDomainsForOrg(session.orgId, found, limits.maxDomains);

          if (domainReport.blocked.length > 0) {
            return NextResponse.json({
              error:
                `This account spans ${found.length} domains, but your plan allows ${limits.maxDomains}. `
                + `Upgrade to import ${domainReport.blocked.join(', ')}.`,
              limitReached: true,
              blockedDomains: domainReport.blocked,
              maxDomains: limits.maxDomains,
              plan: limits.plan,
            }, { status: 403 });
          }

          if (domainReport.conflicting.length > 0) {
            return NextResponse.json({
              error:
                `${domainReport.conflicting.join(', ')} ${domainReport.conflicting.length === 1 ? 'is' : 'are'} `
                + 'already registered to another organisation on this platform. Contact support to transfer '
                + 'ownership before importing.',
              conflictingDomains: domainReport.conflicting,
            }, { status: 409 });
          }

          if (domainReport.failed.length > 0) {
            return NextResponse.json({
              error: 'Could not prepare these domains on the mail server: '
                + domainReport.failed.map(x => `${x.domain} (${x.error})`).join('; '),
              failedDomains: domainReport.failed,
            }, { status: 502 });
          }

          if (domainReport.provisioned.length) {
            console.log(`[migration] pre-provisioned ${domainReport.provisioned.length} domain(s): `
              + domainReport.provisioned.map(d => d.domain).join(', '));
          }
        }
      }

      const credEnc = encryptCredentials(credentials);
      const { rows: [job] } = await getPool().query(
        `INSERT INTO migration_jobs (workspace_id, initiated_by, source_type, source_host, credentials_enc)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [session.orgId, session.email, sourceType, credentials.host ?? credentials.domain ?? '', credEnc]
      );
      await getQueue().add('orchestrate', { jobId: job.id, workspaceId: session.orgId, sourceType }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: false,
        removeOnFail: false,
      });
      return NextResponse.json({
        jobId: job.id,
        ...(domainReport ? {
          domains: {
            existing: domainReport.existing,
            provisioned: domainReport.provisioned.map(d => d.domain),
          },
        } : {}),
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[migration POST] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}


/** The detached half of `action: 'discover'`. Never throws to the caller. */
async function runDiscovery(
  run: ReturnType<typeof createDiscoveryRun>,
  credentials: Record<string, string>,
  workspaceId: string,
): Promise<void> {
  try {
    // A generous budget: this is not holding a browser request open, so a slow
    // organisation simply takes longer rather than failing.
    const org = await discoverZohoOrg(credentials, {
      deadlineMs: 4 * 60_000,
      onProgress: n => { run.found = n; },
    });
    if (!org) {
      failDiscovery(run, 'Zoho would not return the mailbox list. Reconnect, and check the account you '
        + 'authorise with is an organisation admin.');
      return;
    }

    const sub = await getActiveSub(workspaceId).catch(() => null);
    const limits = resolvePlanLimits(sub ?? { plan: 'trial', max_users: 0 });
    const owned = await consoleQuery<{ domain: string }>(
      'SELECT domain FROM domains WHERE org_id = $1', [workspaceId],
    );
    const ownedSet = new Set(owned.map(d => d.domain.toLowerCase()));

    // Which of these mailboxes already exist on OUR mail server, so an operator can
    // see at a glance who would be a re-import rather than finding out from a
    // duplicate afterwards.
    let existingHere = new Set<string>();
    try {
      const { listAllUsers } = await import('@/lib/flux');
      existingHere = new Set((await listAllUsers()).map(u => u.emailAddress.toLowerCase()));
    } catch (e) {
      console.warn('[migration discover] could not list local mailboxes:', e instanceof Error ? e.message : e);
    }

    finishDiscovery(run, {
      totalUsers: org.userCount,
      seatsInUse: await countOrgMailboxes(workspaceId).catch(() => 0),
      maxUsers: limits.maxUsers,
      maxDomains: limits.maxDomains,
      domains: org.domains
        .map(d => ({ domain: d, userCount: org.perDomain[d] ?? 0, alreadyAdded: ownedSet.has(d) }))
        .sort((a, b) => b.userCount - a.userCount),
      mailboxes: org.mailboxes.map(m => ({ ...m, existsHere: existingHere.has(m.email) })),
      partial: org.partial,
    }, org.raw);

    // Store it so the next request — in this process or a later one — is instant.
    await saveDiscoveryToDb(getPool(), workspaceId, run.orgId, org.raw, org.mailboxes, org.partial);
    console.log(`[migration discover] run ${run.id}: done — ${org.mailboxes.length} mailboxes`
      + (org.partial ? ' (PARTIAL — Zoho listing was cut short)' : ''));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[migration discover] run ${run.id}: failed —`, msg);
    failDiscovery(run, msg);
  }
}
