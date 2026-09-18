import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, queryOne, ensureDb } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { issueVerificationEmail } from '@/lib/tokens';
import { PLANS, resolvePlanLimits } from '@/lib/plans';
import { provisionDomain, normaliseDomain, isValidDomain } from '@/lib/domain-provisioning';
import { createUser } from '@/lib/flux';

export async function POST(req: Request) {
  // 5 signups per hour per IP
  const ip = getClientIp(req);
  const { allowed } = rateLimit(`signup:${ip}`, 5, 60 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many signup attempts. Try again later.' }, { status: 429 });
  }

  try {
    const { name, email, password, domain, phone } = await req.json() as {
      name?: string;
      email?: string;
      password?: string;
      domain?: string;
      phone?: string;
    };
    if (!name || !email || !password) {
      return NextResponse.json({ error: 'name, email and password are required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const cleanDomain = domain ? normaliseDomain(domain) : null;
    if (cleanDomain && !isValidDomain(cleanDomain)) {
      return NextResponse.json({ error: 'Invalid domain name format (e.g. yourcompany.com)' }, { status: 400 });
    }

    await ensureDb();

    if (cleanDomain) {
      const existingDomain = await queryOne('SELECT id FROM domains WHERE domain = $1', [cleanDomain]);
      if (existingDomain) {
        return NextResponse.json({ error: 'This domain name is already registered by another organization' }, { status: 409 });
      }
    }

    const existing = await queryOne('SELECT id FROM organizations WHERE owner_email = $1', [email.toLowerCase()]);
    if (existing) return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });

    const cleanPhone = phone && phone.trim().length > 0 ? phone.trim() : null;
    const hash = await bcrypt.hash(password, 12);
    const org = await queryOne<{ id: string }>(`
      INSERT INTO organizations (name, owner_email, password_hash, phone)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [name, email.toLowerCase(), hash, cleanPhone]);

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

    let domainId: string | null = null;
    let autoMailbox: string | null = null;

    if (cleanDomain) {
      try {
        const prov = await provisionDomain(org.id, cleanDomain);
        if (prov?.id) {
          domainId = prov.id;

          // Automatically provision primary business mailbox for the user
          try {
            let username = 'admin';
            if (email.toLowerCase().endsWith(`@${cleanDomain}`)) {
              username = email.toLowerCase().split('@')[0];
            } else {
              const handle = email.toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '');
              if (handle.length >= 2) username = handle;
            }

            const limits = resolvePlanLimits({ plan: 'lite', max_users: PLANS.lite.freeIncludedUsers });
            const userRes = await createUser(
              username,
              prov.fluxDomainId,
              password,
              name,
              limits.storageBytesPerUser
            );
            if (!('error' in userRes)) {
              autoMailbox = `${username}@${cleanDomain}`;
            } else {
              console.warn(`[signup] createUser returned error for "${username}":`, userRes.error);
            }
          } catch (mboxErr) {
            console.warn('[signup] Could not auto-create primary mailbox:', mboxErr);
          }
        }
      } catch (domainErr) {
        console.warn(`[signup] Could not auto-provision domain "${cleanDomain}":`, domainErr);
      }
    }

    // Confirm the address is real and reachable. Deliberately not fatal: the account
    // and its subscription already exist, and losing a signup to a transient SMTP
    // error would be far worse than an unconfirmed address the owner can resend from
    // the dashboard. `emailSent: false` tells the client to say so plainly.
    const emailSent = await issueVerificationEmail(org.id, email.toLowerCase(), name);

    const token = await createSession({ orgId: org.id, email: email.toLowerCase(), name });
    const res = NextResponse.json({
      ok: true,
      emailSent,
      domainId,
      domain: cleanDomain,
      mailbox: autoMailbox,
    }, { status: 201 });
    res.cookies.set('console_token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 7 * 24 * 3600, path: '/',
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
