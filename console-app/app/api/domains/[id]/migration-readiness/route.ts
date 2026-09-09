import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { runPool } from '@/lib/run-pool';
import { getSesIdentity, getSesAccountStatus } from '@/lib/ses';

type Params = { params: Promise<{ id: string }> };

/**
 * Whether it's safe to switch this domain's mail here — specifically, whether
 * every address that exists in a connected source system also has a mailbox on
 * this platform already.
 *
 * Switching MX affects the WHOLE domain the instant it takes effect, not just
 * the mailboxes someone has gotten around to migrating. An address that exists
 * in Zoho but has no mailbox here yet starts bouncing new mail the moment this
 * domain's MX changes — silently, with no error surfaced to the sender or to us.
 * This is the check that made an actual cutover safe to do by hand; it should not
 * take a manual investigation every time a domain goes live.
 *
 * Best effort: only looks at the most recent Zoho listing cached for this
 * workspace. No cached listing (never connected Zoho, or it expired) means
 * nothing to compare against — `checked: false`, not a false "all clear".
 */
export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const domain = await queryOne<{ domain: string }>(
    'SELECT domain FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId],
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  // Receiving and sending are verified independently, and only receiving was ever
  // checked here. A domain can pass every mailbox check, take over its MX, and still
  // be unable to send a single message because its SES identity is unverified — which
  // is exactly what happened, unnoticed, for a week. Read-only: this is a pre-flight
  // check, so it reports the state rather than repairing it.
  const [sesId, sesAccount] = await Promise.all([
    getSesIdentity(domain.domain),
    getSesAccountStatus(),
  ]);
  const sending = {
    ready: sesId.verified && !sesAccount.sandbox,
    dkimStatus: sesId.dkimStatus ?? null,
    sandbox: sesAccount.sandbox,
  };

  try {
    const cached = await runPool().query<{ mailboxes: Array<{ email: string; domain: string }> }>(
      `SELECT mailboxes FROM zoho_discovery_cache
        WHERE workspace_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [session.orgId],
    );
    const listing = cached.rows[0]?.mailboxes;
    if (!listing) return NextResponse.json({ checked: false, sending });

    const sourceEmails = listing
      .filter(m => m.domain === domain.domain)
      .map(m => m.email.toLowerCase());
    if (sourceEmails.length === 0) return NextResponse.json({ checked: false, sending });

    const { listAllUsers } = await import('@/lib/flux');
    const here = new Set((await listAllUsers()).map(u => u.emailAddress.toLowerCase()));
    const missing = sourceEmails.filter(e => !here.has(e));

    return NextResponse.json({
      checked: true,
      sourceTotal: sourceEmails.length,
      hereTotal: sourceEmails.length - missing.length,
      missing,
      sending,
    });
  } catch (e) {
    // A failed check must never block the publish outright — it degrades to "not
    // checked", the same as no Zoho connection ever having existed.
    console.warn('[migration-readiness] check failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ checked: false, sending });
  }
}
