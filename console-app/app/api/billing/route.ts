import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { PLANS, PLAN_ORDER, GST_RATE, MAX_SEATS } from '@/lib/plans';
import { countOrgMailboxes } from '@/lib/subscription';
import { getPlanPricingMode } from '@/lib/razorpay';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sub = await queryOne<{
    plan: string; max_users: number; status: string;
    trial_ends_at: string; razorpay_subscription_id: string;
    current_period_end: string;
  }>('SELECT * FROM subscriptions WHERE org_id = $1', [session.orgId]);

  // The seat picker cannot offer fewer seats than the org is already using, so the
  // floor is sent with the plans rather than discovered on a rejected checkout.
  const seatsInUse = await countOrgMailboxes(session.orgId);

  // What the gateway will actually charge decides how the price is labelled. If the
  // Razorpay plans carry no GST, the page must not print "+18% GST" beside a number
  // nobody will be asked to pay on top of.
  const gstMode = await getPlanPricingMode();

  return NextResponse.json({
    subscription: sub,
    plans: PLANS,
    planOrder: PLAN_ORDER,
    seatsInUse,
    gstRate: GST_RATE,
    gstMode,
    maxSeats: MAX_SEATS,
  });
}
