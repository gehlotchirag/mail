import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import { createRun, recordMailbox, finishRun, type RunState } from '@/lib/imap-runs';
import { fetchAllZohoAccounts } from '@/lib/zoho-accounts';
import { cachedRawAccountsFor } from '@/lib/discovery-runs';

/**
 * Set a SPECIFIC, admin-chosen password on SPECIFIC Zoho mailboxes — as opposed to
 * /api/migration/enable-imap's bulk reset, which puts every selected mailbox on one
 * shared value. This exists for the case that endpoint cannot serve: a handful of
 * named users, each getting their own password (e.g. handing someone back the
 * password they picked over the phone, or restoring several people who do not want
 * to be migrated without putting them all on the same guessable value).
 *
 * Same detached-run architecture as enable-imap, for the same reason: this is a
 * sequence of individual Zoho API calls that can run long enough to outlive the
 * reverse proxy's connection, and losing the result on a timeout is what caused the
 * original incident this whole run-tracking system exists to prevent.
 *
 * A password reset is IRREVERSIBLE — Zoho stores only a hash, so there is no way,
 * for us or for Zoho, to recover what a mailbox's password was before this runs.
 */
interface ZohoAccountRow {
  accountId?: string;
  zuid?: number | string;
  incomingUserName?: string;
  mailboxAddress?: string;
  primaryEmailAddress?: string;
  emailAddress?: Array<{ mailId?: string }> | string;
}

function addressesFor(a: ZohoAccountRow): string[] {
  const out = [a.incomingUserName, a.mailboxAddress, a.primaryEmailAddress];
  if (Array.isArray(a.emailAddress)) out.push(...a.emailAddress.map(e => e.mailId));
  else if (typeof a.emailAddress === 'string') out.push(a.emailAddress);
  return [...new Set(out.filter((x): x is string => typeof x === 'string' && x.includes('@'))
    .map(x => x.toLowerCase()))];
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { credentials, entries, forcePasswordChange } = await req.json() as {
    credentials?: Record<string, string>;
    /** One password per named mailbox. Neither value is ever logged. */
    entries?: Array<{ email?: string; password?: string }>;
    /**
     * Treat each password as one-time, so the user must choose their own at first
     * login (Zoho's `oneTimePassword` flag).
     */
    forcePasswordChange?: boolean;
  };
  const orgId = credentials?.orgId;
  const accessToken = credentials?.accessToken;
  const region = credentials?.region || 'in';
  if (!orgId || !accessToken) {
    return NextResponse.json({ error: 'Connect your Zoho account first.' }, { status: 400 });
  }

  // Normalise and validate up front, so a typo fails immediately with a clear
  // reason instead of surfacing as an opaque "not found" once the run is underway.
  const seen = new Set<string>();
  const wanted: Array<{ email: string; password: string }> = [];
  const rejected: Array<{ email: string; error: string }> = [];
  for (const raw of entries ?? []) {
    const email = (raw.email ?? '').trim().toLowerCase();
    const password = raw.password ?? '';
    if (!email || !email.includes('@')) {
      rejected.push({ email: raw.email ?? '(blank)', error: 'Not a valid email address' });
      continue;
    }
    if (!password || password.length < 8) {
      rejected.push({ email, error: 'Password must be at least 8 characters' });
      continue;
    }
    if (seen.has(email)) {
      rejected.push({ email, error: 'Listed more than once — only the first entry was kept' });
      continue;
    }
    seen.add(email);
    wanted.push({ email, password });
  }
  if (wanted.length === 0) {
    return NextResponse.json({
      error: rejected.length
        ? `None of the ${rejected.length} entries were usable. First problem: ${rejected[0].email} — ${rejected[0].error}`
        : 'No entries were given.',
      rejected,
    }, { status: 400 });
  }

  const base = `https://mail.zoho.${region}/api`;
  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Listing is deferred to the detached run: crawling this organisation costs
  // ~10 seconds per 50 mailboxes, far longer than the request can stay open.
  // A recent listing from the mailbox picker is reused when available.
  const cachedRaw = cachedRawAccountsFor(session.orgId, orgId) as ZohoAccountRow[] | undefined;

  const run = createRun({
    id: randomUUID(),
    orgId,
    workspaceId: session.orgId,
    mode: 'passwords',
    total: wanted.length,
  });
  console.log(`[zoho-set-passwords] run ${run.id} started for org ${orgId}: ${wanted.length} mailbox(es) requested`
    + (rejected.length ? `, ${rejected.length} rejected before starting` : ''));

  void runSetPasswords({ run, wanted, cachedRaw, base, headers, orgId, forcePasswordChange });

  return NextResponse.json({ runId: run.id, rejected }, { headers: { 'Cache-Control': 'no-store, private' } });
}

async function runSetPasswords(opts: {
  run: RunState;
  wanted: Array<{ email: string; password: string }>;
  cachedRaw?: ZohoAccountRow[];
  base: string;
  headers: Record<string, string>;
  orgId: string;
  forcePasswordChange?: boolean;
}) {
  const { run, wanted, cachedRaw, base, headers, orgId, forcePasswordChange } = opts;

  try {
    // Resolve each requested address to a zuid. Listing happens here, not in the
    // request, for the same reason the run itself is detached.
    let accounts: ZohoAccountRow[];
    if (cachedRaw?.length) {
      accounts = cachedRaw;
    } else {
      const fetched = await fetchAllZohoAccounts({ base, orgId, headers, deadlineMs: 4 * 60_000 });
      if (!fetched.ok) { finishRun(run, fetched.error); return; }
      accounts = fetched.accounts;
    }
    const byAddress = new Map<string, ZohoAccountRow>();
    for (const a of accounts) for (const addr of addressesFor(a)) byAddress.set(addr, a);

    // Never reset the OAuth token owner's password mid-run — Zoho invalidates the
    // token the instant it changes, which would fail every call after it. Unlike
    // enable-imap (which just skips the owner), here the owner may be someone the
    // admin specifically listed — so instead of silently dropping them, their entry
    // is deferred to run LAST, after every other mailbox is already done and losing
    // the token no longer matters.
    let tokenOwner = '';
    try {
      const meRes = await fetch(`${base}/accounts`, { headers });
      if (meRes.ok) {
        const me = ((await meRes.json()) as { data?: ZohoAccountRow[] }).data?.[0];
        tokenOwner = (me?.incomingUserName || me?.mailboxAddress || '').toLowerCase();
      }
    } catch { /* fall through: an unidentified owner just means no deferral happens */ }

    const ordered = tokenOwner
      ? [...wanted.filter(w => w.email !== tokenOwner), ...wanted.filter(w => w.email === tokenOwner)]
      : wanted;

    const passwords: Record<string, string> = {};

    for (const { email, password } of ordered) {
      const account = byAddress.get(email);
      if (!account) {
        recordMailbox(run, { email, status: 'failed', error: 'No mailbox with this address in this Zoho organisation' });
        console.log(`[zoho-set-passwords] run ${run.id}   ${email}: failed (not found)`);
        continue;
      }
      if (account.zuid == null) {
        recordMailbox(run, { email, status: 'failed', error: 'Zoho did not return a zuid for this mailbox' });
        console.log(`[zoho-set-passwords] run ${run.id}   ${email}: failed (no zuid)`);
        continue;
      }
      const isOwner = tokenOwner && email === tokenOwner;
      try {
        const res = await fetch(`${base}/organization/${orgId}/accounts/${account.zuid}`, {
          method: 'PUT', headers,
          body: JSON.stringify({
            zuid: String(account.zuid), password, mode: 'resetPassword',
            oneTimePassword: forcePasswordChange ?? false,
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          // Zoho already has this exact password for the mailbox, so the desired
          // state is already true — see the note in enable-imap.
          if (/password\s+history/i.test(text)) {
            passwords[email] = password;
            recordMailbox(run, { email, status: 'unchanged' });
            console.log(`[zoho-set-passwords] run ${run.id}   ${email}: already set to this value`);
            continue;
          }
          const error = `HTTP ${res.status}: ${text.slice(0, 140)}`;
          recordMailbox(run, { email, status: 'failed', error });
          console.log(`[zoho-set-passwords] run ${run.id}   ${email}: failed (${error})`);
          continue;
        }
        // Password VALUES are never written to the log — only that a change
        // happened and to how many mailboxes so far.
        passwords[email] = password;
        recordMailbox(run, { email, status: 'changed' });
        console.log(`[zoho-set-passwords] run ${run.id}   ${email}: password set (${run.changed}/${run.total})`
          + (isOwner ? ' [connection token now invalid — this was the last mailbox in the run]' : ''));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        recordMailbox(run, { email, status: 'failed', error });
        console.log(`[zoho-set-passwords] run ${run.id}   ${email}: failed (${error})`);
      }
    }

    run.passwords = passwords;
    run.passwordsSet = Object.keys(passwords).length;

    finishRun(run);
    console.log(`[zoho-set-passwords] run ${run.id}: finished — ${run.changed} set, ${run.failed} failed`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[zoho-set-passwords] run ${run.id}: aborted — ${error}`);
    finishRun(run, error);
  }
}
