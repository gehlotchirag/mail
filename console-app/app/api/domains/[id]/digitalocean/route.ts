import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  getRequiredDnsRecords, getVerifyRecord, planDnsRecord, toRelativeName,
  isFailureStatus, type ProviderRecord, type PublishResult,
} from '@/lib/dns';

type Params = { params: Promise<{ id: string }> };

type DoRecord = { id: number; type: string; name: string; data: string; priority?: number | null };

/** Credentials arrive in the POST body only — never in a query string. */
type Body = {
  action?: 'zones' | 'publish';
  doToken?: string;
  zoneDomain?: string;
  verifyOnly?: boolean;
};

function doHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function doFetch(path: string, token: string, method = 'GET', body?: object): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://api.digitalocean.com${path}`, {
      method, headers: doHeaders(token), body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the DigitalOcean API');
  }
  const text = await res.text();
  const parsed = text.trim() ? JSON.parse(text) as Record<string, unknown> : {};
  if (!res.ok) {
    const message = typeof parsed.message === 'string' ? parsed.message : `DigitalOcean API error (HTTP ${res.status})`;
    throw new Error(message);
  }
  return parsed;
}

/** DigitalOcean uses '@' for the apex and stores names zone-relative. */
function doName(host: string, zone: string): string {
  return toRelativeName(host, zone) || '@';
}

/**
 * DigitalOcean appends the zone to any MX/CNAME target that is not fully
 * qualified, so external targets must carry a trailing dot.
 */
function doData(type: string, value: string): string {
  const t = type.toUpperCase();
  if (t === 'MX' || t === 'CNAME' || t === 'NS' || t === 'SRV') {
    return value.endsWith('.') ? value : `${value}.`;
  }
  return value;
}

async function listZoneRecords(zone: string, token: string): Promise<ProviderRecord[]> {
  const out: ProviderRecord[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = await doFetch(
      `/v2/domains/${encodeURIComponent(zone)}/records?per_page=200&page=${page}`, token,
    ) as { domain_records?: DoRecord[]; links?: { pages?: { next?: string } } };
    const rows = body.domain_records ?? [];
    out.push(...rows.map(r => ({
      id: String(r.id), type: r.type, name: r.name, value: r.data,
      priority: r.priority ?? undefined, raw: r,
    })));
    if (rows.length === 0 || !body.links?.pages?.next) break;
  }
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
  const { action = 'publish', doToken, zoneDomain, verifyOnly } = body;
  if (!doToken) return NextResponse.json({ error: 'doToken is required' }, { status: 400 });

  const domain = await queryOne<{ id: string; domain: string; verify_token: string; verified: boolean }>(
    'SELECT id, domain, verify_token, verified FROM domains WHERE id = $1 AND org_id = $2',
    [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  // ── List matching zones (was a GET with the token in the URL)
  if (action === 'zones') {
    try {
      const res = await doFetch('/v2/domains?per_page=200', doToken) as { domains?: { name: string }[] };
      const matching = (res.domains ?? [])
        .filter(d => domain.domain === d.name || domain.domain.endsWith(`.${d.name}`));
      return NextResponse.json({ zones: matching.map(d => ({ id: d.name, name: d.name })) });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'DigitalOcean API error' }, { status: 502 },
      );
    }
  }

  if (!zoneDomain) return NextResponse.json({ error: 'zoneDomain is required' }, { status: 400 });

  const records = verifyOnly
    ? [getVerifyRecord(domain.domain, domain.verify_token)]
    : [...(!domain.verified ? [getVerifyRecord(domain.domain, domain.verify_token)] : []), ...getRequiredDnsRecords(domain.domain)];

  // Read the zone first. If that fails, abort rather than publish blind — the
  // old code treated a failed read as "the zone is empty" and duplicated records.
  let existing: ProviderRecord[];
  try {
    existing = await listZoneRecords(zoneDomain, doToken);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      results: [{
        record: 'zone records',
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not read the existing DNS records',
      }] satisfies PublishResult[],
    }, { status: 502 });
  }

  const results: PublishResult[] = [];

  for (const rec of records) {
    const label = `${rec.type} ${rec.host}`;
    const name = doName(rec.host, zoneDomain);
    const payload: Record<string, unknown> = {
      type: rec.type,
      name,
      data: doData(rec.type, rec.value),
      ttl: 1800,
      ...(rec.type.toUpperCase() === 'MX' ? { priority: rec.priority ?? 10 } : {}),
    };

    // Matching on type+name alone would overwrite an unrelated record — e.g. a
    // Google site-verification TXT at the apex. planDnsRecord matches content
    // and ownership, so we only ever touch a record we published ourselves.
    const plan = planDnsRecord(rec, zoneDomain, existing);

    try {
      if (plan.kind === 'noop') {
        results.push({ record: label, status: plan.status, ...(plan.message ? { error: plan.message } : {}) });
        continue;
      }
      if (plan.kind === 'conflict') {
        results.push({ record: label, status: 'conflict', error: plan.message });
        continue;
      }
      if (plan.kind === 'update') {
        await doFetch(
          `/v2/domains/${encodeURIComponent(zoneDomain)}/records/${encodeURIComponent(plan.target.id)}`,
          doToken, 'PATCH', payload,
        );
        const idx = existing.findIndex(r => r.id === plan.target.id);
        if (idx >= 0) existing[idx] = { ...existing[idx], value: rec.value, priority: rec.priority };
        results.push({ record: label, status: 'updated' });
      } else {
        const created = await doFetch(
          `/v2/domains/${encodeURIComponent(zoneDomain)}/records`, doToken, 'POST', payload,
        ) as { domain_record?: DoRecord };
        existing.push({
          id: String(created.domain_record?.id ?? `new-${existing.length}`),
          type: rec.type, name, value: rec.value, priority: rec.priority,
        });
        results.push({ record: label, status: 'created' });
      }
    } catch (err) {
      results.push({
        record: label, status: 'error',
        error: err instanceof Error ? err.message : 'DigitalOcean API error',
      });
    }
  }

  const allOk = results.every(r => !isFailureStatus(r.status));
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
