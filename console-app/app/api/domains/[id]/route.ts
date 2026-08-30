import { NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { removeDomain } from '@/lib/flux';
import { getRequiredDnsRecords, getVerifyRecord, verifyDomainOwnership, detectDnsProvider } from '@/lib/dns';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const domain = await queryOne<{ id: string; domain: string; verified: boolean; verify_token: string }>(
    'SELECT * FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [dnsProvider] = await Promise.all([detectDnsProvider(domain.domain)]);
  return NextResponse.json({
    ...domain,
    records: getRequiredDnsRecords(domain.domain),
    verifyRecord: getVerifyRecord(domain.domain, domain.verify_token),
    dnsProvider,  // 'cloudflare' | 'godaddy' | 'namecheap' | 'route53' | null
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

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const domain = await queryOne<{ flux_domain_id?: string }>(
    'SELECT flux_domain_id FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (domain.flux_domain_id) await removeDomain(domain.flux_domain_id);
  await query('DELETE FROM domains WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
