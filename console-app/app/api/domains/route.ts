import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query, queryOne } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { addDomain } from '@/lib/flux';
import { getActiveSub, subErrorResponse, limitErrorResponse } from '@/lib/subscription';
import { resolvePlanLimits } from '@/lib/plans';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const domains = await query(
    'SELECT * FROM domains WHERE org_id = $1 ORDER BY created_at',
    [session.orgId]
  );
  return NextResponse.json({ domains });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const verifyToken = `arham-verify-${crypto.randomBytes(12).toString('hex')}`;

  // Add to Flux
  const fluxResult = await addDomain(clean);
  const fluxDomainId = 'error' in fluxResult ? null : fluxResult.id;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO domains (org_id, domain, flux_domain_id, verify_token)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [session.orgId, clean, fluxDomainId, verifyToken]
  );

  return NextResponse.json({ id: row?.id, domain: clean, verifyToken }, { status: 201 });
}
