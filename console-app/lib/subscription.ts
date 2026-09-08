import { NextResponse } from 'next/server';
import { queryOne } from './db';

export interface SubRow {
  plan: string;
  status: string;
  max_users: number;
  trial_ends_at: string | null;
  org_id: string;
}

/**
 * Returns null if:
 *  - no subscription found
 *  - status is 'cancelled' or 'expired'
 *  - status is 'trial' and trial_ends_at is in the past
 * Returns the row if the subscription is active.
 */
export async function getActiveSub(orgId: string): Promise<SubRow | null> {
  const sub = await queryOne<SubRow>(
    'SELECT plan, status, max_users, trial_ends_at, org_id FROM subscriptions WHERE org_id = $1',
    [orgId]
  );

  if (!sub) return null;
  if (sub.status === 'cancelled' || sub.status === 'expired') return null;
  if (sub.status === 'trial' && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date()) {
    return null;
  }

  return sub;
}

/**
 * Returns a standard 403 response for an expired or cancelled subscription.
 */
export function subErrorResponse(): Response {
  return NextResponse.json(
    {
      error: 'Your subscription has expired or been cancelled. Please renew your plan.',
      subscriptionRequired: true,
    },
    { status: 403 }
  );
}

/**
 * Returns the standard 403 used when a plan limit (users, domains, ...) is hit.
 */
export function limitErrorResponse(message: string): Response {
  return NextResponse.json({ error: message, limitReached: true }, { status: 403 });
}

/**
 * Mailboxes this organisation already has on the mail server, across every domain
 * it owns. Seats are sold per organisation, not per domain, so the count has to
 * span all of them.
 *
 * Returns 0 rather than throwing when the mail server cannot be reached: callers
 * use this to *tighten* a limit, and a transient JMAP failure must not become a
 * refusal to sell seats or run a migration.
 */
export async function countOrgMailboxes(orgId: string): Promise<number> {
  try {
    const { query } = await import('./db');
    const { countUsersForDomains } = await import('./flux');
    const rows = await query<{ flux_domain_id: string | null }>(
      'SELECT flux_domain_id FROM domains WHERE org_id = $1 AND flux_domain_id IS NOT NULL', [orgId],
    );
    return await countUsersForDomains(rows.map(r => r.flux_domain_id).filter((x): x is string => !!x));
  } catch (err) {
    console.warn('[subscription] could not count existing mailboxes:', err instanceof Error ? err.message : err);
    return 0;
  }
}
