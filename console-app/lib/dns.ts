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
    // NOTE: no autoconfig./autodiscover. CNAMEs.
    //
    // They used to be here, pointing at MAIL_HOST. A client resolving
    // autoconfig.<customer-domain> connects with that name in SNI, and our
    // certificate only covers our own hostnames — so the TLS handshake fails and
    // the client shows a certificate warning instead of configuring itself.
    // Publishing a record that guarantees a warning is worse than publishing none.
    //
    // Verified 2026-09-01: autoconfig.livcure.co.in and autodiscover.livcure.co.in
    // both returned HTTP 000 (handshake failure) while the equivalents on
    // arhamworkspace.tech, which the cert does cover, returned 200.
    //
    // Issuing a certificate per customer domain would fix it, but no major provider
    // does that — Zoho, Google and Microsoft all publish autoconfig under their OWN
    // hostnames and let clients find it indirectly:
    //   - Thunderbird: MX lookup -> provider domain -> Mozilla's ISPDB entry.
    //     Requires registering this service in the ISPDB (one-time, external).
    //   - Outlook: an SRV record, _autodiscover._tcp.<domain>, pointing at our
    //     hostname so SNI matches our certificate.
    //
    // The SRV record is not emitted yet because none of the four DNS publishers
    // (Cloudflare/GoDaddy/Porkbun/DigitalOcean) can write SRV records — each needs
    // a different payload shape for priority/weight/port, and planDnsRecord compares
    // records by a single string value. Emitting it before that lands would hand the
    // publisher a record it would mangle or reject.
  ];
}

/**
 * The three Easy-DKIM CNAMEs SES hands back when a domain is registered. Until these
 * resolve, SES treats the domain as unverified and rejects everything it sends with
 * "Email address is not verified" — so they belong in the required set, not as an
 * optional extra. Pass the tokens from `ensureSesIdentity()`.
 */
export function getSesDkimRecords(
  tokens: Array<{ host: string; value: string }>,
): DnsSetupRecord[] {
  return tokens.map((t, i) => ({
    type: 'CNAME', host: t.host, value: t.value,
    description: `DKIM key ${i + 1} of ${tokens.length} — authenticates mail you send (required)`,
  }));
}

/**
 * The complete record set to publish for a domain — ownership proof, mail routing,
 * and the SES DKIM CNAMEs.
 *
 * Every DNS provider route must use this rather than composing its own list. The
 * DKIM CNAMEs come from SES at runtime, so a route that calls
 * `getRequiredDnsRecords()` directly silently omits them and the domain ends up
 * publishing perfect-looking DNS that still cannot send. Centralising it here means
 * a fifth provider cannot reintroduce that bug.
 *
 * SES failures degrade rather than throw: the mail records still get published and
 * the DKIM CNAMEs appear on the next run once SES is reachable.
 */
export async function getPublishableRecords(
  domain: string,
  opts: { verified: boolean; verifyToken: string; verifyOnly?: boolean },
): Promise<DnsSetupRecord[]> {
  const verifyRecord = getVerifyRecord(domain, opts.verifyToken);
  if (opts.verifyOnly) return [verifyRecord];

  const { ensureSesIdentity } = await import('./ses');
  const ses = await ensureSesIdentity(domain);
  if (ses.error) {
    console.error(`[dns] SES identity unavailable for "${domain}" — publishing without DKIM: ${ses.error}`);
  }

  return [
    ...(opts.verified ? [] : [verifyRecord]),
    ...getRequiredDnsRecords(domain),
    ...getSesDkimRecords(ses.tokens),
  ];
}

/**
 * Whether mail for this domain is actually routed to us right now — a live MX
 * lookup, not the stored `verified` flag.
 *
 * `verified` only proves the customer owns the domain (the TXT record check);
 * it says nothing about whether mail gets here. A domain can sit "✓ Verified" in
 * the UI indefinitely while its MX still points at Zoho or Google — this is
 * exactly what happened to a live tenant domain: verified early on, mail records
 * never published, and nothing in the product ever surfaced the gap. That
 * customer's inbound mail (from anyone outside the platform) kept landing at
 * their old provider for over a week with no warning.
 *
 * Best-effort and bounded: a domain with a broken/slow zone must not hang the
 * page that displays it.
 */
export async function checkMxLive(domain: string, timeoutMs = 4000): Promise<boolean | null> {
  const hosts = await getMxHosts(domain, timeoutMs);
  if (hosts === null) return null;
  const host = MAIL_HOST.replace(/\.$/, '').toLowerCase();
  return hosts.includes(host);
}

/**
 * The actual MX exchange hostnames a domain currently resolves to, lowest
 * priority first — so the console can honestly say where mail is routing
 * ("still pointing at aspmx.l.google.com") instead of guessing a provider name
 * from a boolean. `null` on no MX / lookup failure / timeout, same convention
 * as `checkMxLive`.
 */
export async function getMxHosts(domain: string, timeoutMs = 4000): Promise<string[] | null> {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return records
      .sort((a, b) => a.priority - b.priority)
      .map(r => r.exchange.replace(/\.$/, '').toLowerCase());
  } catch {
    return null;
  }
}

export function getVerifyRecord(domain: string, token: string): DnsSetupRecord {
  return {
    type: 'TXT', host: `_arham-verify.${domain}`, value: token,
    description: 'Domain ownership verification — can be removed after verification',
  };
}

export async function verifyDomainOwnership(domain: string, token: string): Promise<boolean> {
  const host = `_arham-verify.${domain}`;
  const matches = (records: string[][]) => records.flat().some(r => r.trim() === token);

  // Ask the zone's OWN nameservers first.
  //
  // When the verification record was just written through a provider API
  // (DigitalOcean/Cloudflare/GoDaddy/Porkbun), the authoritative server already
  // has it — there is nothing to propagate — so this succeeds immediately.
  //
  // Going through the system's recursive resolver instead is what made
  // verification feel broken: the UI published the record and checked 2 seconds
  // later, the resolver cached the NXDOMAIN, and every retry kept returning that
  // cached negative answer for the SOA minimum TTL. The user saw "TXT record not
  // found yet, DNS can take up to 48 hours" for a record that existed already.
  try {
    const nsNames = await dns.resolveNs(domain);
    const ips = (await Promise.all(
      nsNames.map(async n => { try { return await dns.resolve4(n); } catch { return []; } }),
    )).flat();

    if (ips.length > 0) {
      const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
      resolver.setServers(ips);
      if (matches(await resolver.resolveTxt(host))) return true;
    }
  } catch {
    // Unreachable/firewalled nameservers, or no record there yet — fall through
    // rather than treating it as a definitive "not verified".
  }

  // Fall back to the default resolver. Covers zones whose nameservers we cannot
  // query directly, and records a customer added by hand somewhere we do not see.
  try {
    return matches(await dns.resolveTxt(host));
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
