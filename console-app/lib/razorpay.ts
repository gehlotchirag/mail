import { PLANS, GST_RATE, type PlanKey } from './plans';

/**
 * Razorpay Subscription plan IDs, one per paid tier. These are account-scoped and
 * differ between test and live mode, so they are overridable by environment; the
 * defaults are the live plans created for Arham Workspace.
 */
export const RAZORPAY_PLAN_IDS: Record<Exclude<PlanKey, 'trial'>, string> = {
  lite:       process.env.RAZORPAY_PLAN_LITE       ?? 'plan_TYLaPbkzrdJMgN',
  starter:    process.env.RAZORPAY_PLAN_STARTER    ?? 'plan_TYLfoQ8MtfikPM',
  business:   process.env.RAZORPAY_PLAN_BUSINESS   ?? 'plan_TYLj9vnX30SHjm',
  enterprise: process.env.RAZORPAY_PLAN_ENTERPRISE ?? 'plan_TYLi7kvn878dDO',
};

/** Monthly cycles a new subscription is authorised for — ~10 years. */
export const TOTAL_BILLING_CYCLES = 120;

function auth(): string | null {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) return null;
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

export function razorpayConfigured(): boolean {
  return auth() !== null;
}

interface RzpError { error?: { description?: string; code?: string } }

async function rzp<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const a = auth();
  if (!a) return { ok: false, error: 'Payment gateway not configured.' };
  let res: Response;
  try {
    res = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: a, ...(init?.headers ?? {}) },
    });
  } catch (e) {
    return { ok: false, error: `Could not reach Razorpay: ${e instanceof Error ? e.message : 'network error'}` };
  }
  const body = await res.json().catch(() => ({})) as T & RzpError;
  if (!res.ok) {
    const desc = body.error?.description ?? `Razorpay returned ${res.status}`;
    return { ok: false, error: desc };
  }
  return { ok: true, data: body as T };
}

export interface RzpPlan {
  id: string;
  period: string;
  interval: number;
  item: { name: string; amount: number; currency: string };
}

export function getPlan(planId: string) {
  return rzp<RzpPlan>(`/plans/${planId}`);
}

/**
 * Whether a Razorpay plan's per-seat amount agrees with what this codebase
 * advertises, and on which convention.
 *
 * Razorpay charges exactly `plan.item.amount × quantity` — it applies no tax of its
 * own. So the plan amount is the single source of truth for what a customer is
 * actually billed, and it can only mean one of two things: the ex-GST price we
 * display, or that price with GST already folded in. Anything else means the
 * console would quote one number and the gateway would take another, which is the
 * one outcome worth blocking a sale over.
 */
export type AmountVerdict =
  // `inclGstPaise` is what the plan would need to be worth for GST to be collected —
  // the number an operator has to act on, not the one already configured.
  | { kind: 'ex-gst'; expectedPaise: number; inclGstPaise: number }
  | { kind: 'incl-gst'; expectedPaise: number }
  | { kind: 'mismatch'; exGstPaise: number; inclGstPaise: number; actualPaise: number };

export function classifyPlanAmount(plan: Exclude<PlanKey, 'trial'>, actualPaise: number): AmountVerdict {
  const exGst = PLANS[plan].pricePerUser * 100;
  const inclGst = Math.round(PLANS[plan].pricePerUser * (1 + GST_RATE) * 100);
  if (actualPaise === exGst) return { kind: 'ex-gst', expectedPaise: exGst, inclGstPaise: inclGst };
  // A rupee of slack: GST on an odd price does not land on a whole rupee, and the
  // dashboard only accepts two decimal places.
  if (Math.abs(actualPaise - inclGst) <= 100) return { kind: 'incl-gst', expectedPaise: inclGst };
  return { kind: 'mismatch', exGstPaise: exGst, inclGstPaise: inclGst, actualPaise };
}

export interface RzpSubscription {
  id: string;
  status: string;
  plan_id: string;
  quantity: number;
  short_url?: string;
  current_end?: number;
  notes?: Record<string, string>;
}

export function createSubscription(body: {
  plan_id: string;
  quantity: number;
  total_count: number;
  notes: Record<string, string>;
}) {
  return rzp<RzpSubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ ...body, customer_notify: 1 }),
  });
}

/**
 * Changes the tier or seat count on a running subscription. `schedule_change_at:
 * 'now'` makes Razorpay raise a pro-rated invoice immediately rather than parking
 * the change until the next cycle, which is what someone clicking "add seats"
 * expects — they want the mailbox today.
 */
export function updateSubscription(subscriptionId: string, body: { plan_id?: string; quantity?: number }) {
  return rzp<RzpSubscription>(`/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...body, schedule_change_at: 'now' }),
  });
}

export function cancelSubscription(subscriptionId: string, atCycleEnd = true) {
  return rzp<RzpSubscription>(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancel_at_cycle_end: atCycleEnd ? 1 : 0 }),
  });
}

/**
 * Which convention the configured Razorpay plans are priced on.
 *
 * Razorpay plans are immutable once created, so this cannot be corrected in the
 * dashboard — it can only be read and told the truth about. The billing page uses
 * it to label prices with what the customer will actually be charged, instead of
 * asserting a tax that the gateway may not be collecting.
 */
export type GstMode = 'ex-gst' | 'incl-gst' | 'mixed' | 'unknown';

let cached: { mode: GstMode; at: number } | null = null;
const CACHE_MS = 5 * 60_000;

export async function getPlanPricingMode(): Promise<GstMode> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.mode;

  const entries = Object.entries(RAZORPAY_PLAN_IDS) as [Exclude<PlanKey, 'trial'>, string][];
  const verdicts = await Promise.all(entries.map(async ([key, id]) => {
    const res = await getPlan(id);
    if (!res.ok) return null;
    return classifyPlanAmount(key, res.data.item.amount).kind;
  }));

  const known = verdicts.filter((v): v is 'ex-gst' | 'incl-gst' | 'mismatch' => v !== null);
  let mode: GstMode;
  if (known.length === 0) mode = 'unknown';
  else if (known.some(v => v === 'mismatch')) mode = 'mixed';
  else if (known.every(v => v === 'ex-gst')) mode = 'ex-gst';
  else if (known.every(v => v === 'incl-gst')) mode = 'incl-gst';
  else mode = 'mixed';

  // Only a complete, consistent reading is worth caching; a partial one should be
  // retried rather than pinned for five minutes.
  if (mode !== 'unknown' && known.length === entries.length) cached = { mode, at: Date.now() };
  return mode;
}
