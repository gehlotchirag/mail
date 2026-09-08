import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { cancelSubscription } from '@/lib/razorpay';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sub = await queryOne<{ razorpay_subscription_id: string | null; status: string }>(
    'SELECT razorpay_subscription_id, status FROM subscriptions WHERE org_id = $1', [session.orgId]
  );
  if (!sub?.razorpay_subscription_id) {
    return NextResponse.json({ error: 'There is no paid subscription to cancel.' }, { status: 400 });
  }
  if (sub.status === 'cancelled') {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // Cancel at the end of the paid period, not immediately — they have paid through
  // this cycle and their mail must keep working until it ends. The row is left
  // alone; `subscription.cancelled` from the webhook is what marks it, so the
  // dashboard never claims a cancellation the gateway did not confirm.
  const res = await cancelSubscription(sub.razorpay_subscription_id, true);
  if (!res.ok) {
    return NextResponse.json({ error: `Could not cancel: ${res.error}` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    message: 'Your subscription will not renew. Mail keeps working until the end of the period you have paid for.',
  });
}
