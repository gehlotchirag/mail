import { query } from './db';
import {
  detectDnsProvider, getPublishableRecords, planDnsRecord,
  toRelativeName, type ProviderRecord,
} from './dns';

/**
 * Known platform GoDaddy API credentials.
 * Can also be augmented via GODADDY_API_KEYS env variable (JSON or key:secret pairs).
 */
export interface GoDaddyCreds {
  key: string;
  secret: string;
}

const DEFAULT_GODADDY_KEYS: GoDaddyCreds[] = [
  { key: 'fZ1UbxYKRGh7_7PyY67MCZ4Wx3SFw2Fw6YQ', secret: 'X1qmg2S8quE2V7rhggZctV' },
  { key: 'e5XugTqDPSxG_MJCm2mVjd8CNpkrTe9Ppw9', secret: '8LjmaBh7S9G1NzE73wkAqb' },
];

function getPlatformGoDaddyKeys(): GoDaddyCreds[] {
  const keys: GoDaddyCreds[] = [...DEFAULT_GODADDY_KEYS];
  if (process.env.GODADDY_KEY && process.env.GODADDY_SECRET) {
    keys.unshift({ key: process.env.GODADDY_KEY.trim(), secret: process.env.GODADDY_SECRET.trim() });
  }
  if (process.env.GODADDY_API_KEYS) {
    try {
      const parsed = JSON.parse(process.env.GODADDY_API_KEYS) as GoDaddyCreds[];
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (p.key && p.secret) keys.unshift(p);
        }
      }
    } catch {
      // ignore JSON parse error
    }
  }
  return keys;
}

type GdRecord = {
  type?: string;
  name?: string;
  data: string;
  ttl?: number;
  priority?: number;
  port?: number;
  weight?: number;
  service?: string;
  protocol?: string;
};

function toWriteRecord(r: GdRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { data: r.data, ttl: r.ttl ?? 600 };
  if (r.priority != null) out.priority = r.priority;
  if (r.port != null) out.port = r.port;
  if (r.weight != null) out.weight = r.weight;
  if (r.service != null) out.service = r.service;
  if (r.protocol != null) out.protocol = r.protocol;
  return out;
}

async function checkGoDaddyDomain(domain: string, creds: GoDaddyCreds): Promise<boolean> {
  try {
    const res = await fetch(`https://api.godaddy.com/v1/domains/${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: {
        Authorization: `sso-key ${creds.key}:${creds.secret}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function gdFetch<T>(path: string, creds: GoDaddyCreds, method = 'GET', body?: object): Promise<T> {
  const res = await fetch(`https://api.godaddy.com${path}`, {
    method,
    headers: {
      Authorization: `sso-key ${creds.key}:${creds.secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `GoDaddy API HTTP ${res.status}`;
    try {
      const err = JSON.parse(text) as { message?: string };
      if (err.message) msg = err.message;
    } catch { /* empty */ }
    throw new Error(msg);
  }
  return (text.trim() ? JSON.parse(text) : {}) as T;
}

async function gdRecordSet(zone: string, creds: GoDaddyCreds, type: string, name: string): Promise<GdRecord[]> {
  try {
    const rows = await gdFetch<GdRecord[]>(
      `/v1/domains/${encodeURIComponent(zone)}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
      creds,
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function autoConfigureGoDaddyDns(
  domainId: string,
  domainName: string,
  verifyToken: string,
  creds: GoDaddyCreds,
): Promise<{ ok: boolean; message: string }> {
  try {
    const zoneDomain = domainName;
    const records = await getPublishableRecords(zoneDomain, {
      verified: true, // We publish all records
      verifyToken,
    });

    for (const rec of records) {
      const name = toRelativeName(rec.host, zoneDomain) || '@';
      const current = await gdRecordSet(zoneDomain, creds, rec.type, name);

      const existing: ProviderRecord[] = current.map((r, i) => ({
        id: String(i),
        type: rec.type,
        name,
        value: r.data,
        priority: r.priority,
        raw: r,
      }));

      const plan = planDnsRecord(rec, zoneDomain, existing);
      if (plan.kind === 'noop') continue;

      const ours: Record<string, unknown> = {
        data: rec.value,
        ttl: 600,
        ...(rec.type.toUpperCase() === 'MX' ? { priority: rec.priority ?? 10 } : {}),
      };

      const merged = plan.kind === 'update'
        ? current.map((r, i) => (String(i) === plan.target.id ? ours : toWriteRecord(r)))
        : [...current.map(toWriteRecord), ours];

      await gdFetch(
        `/v1/domains/${encodeURIComponent(zoneDomain)}/records/${encodeURIComponent(rec.type)}/${encodeURIComponent(name)}`,
        creds,
        'PUT',
        merged,
      );
    }

    // Mark domain as verified in the database
    await query('UPDATE domains SET verified = true WHERE id = $1', [domainId]);
    return { ok: true, message: 'All DNS records automatically published to GoDaddy and domain verified.' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-dns] GoDaddy publish failed for "${domainName}":`, msg);
    return { ok: false, message: msg };
  }
}

export interface AutoDnsResult {
  autoConfigured: boolean;
  provider: string | null;
  message: string;
}

/**
 * Automatically detects DNS provider and configures DNS if platform credentials exist.
 */
export async function tryAutoConfigureDns(
  domainId: string,
  domainName: string,
  verifyToken: string,
): Promise<AutoDnsResult> {
  try {
    const provider = await detectDnsProvider(domainName);
    console.log(`[auto-dns] Domain "${domainName}" detected DNS provider: ${provider ?? 'unknown'}`);

    if (provider === 'godaddy') {
      const platformKeys = getPlatformGoDaddyKeys();
      for (const creds of platformKeys) {
        const hasDomain = await checkGoDaddyDomain(domainName, creds);
        if (hasDomain) {
          console.log(`[auto-dns] Domain "${domainName}" matched GoDaddy account key (${creds.key.slice(0, 8)}...). Auto-configuring DNS...`);
          const res = await autoConfigureGoDaddyDns(domainId, domainName, verifyToken, creds);
          if (res.ok) {
            return {
              autoConfigured: true,
              provider: 'godaddy',
              message: 'DNS automatically configured on GoDaddy!',
            };
          }
        }
      }
    }

    return {
      autoConfigured: false,
      provider,
      message: provider ? `Detected DNS provider: ${provider}` : 'DNS provider could not be detected automatically.',
    };
  } catch (err: unknown) {
    console.warn(`[auto-dns] Error during auto-configure for "${domainName}":`, err);
    return {
      autoConfigured: false,
      provider: null,
      message: 'Automatic DNS check encountered an error.',
    };
  }
}
