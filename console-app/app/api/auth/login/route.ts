import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne, initDb } from '@/lib/db';
import { createSession } from '@/lib/auth';

export async function POST(req: Request) {
  const { email, password } = await req.json() as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 });

  await initDb();
  const org = await queryOne<{ id: string; name: string; password_hash: string }>(
    'SELECT id, name, password_hash FROM organizations WHERE owner_email = $1',
    [email.toLowerCase()]
  );
  if (!org) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

  const valid = await bcrypt.compare(password, org.password_hash);
  if (!valid) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

  const token = await createSession({ orgId: org.id, email: email.toLowerCase(), name: org.name });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('console_token', token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', maxAge: 7 * 24 * 3600, path: '/',
  });
  return res;
}
