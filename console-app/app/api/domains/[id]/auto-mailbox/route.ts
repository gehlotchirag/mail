import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { queryOne } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { listUsersForDomain, createUser } from '@/lib/flux';
import { getActiveSub } from '@/lib/subscription';
import { resolvePlanLimits, PLANS } from '@/lib/plans';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const domain = await queryOne<{ id: string; domain: string; flux_domain_id: string | null }>(
    'SELECT id, domain, flux_domain_id FROM domains WHERE id = $1 AND org_id = $2',
    [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
  if (!domain.flux_domain_id) return NextResponse.json({ error: 'Domain not provisioned on mail server yet' }, { status: 400 });

  try {
    const existingUsers = await listUsersForDomain(domain.flux_domain_id);
    if (existingUsers.length > 0) {
      return NextResponse.json({
        ok: true,
        mailbox: existingUsers[0].emailAddress,
        isNew: false,
        allMailboxes: existingUsers.map(u => u.emailAddress)
      });
    }

    let body: { desiredUsername?: string } = {};
    try {
      body = await req.json();
    } catch { /* empty body is ok */ }

    // Derive personalised username from session or desired name
    let username = 'admin';
    if (body.desiredUsername && /^[a-z0-9._-]+$/i.test(body.desiredUsername)) {
      username = body.desiredUsername.toLowerCase();
    } else if (session.email?.toLowerCase().endsWith(`@${domain.domain}`)) {
      username = session.email.toLowerCase().split('@')[0];
    } else if (session.email) {
      const handle = session.email.toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '');
      if (handle.length >= 2) username = handle;
    } else if (session.name) {
      const handle = session.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (handle.length >= 2) username = handle;
    }

    const sub = await getActiveSub(session.orgId);
    const limits = resolvePlanLimits(sub ?? { plan: 'lite', max_users: PLANS.lite.freeIncludedUsers });

    // Generate secure default password if needed
    const autoPassword = `Arham@${crypto.randomBytes(4).toString('hex')}!`;
    const userRes = await createUser(
      username,
      domain.flux_domain_id,
      autoPassword,
      session.name || username,
      limits.storageBytesPerUser
    );

    if ('error' in userRes) {
      return NextResponse.json({ error: userRes.error }, { status: 400 });
    }

    const fullEmail = `${username}@${domain.domain}`;
    return NextResponse.json({
      ok: true,
      mailbox: fullEmail,
      isNew: true,
      autoPassword,
      allMailboxes: [fullEmail]
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auto-mailbox] Failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
