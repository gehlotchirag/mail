import { heartbeatUser } from '../db/queries.js';

// How often a running user-migration job stamps heartbeat_at, and how long that
// stamp may go stale before the reaper is allowed to treat the job as dead. The
// gap between them is what stops the reaper from re-enqueuing a slow but healthy
// user and duplicating its mail.
export const HEARTBEAT_INTERVAL_MS = Number(process.env.MIGRATION_HEARTBEAT_MS ?? 30_000);
export const HEARTBEAT_STALE_MS = Number(
  process.env.MIGRATION_HEARTBEAT_STALE_MS ?? Math.max(HEARTBEAT_INTERVAL_MS * 6, 180_000),
);

/** Beat until the returned stop function is called. */
export function startHeartbeat(userId: string): () => void {
  const beat = () => {
    void heartbeatUser(userId).catch(err => {
      console.warn(`[heartbeat] ${userId}: ${err instanceof Error ? err.message : err}`);
    });
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
