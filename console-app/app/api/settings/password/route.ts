import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';

/* POST /api/settings/password — verify current password, set new hash */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { current?: string; next?: string };
  if (!body.current || !body.next) {
    return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 });
  }
  if (body.next.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
  }

  /* Fetch stored hash */
  const org = await queryOne<{ password_hash: string }>(
    'SELECT password_hash FROM organizations WHERE id = $1',
    [session.orgId]
  );
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

  /* Verify current password */
  const valid = await bcrypt.compare(body.current, org.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
  }

  /* Hash and store new password */
  const newHash = await bcrypt.hash(body.next, 12);
  await query(
    'UPDATE organizations SET password_hash = $1 WHERE id = $2',
    [newHash, session.orgId]
  );

  return NextResponse.json({ ok: true });
}
