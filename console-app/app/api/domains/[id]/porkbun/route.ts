import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  getRequiredDnsRecords, getVerifyRecord, planDnsRecord, toRelativeName,
  isFailureStatus, type ProviderRecord, type PublishResult,
} from '@/lib/dns';

type Params = { params: Promise<{ id: string }> };

/** Porkbun returns `name` as an FQDN (e.g. "_dmarc.example.com"), never relative. */
type PbRecord = { id: string; name: string; type: string; content: string; ttl?: string; prio?: string | null };

/** Credentials arrive in the POST body only — never in a query string. */
type Body = {
  action?: 'zones' | 'publish';
  pbKey?: string;
  pbSecret?: string;
  zoneDomain?: string;
  verifyOnly?: boolean;
};

async function pb<T>(path: string, pbKey: string, pbSecret: string, extra?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://porkbun.com/api/json/v3${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: pbKey, secretapikey: pbSecret, ...extra }),
    });
  } catch {
    throw new Error('Could not reach the Porkbun API');
  }

  const text = await res.text();
  let data: ({ status?: string; message?: string } & T);
  try {
    data = JSON.parse(text) as ({ status?: string; message?: string } & T);
  } catch {
    throw new Error(`Porkbun API returned an unreadable response (HTTP ${res.status})`);
  }
  if (!res.ok || data.status === 'ERROR') {
    throw new Error(data.message ?? `Porkbun API error (HTTP ${res.status})`);
  }
  return data;
}

/** Porkbun takes the apex as an empty name. */
function pbName(host: string, zone: string): string {
  return toRelativeName(host, zone);
}

async function listZoneRecords(zone: string, pbKey: string, pbSecret: string): Promise<ProviderRecord[]> {
  const data = await pb<{ records?: PbRecord[] }>(
    `/dns/retrieve/${encodeURIComponent(zone)}`, pbKey, pbSecret,
  );
  return (data.records ?? []).map(r => ({
    id: String(r.id),
    type: r.type,
    // Porkbun's FQDN name is normalised against the zone by planDnsRecord.
    name: r.name,
    value: r.content,
    priority: r.prio != null && r.prio !== '' ? Number(r.prio) : undefined,
    raw: r,
  }));
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
  const { action = 'publish', pbKey, pbSecret, zoneDomain, verifyOnly } = body;
  if (!pbKey || !pbSecret) {
    return NextResponse.json({ error: 'pbKey and pbSecret are required' }, { status: 400 });
  }

  const domain = await queryOne<{ id: string; domain: string; verify_token: string; verified: boolean }>(
    'SELECT id, domain, verify_token, verified FROM domains WHERE id = $1 AND org_id = $2',
    [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  // ── Confirm the credentials can read the zone (was a GET with the key+secret in the URL)
  if (action === 'zones') {
    const apex = domain.domain.split('.').slice(-2).join('.');
    try {
      await pb(`/dns/retrieve/${encodeURIComponent(apex)}`, pbKey, pbSecret);
      return NextResponse.json({ zones: [{ id: apex, name: apex }] });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Cannot access domain — check API keys' }, { status: 502 },
      );
    }
  }

  if (!zoneDomain) return NextResponse.json({ error: 'zoneDomain is required' }, { status: 400 });

  const records = verifyOnly
    ? [getVerifyRecord(domain.domain, domain.verify_token)]
    : [...(!domain.verified ? [getVerifyRecord(domain.domain, domain.verify_token)] : []), ...getRequiredDnsRecords(domain.domain)];

  // Read the zone first. A failed read used to be swallowed and treated as an
  // empty zone, which made every run create yet another copy of each record.
  let existing: ProviderRecord[];
  try {
    existing = await listZoneRecords(zoneDomain, pbKey, pbSecret);
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
    const name = pbName(rec.host, zoneDomain);
    const payload = {
      type: rec.type,
      name,
      content: rec.value,
      ttl: '600',
      ...(rec.type.toUpperCase() === 'MX' ? { prio: String(rec.priority ?? 10) } : {}),
    };

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
        await pb(`/dns/edit/${encodeURIComponent(zoneDomain)}/${encodeURIComponent(plan.target.id)}`, pbKey, pbSecret, payload);
        const idx = existing.findIndex(r => r.id === plan.target.id);
        if (idx >= 0) existing[idx] = { ...existing[idx], value: rec.value, priority: rec.priority };
        results.push({ record: label, status: 'updated' });
      } else {
        const created = await pb<{ id?: string | number }>(
          `/dns/create/${encodeURIComponent(zoneDomain)}`, pbKey, pbSecret, payload,
        );
        existing.push({
          id: String(created.id ?? `new-${existing.length}`),
          type: rec.type, name: rec.host, value: rec.value, priority: rec.priority,
        });
        results.push({ record: label, status: 'created' });
      }
    } catch (err) {
      results.push({
        record: label, status: 'error',
        error: err instanceof Error ? err.message : 'Porkbun API error',
      });
    }
  }

  const allOk = results.every(r => !isFailureStatus(r.status));
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
