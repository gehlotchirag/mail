const GB = 1024 ** 3;

/**
 * Pricing is PER SEAT PER MONTH, in rupees, exclusive of GST — the same basis Zoho
 * quotes on, so the comparison below is like-for-like.
 *
 * Benchmarked against Zoho Mail India (Sep 2026) at roughly 20% under:
 *   lite       5 GB   ₹40   vs Zoho Mail Lite 5GB       ₹59   (-32%)
 *   starter    10 GB  ₹60   vs Zoho Mail Lite 10GB      ₹75   (-20%)
 *   business   50 GB  ₹159  vs Zoho Mail Premium        ₹199  (-20%)
 *   enterprise 100 GB ₹319  vs Zoho Workplace Pro       ₹399  (-20%)
 *
 * `maxDomains` is deliberately flat across paid tiers. Zoho charges for mailboxes
 * and lets any paid plan hold ~30 domains; gating domains by tier made us look
 * meaner than the incumbent on exactly the axis we were pitching as a strength.
 */
export const PLANS = {
  trial: {
    name: 'Free Trial', pricePerUser: 0, storageGbPerUser: 5, maxDomains: 1, includedUsers: 3,
    features: ['3 mailboxes', '5 GB per mailbox', '1 domain', '14-day trial'],
  },
  // The signup incentive: every new organisation is provisioned directly onto
  // this plan (see app/api/auth/signup/route.ts), not the 14-day `trial`
  // above — 20 mailboxes, free for 12 months, no card required. Enforcement
  // needs no bespoke code: `max_users` is set to `freeIncludedUsers` at
  // signup, so the ordinary per-seat cap blocks mailbox #21, and
  // `trial_ends_at` is set 365 days out with `status: 'trial'`, so the
  // ordinary getActiveSub() expiry check blocks everything once the year is
  // up — the same two mechanisms that already gate the `trial` plan above.
  // Checkout deliberately refuses to sell this plan (see
  // app/api/billing/checkout/route.ts) so it can only ever be granted at
  // signup, never bought or switched into later — existing orgs are
  // unaffected by this offer.
  lite: {
    name: 'Lite', pricePerUser: 40, storageGbPerUser: 5, maxDomains: 30, includedUsers: 1,
    /** Free-plan seat count granted at signup — see the comment above. */
    freeIncludedUsers: 20,
    /** How long the free period lasts from signup, in days. */
    freeDays: 365,
    features: ['Free for your first 12 months', 'Up to 20 mailboxes included', '5 GB per mailbox', 'Up to 30 domains', 'IMAP, POP and ActiveSync', 'Free migration', 'Email support'],
  },
  starter: {
    name: 'Starter', pricePerUser: 60, storageGbPerUser: 10, maxDomains: 30, includedUsers: 1,
    features: ['10 GB per mailbox', 'Up to 30 domains', 'IMAP, POP and ActiveSync', 'Free migration', 'Email support'],
  },
  business: {
    name: 'Business', pricePerUser: 159, storageGbPerUser: 50, maxDomains: 30, includedUsers: 1,
    features: ['50 GB per mailbox', 'Up to 30 domains', 'Team aliases and distribution lists', 'Priority support'],
  },
  enterprise: {
    name: 'Enterprise', pricePerUser: 319, storageGbPerUser: 100, maxDomains: 30, includedUsers: 1,
    features: ['100 GB per mailbox', 'Up to 30 domains', 'Team aliases and distribution lists', 'Custom DKIM', 'Dedicated support and SLA'],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

/** Cheapest → most expensive. Drives the order plans are listed in. */
export const PLAN_ORDER: readonly PlanKey[] = ['trial', 'lite', 'starter', 'business', 'enterprise'];

/**
 * Indian GST on a SaaS subscription. Prices are quoted exclusive of it (as Zoho
 * does) and it is added at checkout, so the advertised number stays comparable
 * while the amount actually charged is the lawful one.
 */
export const GST_RATE = 0.18;

/** Seats are unbounded by tier, but a typo should not be able to order 99,999. */
export const MAX_SEATS = 2000;

/** Rupees charged for `seats` on `plan`, inclusive of GST. */
export function priceForSeats(plan: PlanKey, seats: number): { net: number; gst: number; total: number } {
  const net = PLANS[plan].pricePerUser * seats;
  const gst = Math.round(net * GST_RATE);
  return { net, gst, total: net + gst };
}

/**
 * Per-user mailbox quota in bytes, derived from the advertised GB figure in
 * PLANS. This is the value pushed to Flux as `quotas.maxDiskQuota` on account
 * creation — never hard-code byte counts anywhere else.
 */
export const PLAN_STORAGE_BYTES_PER_USER: Record<PlanKey, number> = {
  trial:      PLANS.trial.storageGbPerUser * GB,
  lite:       PLANS.lite.storageGbPerUser * GB,
  starter:    PLANS.starter.storageGbPerUser * GB,
  business:   PLANS.business.storageGbPerUser * GB,
  enterprise: PLANS.enterprise.storageGbPerUser * GB,
};

/**
 * Capabilities that are gated per tier, kept beside PLANS so that what the
 * pricing copy in `features` advertises and what the API actually enforces
 * cannot drift apart.
 *
 * `teamAliases` covers both per-mailbox aliases and shared distribution list
 * addresses — the two things "Team aliases" is sold as.
 */
export const PLAN_CAPABILITIES: Record<PlanKey, { teamAliases: boolean }> = {
  trial:      { teamAliases: false },
  lite:       { teamAliases: false },
  starter:    { teamAliases: false },
  business:   { teamAliases: true },
  enterprise: { teamAliases: true },
};

export function planSupportsTeamAliases(plan: PlanKey): boolean {
  return PLAN_CAPABILITIES[plan].teamAliases;
}

/**
 * Ceiling on aliases per mailbox and members per distribution list. Not a sold
 * limit — just a guard so one organisation cannot fill the mail server's global
 * address index.
 */
export const MAX_ALIASES_PER_ACCOUNT = 25;
export const MAX_LIST_RECIPIENTS = 200;

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
 * Resolves the limits in force for a subscription.
 *
 * Under per-seat pricing the two inputs no longer compete: `subscriptions.plan`
 * decides storage, domains and features, while `subscriptions.max_users` is simply
 * the number of seats bought and paid for. It is therefore taken at face value —
 * the old logic promoted an org to a more expensive tier's storage whenever its
 * seat count exceeded that tier's cap, which under this model would hand out free
 * upgrades to anyone who bought enough seats.
 *
 * An unknown plan string still falls back to the most restrictive tier.
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
    ? Math.min(Math.floor(sub.max_users), MAX_SEATS)
    : PLANS[plan].includedUsers;

  return {
    plan,
    maxUsers,
    maxDomains: PLANS[plan].maxDomains,
    storageBytesPerUser: PLAN_STORAGE_BYTES_PER_USER[plan],
  };
}
