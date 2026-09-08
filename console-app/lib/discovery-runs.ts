/**
 * Background Zoho organisation discovery.
 *
 * Listing a large organisation is slow — Zoho took over 40 seconds to return a
 * 200-mailbox org, which is longer than any sensible in-request budget and close
 * to the reverse proxy's own limit. Doing it inside the HTTP request meant the
 * call aborted, discovery fell back to the single-mailbox endpoint, and the
 * per-person picker silently rendered with one row instead of two hundred.
 *
 * So discovery runs detached, like the IMAP/password work does: the request
 * starts it and returns an id, and the browser polls until the list is ready. A
 * slow upstream then costs the operator a progress spinner rather than a broken
 * feature.
 *
 * Results are cached briefly so re-opening the page — or a second tab — reuses a
 * completed listing instead of hammering Zoho again.
 */
export interface DiscoveredMailbox {
  email: string;
  displayName: string;
  domain: string;
  imapEnabled: boolean;
  existsHere: boolean;
  role?: string;
  usedStorageMb?: number;
}

export interface DiscoveryResult {
  totalUsers: number;
  seatsInUse: number;
  maxUsers: number;
  maxDomains: number;
  domains: Array<{ domain: string; userCount: number; alreadyAdded: boolean }>;
  mailboxes: DiscoveredMailbox[];
  /** True when Zoho's listing was cut short; the list is real but incomplete. */
  partial: boolean;
}

export interface DiscoveryRun {
  id: string;
  workspaceId: string;
  orgId: string;
  status: 'running' | 'done' | 'error';
  /** Mailboxes found so far, so the UI can show progress on a slow org. */
  found: number;
  result?: DiscoveryResult;
  /**
   * Zoho's raw account rows, kept so a follow-up action does not have to crawl the
   * organisation again. Listing this org costs ~10 seconds per 50 mailboxes, so a
   * reset that re-listed would spend over a minute before it could even start.
   */
  raw?: unknown[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const runs = new Map<string, DiscoveryRun>();
/**
 * A finished listing stays usable for half an hour. Crawling a large organisation
 * costs nearly two minutes, and the natural flow — list, pick people, run an
 * action — easily spans longer than a few minutes of deliberation.
 */
const RETAIN_MS = 30 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, r] of runs) {
    if (r.status !== 'running' && r.finishedAt && now - r.finishedAt > RETAIN_MS) runs.delete(id);
  }
}

export function createDiscoveryRun(id: string, workspaceId: string, orgId: string): DiscoveryRun {
  sweep();
  const run: DiscoveryRun = { id, workspaceId, orgId, status: 'running', found: 0, startedAt: Date.now() };
  runs.set(id, run);
  return run;
}

export function getDiscoveryRun(id: string): DiscoveryRun | undefined {
  return runs.get(id);
}

/** Raw account rows from a recent listing, for callers that need zuid/accountId. */
export function cachedRawAccountsFor(workspaceId: string, orgId: string): unknown[] | undefined {
  const r = recentDiscoveryFor(workspaceId, orgId);
  return r?.raw;
}

/**
 * A completed listing for this org, if one is recent enough to reuse. Avoids a
 * fresh multi-minute crawl every time the page is opened.
 */
export function recentDiscoveryFor(workspaceId: string, orgId: string): DiscoveryRun | undefined {
  sweep();
  let best: DiscoveryRun | undefined;
  for (const r of runs.values()) {
    if (r.workspaceId !== workspaceId || r.orgId !== orgId) continue;
    if (r.status !== 'done' || !r.result) continue;
    if (!best || r.startedAt > best.startedAt) best = r;
  }
  return best;
}

/** An in-flight listing for this org, so two tabs share one crawl. */
export function inFlightDiscoveryFor(workspaceId: string, orgId: string): DiscoveryRun | undefined {
  for (const r of runs.values()) {
    if (r.workspaceId === workspaceId && r.orgId === orgId && r.status === 'running') return r;
  }
  return undefined;
}

export function finishDiscovery(run: DiscoveryRun, result: DiscoveryResult, raw?: unknown[]): void {
  run.result = result;
  run.raw = raw;
  run.found = result.mailboxes.length;
  run.status = 'done';
  run.finishedAt = Date.now();
}

export function failDiscovery(run: DiscoveryRun, error: string): void {
  run.status = 'error';
  run.error = error;
  run.finishedAt = Date.now();
}

// ── Durable cache ─────────────────────────────────────────────────────────────
//
// The in-memory map above is a fast path only. Listing a Zoho organisation takes
// close to two minutes, so losing the result to a routine restart meant every
// deploy forced a re-crawl and any action depending on it silently re-listed.
// Postgres holds the authoritative copy.

/** How long a stored listing stays usable before a fresh crawl is preferred. */
const DB_CACHE_MINUTES = 30;

type Pooled = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> };

export async function saveDiscoveryToDb(
  pool: Pooled,
  workspaceId: string,
  orgId: string,
  accounts: unknown[],
  mailboxes: unknown[],
  partial: boolean,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO zoho_discovery_cache (workspace_id, zoho_org_id, accounts, mailboxes, partial, created_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, NOW())
       ON CONFLICT (workspace_id, zoho_org_id)
       DO UPDATE SET accounts = EXCLUDED.accounts, mailboxes = EXCLUDED.mailboxes,
                     partial = EXCLUDED.partial, created_at = NOW()`,
      [workspaceId, orgId, JSON.stringify(accounts), JSON.stringify(mailboxes), partial],
    );
  } catch (e) {
    // A cache write failing must never fail the listing itself.
    console.warn('[discovery] could not persist listing:', e instanceof Error ? e.message : e);
  }
}

export async function loadDiscoveryFromDb(
  pool: Pooled,
  workspaceId: string,
  orgId: string,
): Promise<{ accounts: unknown[]; mailboxes: unknown[]; partial: boolean; ageMinutes: number } | null> {
  try {
    const r = await pool.query(
      `SELECT accounts, mailboxes, partial,
              EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS age_minutes
         FROM zoho_discovery_cache
        WHERE workspace_id = $1 AND zoho_org_id = $2`,
      [workspaceId, orgId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const age = Number(row.age_minutes ?? 0);
    if (age > DB_CACHE_MINUTES) return null;
    return {
      accounts: (row.accounts ?? []) as unknown[],
      mailboxes: (row.mailboxes ?? []) as unknown[],
      partial: Boolean(row.partial),
      ageMinutes: age,
    };
  } catch (e) {
    console.warn('[discovery] could not read cached listing:', e instanceof Error ? e.message : e);
    return null;
  }
}
