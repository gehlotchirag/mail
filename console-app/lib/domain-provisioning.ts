/**
 * Provisioning a domain for an organisation, in one place.
 *
 * A domain is only usable once four things are true, and every one of them has
 * failed silently at some point:
 *   1. it exists on the Flux mail server (else no mailbox can be created under it);
 *   2. `domains.flux_domain_id` is stored (the Users page filters on it, so a NULL
 *      makes the whole domain and its users invisible);
 *   3. it emits a single DKIM signature (Flux defaults to two, which SES rejects
 *      outright — every outbound message bounces);
 *   4. it is a verified SES identity (else SES refuses to send as it at all).
 *
 * Adding a domain by hand and importing a multi-domain Zoho organisation must go
 * through the same steps, so they share this module rather than each doing four
 * fifths of the job.
 */
import crypto from 'crypto';
import { query, queryOne } from './db';
import { addDomain, enforceSingleDkimSignature } from './flux';
import { ensureSesIdentity } from './ses';

export interface ProvisionedDomain {
  id: string;
  domain: string;
  verifyToken: string;
  sesTokens: Array<{ host: string; value: string }>;
  sesVerified: boolean;
  warnings: string[];
}

export function normaliseDomain(input: string): string {
  return input.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function isValidDomain(domain: string): boolean {
  return /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(domain);
}

/**
 * Creates one domain end-to-end. Throws only when the mail server refuses it —
 * a domain we cannot create on Flux must not leave a row behind, because that row
 * would look provisioned while no mailbox could ever exist under it.
 *
 * DKIM and SES failures are recorded as warnings instead: the domain is real and
 * usable for receiving, and both are retried idempotently on the domain page.
 */
export async function provisionDomain(orgId: string, rawDomain: string): Promise<ProvisionedDomain> {
  const domain = normaliseDomain(rawDomain);
  const verifyToken = `arham-verify-${crypto.randomBytes(12).toString('hex')}`;

  const fluxResult = await addDomain(domain);
  if ('error' in fluxResult) {
    throw new Error(`Could not provision "${domain}" on the mail server: ${fluxResult.error}`);
  }
  const fluxDomainId = fluxResult.id;

  const warnings: string[] = [];

  const dkim = await enforceSingleDkimSignature(fluxDomainId);
  if (dkim.error) {
    console.error(`[domains] DKIM normalisation failed for "${domain}": ${dkim.error}`);
    warnings.push('DKIM could not be normalised on the mail server — outbound mail may bounce until this is corrected.');
  } else if (dkim.disabled || dkim.destroyed.length) {
    console.log(`[domains] "${domain}" DKIM normalised (ed25519 disabled=${dkim.disabled}, keys removed=${dkim.destroyed.length})`);
  }

  const ses = await ensureSesIdentity(domain);
  if (ses.error) {
    console.error(`[domains] SES identity failed for "${domain}": ${ses.error}`);
    warnings.push('Could not register this domain with the sending provider. Outbound mail will be rejected until this is retried.');
  } else {
    console.log(`[domains] SES identity for "${domain}": dkim=${ses.dkimStatus ?? 'n/a'}, tokens=${ses.tokens.length}`);
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO domains (org_id, domain, flux_domain_id, verify_token)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, domain, fluxDomainId, verifyToken]
  );

  return {
    id: row?.id ?? '',
    domain,
    verifyToken,
    sesTokens: ses.tokens,
    sesVerified: ses.verified,
    warnings,
  };
}

export interface EnsureDomainsResult {
  /** Already present for this organisation — nothing to do. */
  existing: string[];
  /** Created by this call. */
  provisioned: ProvisionedDomain[];
  /** Not created because the plan's domain allowance is exhausted. */
  blocked: string[];
  /** Registered to a DIFFERENT organisation — never silently taken over. */
  conflicting: string[];
  /** Attempted but rejected by the mail server. */
  failed: Array<{ domain: string; error: string }>;
  maxDomains: number;
  /** Domain count for this org after the call. */
  total: number;
}

/**
 * Makes every domain in `wanted` usable by this organisation, within its plan.
 *
 * Used by the migration pre-flight: a Zoho organisation routinely spans several
 * domains, and before this existed each user on a secondary domain failed
 * individually with "Domain not found in Flux server" — N confusing per-user
 * errors instead of one actionable statement about the plan.
 *
 * Never partially charges past the limit: domains are provisioned in the order
 * given until the allowance runs out, and the remainder come back in `blocked`
 * so the caller can prompt an upgrade naming exactly what is missing.
 */
export async function ensureDomainsForOrg(
  orgId: string,
  wanted: string[],
  maxDomains: number,
): Promise<EnsureDomainsResult> {
  const result: EnsureDomainsResult = {
    existing: [], provisioned: [], blocked: [], conflicting: [], failed: [],
    maxDomains, total: 0,
  };

  const cleaned = [...new Set(
    wanted.map(normaliseDomain).filter(d => d && isValidDomain(d)),
  )];

  const owned = await query<{ domain: string; org_id: string }>(
    'SELECT domain, org_id FROM domains WHERE domain = ANY($1::text[])',
    [cleaned],
  );
  const ownedByUs = new Set(owned.filter(r => r.org_id === orgId).map(r => r.domain));
  const ownedByOthers = new Set(owned.filter(r => r.org_id !== orgId).map(r => r.domain));

  const countRow = await queryOne<{ count: string }>(
    'SELECT COUNT(*) AS count FROM domains WHERE org_id = $1', [orgId],
  );
  let count = parseInt(countRow?.count ?? '0', 10);

  for (const domain of cleaned) {
    if (ownedByUs.has(domain)) { result.existing.push(domain); continue; }
    if (ownedByOthers.has(domain)) { result.conflicting.push(domain); continue; }

    if (count >= maxDomains) { result.blocked.push(domain); continue; }

    try {
      result.provisioned.push(await provisionDomain(orgId, domain));
      count++;
    } catch (err) {
      result.failed.push({ domain, error: err instanceof Error ? err.message : String(err) });
    }
  }

  result.total = count;
  return result;
}
