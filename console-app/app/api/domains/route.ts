import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { provisionDomain } from '@/lib/domain-provisioning';
import { getSesDkimRecords } from '@/lib/dns';
import { getActiveSub, subErrorResponse, limitErrorResponse } from '@/lib/subscription';
import { resolvePlanLimits } from '@/lib/plans';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const domains = await query<{ id: string; domain: string; verified: boolean }>(
    'SELECT * FROM domains WHERE org_id = $1 ORDER BY created_at',
    [session.orgId]
  );

  // A domain can be "verified" (ownership proven) while its MX still points
  // somewhere else entirely — nothing before this checked, so a customer's mail
  // kept landing at their old provider with the console showing a green
  // checkmark. Only worth checking for domains that are otherwise done; bounded
  // and best-effort so one slow zone cannot hang the whole list.
  const { checkMxLive } = await import('@/lib/dns');
  const { getSesIdentity } = await import('@/lib/ses');
  const withMx = await Promise.all(domains.map(async d => {
    const [mxLive, ses] = await Promise.all([
      d.verified ? checkMxLive(d.domain) : Promise.resolve(null),
      // Whether the domain can SEND is a separate failure from where its mail
      // arrives, and it failed silently for a week: SES had marked the identity
      // FAILED, every outbound message bounced, and no screen said so.
      // Deliberately the read-only call — a list request must never create or
      // recreate an identity as a side effect. Repair belongs to the detail route.
      getSesIdentity(d.domain),
    ]);
    return { ...d, mxLive, sendingReady: ses.error ? null : ses.verified };
  }));

  return NextResponse.json({ domains: withMx });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Adding a domain provisions a mail server, an SES identity and DNS records, and
  // starts sending mail with this account's address on it. Requiring a confirmed
  // address first is what stops a mistyped or borrowed email from doing that. Login
  // is deliberately NOT gated — accounts that predate confirmation are grandfathered
  // in by the migration, and locking anyone out of their own dashboard to enforce
  // this would cost more than it protects.
  const owner = await queryOne<{ email_verified: boolean; owner_email: string }>(
    'SELECT email_verified, owner_email FROM organizations WHERE id = $1',
    [session.orgId]
  );
  if (owner && !owner.email_verified) {
    return NextResponse.json({
      error: `Confirm ${owner.owner_email} before adding a domain. We sent you a link when you signed up — `
           + 'check your inbox, or send it again.',
      emailUnverified: true,
      ownerEmail: owner.owner_email,
    }, { status: 403 });
  }

  // Check subscription is active
  const sub = await getActiveSub(session.orgId);
  if (!sub) return subErrorResponse();

  const { domain } = await req.json() as { domain?: string };
  if (!domain) return NextResponse.json({ error: 'domain is required' }, { status: 400 });

  const clean = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
    return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 });
  }

  const existing = await queryOne('SELECT id, org_id FROM domains WHERE domain = $1', [clean]);
  if (existing) {
    const e = existing as { id: string; org_id: string };
    if (e.org_id !== session.orgId) return NextResponse.json({ error: 'Domain already registered' }, { status: 409 });
    return NextResponse.json({ error: 'You already added this domain' }, { status: 409 });
  }

  // Check domain limit for this plan. maxDomains lives only in PLANS, so it is
  // resolved from the plan name reconciled against the subscriptions row.
  const { maxDomains } = resolvePlanLimits(sub);
  const domainCountRow = await queryOne<{ count: string }>(
    'SELECT COUNT(*) AS count FROM domains WHERE org_id = $1',
    [session.orgId]
  );
  const domainCount = parseInt(domainCountRow?.count ?? '0', 10);
  if (domainCount >= maxDomains) {
    return limitErrorResponse(
      `Domain limit reached (${maxDomains}). Upgrade your plan to add more domains.`
    );
  }

  // Same provisioning path the migration pre-flight uses, so adding a domain by
  // hand and importing a multi-domain organisation cannot drift apart.
  let provisioned;
  try {
    provisioned = await provisionDomain(session.orgId, clean);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[domains] provisioning failed for "${clean}": ${reason}`);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({
    id: provisioned.id,
    domain: provisioned.domain,
    verifyToken: provisioned.verifyToken,
    // The SES DKIM CNAMEs are part of the required DNS set; the domain page and the
    // provider auto-publisher both read them from here.
    sesDkimRecords: getSesDkimRecords(provisioned.sesTokens),
    sesVerified: provisioned.sesVerified,
    ...(provisioned.warnings.length ? { warnings: provisioned.warnings } : {}),
  }, { status: 201 });
}
