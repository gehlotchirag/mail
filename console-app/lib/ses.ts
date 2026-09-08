/**
 * SES identity management for customer domains.
 *
 * We relay all outbound mail through Amazon SES. SES will only accept a message
 * whose sender belongs to a *verified identity* — so a customer domain that is not
 * registered with SES bounces every message it sends:
 *
 *   554 Message rejected: Email address is not verified.
 *   The following identities failed the check in region AP-SOUTH-1: user@their-domain
 *
 * Registering the domain yields three Easy-DKIM CNAME tokens which must appear in
 * the customer's DNS. Once those resolve, SES marks the identity verified and signs
 * their outbound mail. This module is the thin wrapper the onboarding flow uses.
 *
 * Every call is best-effort: a failure here must never block domain creation, so
 * callers get a structured result rather than an exception.
 */
import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetAccountCommand,
} from '@aws-sdk/client-sesv2';

const REGION = process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? 'ap-south-1';

let _client: SESv2Client | null = null;
function client(): SESv2Client {
  // Credentials come from the EC2 instance role — never from env vars in prod.
  if (!_client) _client = new SESv2Client({ region: REGION });
  return _client;
}

export interface SesDkimToken {
  /** Host for the CNAME, e.g. `abc123._domainkey.example.com` */
  host: string;
  /** Target, e.g. `abc123.dkim.amazonses.com` */
  value: string;
}

export interface SesIdentityStatus {
  /** false when SES has no identity for this domain at all */
  exists: boolean;
  /** SES has confirmed the DKIM CNAMEs resolve */
  verified: boolean;
  /** PENDING | SUCCESS | FAILED | TEMPORARY_FAILURE | NOT_STARTED */
  dkimStatus?: string;
  tokens: SesDkimToken[];
  error?: string;
}

function tokensToRecords(domain: string, tokens: string[] | undefined): SesDkimToken[] {
  return (tokens ?? []).map(t => ({
    host: `${t}._domainkey.${domain}`,
    value: `${t}.dkim.amazonses.com`,
  }));
}

/** Read the current SES state for a domain. `exists: false` when not registered. */
export async function getSesIdentity(domain: string): Promise<SesIdentityStatus> {
  try {
    const res = await client().send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
    return {
      exists: true,
      verified: Boolean(res.VerifiedForSendingStatus),
      dkimStatus: res.DkimAttributes?.Status,
      tokens: tokensToRecords(domain, res.DkimAttributes?.Tokens),
    };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotFoundException') return { exists: false, verified: false, tokens: [] };
    return {
      exists: false, verified: false, tokens: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Register a domain with SES using Easy DKIM and return the CNAMEs the customer
 * must publish. Idempotent: an already-registered domain returns its current state
 * instead of erroring.
 */
export async function ensureSesIdentity(domain: string): Promise<SesIdentityStatus> {
  const existing = await getSesIdentity(domain);
  if (existing.exists || existing.error) return existing;

  try {
    const res = await client().send(new CreateEmailIdentityCommand({
      EmailIdentity: domain,
      // Easy DKIM: SES generates and rotates the keypair and signs on our behalf.
      DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
    }));
    return {
      exists: true,
      verified: Boolean(res.VerifiedForSendingStatus),
      dkimStatus: res.DkimAttributes?.Status,
      tokens: tokensToRecords(domain, res.DkimAttributes?.Tokens),
    };
  } catch (err) {
    // Lost a race with a concurrent create — read back rather than fail.
    if ((err as { name?: string })?.name === 'AlreadyExistsException') return getSesIdentity(domain);
    return {
      exists: false, verified: false, tokens: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Remove a domain from SES. Called when a customer deletes the domain. */
export async function deleteSesIdentity(domain: string): Promise<{ error?: string }> {
  try {
    await client().send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }));
    return {};
  } catch (err) {
    if ((err as { name?: string })?.name === 'NotFoundException') return {};
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Whether the SES account still sits in the sandbox. While sandboxed, mail can only
 * be sent to *verified recipients*, so a customer can finish DNS setup correctly and
 * still not reach the outside world. Surfacing this stops that looking like our bug.
 */
export async function getSesAccountStatus(): Promise<{ sandbox: boolean; sendingEnabled: boolean; error?: string }> {
  try {
    const res = await client().send(new GetAccountCommand({}));
    return {
      sandbox: !res.ProductionAccessEnabled,
      sendingEnabled: Boolean(res.SendingEnabled),
    };
  } catch (err) {
    return { sandbox: false, sendingEnabled: false, error: err instanceof Error ? err.message : String(err) };
  }
}
