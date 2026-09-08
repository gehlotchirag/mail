/**
 * In-flight and recently finished Zoho IMAP/password runs.
 *
 * These runs take minutes for a large organisation — roughly one Zoho API call per
 * mailbox, sequentially — which is far longer than the reverse proxy will hold a
 * request open. Previously the endpoint did the whole thing inside the request, so
 * nginx returned 504 at 60 seconds while the work carried on invisibly: the caller
 * got an error, the result (including the passwords it had just set) was thrown
 * away with the closed connection, and nothing recorded what had been changed.
 *
 * So the work is detached from the request. The route starts a run, returns its id
 * immediately, and the caller polls this registry for progress.
 *
 * Deliberately in memory: a run is only meaningful while the process that owns it is
 * alive, and a restart mid-run is reported as such rather than resumed. The log is
 * the durable record — every mailbox is written there as it changes.
 */
export type RunStatus = 'running' | 'done' | 'error' | 'interrupted';

export interface RunMailbox {
  email: string;
  status: 'changed' | 'unchanged' | 'failed';
  error?: string;
}

export interface RunState {
  id: string;
  orgId: string;
  /** Which org owns this run — nobody else may read it. */
  workspaceId: string;
  mode: 'enabled' | 'disabled' | 'passwords';
  status: RunStatus;
  total: number;
  processed: number;
  changed: number;
  unchanged: number;
  failed: number;
  byDomain: Record<string, number>;
  mailboxes: RunMailbox[];
  passwords?: Record<string, string>;
  passwordsSet?: number;
  passwordFailures?: Array<{ email: string; error: string }>;
  skippedOwner?: string;
  skippedOtherDomain?: number;
  scopedToDomains?: string[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const runs = new Map<string, RunState>();

/** Keep finished runs long enough to be read, then let them go. */
const RETAIN_MS = 60 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, r] of runs) {
    if (r.status !== 'running' && r.finishedAt && now - r.finishedAt > RETAIN_MS) runs.delete(id);
  }
}

export function createRun(init: Omit<RunState, 'startedAt' | 'processed' | 'changed' | 'unchanged' | 'failed' | 'byDomain' | 'mailboxes' | 'status'>): RunState {
  sweep();
  const run: RunState = {
    ...init,
    status: 'running',
    processed: 0, changed: 0, unchanged: 0, failed: 0,
    byDomain: {}, mailboxes: [],
    startedAt: Date.now(),
  };
  runs.set(run.id, run);
  return run;
}

export function getRun(id: string): RunState | undefined {
  return runs.get(id);
}

/** The most recent run for an organisation, so a reloaded page can find its way back. */
export function latestRunFor(workspaceId: string): RunState | undefined {
  let best: RunState | undefined;
  for (const r of runs.values()) {
    if (r.workspaceId !== workspaceId) continue;
    if (!best || r.startedAt > best.startedAt) best = r;
  }
  return best;
}

export function recordMailbox(run: RunState, m: RunMailbox): void {
  run.mailboxes.push(m);
  run.processed++;
  if (m.status === 'changed') {
    run.changed++;
    const d = m.email.split('@')[1]?.toLowerCase() ?? '(unknown)';
    run.byDomain[d] = (run.byDomain[d] ?? 0) + 1;
  } else if (m.status === 'unchanged') run.unchanged++;
  else run.failed++;
}

export function finishRun(run: RunState, error?: string): void {
  run.status = error ? 'error' : 'done';
  if (error) run.error = error;
  run.finishedAt = Date.now();
}

// ── Durable run state ─────────────────────────────────────────────────────────
//
// These runs execute inside the web process, so a restart aborts them mid-way.
// Persisting progress does not make them resumable, but it does mean the operator
// sees how far a run actually got — instead of a progress bar that polls a run id
// the new process has never heard of and spins forever.

type Pooled = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> };

export async function persistRun(pool: Pooled, run: RunState): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO imap_runs (id, workspace_id, zoho_org_id, mode, status, total, processed,
                              changed, unchanged, failed, mailboxes, error, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,to_timestamp($13/1000.0),
               CASE WHEN $14::bigint IS NULL THEN NULL ELSE to_timestamp($14/1000.0) END)
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, total=EXCLUDED.total, processed=EXCLUDED.processed,
         changed=EXCLUDED.changed, unchanged=EXCLUDED.unchanged, failed=EXCLUDED.failed,
         mailboxes=EXCLUDED.mailboxes, error=EXCLUDED.error, finished_at=EXCLUDED.finished_at`,
      [
        run.id, run.workspaceId, run.orgId, run.mode, run.status,
        run.total, run.processed, run.changed, run.unchanged, run.failed,
        // Addresses and outcomes only — never the passwords that were set.
        JSON.stringify(run.mailboxes), run.error ?? null,
        run.startedAt, run.finishedAt ?? null,
      ],
    );
  } catch (e) {
    // Persistence is observability, not correctness: never fail a run over it.
    console.warn('[imap-runs] could not persist run state:', e instanceof Error ? e.message : e);
  }
}

export async function loadRunFromDb(pool: Pooled, id: string, workspaceId: string) {
  try {
    const r = await pool.query(
      `SELECT id, mode, status, total, processed, changed, unchanged, failed, mailboxes, error
         FROM imap_runs WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}
