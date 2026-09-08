import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne, query, ensureDb } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { hashToken } from '@/lib/tokens';

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { allowed } = rateLimit(`reset:${ip}`, 10, 15 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests, please wait.' }, { status: 429 });
  }

  const { token, password } = await req.json() as { token?: string; password?: string };
  if (!token || !password) {
    return NextResponse.json({ error: 'Token and password required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  await ensureDb();

  // Tokens are stored hashed. `token = $2` still matches links that were issued
  // before hashing existed; those all expire within an hour of this deploy, after
  // which the clause is dead weight and can go.
  const row = await queryOne<{ id: string; org_id: string; expires_at: string; used: boolean }>(
    `SELECT id, org_id, expires_at, used FROM password_reset_tokens
      WHERE token_hash = $1 OR token = $2`,
    [hashToken(token), token],
  );

  if (!row) {
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }
  if (row.used) {
    return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 });
  }
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Reset link has expired, please request a new one' }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);

  // Completing a reset proves control of the registered mailbox, which is exactly
  // what the confirmation email asks for — so an account that arrived here without
  // ever clicking that link is verified by this instead of being asked twice.
  await query(
    `UPDATE organizations
        SET password_hash = $1,
            email_verified = TRUE,
            email_verified_at = COALESCE(email_verified_at, NOW())
      WHERE id = $2`,
    [hash, row.org_id],
  );
  await query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [row.id]);
  // Any other link that was still outstanding for this account dies with it.
  await query('UPDATE password_reset_tokens SET used = TRUE WHERE org_id = $1 AND NOT used', [row.org_id]);

  return NextResponse.json({ ok: true });
}
