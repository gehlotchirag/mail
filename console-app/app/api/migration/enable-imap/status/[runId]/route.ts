import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getRun, loadRunFromDb } from '@/lib/imap-runs';
import { runPool } from '@/lib/run-pool';

type Params = { params: Promise<{ runId: string }> };

/**
 * Poll target for a Zoho IMAP/password run started by POST /api/migration/enable-imap.
 * The run lives in memory on this process, so it disappears on a restart — reported
 * as "not found" rather than silently returning stale progress.
 */
export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { runId } = await params;
  const run = getRun(runId);

  // Not in this process's memory: either it finished long ago, or the process that
  // owned it restarted. The stored copy answers both cases — a run interrupted by a
  // restart reports how far it actually got, rather than the caller polling forever
  // against a 404.
  if (!run || run.workspaceId !== session.orgId) {
    const stored = await loadRunFromDb(runPool(), runId, session.orgId) as null | {
      mode: string; status: string; total: number; processed: number;
      changed: number; unchanged: number; failed: number;
      mailboxes: Array<{ email: string; status: string; error?: string }> | null; error: string | null;
    };
    if (!stored) {
      return NextResponse.json({ error: 'Run not found — it may have finished some time ago.' }, { status: 404 });
    }
    return NextResponse.json({
      id: runId,
      mode: stored.mode,
      status: stored.status,
      total: stored.total,
      processed: stored.processed,
      changed: stored.changed,
      unchanged: stored.unchanged,
      failed: stored.failed,
      mailboxes: stored.mailboxes ?? [],
      error: stored.error ?? undefined,
      // Passwords are never persisted, so a run recovered from storage cannot hand
      // them back. Said plainly, because silently omitting them would look like the
      // reset had not happened.
      passwordsUnavailable: stored.mode === 'passwords' || stored.mode === 'enabled',
      recoveredAfterRestart: true,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  }

  return NextResponse.json({
    id: run.id,
    mode: run.mode,
    status: run.status,
    total: run.total,
    processed: run.processed,
    changed: run.changed,
    unchanged: run.unchanged,
    failed: run.failed,
    byDomain: run.byDomain,
    scopedToDomains: run.scopedToDomains,
    skippedOtherDomain: run.skippedOtherDomain,
    skippedOwner: run.skippedOwner,
    error: run.error,
    // The full mailbox list and any passwords are withheld from progress polls —
    // only sent once the run is done, so a mid-run poll can't leak the shared
    // password before every mailbox that needs it has actually been set.
    ...(run.status !== 'running' ? {
      mailboxes: run.mailboxes,
      passwords: run.passwords,
      passwordsSet: run.passwordsSet,
      passwordFailures: run.passwordFailures,
    } : {}),
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
