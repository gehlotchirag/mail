import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';

/* GET /api/settings/profile — return org name + email */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const org = await queryOne<{ name: string; owner_email: string }>(
    'SELECT name, owner_email FROM organizations WHERE id = $1',
    [session.orgId]
  );
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

  return NextResponse.json({ name: org.name, email: org.owner_email });
}

/* POST /api/settings/profile — update display name */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length < 1) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: 'Name must be 120 characters or fewer' }, { status: 400 });
  }

  await query(
    'UPDATE organizations SET name = $1 WHERE id = $2',
    [name, session.orgId]
  );

  return NextResponse.json({ ok: true, name });
}

/* DELETE /api/settings/profile — permanently delete the organization */
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  /* CASCADE on domains + subscriptions handles child rows */
  await query('DELETE FROM organizations WHERE id = $1', [session.orgId]);

  return NextResponse.json({ ok: true });
}
