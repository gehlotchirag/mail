import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { listAllUsers, getAccountDiskQuotas } from '@/lib/flux';
import { getActiveSub, subErrorResponse } from '@/lib/subscription';
import { resolvePlanLimits } from '@/lib/plans';
import { applyOrgStorageQuotas } from '@/lib/quota';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Reports how the organisation's mail accounts compare with the storage quota
 * its plan entitles them to. Read-only — nothing is written to the mail server.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sub = await getActiveSub(session.orgId);
  if (!sub) return subErrorResponse();
  const limits = resolvePlanLimits(sub);

  const domains = await query<{ flux_domain_id: string | null }>(
    'SELECT flux_domain_id FROM domains WHERE org_id = $1 AND flux_domain_id IS NOT NULL',
    [session.orgId]
  );
  const fluxDomainIds = new Set(
    domains.map(d => d.flux_domain_id).filter((id): id is string => !!id)
  );

  const accounts = (await listAllUsers()).filter(u => u.domainId && fluxDomainIds.has(u.domainId));
  const current = await getAccountDiskQuotas(accounts.map(a => a.id));

  return NextResponse.json({
    plan: limits.plan,
    storageBytesPerUser: limits.storageBytesPerUser,
    accounts: accounts.length,
    // getAccountDiskQuotas is best effort; an empty map means the server did not
    // report quotas at all, so we cannot claim anything is out of date.
    quotasReadable: current.size > 0 || accounts.length === 0,
    outOfDate: accounts.filter(a => current.get(a.id) !== limits.storageBytesPerUser).length,
    users: accounts.map(a => ({
      id: a.id,
      emailAddress: a.emailAddress,
      storageQuotaBytes: current.get(a.id) ?? null,
    })),
  });
}

/**
 * Backfills / re-applies the plan's per-user storage quota across every mail
 * account in the organisation. Safe to re-run: accounts already on the correct
 * quota are skipped.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Each run walks every account on the mail server; keep it from being spammed.
  const { allowed } = rateLimit(`quota-sync:${session.orgId}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many quota sync requests. Please wait a minute and try again.' },
      { status: 429 }
    );
  }

  const sub = await getActiveSub(session.orgId);
  if (!sub) return subErrorResponse();

  const result = await applyOrgStorageQuotas(session.orgId);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    ...result,
    ...(result.failed.length ? {
      warning: `${result.failed.length} account(s) could not be updated on the mail server.`,
    } : {}),
  });
}
