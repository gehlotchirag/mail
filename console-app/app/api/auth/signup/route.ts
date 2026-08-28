import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, queryOne, initDb } from '@/lib/db';
import { createSession } from '@/lib/auth';

export async function POST(req: Request) {
  const { name, email, password } = await req.json() as { name?: string; email?: string; password?: string };
  if (!name || !email || !password) {
    return NextResponse.json({ error: 'name, email and password are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }
  await initDb();

  const existing = await queryOne('SELECT id FROM organizations WHERE owner_email = $1', [email.toLowerCase()]);
  if (existing) return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });

  const hash = await bcrypt.hash(password, 12);
  const org = await queryOne<{ id: string }>(`
    INSERT INTO organizations (name, owner_email, password_hash)
    VALUES ($1, $2, $3) RETURNING id
  `, [name, email.toLowerCase(), hash]);

  if (!org) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });

  // Create trial subscription
  await query(`
    INSERT INTO subscriptions (org_id, plan, max_users, status)
    VALUES ($1, 'trial', 3, 'trial')
  `, [org.id]);

  const token = await createSession({ orgId: org.id, email: email.toLowerCase(), name });
  const res = NextResponse.json({ ok: true }, { status: 201 });
  res.cookies.set('console_token', token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', maxAge: 7 * 24 * 3600, path: '/',
  });
  return res;
}
