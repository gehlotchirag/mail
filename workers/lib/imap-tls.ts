import type { ConnectionOptions } from 'tls';

/**
 * TLS options for connections to a CUSTOMER's source mail server.
 *
 * Certificates are verified by default. Verification is only skipped when the
 * migration job carries an explicit `allow_insecure_tls` opt-in, so the decision
 * is recorded per job and auditable rather than global and silent.
 */
export function buildImapTlsOptions(
  allowInsecureTls: boolean | undefined,
  context: string,
): ConnectionOptions {
  if (allowInsecureTls === true) {
    console.warn(
      `[imap-tls] INSECURE: TLS certificate verification DISABLED for ${context} ` +
      '— job opted in via allow_insecure_tls. Credentials are exposed to anyone on the network path.',
    );
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

/** Normalise whatever the DB/job payload carries into a strict boolean. */
export function parseAllowInsecureTls(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}
