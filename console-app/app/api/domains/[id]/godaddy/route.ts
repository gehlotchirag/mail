import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  getRequiredDnsRecords, getVerifyRecord, planDnsRecord, toRelativeName,
  isFailureStatus, type ProviderRecord, type PublishResult,
} from '@/lib/dns';

type Params = { params: Promise<{ id: string }> };

/**
 * GoDaddy record as returned by GET /v1/domains/{domain}/records/{type}/{name}.
 * `service`/`protocol`/`port`/`weight` only appear on SRV records.
 */
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

/** Credentials arrive in the POST body only — never in a query string. */
type Body = {
  action?: 'zones' | 'publish';
  gdKey?: string;
  gdSecret?: string;
  zoneDomain?: string;
  verifyOnly?: boolean;
};

class GdError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function gdHeaders(key: string, secret: string) {
  return { Authorization: `sso-key ${key}:${secret}`, 'Content-Type': 'application/json' };
}

async function gdFetch<T>(path: string, key: string, secret: string, method = 'GET', body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.godaddy.com${path}`, {
      method, headers: gdHeaders(key, secret),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GdError('Could not reach the GoDaddy API', 0);
  }

  const text = await res.text();
  if (!res.ok) {
    let message = `GoDaddy API error (HTTP ${res.status})`;
    try {
      const err = JSON.parse(text) as { message?: string; fields?: { message?: string }[] };
      message = err.message ?? err.fields?.[0]?.message ?? message;
    } catch { /* non-JSON error body — keep the generic message */ }
    throw new GdError(message, res.status);
  }
  // GoDaddy PUT/DELETE return 200 with an empty body — handle gracefully.
  return (text.trim() ? JSON.parse(text) : {}) as T;
}

/** GoDaddy uses '@' for the apex. */
function gdName(host: string, zone: string): string {
  return toRelativeName(host, zone) || '@';
}

/**
 * The record set GoDaddy currently holds for one type+name — exactly the set a
 * PUT to that path would replace. A 404 means "no such record set", not failure.
 */
async function gdRecordSet(zone: string, key: string, secret: string, type: string, name: string): Promise<GdRecord[]> {
  try {
    const rows = await gdFetch<GdRecord[]>(
      `/v1/domains/${encodeURIComponent(zone)}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
      key, secret,
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (err instanceof GdError && err.status === 404) return [];
    throw err;
  }
}

/**
 * Body shape for PUT /records/{type}/{name}: the type and name come from the
 * path, so only the value fields may be sent back.
 */
function toWriteRecord(r: GdRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { data: r.data, ttl: r.ttl ?? 600 };
  if (r.priority != null) out.priority = r.priority;
  if (r.port != null) out.port = r.port;
  if (r.weight != null) out.weight = r.weight;
  if (r.service != null) out.service = r.service;
  if (r.protocol != null) out.protocol = r.protocol;
  return out;
}

export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { action = 'publish', gdKey, gdSecret, zoneDomain, verifyOnly } = body;
  if (!gdKey || !gdSecret) {
    return NextResponse.json({ error: 'gdKey and gdSecret are required' }, { status: 400 });
  }

  const domain = await queryOne<{ id: string; domain: string; verify_token: string; verified: boolean }>(
    'SELECT id, domain, verify_token, verified FROM domains WHERE id = $1 AND org_id = $2',
    [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  // ── List matching zones in the account (was a GET with the key+secret in the URL)
  if (action === 'zones') {
    try {
      const all = await gdFetch<{ domain: string }[]>('/v1/domains?limit=100&status=ACTIVE', gdKey, gdSecret);
      const matching = (Array.isArray(all) ? all : [])
        .filter(d => domain.domain === d.domain || domain.domain.endsWith(`.${d.domain}`));
      return NextResponse.json({ zones: matching.map(d => ({ id: d.domain, name: d.domain })) });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'GoDaddy API error' }, { status: 502 },
      );
    }
  }

  if (!zoneDomain) return NextResponse.json({ error: 'zoneDomain is required' }, { status: 400 });

  const records = verifyOnly
    ? [getVerifyRecord(domain.domain, domain.verify_token)]
    : [...(!domain.verified ? [getVerifyRecord(domain.domain, domain.verify_token)] : []), ...getRequiredDnsRecords(domain.domain)];

  const results: PublishResult[] = [];

  for (const rec of records) {
    const label = `${rec.type} ${rec.host}`;
    const name = gdName(rec.host, zoneDomain);

    try {
      // GoDaddy's PUT /records/{type}/{name} REPLACES the whole record set for
      // that type+name. Read it first, merge our record into it, and PUT the
      // union — otherwise the customer's other TXT/MX records are destroyed.
      const current = await gdRecordSet(zoneDomain, gdKey, gdSecret, rec.type, name);

      const existing: ProviderRecord[] = current.map((r, i) => ({
        id: String(i),
        type: rec.type,
        name,
        value: r.data,
        priority: r.priority,
        raw: r,
      }));

      const plan = planDnsRecord(rec, zoneDomain, existing);
      if (plan.kind === 'noop') {
        results.push({ record: label, status: plan.status, ...(plan.message ? { error: plan.message } : {}) });
        continue;
      }
      if (plan.kind === 'conflict') {
        results.push({ record: label, status: 'conflict', error: plan.message });
        continue;
      }

      const ours: Record<string, unknown> = {
        data: rec.value,
        ttl: 600, // GoDaddy's minimum
        ...(rec.type.toUpperCase() === 'MX' ? { priority: rec.priority ?? 10 } : {}),
      };

      const merged = plan.kind === 'update'
        // Replace only the record we previously published; keep every other one.
        ? current.map((r, i) => (String(i) === plan.target.id ? ours : toWriteRecord(r)))
        // Append ours to the customer's existing records for this type+name.
        : [...current.map(toWriteRecord), ours];

      await gdFetch(
        `/v1/domains/${encodeURIComponent(zoneDomain)}/records/${encodeURIComponent(rec.type)}/${encodeURIComponent(name)}`,
        gdKey, gdSecret, 'PUT', merged,
      );
      results.push({ record: label, status: plan.kind === 'update' ? 'updated' : 'created' });
    } catch (err) {
      results.push({
        record: label, status: 'error',
        error: err instanceof Error ? err.message : 'GoDaddy API error',
      });
    }
  }

  const allOk = results.every(r => !isFailureStatus(r.status));
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
