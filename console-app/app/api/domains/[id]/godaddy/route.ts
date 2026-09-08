import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import {
  getPublishableRecords, planDnsRecord, toRelativeName,
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
  /** New GoDaddy Personal Access Token (`gd_pat_…`). Preferred. */
  gdToken?: string;
  /** Legacy API Key + Secret pair. Still accepted for anyone holding one. */
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

/**
 * GoDaddy's developer platform replaced the old API Key + Secret pair with a single
 * Personal Access Token (`gd_pat_…`), so the credential a customer can obtain today
 * no longer fits the `sso-key <key>:<secret>` header this route used to hard-code.
 *
 * Rather than bet on one header form, carry an ordered list of candidates and keep
 * whichever the API accepts. A key/secret pair has exactly one candidate; a PAT is
 * tried as a bearer credential first and then in the sso-key form, because GoDaddy
 * has shipped both during this transition and an account can be on either.
 */
type GdAuth = { candidates: string[]; chosen?: string };

/**
 * Strip ALL whitespace, not just the ends.
 *
 * GoDaddy's console wraps a long key across two lines, and copying it brings the
 * line break along as a space. `.trim()` leaves that space in the middle, the
 * header goes out malformed, and GoDaddy answers 401 — indistinguishable from a
 * wrong credential, so the customer re-issues keys that were never the problem.
 * No provider credential legitimately contains whitespace.
 */
function clean(v?: string): string {
  return (v ?? '').replace(/\s+/g, '');
}

function buildAuth(token?: string, key?: string, secret?: string): GdAuth | null {
  const k = clean(key), sec = clean(secret);
  if (k && sec) {
    return { candidates: [`sso-key ${k}:${sec}`] };
  }
  const t = clean(token);
  if (!t) return null;
  // Someone may paste "key:secret" into the single field — that is the legacy form.
  if (t.includes(':')) return { candidates: [`sso-key ${t}`] };
  return { candidates: [`Bearer ${t}`, `sso-key ${t}`] };
}

async function gdRequest(path: string, authValue: string, method: string, body?: object): Promise<Response> {
  try {
    return await fetch(`https://api.godaddy.com${path}`, {
      method,
      headers: { Authorization: authValue, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GdError('Could not reach the GoDaddy API', 0);
  }
}

async function gdFetch<T>(path: string, auth: GdAuth, method = 'GET', body?: object): Promise<T> {
  const tries = auth.chosen ? [auth.chosen] : auth.candidates;
  let res!: Response;

  for (let i = 0; i < tries.length; i++) {
    res = await gdRequest(path, tries[i], method, body);
    // Only an auth rejection is worth re-trying with a different header form;
    // a 404 or 422 means we are talking to the right API with the right credential.
    const authRejected = res.status === 401 || res.status === 403;
    if (!authRejected || i === tries.length - 1) {
      if (!authRejected) auth.chosen = tries[i];
      break;
    }
  }

  const text = await res.text();
  if (!res.ok) {
    let message = `GoDaddy API error (HTTP ${res.status})`;
    try {
      const err = JSON.parse(text) as { message?: string; fields?: { message?: string }[] };
      message = err.message ?? err.fields?.[0]?.message ?? message;
    } catch { /* non-JSON error body — keep the generic message */ }
    if (res.status === 401 || res.status === 403) {
      message = 'GoDaddy rejected the credential. Check the token was copied in full, '
              + 'and that it was created for the Production environment.';
    }
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
async function gdRecordSet(zone: string, auth: GdAuth, type: string, name: string): Promise<GdRecord[]> {
  try {
    const rows = await gdFetch<GdRecord[]>(
      `/v1/domains/${encodeURIComponent(zone)}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
      auth,
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
  const { action = 'publish', gdToken, gdKey, gdSecret, zoneDomain, verifyOnly } = body;
  const auth = buildAuth(gdToken, gdKey, gdSecret);
  if (!auth) {
    return NextResponse.json(
      { error: 'Provide a GoDaddy Personal Access Token, or an API Key and Secret.' },
      { status: 400 },
    );
  }

  const domain = await queryOne<{ id: string; domain: string; verify_token: string; verified: boolean }>(
    'SELECT id, domain, verify_token, verified FROM domains WHERE id = $1 AND org_id = $2',
    [id, session.orgId]
  );
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  // ── List matching zones in the account (was a GET with the key+secret in the URL)
  if (action === 'zones') {
    try {
      const all = await gdFetch<{ domain: string }[]>('/v1/domains?limit=100&status=ACTIVE', auth);
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

  // Single source of truth for what a domain must publish — includes the SES DKIM
  // CNAMEs, without which the domain resolves correctly but still cannot send.
  const records = await getPublishableRecords(domain.domain, {
    verified: domain.verified,
    verifyToken: domain.verify_token,
    verifyOnly,
  });

  const results: PublishResult[] = [];

  for (const rec of records) {
    const label = `${rec.type} ${rec.host}`;
    const name = gdName(rec.host, zoneDomain);

    try {
      // GoDaddy's PUT /records/{type}/{name} REPLACES the whole record set for
      // that type+name. Read it first, merge our record into it, and PUT the
      // union — otherwise the customer's other TXT/MX records are destroyed.
      const current = await gdRecordSet(zoneDomain, auth, rec.type, name);

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
        auth, 'PUT', merged,
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
