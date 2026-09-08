import { createHash, randomBytes } from 'crypto';
import { query } from '@/lib/db';
import { appBaseUrl, sendVerificationEmail } from '@/lib/mailer';

/**
 * Tokens travel in a URL but are stored as a digest. Anyone who can read the
 * database — a backup, a support query, a log of a slow statement — otherwise holds
 * a working password-reset link for every pending request.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

const VERIFY_TTL_HOURS = 24;

/**
 * Issues a fresh confirmation link and emails it. Any earlier unused token for the
 * org is burned first, so a resend invalidates the older mail rather than leaving
 * several live links for one address.
 *
 * Returns false when the mail could not be handed to SMTP; callers decide whether
 * that is fatal (a resend the user is watching) or merely logged (signup, which must
 * still succeed so the account is not lost to a transient SMTP failure).
 */
export async function issueVerificationEmail(orgId: string, email: string, name: string): Promise<boolean> {
  const raw = newToken();
  await query('UPDATE email_verification_tokens SET used = TRUE WHERE org_id = $1 AND NOT used', [orgId]);
  await query(
    `INSERT INTO email_verification_tokens (org_id, token_hash, email, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${VERIFY_TTL_HOURS} hours')`,
    [orgId, hashToken(raw), email],
  );

  const url = `${appBaseUrl()}/api/auth/verify-email?token=${raw}`;
  try {
    await sendVerificationEmail(email, name, url);
    return true;
  } catch (e) {
    console.error(`[verify-email] could not send to ${email}:`, e instanceof Error ? e.message : e);
    return false;
  }
}
