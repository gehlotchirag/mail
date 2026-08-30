import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { PLANS } from '@/lib/plans';
import { syncOrgStorageQuotasSafe } from '@/lib/quota';

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set — rejecting all webhook requests');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expected !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: { event: string; payload: Record<string, unknown> };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    if (event.event === 'payment.captured') {
      const payment = (event.payload.payment as { entity?: Record<string, unknown> })?.entity ?? {};
      const notes = payment.notes as Record<string, string> ?? {};
      const orgId = notes.org_id;
      const plan = notes.plan as keyof typeof PLANS;
      const razorpayPaymentId = payment.id as string;

      if (orgId && plan && PLANS[plan]) {
        const changed = await query<{ org_id: string }>(
          `UPDATE subscriptions
           SET plan = $1, max_users = $2, status = 'active',
               razorpay_payment_id = $3, current_period_end = NOW() + INTERVAL '30 days'
           WHERE org_id = $4
           RETURNING org_id`,
          [plan, PLANS[plan].maxUsers, razorpayPaymentId, orgId]
        );
        // The plan drives storage as well as the user cap, so every existing
        // mailbox has to be re-quotaed — otherwise an upgrade or downgrade only
        // ever moved max_users and nobody's storage actually changed.
        if (changed.length) await syncOrgStorageQuotasSafe(orgId, 'payment.captured');
      }
    }

    if (event.event === 'payment.failed') {
      // Payment failed — restore subscription to trial so user isn't left in limbo
      const payment = (event.payload.payment as { entity?: Record<string, unknown> })?.entity ?? {};
      const notes = payment.notes as Record<string, string> ?? {};
      const orgId = notes.org_id;
      if (orgId) {
        const reverted = await query<{ org_id: string }>(
          `UPDATE subscriptions
           SET status = 'trial', plan = 'trial', max_users = $2
           WHERE org_id = $1 AND status = 'pending'
           RETURNING org_id`,
          [orgId, PLANS.trial.maxUsers]
        );
        // Only re-quota if the row actually moved back to trial.
        if (reverted.length) await syncOrgStorageQuotasSafe(orgId, 'payment.failed');
      }
    }

    if (event.event === 'subscription.charged') {
      const sub = (event.payload.subscription as { entity?: Record<string, unknown> })?.entity ?? {};
      const notes = sub.notes as Record<string, string> ?? {};
      const orgId = notes.org_id;
      if (orgId) {
        await query(
          `UPDATE subscriptions
           SET status = 'active', current_period_end = NOW() + INTERVAL '30 days'
           WHERE org_id = $1`,
          [orgId]
        );
      }
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    // Return 200 so Razorpay doesn't retry — log the error for manual investigation
  }

  return NextResponse.json({ received: true });
}
