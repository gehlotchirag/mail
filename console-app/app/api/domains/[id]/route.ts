import { NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { removeDomain } from '@/lib/flux';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const domain = await queryOne('SELECT * FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]);
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ domain });
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
