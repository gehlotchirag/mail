import { query } from './db';
import { getActiveSub, subErrorResponse, limitErrorResponse } from './subscription';
import { resolvePlanLimits, planSupportsTeamAliases, MAX_LIST_RECIPIENTS } from './plans';

export interface OrgDomain {
  id: string;
  domain: string;
  flux_domain_id: string;
  verified: boolean;
}

/**
 * The organisation's provisioned domains, keyed both ways: routes that take a
 * user-supplied address need domain-name → Flux id, and routes that render mail
 * server objects need Flux id → domain name.
 */
export interface OrgDomains {
  list: OrgDomain[];
  byName: Map<string, OrgDomain>;
  byFluxId: Map<string, OrgDomain>;
  fluxIds: Set<string>;
}

export async function getOrgDomains(orgId: string): Promise<OrgDomains> {
  const rows = await query<OrgDomain>(
    `SELECT id, domain, flux_domain_id, verified
     FROM domains WHERE org_id = $1 AND flux_domain_id IS NOT NULL`,
    [orgId]
  );
  return {
    list: rows,
    byName: new Map(rows.map(d => [d.domain.toLowerCase(), d])),
    byFluxId: new Map(rows.map(d => [d.flux_domain_id, d])),
    fluxIds: new Set(rows.map(d => d.flux_domain_id)),
  };
}

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

/**
 * Splits a user-supplied address into a local part plus one of the
 * organisation's domains. Returns an error string rather than throwing so
 * callers can hand it straight to `NextResponse.json`.
 */
export function resolveOrgAddress(
  address: string, domains: OrgDomains
): { localPart: string; domain: OrgDomain } | { error: string } {
  const clean = address.trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at <= 0 || at === clean.length - 1) {
    return { error: 'Address must be in the form name@yourdomain.com' };
  }

  const localPart = clean.slice(0, at);
  const domainName = clean.slice(at + 1);
  if (!LOCAL_PART.test(localPart)) return { error: `Invalid address "${clean}"` };

  const domain = domains.byName.get(domainName);
  if (!domain) return { error: `${domainName} is not one of your domains` };
  if (!domain.verified) return { error: `${domainName} is not verified yet` };

  return { localPart, domain };
}

/**
 * Plan gate + domain lookup shared by the alias and distribution-list routes.
 * Returns a ready-made 403 response when the organisation's subscription is
 * inactive or its tier does not include team aliases.
 */
export async function requireTeamAliasAccess(
  orgId: string
): Promise<{ domains: OrgDomains } | { response: Response }> {
  const sub = await getActiveSub(orgId);
  if (!sub) return { response: subErrorResponse() };

  const { plan } = resolvePlanLimits(sub);
  if (!planSupportsTeamAliases(plan)) {
    return {
      response: limitErrorResponse(
        'Team aliases are available on the Business plan and above. Upgrade to use them.'
      ),
    };
  }
  return { domains: await getOrgDomains(orgId) };
}

const EMAIL = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * Normalises and validates distribution-list recipients. Addresses outside the
 * organisation are allowed — fanning out to them is the point of a list.
 */
export function parseRecipients(raw: unknown): { recipients: string[] } | { error: string } {
  if (!Array.isArray(raw) || !raw.length) {
    return { error: 'recipients must be a non-empty array of email addresses' };
  }
  if (raw.length > MAX_LIST_RECIPIENTS) {
    return { error: `A list can have at most ${MAX_LIST_RECIPIENTS} recipients` };
  }

  const recipients: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return { error: 'recipients must be email addresses' };
    const address = entry.trim().toLowerCase();
    if (!EMAIL.test(address)) return { error: `Invalid recipient "${entry}"` };
    if (!recipients.includes(address)) recipients.push(address);
  }
  return { recipients };
}
