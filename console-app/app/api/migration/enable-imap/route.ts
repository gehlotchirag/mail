import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import { createRun, recordMailbox, finishRun, persistRun, type RunState } from '@/lib/imap-runs';
import { runPool } from '@/lib/run-pool';
import { fetchAllZohoAccounts } from '@/lib/zoho-accounts';
import { cachedRawAccountsFor } from '@/lib/discovery-runs';

/**
 * Turn IMAP on (or off) — and optionally reset passwords — for every mailbox in a
 * Zoho organisation.
 *
 * Zoho disables IMAP for all users by default and offers no bulk control: their
 * admin console exposes it as a per-user switch under Mailbox Settings, so a
 * 40-person migration otherwise starts with 40 manual clicks. There IS an admin
 * API for it (PUT .../accounts/{accountId} with mode=updateIMAPStatus), which is
 * what this drives.
 *
 * Deliberately a separate, explicit action rather than part of starting an import:
 * it changes the customer's own Zoho configuration, which we should never do as a
 * silent side effect of pressing "Import".
 *
 * Runs DETACHED from the request. An organisation of 200+ mailboxes takes minutes
 * — roughly one sequential Zoho API call per mailbox — which is longer than the
 * reverse proxy holds a connection open (60s). Doing the work inline meant nginx
 * returned 504 while the route kept running unseen: the caller got an error, and
 * the result — including any passwords just set — was thrown away with the closed
 * connection, leaving no record of what had actually changed. So this POST starts
 * the run, writes each mailbox to the log AS IT HAPPENS (so a crash mid-run still
 * leaves an audit trail), and returns a run id immediately; GET polls progress.
 */
interface ZohoAccountRow {
  accountId?: string;
  zuid?: number | string;
  incomingUserName?: string;
  mailboxAddress?: string;
  primaryEmailAddress?: string;
  emailAddress?: Array<{ mailId?: string }> | string;
  imapAccessEnabled?: boolean;
}

/** Every address this account answers to, lowercased. */
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

  const { credentials, resetPasswords, disableImap, exceptEmails, onlyEmails, imapAction, sharedPassword, forcePasswordChange } = await req.json() as {
    credentials?: Record<string, string>;
    /**
     * Ask Zoho to treat the new password as one-time, so each user is required to
     * choose their own at first login. Zoho's `oneTimePassword` flag: "Specifies if
     * the password is a one-time password... The user will be asked to change the
     * password on the first login."
     *
     * This is what stops a shared reset password from becoming several hundred
     * mailboxes permanently sharing one login secret.
     */
    forcePasswordChange?: boolean;
    /**
     * The value every selected mailbox is reset to. Supplied by the caller because
     * a hardcoded one cannot work: Zoho screens resets against breach corpora and
     * rejects anything that has ever leaked — `ChangeMe123` fails every time with
     * "Password has previously appeared in a data breach", so a whole run reports
     * 0 set / N failed and nobody's password actually changes.
     */
    sharedPassword?: string;
    /**
     * Turn IMAP OFF instead of on, to put a source system back the way it was after
     * an abandoned migration. Never resets passwords — a reset cannot be undone, so
     * pairing the two would imply a rollback this endpoint cannot deliver.
     */
    disableImap?: boolean;
    /**
     * Act on exactly these mailboxes, ignoring the domain scope entirely.
     *
     * The domain filter is the right tool for "migrate this whole domain"; it is the
     * wrong one for "these four people are locked out and are not migrating at all".
     * Without an explicit list, that case forced an operator to run a domain-wide
     * action and hope, or to touch nothing.
     */
    onlyEmails?: string[];
    /**
     * What to do about IMAP: switch it on, switch it off, or leave it completely
     * alone. 'none' matters for a user who is staying on Zoho — resetting their
     * password should not silently flip a mail-access setting on an account nobody
     * is going to migrate.
     */
    imapAction?: 'enable' | 'disable' | 'none';
    /**
     * Addresses to leave alone. Zoho reports only the CURRENT IMAP state, so a
     * disable pass cannot tell a mailbox we switched on from one the customer had
     * already switched on themselves. This is how those are protected.
     */
    exceptEmails?: string[];
    /**
     * Also set a known password on every mailbox.
     *
     * Zoho has no master-user IMAP: a credential authenticates exactly one
     * mailbox, so reading forty of them needs forty credentials. App passwords are
     * self-service and cannot be created by an admin, which leaves this — the admin
     * password-reset API — as the only way to obtain them without involving every
     * user individually.
     *
     * Destructive to the SOURCE system: it signs those users out of Zoho until they
     * are given the new password. Never inferred; the caller must ask for it.
     */
    resetPasswords?: boolean;
  };
  const orgId = credentials?.orgId;
  const accessToken = credentials?.accessToken;
  const region = credentials?.region || 'in';
  if (!orgId || !accessToken) {
    return NextResponse.json({ error: 'Connect your Zoho account first.' }, { status: 400 });
  }

  // Validate the shared password BEFORE starting anything. Zoho only rejects it
  // per-mailbox, so an unusable value produced a run that dutifully failed several
  // hundred times and reported "0 set" — which reads as a broken tool rather than
  // a rejected password.
  if (resetPasswords) {
    const pw = sharedPassword ?? '';
    if (pw.length < 10) {
      return NextResponse.json({
        error: 'Choose a password of at least 10 characters for the reset.',
      }, { status: 400 });
    }
    // Zoho checks resets against breach corpora. These are the shapes that always
    // fail there, and failing here costs one request instead of several hundred.
    const weak = /^(changeme|password|welcome|qwerty|letmein|admin|test)\d*!?$/i;
    if (weak.test(pw) || /^(.)\1+$/.test(pw)) {
      return NextResponse.json({
        error: 'Zoho refuses passwords that have appeared in a data breach, and this is one of them — '
             + 'every mailbox would fail. Use something unique, e.g. two unrelated words plus digits.',
      }, { status: 400 });
    }
  }

  const base = `https://mail.zoho.${region}/api`;
  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // The account listing itself is quick (a handful of paged calls), so it stays in
  // the request — a bad org id or a dead token should fail fast with a clear error
  // rather than starting a run that immediately has nothing to do.
  //
  // Paged in a loop, not a single `limit=200&start=0` call: this org has 200+
  // mailboxes, and a single page silently drops everything past the 200th with no
  // error — the earlier version of this route would have run against the first
  // 200 and reported success while up to however-many more were never touched.
  // The account listing is NOT done here. Zoho takes ~10 seconds per 50 mailboxes,
  // so crawling a 300-mailbox organisation costs over a minute — longer than the
  // reverse proxy will hold this request open. Listing inline meant the POST never
  // returned, the browser sat on "Working…", and the run id never reached it.
  //
  // A recent listing from the mailbox picker is reused when present, which makes
  // the common path instant; otherwise the detached run crawls for itself.
  const cachedRaw = cachedRawAccountsFor(session.orgId, orgId) as ZohoAccountRow[] | undefined;

  // Scope every change. This endpoint enables/disables IMAP and, on request, RESETS
  // PASSWORDS — signing people out of Zoho. Doing that to anyone the customer never
  // asked to touch would be an outage we caused in someone else's mail system, so
  // the narrowing happens before anything runs.
  //
  // An explicit mailbox list wins outright over the domain scope: picking four
  // named people is a deliberately narrower instruction than "this whole domain",
  // and silently intersecting the two would quietly drop rows the operator ticked.
  const picked = new Set((onlyEmails ?? []).map(e => e.trim().toLowerCase()).filter(Boolean));
  const wantedDomains = (credentials?.importDomains ?? '')
    .split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const domainFilter = picked.size === 0 && wantedDomains.length ? new Set(wantedDomains) : null;

  // `imapAction` is the explicit form; `disableImap` is the older boolean kept
  // working so nothing that still sends it silently changes meaning.
  const effectiveImapAction: 'enable' | 'disable' | 'none' =
    imapAction ?? (disableImap ? 'disable' : 'enable');

  // `total` starts at 0 and is set once the run knows how many mailboxes are in
  // scope — the count is not available until the listing completes.
  const run = createRun({
    id: randomUUID(),
    orgId,
    workspaceId: session.orgId,
    mode: effectiveImapAction === 'none' ? 'passwords' : effectiveImapAction === 'disable' ? 'disabled' : 'enabled',
    total: 0,
    scopedToDomains: domainFilter ? [...domainFilter] : undefined,
  });
  console.log(
    `[zoho-imap] run ${run.id} started for org ${orgId}: imap=${effectiveImapAction} `
    + `passwords=${resetPasswords ? 'yes' : 'no'}`
    + (picked.size > 0 ? ` (explicit list of ${picked.size})` : '')
    + (domainFilter ? ` scoped to ${[...domainFilter].join(', ')}` : '')
    + (cachedRaw ? ` — reusing ${cachedRaw.length} cached accounts` : ' — will list accounts itself')
  );

  // Fire and forget. This process is a long-lived PM2 worker, not a serverless
  // function that dies when the response is sent, so the work genuinely continues
  // after POST returns — that's what makes detaching it possible at all.
  void runImapChange({
    run, cachedRaw, base, headers, orgId,
    imapAction: effectiveImapAction, resetPasswords, exceptEmails, picked, domainFilter,
    sharedPassword, forcePasswordChange,
  });

  return NextResponse.json({ runId: run.id }, { headers: { 'Cache-Control': 'no-store, private' } });
}

async function runImapChange(opts: {
  run: RunState;
  cachedRaw?: ZohoAccountRow[];
  base: string;
  headers: Record<string, string>;
  orgId: string;
  imapAction: 'enable' | 'disable' | 'none';
  resetPasswords?: boolean;
  exceptEmails?: string[];
  picked: Set<string>;
  domainFilter: Set<string> | null;
  sharedPassword?: string;
  forcePasswordChange?: boolean;
}) {
  const { run, cachedRaw, base, headers, orgId, imapAction, resetPasswords, exceptEmails, picked, domainFilter, sharedPassword, forcePasswordChange } = opts;
  const disableImap = imapAction === 'disable';
  const verb = disableImap ? 'disabled' : 'enabled';

  try {
    // Listing happens HERE, not in the request, because it can take minutes.
    let accounts: ZohoAccountRow[];
    if (cachedRaw?.length) {
      accounts = cachedRaw;
    } else {
      const fetched = await fetchAllZohoAccounts({
        base, orgId, headers,
        deadlineMs: 4 * 60_000,
        onProgress: n => { run.total = n; },
      });
      if (!fetched.ok) { finishRun(run, fetched.error); return; }
      accounts = fetched.accounts;
      if (fetched.truncated) {
        console.warn(`[zoho-imap] run ${run.id}: account list truncated at ${accounts.length}`);
      }
    }

    // Scope AFTER listing. An explicit mailbox list wins outright over the domain
    // scope: picking named people is a narrower instruction than naming a domain,
    // and intersecting them would silently drop rows the operator ticked.
    if (picked.size > 0) {
      accounts = accounts.filter(a => addressesFor(a).some(x => picked.has(x)));
    } else if (domainFilter) {
      accounts = accounts.filter(a => {
        const addr = a.incomingUserName ?? a.mailboxAddress ?? a.primaryEmailAddress ?? '';
        const dom = addr.split('@')[1]?.toLowerCase();
        return !!dom && domainFilter.has(dom);
      });
    }

    if (accounts.length === 0) {
      finishRun(run, picked.size > 0
        ? 'None of the selected addresses exist in this Zoho organisation. Nothing was changed.'
        : `No mailboxes matched the selected scope. Nothing was changed.`);
      return;
    }

    run.total = accounts.length;
    console.log(`[zoho-imap] run ${run.id}: ${accounts.length} mailbox(es) in scope`);
    // Persisted at milestones rather than per mailbox: 550 rows of write traffic
    // would cost more than the visibility is worth, and a crash between two
    // checkpoints still leaves the per-mailbox log.
    await persistRun(runPool(), run);

    const targetState = !disableImap;
    const spare = new Set((exceptEmails ?? []).map(e => e.trim().toLowerCase()).filter(Boolean));

    // 'none' leaves Zoho's IMAP setting completely untouched — the case where
    // someone is staying on Zoho and only needs their password back. Their run
    // still records a row per mailbox so the count and audit trail are unbroken.
    for (const a of imapAction === 'none' ? [] : accounts) {
      const email = a.incomingUserName || a.mailboxAddress || String(a.accountId ?? 'unknown');

      if (spare.size && addressesFor(a).some(x => spare.has(x))) {
        recordMailbox(run, { email, status: 'unchanged' });
        console.log(`[zoho-imap] run ${run.id}   ${email}: unchanged (spared)`);
        continue;
      }
      // Already in the state being asked for — nothing to do either way.
      if (Boolean(a.imapAccessEnabled) === targetState) {
        recordMailbox(run, { email, status: 'unchanged' });
        console.log(`[zoho-imap] run ${run.id}   ${email}: unchanged (already ${targetState ? 'on' : 'off'})`);
        continue;
      }
      if (!a.accountId || a.zuid == null) {
        const error = 'Zoho did not return an account id for this mailbox';
        recordMailbox(run, { email, status: 'failed', error });
        console.log(`[zoho-imap] run ${run.id}   ${email}: failed (${error})`);
        continue;
      }

      try {
        const res = await fetch(`${base}/organization/${orgId}/accounts/${a.accountId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            zuid: String(a.zuid),
            mode: 'updateIMAPStatus',
            imapAccessEnabled: String(targetState),
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          const scopeIssue = /scope|OAUTH/i.test(text) || res.status === 401 || res.status === 403;
          const error = scopeIssue
            ? 'Zoho refused: reconnect your Zoho account so we can request permission to change IMAP settings.'
            : `Zoho returned HTTP ${res.status}: ${text.slice(0, 140)}`;
          recordMailbox(run, { email, status: 'failed', error });
          console.log(`[zoho-imap] run ${run.id}   ${email}: failed (${error})`);
          continue;
        }
        recordMailbox(run, { email, status: 'changed' });
        // Logged as each mailbox completes — not batched at the end — so a run
        // killed halfway still leaves a true count of what was actually done.
        console.log(`[zoho-imap] run ${run.id}   ${email}: ${verb} (${run.changed}/${run.total} so far)`);
        if (run.processed % 25 === 0) await persistRun(runPool(), run);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        recordMailbox(run, { email, status: 'failed', error });
        console.log(`[zoho-imap] run ${run.id}   ${email}: failed (${error})`);
      }
    }

    console.log(
      `[zoho-imap] run ${run.id}: IMAP pass done — ${verb}=${run.changed} unchanged=${run.unchanged} failed=${run.failed}`
    );
    console.log(`[zoho-imap] run ${run.id}: ${verb} by domain: `
      + (Object.entries(run.byDomain).map(([d, n]) => `${d}=${n}`).join(', ') || 'none'));

    if (resetPasswords && imapAction !== 'disable') {
      // When IMAP was left alone, the password pass IS the run — so it reports the
      // per-mailbox progress that the (skipped) IMAP loop would otherwise have
      // provided. Without this the progress bar would sit at 0 of N throughout.
      await resetAllPasswords(run, accounts, base, headers, orgId, imapAction === 'none', sharedPassword, forcePasswordChange);
    }

    finishRun(run);
    await persistRun(runPool(), run);
    console.log(`[zoho-imap] run ${run.id}: finished`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[zoho-imap] run ${run.id}: aborted — ${error}`);
    finishRun(run, error);
    await persistRun(runPool(), run);
  }
}

async function resetAllPasswords(
  run: RunState,
  accounts: ZohoAccountRow[],
  base: string,
  headers: Record<string, string>,
  orgId: string,
  /** Report each mailbox as run progress — true when this is the run's only phase. */
  trackProgress = false,
  sharedPassword?: string,
  forcePasswordChange = false,
) {
  const passwords: Record<string, string> = {};
  const passwordFailures: Array<{ email: string; error: string }> = [];

  /**
   * The password every selected mailbox is reset to.
   *
   * Supplied by the caller, and validated before the run starts. It used to be the
   * hardcoded 'ChangeMe123', which Zoho rejects for every single mailbox with
   * "Password has previously appeared in a data breach" — so the run reported
   * 0 set / N failed and no password ever changed, while the UI implied success.
   *
   * Consequences of any shared value, so nobody rediscovers them the hard way:
   *  - It is set on the customer's LIVE Zoho accounts, and Zoho's login page is
   *    public. Until each user changes it, anyone who knows an address can sign
   *    in as them and read their mail, calendar and WorkDrive.
   *  - It survives the migration; nothing here or in Zoho forces a change.
   */
  const SHARED_PASSWORD = sharedPassword ?? '';

  // Never reset the password of the account that OWNS this OAuth token.
  //
  // Zoho invalidates the token the moment its owner's password changes, so doing
  // so kills the run: the first reset succeeds and every call after it fails with
  // 401 INVALID_OAUTHTOKEN. It also locks the admin out of their own Zoho console
  // mid-migration.
  //
  // No loss of coverage: the connecting admin's own mailbox is the one Zoho DOES
  // serve over the REST API, so the migration reads it without an IMAP credential.
  let tokenOwner = '';
  try {
    const meRes = await fetch(`${base}/accounts`, { headers });
    if (meRes.ok) {
      const me = ((await meRes.json()) as { data?: ZohoAccountRow[] }).data?.[0];
      tokenOwner = (me?.incomingUserName || me?.mailboxAddress || '').toLowerCase();
    }
  } catch { /* fall through: better to skip nobody than to fail the whole step */ }
  if (tokenOwner) console.log(`[zoho-imap] run ${run.id}: skipping password reset for token owner ${tokenOwner}`);

  for (const a of accounts) {
    const thisEmail = (a.incomingUserName || a.mailboxAddress || '').toLowerCase();
    if (tokenOwner && thisEmail === tokenOwner) {
      run.skippedOwner = thisEmail;
      if (trackProgress) recordMailbox(run, { email: thisEmail, status: 'unchanged' });
      continue;
    }
    const email = a.incomingUserName || a.mailboxAddress || String(a.accountId ?? 'unknown');
    if (a.zuid == null) {
      const error = 'Zoho did not return a zuid for this mailbox';
      passwordFailures.push({ email, error });
      if (trackProgress) recordMailbox(run, { email, status: 'failed', error });
      continue;
    }
    try {
      // NOTE: this endpoint is keyed by ZUID, not accountId — unlike the IMAP call
      // above, which uses accountId. Zoho documents them differently and mixing
      // them up returns a misleading "invalid account" error.
      // `zuid` must be in the BODY as well as the URL. Zoho's own sample for
      // resetPassword omits it, but the API validates zuid before mode and rejects
      // the call with 400 "zuid is null" — which is what made every reset fail
      // while the IMAP call (whose docs DO include zuid) succeeded.
      const res = await fetch(`${base}/organization/${orgId}/accounts/${a.zuid}`, {
        method: 'PUT', headers,
        body: JSON.stringify({
          zuid: String(a.zuid),
          password: SHARED_PASSWORD,
          mode: 'resetPassword',
          // Zoho's own flag for "make them pick their own at first login". Sent
          // explicitly rather than left to a default this endpoint does not
          // document, so the behaviour is the same on every run.
          oneTimePassword: forcePasswordChange,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        // "Password present in the password history" means Zoho already knows this
        // exact value for this mailbox — almost always because an earlier run set
        // it. Refusing to re-set it is not a failure to reach the desired state:
        // the mailbox is ALREADY on the password we wanted. Treating it as a
        // failure dropped the credential, so the import had nothing to log in with
        // and fell back to an API call that 404s for anyone but the token owner.
        if (/password\s+history/i.test(text)) {
          for (const alias of addressesFor(a)) passwords[alias] = SHARED_PASSWORD;
          if (trackProgress) recordMailbox(run, { email, status: 'unchanged' });
          console.log(`[zoho-imap] run ${run.id}   password ${email}: already set to this value (reused)`);
          continue;
        }
        const error = `HTTP ${res.status}: ${text.slice(0, 140)}`;
        passwordFailures.push({ email, error });
        if (trackProgress) recordMailbox(run, { email, status: 'failed', error });
        console.log(`[zoho-imap] run ${run.id}   password ${email}: failed (${error})`);
        continue;
      }
      // Key by EVERY address Zoho reports for the account, not just the one we
      // display. Discovery picks the primary address via its own precedence, and
      // if that differs from `incomingUserName` the lookup would silently miss and
      // the user would fail as though no credential existed.
      for (const alias of addressesFor(a)) passwords[alias] = SHARED_PASSWORD;
      if (trackProgress) recordMailbox(run, { email, status: 'changed' });
      console.log(`[zoho-imap] run ${run.id}   password ${email}: reset (${Object.keys(passwords).length} so far)`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      passwordFailures.push({ email, error });
      if (trackProgress) recordMailbox(run, { email, status: 'failed', error });
      console.log(`[zoho-imap] run ${run.id}   password ${email}: failed (${error})`);
    }
  }

  run.passwords = passwords;
  run.passwordsSet = Object.keys(passwords).length;
  run.passwordFailures = passwordFailures;

  console.log(`[zoho-imap] run ${run.id}: passwords set for ${run.passwordsSet}, ${passwordFailures.length} failed`);
  for (const pf of passwordFailures) console.error(`[zoho-imap] run ${run.id}   ${pf.email}: ${pf.error}`);
}
