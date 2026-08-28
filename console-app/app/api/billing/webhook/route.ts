import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { PLANS } from '@/lib/plans';

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (secret) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    if (expected !== signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
  }

  let event: { event: string; payload: Record<string, unknown> };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (event.event === 'payment.captured') {
    const payment = (event.payload.payment as { entity?: Record<string, unknown> })?.entity ?? {};
    const notes = payment.notes as Record<string, string> ?? {};
    const orgId = notes.org_id;
    const plan = notes.plan as keyof typeof PLANS;
    const razorpayPaymentId = payment.id as string;

    if (orgId && plan && PLANS[plan]) {
      await query(
        `UPDATE subscriptions
         SET plan = $1, max_users = $2, status = 'active',
             razorpay_payment_id = $3, current_period_end = NOW() + INTERVAL '30 days'
         WHERE org_id = $4`,
        [plan, PLANS[plan].maxUsers, razorpayPaymentId, orgId]
      );
    }
  }

  if (event.event === 'subscription.charged') {
    const sub = (event.payload.subscription as { entity?: Record<string, unknown> })?.entity ?? {};
    const notes = sub.notes as Record<string, string> ?? {};
    const orgId = notes.org_id;
    const plan = notes.plan as keyof typeof PLANS;

    if (orgId && plan && PLANS[plan]) {
      await query(
        `UPDATE subscriptions
         SET status = 'active', current_period_end = NOW() + INTERVAL '30 days'
         WHERE org_id = $1`,
        [orgId]
      );
    }
  }

  return NextResponse.json({ received: true });
}
