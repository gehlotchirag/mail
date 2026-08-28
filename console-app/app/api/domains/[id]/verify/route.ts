import { NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { verifyDomainOwnership } from '@/lib/dns';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const domain = await queryOne<{ domain: string; verify_token: string; verified: boolean }>(
    'SELECT domain, verify_token, verified FROM domains WHERE id = $1 AND org_id = $2',
    [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (domain.verified) return NextResponse.json({ verified: true });

  const ok = await verifyDomainOwnership(domain.domain, domain.verify_token);
  if (ok) {
    await query('UPDATE domains SET verified = TRUE WHERE id = $1', [id]);
    return NextResponse.json({ verified: true });
  }
  return NextResponse.json({ verified: false, message: 'TXT record not found yet. DNS changes can take up to 48 hours to propagate.' });
}
