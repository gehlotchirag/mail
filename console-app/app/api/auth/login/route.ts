import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne, ensureDb } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(req: Request) {
  // 10 attempts per 60 seconds per IP
  const ip = getClientIp(req);
  const { allowed } = rateLimit(`login:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  }

  try {
    const { email, password } = await req.json() as { email?: string; password?: string };
    if (!email || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 });

    await ensureDb();
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
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
