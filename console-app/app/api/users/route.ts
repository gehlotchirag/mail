import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { listUsersForDomain, createUser } from '@/lib/flux';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const domains = await query<{ id: string; domain: string; flux_domain_id: string; verified: boolean }>(
    'SELECT id, domain, flux_domain_id, verified FROM domains WHERE org_id = $1', [session.orgId]
  );

  const allUsers: Array<{ domainId: string; domain: string; users: unknown[] }> = [];
  for (const d of domains) {
    if (!d.flux_domain_id) continue;
    const users = await listUsersForDomain(d.flux_domain_id);
    allUsers.push({ domainId: d.id, domain: d.domain, users });
  }
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

  // Check subscription limit
  const sub = await queryOne<{ max_users: number; status: string }>(
    'SELECT max_users, status FROM subscriptions WHERE org_id = $1', [session.orgId]
  );
  if (sub) {
    const currentUsers = await listUsersForDomain(domain.flux_domain_id);
    if (currentUsers.length >= sub.max_users) {
      return NextResponse.json({
        error: `User limit reached (${sub.max_users}). Upgrade your plan to add more users.`,
        limitReached: true,
      }, { status: 403 });
    }
  }

  const result = await createUser(username, domain.flux_domain_id, password, displayName);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
