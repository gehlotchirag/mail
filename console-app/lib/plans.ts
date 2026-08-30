const GB = 1024 ** 3;

export const PLANS = {
  trial:      { name: 'Free Trial',  price: 0,    maxUsers: 3,   maxDomains: 1,   storageGbPerUser: 5,   features: ['3 users', '5 GB storage/user', 'Basic support'] },
  starter:    { name: 'Starter',     price: 499,  maxUsers: 10,  maxDomains: 3,   storageGbPerUser: 15,  features: ['10 users', '15 GB storage/user', 'Email support', 'Custom domain'] },
  business:   { name: 'Business',    price: 1499, maxUsers: 50,  maxDomains: 10,  storageGbPerUser: 50,  features: ['50 users', '50 GB storage/user', 'Priority support', 'Custom domain', 'Team aliases'] },
  enterprise: { name: 'Enterprise',  price: 3999, maxUsers: 999, maxDomains: 999, storageGbPerUser: 100, features: ['Unlimited users', '100 GB storage/user', 'Dedicated support', 'SLA', 'Custom DKIM'] },
} as const;

export type PlanKey = keyof typeof PLANS;

/** Cheapest → most expensive. Used to infer an effective tier from max_users. */
export const PLAN_ORDER: readonly PlanKey[] = ['trial', 'starter', 'business', 'enterprise'];

/**
 * Per-user mailbox quota in bytes, derived from the advertised GB figure in
 * PLANS. This is the value pushed to Flux as `quotas.maxDiskQuota` on account
 * creation — never hard-code byte counts anywhere else.
 */
export const PLAN_STORAGE_BYTES_PER_USER: Record<PlanKey, number> = {
  trial:      PLANS.trial.storageGbPerUser * GB,
  starter:    PLANS.starter.storageGbPerUser * GB,
  business:   PLANS.business.storageGbPerUser * GB,
  enterprise: PLANS.enterprise.storageGbPerUser * GB,
};

export function isPlanKey(value: string): value is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}

export interface PlanLimits {
  /** The tier whose limits are actually being applied. */
  plan: PlanKey;
  maxUsers: number;
  maxDomains: number;
  storageBytesPerUser: number;
}

/**
 * Reconciles the two sources of plan limits.
 *
 * `subscriptions.max_users` is written by the billing webhook and shown in the
 * dashboard, so it is authoritative for the user cap — it may legitimately have
 * been overridden for a custom/grandfathered deal. `maxDomains` and the storage
 * quota exist only in PLANS, keyed by `subscriptions.plan`.
 *
 * The two can disagree. Rather than silently trusting either:
 *  - an unknown `plan` string falls back to the most restrictive tier (trial);
 *  - if `max_users` is *larger* than the named plan allows, the row has been
 *    overridden upwards, so the effective tier becomes the cheapest tier that
 *    covers that user count and its domain/storage limits are used with it;
 *  - if `max_users` is smaller, the named plan is kept (the customer never gets
 *    more than the tier they are on) and only the user cap is tightened.
 * Every disagreement is logged.
 */
export function resolvePlanLimits(sub: { plan: string; max_users: number }): PlanLimits {
  let plan: PlanKey;
  if (isPlanKey(sub.plan)) {
    plan = sub.plan;
  } else {
    console.warn(`[plans] Unknown plan "${sub.plan}" on subscription — falling back to trial limits`);
    plan = 'trial';
  }

  const maxUsers = Number.isFinite(sub.max_users) && sub.max_users > 0
    ? Math.floor(sub.max_users)
    : PLANS[plan].maxUsers;

  let effective = plan;
  if (maxUsers > PLANS[plan].maxUsers) {
    effective = PLAN_ORDER.find(p => PLANS[p].maxUsers >= maxUsers) ?? 'enterprise';
    console.warn(
      `[plans] subscriptions.max_users (${maxUsers}) exceeds plan "${plan}" (${PLANS[plan].maxUsers}) — ` +
      `applying "${effective}" domain and storage limits`
    );
  } else if (maxUsers < PLANS[plan].maxUsers) {
    console.warn(
      `[plans] subscriptions.max_users (${maxUsers}) is below plan "${plan}" (${PLANS[plan].maxUsers}) — ` +
      `honouring the lower user cap from the database`
    );
  }

  return {
    plan: effective,
    maxUsers,
    maxDomains: PLANS[effective].maxDomains,
    storageBytesPerUser: PLAN_STORAGE_BYTES_PER_USER[effective],
  };
}
