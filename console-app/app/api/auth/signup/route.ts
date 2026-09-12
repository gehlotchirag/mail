import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, queryOne, ensureDb } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { issueVerificationEmail } from '@/lib/tokens';
import { PLANS } from '@/lib/plans';

export async function POST(req: Request) {
  // 5 signups per hour per IP
  const ip = getClientIp(req);
  const { allowed } = rateLimit(`signup:${ip}`, 5, 60 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many signup attempts. Try again later.' }, { status: 429 });
  }

  try {
    const { name, email, password } = await req.json() as { name?: string; email?: string; password?: string };
    if (!name || !email || !password) {
      return NextResponse.json({ error: 'name, email and password are required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    await ensureDb();

    const existing = await queryOne('SELECT id FROM organizations WHERE owner_email = $1', [email.toLowerCase()]);
    if (existing) return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });

    const hash = await bcrypt.hash(password, 12);
    const org = await queryOne<{ id: string }>(`
      INSERT INTO organizations (name, owner_email, password_hash)
      VALUES ($1, $2, $3) RETURNING id
    `, [name, email.toLowerCase(), hash]);

    if (!org) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });

    // Every new org is provisioned straight onto the free Lite offer — 20
    // mailboxes, free for a year, no card — not the old 14-day/3-mailbox
    // `trial` plan. `status: 'trial'` is deliberate, not a typo: it reuses
    // getActiveSub()'s existing trial-expiry check (status='trial' AND
    // trial_ends_at in the past => no active subscription) as the enforcement
    // for the free year, so nothing new has to detect the free period ending.
    // The seat cap is likewise just `max_users`, enforced by the ordinary
    // per-plan seat check every other tier already goes through.
    await query(`
      INSERT INTO subscriptions (org_id, plan, max_users, status, trial_ends_at)
      VALUES ($1, 'lite', $2, 'trial', NOW() + ($3 || ' days')::interval)
    `, [org.id, PLANS.lite.freeIncludedUsers, String(PLANS.lite.freeDays)]);

    // Confirm the address is real and reachable. Deliberately not fatal: the account
    // and its subscription already exist, and losing a signup to a transient SMTP
    // error would be far worse than an unconfirmed address the owner can resend from
    // the dashboard. `emailSent: false` tells the client to say so plainly.
    const emailSent = await issueVerificationEmail(org.id, email.toLowerCase(), name);

    const token = await createSession({ orgId: org.id, email: email.toLowerCase(), name });
    const res = NextResponse.json({ ok: true, emailSent }, { status: 201 });
    res.cookies.set('console_token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 7 * 24 * 3600, path: '/',
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
