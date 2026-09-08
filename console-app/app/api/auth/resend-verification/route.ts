import { NextResponse } from 'next/server';
import { queryOne, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { issueVerificationEmail } from '@/lib/tokens';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Keyed on the account as well as the caller so a signed-in user cannot use their
  // own session to flood the address on file.
  const ip = getClientIp(req);
  if (!rateLimit(`resend:${ip}`, 5, 15 * 60_000).allowed
   || !rateLimit(`resend-acct:${session.orgId}`, 3, 60 * 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests, please wait a few minutes.' }, { status: 429 });
  }

  await ensureDb();
  const org = await queryOne<{ name: string; owner_email: string; email_verified: boolean }>(
    'SELECT name, owner_email, email_verified FROM organizations WHERE id = $1',
    [session.orgId],
  );
  if (!org) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  if (org.email_verified) return NextResponse.json({ ok: true, alreadyVerified: true });

  const sent = await issueVerificationEmail(session.orgId, org.owner_email, org.name);
  if (!sent) {
    return NextResponse.json(
      { error: 'We could not send the email right now. Please try again in a few minutes.' },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, sentTo: org.owner_email });
}
