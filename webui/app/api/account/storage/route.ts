import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';

// ─── Optional server-side admin JMAP path ────────────────────────────────────
// If JMAP_URL + JMAP_ADMIN_AUTH are configured, we try Quota/get via admin
// first (fast, accurate). If not configured or they return no data, we fall
// back to summing email sizes with the user's own JMAP credentials.
const JMAP_URL = process.env.JMAP_URL;
const JMAP_ADMIN_AUTH = process.env.JMAP_ADMIN_AUTH;

async function adminJmap(calls: unknown[][]): Promise<unknown[][]> {
  if (!JMAP_URL || !JMAP_ADMIN_AUTH) throw new Error('not configured');
  const res = await fetch(`${JMAP_URL}/jmap/`, {
    method: 'POST',
    headers: { Authorization: JMAP_ADMIN_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      using: [
        'urn:ietf:params:jmap:core',
        'urn:stalwart:jmap',
        'urn:ietf:params:jmap:quota',
      ],
      methodCalls: calls,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { methodResponses: unknown[][] };
  return data.methodResponses;
}

/**
 * Sum total email size for an account using the user's own JMAP credentials.
 * Iterates Email/query pages (max 2000 per page) then fetches sizes.
 * Returns bytes used.
 */
async function sumEmailSizes(
  serverUrl: string,
  authHeader: string,
  accountId: string,
): Promise<number> {
  const JMAP_ENDPOINT = `${serverUrl}/jmap/`;
  const using = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'];

  async function jmapCall(calls: unknown[][]): Promise<unknown[][]> {
    const res = await fetch(JMAP_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ using, methodCalls: calls }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`JMAP ${res.status}`);
    const d = await res.json() as { methodResponses: unknown[][] };
    return d.methodResponses;
  }

  let totalSize = 0;
  let position = 0;
  const limit = 500;

  // Limit iterations to avoid very long requests (caps at 10k emails = ~20 pages)
  for (let page = 0; page < 20; page++) {
    const responses = await jmapCall([
      ['Email/query', { accountId, position, limit, sort: null }, 'q'],
      ['Email/get', {
        accountId,
        '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
        properties: ['size'],
      }, 'g'],
    ]);

    let ids: string[] = [];
    let sizes: number[] = [];

    for (const [method, result] of responses as Array<[string, Record<string, unknown>]>) {
      if (method === 'Email/query') {
        ids = (result.ids as string[] | undefined) ?? [];
      }
      if (method === 'Email/get') {
        const list = (result.list as Array<{ size?: number }> | undefined) ?? [];
        sizes = list.map((e) => e.size ?? 0);
      }
    }

    for (const s of sizes) totalSize += s;

    if (ids.length < limit) break; // last page
    position += ids.length;
  }

  return totalSize;
}

/**
 * GET /api/account/storage
 *
 * Returns { used: number, total: number } in bytes for the logged-in user.
 *
 * Strategy:
 * 1. Try JMAP Quota/get via server-side admin credentials (fast, exact).
 * 2. If admin not configured or returns no data, sum email sizes with the
 *    user's own JMAP credentials (slower, good approximation).
 */
export async function GET(request: NextRequest) {
  try {
    const creds = await getStalwartCredentials(request);
    if (!creds) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Resolve the user's accountId from their JMAP session
    const sessionRes = await fetch(`${creds.serverUrl}/.well-known/jmap`, {
      headers: { Authorization: creds.authHeader },
      signal: AbortSignal.timeout(5000),
    });

    let accountId: string | null = null;
    if (sessionRes.ok) {
      const session = await sessionRes.json() as {
        primaryAccounts?: Record<string, string>;
      };
      accountId =
        session.primaryAccounts?.['urn:ietf:params:jmap:quota'] ??
        session.primaryAccounts?.['urn:stalwart:jmap'] ??
        session.primaryAccounts?.['urn:ietf:params:jmap:mail'] ??
        (session.primaryAccounts ? Object.values(session.primaryAccounts)[0] ?? null : null);
    }

    if (!accountId) {
      return NextResponse.json({ used: 0, total: 0 });
    }

    // ── 1. Admin path: Quota/get ──────────────────────────────────────────────
    if (JMAP_URL && JMAP_ADMIN_AUTH) {
      try {
        const responses = await adminJmap([
          ['Quota/get', { accountId }, 'q'],
        ]);
        for (const [method, result] of responses as Array<[string, Record<string, unknown>]>) {
          if (method === 'Quota/get') {
            const list = (result.list ?? []) as Array<{
              used?: number; hardLimit?: number; limit?: number;
            }>;
            if (list.length > 0) {
              const q = list[0];
              return NextResponse.json({
                used: q.used ?? 0,
                total: q.hardLimit ?? q.limit ?? 0,
              });
            }
          }
        }
      } catch {
        // Admin JMAP failed — fall through to user-level sum
      }
    }

    // ── 2. User path: sum email sizes ─────────────────────────────────────────
    const used = await sumEmailSizes(creds.serverUrl, creds.authHeader, accountId);
    return NextResponse.json({ used, total: 0 }); // total=0 means no configured limit
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown';
    console.error('[storage] Failed:', msg);
    return NextResponse.json({ error: 'Unavailable' }, { status: 503 });
  }
}
