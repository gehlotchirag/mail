import dns from 'dns/promises';

export interface DnsSetupRecord {
  type: string;
  host: string;
  value: string;
  priority?: number;
  description: string;
}

export const MAIL_HOST = process.env.MAIL_HOST ?? 'mail.arhamworkspace.tech';

/** The domain we ask customers to `include:` in their SPF record. */
export const SPF_INCLUDE = MAIL_HOST.replace(/^mail\./, '');

export function getRequiredDnsRecords(domain: string): DnsSetupRecord[] {
  return [
    {
      type: 'MX', host: domain, value: MAIL_HOST, priority: 10,
      description: 'Routes incoming email to the Arham mail server',
    },
    {
      type: 'TXT', host: domain,
      value: `v=spf1 include:${SPF_INCLUDE} include:sendinblue.com ~all`,
      description: 'SPF record — authorises the mail server to send on your behalf',
    },
    {
      type: 'TXT', host: `_dmarc.${domain}`,
      value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`,
      description: 'DMARC policy — enables email delivery reports',
    },
    {
      type: 'CNAME', host: `autoconfig.${domain}`, value: MAIL_HOST,
      description: 'Thunderbird/Outlook auto-configuration',
    },
    {
      type: 'CNAME', host: `autodiscover.${domain}`, value: MAIL_HOST,
      description: 'Outlook auto-discovery',
    },
  ];
}

export function getVerifyRecord(domain: string, token: string): DnsSetupRecord {
  return {
    type: 'TXT', host: `_arham-verify.${domain}`, value: token,
    description: 'Domain ownership verification — can be removed after verification',
  };
}

export async function verifyDomainOwnership(domain: string, token: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(`_arham-verify.${domain}`);
    return records.flat().some(r => r === token);
  } catch {
    return false;
  }
}

export async function detectDnsProvider(domain: string): Promise<string | null> {
  try {
    const ns = (await dns.resolveNs(domain)).join(' ').toLowerCase();
    if (ns.includes('cloudflare')) return 'cloudflare';
    if (ns.includes('domaincontrol') || ns.includes('godaddy')) return 'godaddy';
    if (ns.includes('registrar-servers') || ns.includes('namecheap')) return 'namecheap';
    if (ns.includes('awsdns')) return 'route53';
    if (ns.includes('digitalocean')) return 'digitalocean';
    if (ns.includes('porkbun')) return 'porkbun';
    if (ns.includes('bluehost')) return 'bluehost';
    if (ns.includes('squarespace') || ns.includes('google')) return 'squarespace';
    return null;
  } catch {
    return null;
  }
}

export async function checkMxRecord(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    const mailHost = process.env.MAIL_HOST ?? 'mail.arhamworkspace.tech';
    return records.some(r => r.exchange.toLowerCase().replace(/\.$/, '') === mailHost.toLowerCase());
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Provider-agnostic record planning.
 *
 * Every DNS-provider route publishes the same set of records into a zone that
 * already contains records the CUSTOMER owns. The rules below exist so that a
 * publish is idempotent and never clobbers a record we did not create:
 *
 *   - a record we published before is UPDATED in place (matched on content /
 *     ownership, never on type+name alone),
 *   - an identical record is left alone ('unchanged'),
 *   - a record that belongs to the customer is never touched: it either sits
 *     alongside ours, or — where the RFCs allow only one record (SPF, CNAME) —
 *     the publish reports a 'conflict' for a human to resolve.
 * ────────────────────────────────────────────────────────────────────────── */

/** Outcome of publishing one record. `error`/`conflict` mean "needs attention". */
export type PublishStatus = 'created' | 'updated' | 'unchanged' | 'skipped' | 'conflict' | 'error';

export interface PublishResult {
  record: string;
  status: PublishStatus;
  /** Human-readable explanation for error / conflict / skipped outcomes. */
  error?: string;
}

export function isFailureStatus(status: PublishStatus): boolean {
  return status === 'error' || status === 'conflict';
}

/** One existing record in the customer's zone, normalised across providers. */
export interface ProviderRecord {
  /** Provider record id (or, for GoDaddy, the index within the type+name set). */
  id: string;
  type: string;
  /** Name as the provider returned it — FQDN, zone-relative or '@' all work. */
  name: string;
  /** Record content: MX exchange, CNAME target, TXT string. */
  value: string;
  priority?: number;
  /** The provider's raw object, for routes that must re-send it verbatim. */
  raw?: unknown;
}

export type RecordAction =
  | { kind: 'create' }
  | { kind: 'update'; target: ProviderRecord }
  | { kind: 'noop'; status: 'unchanged' | 'skipped'; message?: string }
  | { kind: 'conflict'; message: string };

/** Zone-relative name; '' for the apex. Accepts FQDN, relative name or '@'. */
export function toRelativeName(host: string, zone: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  const z = zone.trim().toLowerCase().replace(/\.$/, '');
  if (h === '' || h === '@' || h === z) return '';
  if (z && h.endsWith(`.${z}`)) return h.slice(0, -(z.length + 1));
  return h;
}

/** TXT values may arrive quoted and/or split into chunks — compare the payload. */
export function normalizeTxtValue(value: string): string {
  return value.replace(/"/g, '').replace(/\s+/g, ' ').trim();
}

/** Hostnames (MX exchange, CNAME target) are case-insensitive and may be FQDN. */
export function normalizeHostValue(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function sameRecordValue(type: string, a: string, b: string): boolean {
  return type.toUpperCase() === 'TXT'
    ? normalizeTxtValue(a) === normalizeTxtValue(b)
    : normalizeHostValue(a) === normalizeHostValue(b);
}

export function isSpfValue(value: string): boolean {
  return /^v=spf1(\s|$)/i.test(normalizeTxtValue(value));
}

export function isDmarcValue(value: string): boolean {
  return /^v=dmarc1\s*;/i.test(normalizeTxtValue(value));
}

/** True when an SPF record already authorises our mail servers. */
export function spfIncludesUs(value: string): boolean {
  return normalizeTxtValue(value).toLowerCase().includes(`include:${SPF_INCLUDE.toLowerCase()}`);
}

/** True when an MX/CNAME points at our mail host — i.e. we published it. */
export function pointsAtMailHost(value: string): boolean {
  return normalizeHostValue(value) === normalizeHostValue(MAIL_HOST);
}

/**
 * Decide what to do with one desired record given everything already in the zone.
 *
 * @param desired  the record we want published
 * @param zone     the zone (apex) the provider is operating on
 * @param existing every record currently in the zone (names in any form)
 */
export function planDnsRecord(
  desired: DnsSetupRecord,
  zone: string,
  existing: ProviderRecord[],
): RecordAction {
  const type = desired.type.toUpperCase();
  const name = toRelativeName(desired.host, zone);
  const atName = existing.filter(
    r => r.type.toUpperCase() === type && toRelativeName(r.name, zone) === name,
  );

  // Already exactly what we want (same content, and same priority for MX).
  const identical = atName.find(r =>
    sameRecordValue(type, r.value, desired.value) &&
    (type !== 'MX' || (r.priority ?? 10) === (desired.priority ?? 10)));
  if (identical) return { kind: 'noop', status: 'unchanged' };

  switch (type) {
    case 'MX': {
      // Only ever touch the MX that points at our mail host. Any other MX the
      // customer has at this name stays exactly where it is.
      const ours = atName.find(r => pointsAtMailHost(r.value));
      return ours ? { kind: 'update', target: ours } : { kind: 'create' };
    }

    case 'TXT': {
      if (isSpfValue(desired.value)) {
        // A domain may publish at most ONE SPF record — two is a permerror and
        // breaks outbound mail. Only rewrite an SPF record that is already ours.
        const spf = atName.filter(r => isSpfValue(r.value));
        if (spf.length === 0) return { kind: 'create' };
        if (spf.length === 1 && spfIncludesUs(spf[0].value)) {
          return { kind: 'update', target: spf[0] };
        }
        const existingSpf = spf.map(r => `"${normalizeTxtValue(r.value)}"`).join(', ');
        return {
          kind: 'conflict',
          message: spf.length > 1
            ? `${desired.host} already has ${spf.length} SPF records (${existingSpf}). A domain may only publish one — remove the extras, then add "include:${SPF_INCLUDE}" to the survivor. Nothing was changed.`
            : `${desired.host} already has an SPF record (${existingSpf}) that does not authorise our servers. A domain may only publish one SPF record, so add "include:${SPF_INCLUDE}" to the existing record instead of creating a second one. Nothing was changed.`,
        };
      }

      if (isDmarcValue(desired.value)) {
        // Also single-valued, but any existing policy is at least as strict as
        // the p=none monitoring record we would add — leave the customer's be.
        const dmarc = atName.filter(r => isDmarcValue(r.value));
        if (dmarc.length === 0) return { kind: 'create' };
        return {
          kind: 'noop',
          status: 'skipped',
          message: `An existing DMARC policy ("${normalizeTxtValue(dmarc[0].value)}") was left unchanged.`,
        };
      }

      // Verification tokens and other TXT records: several may coexist, and the
      // identical-record check above already makes a repeat run a no-op.
      return { kind: 'create' };
    }

    case 'CNAME': {
      // A name may hold only one CNAME, and a CNAME may not coexist with other
      // records — so never replace one we did not publish.
      if (atName.length === 0) return { kind: 'create' };
      const ours = atName.find(r => pointsAtMailHost(r.value));
      if (ours) return { kind: 'update', target: ours };
      return {
        kind: 'conflict',
        message: `${desired.host} already points to "${normalizeHostValue(atName[0].value)}". Repoint it to ${MAIL_HOST} manually if that record is no longer needed. Nothing was changed.`,
      };
    }

    default: {
      if (atName.length === 0) return { kind: 'create' };
      return {
        kind: 'conflict',
        message: `${desired.type} ${desired.host} already exists with a different value ("${atName[0].value}"). Nothing was changed.`,
      };
    }
  }
}
