import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query, queryOne } from '@/lib/db';
import { PLANS, MAX_SEATS, isPlanKey, type PlanKey } from '@/lib/plans';
import { RAZORPAY_PLAN_IDS } from '@/lib/razorpay';
import { syncOrgStorageQuotasSafe } from '@/lib/quota';

/** Razorpay identifies a tier by its own plan id; map it back to ours. */
function planKeyForRazorpayPlan(planId?: string): PlanKey | null {
  if (!planId) return null;
  const hit = (Object.entries(RAZORPAY_PLAN_IDS) as [PlanKey, string][])
    .find(([, id]) => id === planId);
  return hit ? hit[0] : null;
}

interface SubEntity {
  id?: string;
  plan_id?: string;
  quantity?: number;
  current_end?: number;
  notes?: Record<string, string>;
}

/**
 * Resolves which organisation an event belongs to. The subscription id is the
 * reliable link — it was written to the row before the customer ever authorised
 * the mandate — with the notes as a fallback for anything created out of band.
 */
async function resolveOrgId(sub: SubEntity): Promise<string | null> {
  if (sub.id) {
    const row = await queryOne<{ org_id: string }>(
      'SELECT org_id FROM subscriptions WHERE razorpay_subscription_id = $1', [sub.id]
    );
    if (row) return row.org_id;
  }
  return sub.notes?.org_id ?? null;
}

function seatsFrom(sub: SubEntity, plan: PlanKey): number {
  // Razorpay's own quantity is what it bills on, so it outranks our notes.
  const q = Math.floor(Number(sub.quantity));
  if (Number.isFinite(q) && q > 0) return Math.min(q, MAX_SEATS);
  const noted = Math.floor(Number(sub.notes?.seats));
  if (Number.isFinite(noted) && noted > 0) return Math.min(noted, MAX_SEATS);
  return PLANS[plan].includedUsers;
}

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set — rejecting all webhook requests');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  // Constant-time compare; a length mismatch would make timingSafeEqual throw.
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: { event: string; payload: Record<string, unknown> };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const name = event.event;
    if (!name.startsWith('subscription.')) {
      // Payment-level events are noise here: every subscription charge also emits
      // `payment.captured`, and acting on both would apply the same change twice.
      return NextResponse.json({ received: true });
    }

    const sub = (event.payload.subscription as { entity?: SubEntity })?.entity ?? {};
    const orgId = await resolveOrgId(sub);
    if (!orgId) {
      console.warn(`[billing] ${name} could not be matched to an organisation (subscription ${sub.id ?? 'unknown'})`);
      return NextResponse.json({ received: true });
    }

    const notedPlan = sub.notes?.plan;
    const plan = planKeyForRazorpayPlan(sub.plan_id)
      ?? (notedPlan && isPlanKey(notedPlan) ? notedPlan : null);

    if (name === 'subscription.activated' || name === 'subscription.charged' || name === 'subscription.updated') {
      if (!plan) {
        console.error(`[billing] ${name}: unrecognised Razorpay plan "${sub.plan_id}" — subscription left untouched`);
        return NextResponse.json({ received: true });
      }
      const seats = seatsFrom(sub, plan);
      // Razorpay reports the paid-through date; trust it over a fixed 30-day guess,
      // which drifted a little further from the real cycle every month.
      const periodEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null;

      const changed = await query<{ org_id: string }>(
        `UPDATE subscriptions
            SET plan = $1, max_users = $2, status = 'active',
                razorpay_subscription_id = COALESCE($3, razorpay_subscription_id),
                current_period_end = COALESCE($4::timestamptz, NOW() + INTERVAL '30 days')
          WHERE org_id = $5
          RETURNING org_id`,
        [plan, seats, sub.id ?? null, periodEnd, orgId]
      );
      // The plan drives storage as well as the seat cap, so every existing mailbox
      // has to be re-quotaed — otherwise a tier change only moved max_users and
      // nobody's storage actually changed.
      if (changed.length) await syncOrgStorageQuotasSafe(orgId, name);
      console.log(`[billing] ${name}: org ${orgId} → ${plan}, ${seats} seats`);
      return NextResponse.json({ received: true });
    }

    if (name === 'subscription.pending') {
      // A charge failed and Razorpay is retrying. Service continues during the retry
      // window — cutting mail off on the first failed card is how you lose a customer
      // over an expired card.
      await query(`UPDATE subscriptions SET status = 'pending' WHERE org_id = $1`, [orgId]);
      console.warn(`[billing] subscription.pending: payment failing for org ${orgId}`);
      return NextResponse.json({ received: true });
    }

    if (name === 'subscription.halted') {
      // Retries exhausted.
      await query(`UPDATE subscriptions SET status = 'expired' WHERE org_id = $1`, [orgId]);
      console.warn(`[billing] subscription.halted: org ${orgId} is no longer paying`);
      return NextResponse.json({ received: true });
    }

    if (name === 'subscription.cancelled' || name === 'subscription.completed') {
      await query(`UPDATE subscriptions SET status = 'cancelled' WHERE org_id = $1`, [orgId]);
      console.log(`[billing] ${name}: org ${orgId}`);
      return NextResponse.json({ received: true });
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    // Return 200 so Razorpay doesn't retry — log the error for manual investigation
  }

  return NextResponse.json({ received: true });
}
