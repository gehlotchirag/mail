import { NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { removeDomain, listUsersForDomain, deleteUser } from '@/lib/flux';
import { getVerifyRecord, verifyDomainOwnership, detectDnsProvider, getPublishableRecords, getMxHosts } from '@/lib/dns';
import { ensureSesIdentity, getSesAccountStatus, deleteSesIdentity } from '@/lib/ses';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const domain = await queryOne<{ id: string; domain: string; verified: boolean; verify_token: string }>(
    'SELECT * FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // SES state decides whether this domain can send at all, so it is fetched
  // alongside the DNS records rather than left for the customer to discover via a
  // bounce. `ensureSesIdentity` is idempotent, so this also self-heals domains that
  // were created before SES provisioning existed.
  const [dnsProvider, ses, account, records, mxHosts] = await Promise.all([
    detectDnsProvider(domain.domain),
    ensureSesIdentity(domain.domain),
    getSesAccountStatus(),
    // Same builder the provider routes publish from, so what the page shows and
    // what the button pushes can never disagree.
    getPublishableRecords(domain.domain, { verified: domain.verified, verifyToken: domain.verify_token }),
    // Ownership verified is not the same claim as "mail routes here" — see
    // getMxHosts. The detail page uses this to keep the DNS step open (and its
    // warning visible) even for a domain the wizard would otherwise treat as done,
    // and to say honestly where mail currently resolves instead of a boolean.
    getMxHosts(domain.domain),
  ]);
  const mailHost = (process.env.MAIL_HOST ?? 'mail.arhamworkspace.tech').replace(/\.$/, '').toLowerCase();
  const mxLive = mxHosts === null ? null : mxHosts.includes(mailHost);

  return NextResponse.json({
    ...domain,
    mxLive,
    mxHosts,
    records,
    verifyRecord: getVerifyRecord(domain.domain, domain.verify_token),
    dnsProvider,  // 'cloudflare' | 'godaddy' | 'namecheap' | 'route53' | null
    sending: {
      ready: ses.verified && !account.sandbox,
      sesIdentityExists: ses.exists,
      sesVerified: ses.verified,
      dkimStatus: ses.dkimStatus ?? null,
      // While sandboxed, mail only reaches verified recipients — a platform-wide
      // limit the customer cannot fix, so say so explicitly.
      sandbox: account.sandbox,
      ...(ses.error ? { error: ses.error } : {}),
    },
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { action } = await req.json() as { action?: string };

  const domain = await queryOne<{ id: string; domain: string; verified: boolean; verify_token: string }>(
    'SELECT * FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'verify') {
    if (domain.verified) return NextResponse.json({ verified: true });
    const ok = await verifyDomainOwnership(domain.domain, domain.verify_token);
    if (ok) {
      await query('UPDATE domains SET verified = true WHERE id = $1', [id]);
      return NextResponse.json({ verified: true });
    }
    return NextResponse.json({ verified: false, error: 'TXT record not found yet. DNS can take up to 48 hours to propagate.' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const domain = await queryOne<{ flux_domain_id?: string; domain: string }>(
    'SELECT flux_domain_id, domain FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Deleting a domain destroys every mailbox under it, and mail is not recoverable
  // once the accounts are gone. Refuse while mailboxes exist rather than letting one
  // click take out a tenant's entire mail history; `?force=true` is the deliberate
  // opt-out for someone who has actually read the warning.
  const force = new URL(req.url).searchParams.get('force') === 'true';
  if (domain.flux_domain_id && !force) {
    let mailboxes: Awaited<ReturnType<typeof listUsersForDomain>> = [];
    try {
      mailboxes = await listUsersForDomain(domain.flux_domain_id);
    } catch (e) {
      // Can't prove the domain is empty — refuse rather than guess.
      return NextResponse.json(
        { error: `Could not check for mailboxes on the mail server (${e instanceof Error ? e.message : 'unknown error'}). Refusing to delete.` },
        { status: 502 }
      );
    }
    if (mailboxes.length > 0) {
      return NextResponse.json({
        error: `"${domain.domain}" still has ${mailboxes.length} mailbox${mailboxes.length === 1 ? '' : 'es'}. `
             + 'Deleting the domain permanently destroys them and their mail. Delete the mailboxes first, '
             + 'or confirm you understand the data will be lost.',
        mailboxCount: mailboxes.length,
        mailboxes: mailboxes.map(u => u.emailAddress).slice(0, 20),
        requiresForce: true,
      }, { status: 409 });
    }
  }

  // `force` means the operator read the warning naming the mailboxes and chose to
  // destroy them. Previously it only skipped OUR guard — the mailboxes stayed, Flux
  // refused the domain with `objectIsLinked`, and the delete could never succeed no
  // matter how many times it was confirmed. If we are going to offer "delete anyway",
  // it has to actually do it.
  if (domain.flux_domain_id && force) {
    let doomed: Awaited<ReturnType<typeof listUsersForDomain>> = [];
    try {
      doomed = await listUsersForDomain(domain.flux_domain_id);
    } catch (e) {
      return NextResponse.json(
        { error: `Could not list mailboxes to remove (${e instanceof Error ? e.message : 'unknown error'}). Nothing was deleted.` },
        { status: 502 }
      );
    }

    const failures: string[] = [];
    for (const u of doomed) {
      const res = await deleteUser(u.id);
      if (res.error) {
        console.error(`[domains] could not delete mailbox ${u.emailAddress}: ${res.error}`);
        failures.push(`${u.emailAddress} (${res.error})`);
      }
    }
    if (failures.length > 0) {
      return NextResponse.json({
        error: `Could not remove ${failures.length} mailbox(es), so "${domain.domain}" was left in place: `
             + failures.join('; '),
      }, { status: 502 });
    }
    if (doomed.length) {
      console.log(`[domains] force-deleted ${doomed.length} mailbox(es) under "${domain.domain}"`);
    }
  }

  // Remove from Flux and honour the result. Ignoring it used to leave the
  // console row deleted while the domain still existed on the mail server, so the
  // UI showed nothing while mailboxes kept receiving mail.
  if (domain.flux_domain_id) {
    const removed = await removeDomain(domain.flux_domain_id);
    if (removed.error) {
      console.error(`[domains] Flux refused to delete "${domain.domain}": ${removed.error}`);
      // `objectIsLinked` is the server telling us something still references the
      // domain. It means nothing to a customer, so say what it implies instead.
      const friendly = /objectIsLinked/i.test(removed.error)
        ? `"${domain.domain}" still has something attached to it on the mail server `
          + '(a mailbox, alias or mailing list). Remove those first, then delete the domain.'
        : `The mail server would not delete "${domain.domain}": ${removed.error}`;
      return NextResponse.json({ error: friendly }, { status: 502 });
    }
  }

  // Release the SES identity too, otherwise removed tenants accumulate against the
  // account's identity quota and a re-add later collides with the stale entry.
  const sesDel = await deleteSesIdentity(domain.domain);
  if (sesDel.error) console.error(`[domains] could not delete SES identity "${domain.domain}": ${sesDel.error}`);
  // Ownership was already proven above, but keep the org filter on the write so
  // the guarantee lives in the statement rather than in the reader's memory of
  // what happened 90 lines earlier.
  await query('DELETE FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]);
  return NextResponse.json({ ok: true });
}
