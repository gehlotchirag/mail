import { NextResponse } from 'next/server';
import { queryOne, query, ensureDb } from '@/lib/db';
import { appBaseUrl } from '@/lib/mailer';
import { hashToken } from '@/lib/tokens';

/**
 * Reached by clicking the link in the confirmation email, so it must work without a
 * session (people open mail on a different device) and must answer with a redirect
 * rather than JSON — a browser is on the other end, not a fetch call.
 */
export async function GET(req: Request) {
  const base = appBaseUrl();
  const raw = new URL(req.url).searchParams.get('token') ?? '';
  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/login?verify=${reason}`);

  if (!raw) return fail('invalid');

  await ensureDb();

  const row = await queryOne<{ id: string; org_id: string; email: string; expires_at: string; used: boolean }>(
    'SELECT id, org_id, email, expires_at, used FROM email_verification_tokens WHERE token_hash = $1',
    [hashToken(raw)],
  );
  if (!row) return fail('invalid');

  // An already-used link is the normal result of clicking twice, or of a mail client
  // prefetching the URL. That is a success from the customer's point of view, so it
  // must not be dressed up as an error.
  if (row.used) return NextResponse.redirect(`${base}/dashboard?verify=already`);
  if (new Date(row.expires_at) < new Date()) return fail('expired');

  await query(
    `UPDATE organizations
        SET email_verified = TRUE,
            email_verified_at = COALESCE(email_verified_at, NOW())
      WHERE id = $1`,
    [row.org_id],
  );
  await query('UPDATE email_verification_tokens SET used = TRUE WHERE id = $1', [row.id]);

  return NextResponse.redirect(`${base}/dashboard?verify=ok`);
}
