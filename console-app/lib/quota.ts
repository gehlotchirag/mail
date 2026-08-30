import { query } from './db';
import { listAllUsers, getAccountDiskQuotas, setAccountQuotas } from './flux';
import { resolvePlanLimits, PLAN_STORAGE_BYTES_PER_USER, type PlanKey } from './plans';

export interface QuotaSyncResult {
  /** The tier whose per-user storage figure was applied. */
  plan: PlanKey;
  storageBytesPerUser: number;
  /** Mail accounts found across every provisioned domain in the organisation. */
  accounts: number;
  /** Accounts whose quota was already correct and were left alone. */
  alreadyCorrect: number;
  /** Accounts the quota was pushed to successfully. */
  updated: number;
  /** Accounts the mail server refused, with the reason. */
  failed: Array<{ id: string; emailAddress?: string; error: string }>;
}

/**
 * Applies the organisation's plan storage quota to every existing mail account
 * it owns.
 *
 * This is the backfill for accounts created before per-account quotas existed
 * *and* the re-quota that has to run whenever the plan changes — an upgrade or a
 * downgrade only ever moved `subscriptions.max_users`, so storage silently
 * stayed at whatever it was when the account was made.
 *
 * Idempotent: the target value is derived from PLAN_STORAGE_BYTES_PER_USER, so
 * re-running it is a no-op once every account matches. Accounts whose quota is
 * already correct are skipped rather than re-patched, which also keeps the JMAP
 * traffic proportional to the drift rather than to the account count.
 */
export async function applyOrgStorageQuotas(orgId: string): Promise<QuotaSyncResult | { error: string }> {
  const sub = await query<{ plan: string; max_users: number }>(
    'SELECT plan, max_users FROM subscriptions WHERE org_id = $1', [orgId]
  );
  if (!sub.length) return { error: 'No subscription found for this organisation' };

  const limits = resolvePlanLimits(sub[0]);
  const target = limits.storageBytesPerUser;

  const domains = await query<{ flux_domain_id: string | null }>(
    'SELECT flux_domain_id FROM domains WHERE org_id = $1 AND flux_domain_id IS NOT NULL',
    [orgId]
  );
  const fluxDomainIds = new Set(
    domains.map(d => d.flux_domain_id).filter((id): id is string => !!id)
  );

  const result: QuotaSyncResult = {
    plan: limits.plan,
    storageBytesPerUser: target,
    accounts: 0,
    alreadyCorrect: 0,
    updated: 0,
    failed: [],
  };
  if (!fluxDomainIds.size) return result;

  const accounts = (await listAllUsers()).filter(u => u.domainId && fluxDomainIds.has(u.domainId));
  result.accounts = accounts.length;
  if (!accounts.length) return result;

  // Best effort — an empty map means "unknown", so everything gets re-pushed.
  const current = await getAccountDiskQuotas(accounts.map(a => a.id));

  const pending: Record<string, number> = {};
  for (const account of accounts) {
    if (current.get(account.id) === target) result.alreadyCorrect++;
    else pending[account.id] = target;
  }

  const pendingIds = Object.keys(pending);
  if (!pendingIds.length) return result;

  const errors = await setAccountQuotas(pending);
  const byId = new Map(accounts.map(a => [a.id, a]));
  for (const id of pendingIds) {
    if (errors[id]) {
      result.failed.push({ id, emailAddress: byId.get(id)?.emailAddress, error: errors[id] });
    } else {
      result.updated++;
    }
  }
  return result;
}

/**
 * Fire-and-log wrapper for callers that must not fail because of the mail
 * server — the billing webhook has to answer Razorpay regardless of whether
 * Flux was reachable.
 */
export async function syncOrgStorageQuotasSafe(orgId: string, reason: string): Promise<void> {
  try {
    const result = await applyOrgStorageQuotas(orgId);
    if ('error' in result) {
      console.error(`[quota] ${reason}: could not re-quota org ${orgId}: ${result.error}`);
      return;
    }
    console.log(
      `[quota] ${reason}: org ${orgId} → plan ${result.plan} ` +
      `(${PLAN_STORAGE_BYTES_PER_USER[result.plan]} bytes/user); ` +
      `${result.updated} updated, ${result.alreadyCorrect} already correct, ` +
      `${result.failed.length} failed`
    );
    for (const f of result.failed) {
      console.error(`[quota] ${reason}: account ${f.emailAddress ?? f.id} — ${f.error}`);
    }
  } catch (e) {
    console.error(`[quota] ${reason}: re-quota threw for org ${orgId}:`, e);
  }
}
