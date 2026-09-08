import { NextResponse } from 'next/server';
import { queryOne, query, ensureDb } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { appBaseUrl, sendPasswordResetEmail } from '@/lib/mailer';
import { hashToken, newToken } from '@/lib/tokens';

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { allowed } = rateLimit(`forgot:${ip}`, 5, 15 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests, please wait.' }, { status: 429 });
  }

  const { email } = await req.json() as { email?: string };
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  const addr = email.toLowerCase().trim();

  await ensureDb();

  const org = await queryOne<{ id: string }>(
    'SELECT id FROM organizations WHERE owner_email = $1',
    [addr],
  );

  // Same response whether or not the address is registered, so this endpoint cannot
  // be used to enumerate customers.
  if (!org) return NextResponse.json({ ok: true });

  // A second limit keyed on the account, not the caller's IP: without it anyone can
  // bury a customer's real mail under reset requests from a pool of addresses.
  const perAccount = rateLimit(`forgot-acct:${org.id}`, 3, 60 * 60_000);
  if (!perAccount.allowed) return NextResponse.json({ ok: true });

  const raw = newToken();
  // Burn any outstanding link first — requesting a new one should invalidate the old
  // mail, otherwise every past request stays usable until it expires on its own.
  await query('UPDATE password_reset_tokens SET used = TRUE WHERE org_id = $1 AND NOT used', [org.id]);
  await query(
    `INSERT INTO password_reset_tokens (org_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [org.id, hashToken(raw)],
  );

  const resetUrl = `${appBaseUrl()}/reset-password?token=${raw}`;
  try {
    await sendPasswordResetEmail(addr, resetUrl);
  } catch (e) {
    // The token is already stored, so a retry from the user will simply issue a new
    // one. Log loudly — a silent mail failure here looks to the customer exactly like
    // an address that was never registered.
    console.error(`[forgot-password] send failed for org ${org.id}:`, e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'We could not send the reset email right now. Please try again in a few minutes.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
