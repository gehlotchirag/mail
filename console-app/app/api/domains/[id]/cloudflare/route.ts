import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  getPublishableRecords, planDnsRecord,
  isFailureStatus, type ProviderRecord, type PublishResult,
} from '@/lib/dns';

type Params = { params: Promise<{ id: string }> };

type CFDnsRecord = { id: string; type: string; name: string; content: string; priority?: number };
type CFEnvelope<T> = {
  success: boolean;
  result: T;
  errors?: { message: string }[];
  result_info?: { page: number; total_pages: number };
};

/**
 * Credentials only ever arrive in the POST body — never in a query string,
 * which would leak them into access logs, browser history and proxy logs.
 * Nothing in this file logs the token.
 */
type Body = {
  action?: 'zones' | 'publish';
  cfToken?: string;
  zoneId?: string;
  verifyOnly?: boolean;
};

function cfErrorMessage(env: CFEnvelope<unknown>, status: number): string {
  const msgs = (env.errors ?? []).map(e => e.message).filter(Boolean);
  return msgs.length ? msgs.join('; ') : `Cloudflare API error (HTTP ${status})`;
}

async function cfFetch<T>(path: string, token: string, method = 'GET', body?: object): Promise<CFEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the Cloudflare API');
  }

  const text = await res.text();
  let env: CFEnvelope<T>;
  try {
    env = JSON.parse(text) as CFEnvelope<T>;
  } catch {
    throw new Error(`Cloudflare API returned an unreadable response (HTTP ${res.status})`);
  }
  if (!res.ok || !env.success) throw new Error(cfErrorMessage(env, res.status));
  return env;
}

/** Every record in the zone — we must see the customer's records to avoid them. */
async function listZoneRecords(zoneId: string, token: string): Promise<ProviderRecord[]> {
  const out: ProviderRecord[] = [];
  for (let page = 1; page <= 20; page++) {
    const env = await cfFetch<CFDnsRecord[]>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=100&page=${page}`, token,
    );
    const rows = Array.isArray(env.result) ? env.result : [];
    out.push(...rows.map(r => ({
      id: r.id, type: r.type, name: r.name, value: r.content, priority: r.priority, raw: r,
    })));
    const totalPages = env.result_info?.total_pages ?? 1;
    if (rows.length === 0 || page >= totalPages) break;
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
  const { action = 'publish', cfToken, zoneId, verifyOnly } = body;
  if (!cfToken) return NextResponse.json({ error: 'cfToken is required' }, { status: 400 });

  const domain = await queryOne<{ id: string; domain: string; verify_token: string; verified: boolean }>(
    'SELECT id, domain, verify_token, verified FROM domains WHERE id = $1 AND org_id = $2',
    [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  // ── List zones so the operator can pick one (was a GET with the token in the URL)
  if (action === 'zones') {
    const apex = domain.domain.split('.').slice(-2).join('.');
    try {
      const env = await cfFetch<{ id: string; name: string }[]>(
        `/zones?name=${encodeURIComponent(apex)}&status=active`, cfToken,
      );
      const zones = (Array.isArray(env.result) ? env.result : []).map(z => ({ id: z.id, name: z.name }));
      return NextResponse.json({ zones });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to fetch zones' }, { status: 502 },
      );
    }
  }

  if (!zoneId) return NextResponse.json({ error: 'zoneId is required' }, { status: 400 });

  // Single source of truth for what a domain must publish — includes the SES DKIM
  // CNAMEs, without which the domain resolves correctly but still cannot send.
  const records = await getPublishableRecords(domain.domain, {
    verified: domain.verified,
    verifyToken: domain.verify_token,
    verifyOnly,
  });

  // Read the whole zone up-front. If we cannot, abort: publishing blind would
  // duplicate or overwrite the customer's records.
  let existing: ProviderRecord[];
  let zoneName = domain.domain;
  try {
    const zone = await cfFetch<{ id: string; name: string }>(`/zones/${encodeURIComponent(zoneId)}`, cfToken);
    if (zone.result?.name) zoneName = zone.result.name;
    existing = await listZoneRecords(zoneId, cfToken);
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
    const isProxiable = ['A', 'AAAA', 'CNAME'].includes(rec.type.toUpperCase());
    const payload: Record<string, unknown> = {
      type: rec.type,
      name: rec.host,
      content: rec.value,
      ttl: 1, // automatic
      ...(rec.type.toUpperCase() === 'MX' ? { priority: rec.priority ?? 10 } : {}),
      ...(isProxiable ? { proxied: false } : {}),
    };

    const plan = planDnsRecord(rec, zoneName, existing);
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
        await cfFetch<CFDnsRecord>(
          `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(plan.target.id)}`,
          cfToken, 'PATCH', payload,
        );
        // Keep our in-memory view current so a later record in this same run
        // sees the update rather than acting on stale data.
        const idx = existing.findIndex(r => r.id === plan.target.id);
        if (idx >= 0) existing[idx] = { ...existing[idx], value: rec.value, priority: rec.priority };
        results.push({ record: label, status: 'updated' });
      } else {
        const env = await cfFetch<CFDnsRecord>(
          `/zones/${encodeURIComponent(zoneId)}/dns_records`, cfToken, 'POST', payload,
        );
        const created = env.result;
        existing.push({
          id: created?.id ?? `new-${existing.length}`,
          type: rec.type, name: rec.host, value: rec.value, priority: rec.priority,
        });
        results.push({ record: label, status: 'created' });
      }
    } catch (err) {
      results.push({
        record: label, status: 'error',
        error: err instanceof Error ? err.message : 'Cloudflare API error',
      });
    }
  }

  const allOk = results.every(r => !isFailureStatus(r.status));
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
