import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { listAllUsers, countUsersForDomains, createUser } from '@/lib/flux';
import { getActiveSub, subErrorResponse, limitErrorResponse } from '@/lib/subscription';
import { resolvePlanLimits } from '@/lib/plans';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const domains = await query<{ id: string; domain: string; flux_domain_id: string; verified: boolean }>(
    'SELECT id, domain, flux_domain_id, verified FROM domains WHERE org_id = $1', [session.orgId]
  );

  // One JMAP round-trip for the whole org, then group locally.
  const fluxUsers = await listAllUsers();
  const allUsers = domains
    .filter(d => d.flux_domain_id)
    .map(d => ({
      domainId: d.id,
      domain: d.domain,
      users: fluxUsers.filter(u => u.domainId === d.flux_domain_id),
    }));

  return NextResponse.json({ domains: allUsers });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { username, domainId, password, displayName } = await req.json() as {
    username?: string; domainId?: string; password?: string; displayName?: string;
  };
  if (!username || !domainId || !password) {
    return NextResponse.json({ error: 'username, domainId and password are required' }, { status: 400 });
  }

  // Verify domain belongs to this org
  const domain = await queryOne<{ flux_domain_id: string; verified: boolean }>(
    'SELECT flux_domain_id, verified FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
  if (!domain.flux_domain_id) return NextResponse.json({ error: 'Domain not provisioned yet' }, { status: 400 });

  // Check subscription is active
  const sub = await getActiveSub(session.orgId);
  if (!sub) return subErrorResponse();
  const limits = resolvePlanLimits(sub);

  // Check the user limit across EVERY domain in the organisation, not just the
  // one being added to — the plan sells N users per org, not N per domain.
  const orgDomains = await query<{ flux_domain_id: string | null }>(
    'SELECT flux_domain_id FROM domains WHERE org_id = $1 AND flux_domain_id IS NOT NULL',
    [session.orgId]
  );
  const orgFluxDomainIds = orgDomains
    .map(d => d.flux_domain_id)
    .filter((id): id is string => !!id);

  const currentUsers = await countUsersForDomains(orgFluxDomainIds);
  if (currentUsers >= limits.maxUsers) {
    return limitErrorResponse(
      `User limit reached (${limits.maxUsers}). Upgrade your plan to add more users.`
    );
  }

  const result = await createUser(
    username, domain.flux_domain_id, password, displayName, limits.storageBytesPerUser
  );
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    id: result.id,
    storageQuotaBytes: result.quotaApplied ? limits.storageBytesPerUser : null,
    ...(result.quotaApplied ? {} : {
      warning: 'Account created but the storage quota could not be applied on the mail server.',
    }),
  }, { status: 201 });
}
