import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';
import { PLANS, MAX_SEATS, GST_RATE, isPlanKey, type PlanKey } from '@/lib/plans';
import { countOrgMailboxes } from '@/lib/subscription';
import {
  RAZORPAY_PLAN_IDS, TOTAL_BILLING_CYCLES, razorpayConfigured,
  getPlan, classifyPlanAmount, createSubscription, updateSubscription,
} from '@/lib/razorpay';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan, seats } = await req.json() as { plan?: string; seats?: number };
  if (!plan || !isPlanKey(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  if (plan === 'trial') return NextResponse.json({ error: 'Cannot checkout trial plan' }, { status: 400 });
  // Lite is the free-for-a-year signup incentive (see app/api/auth/signup/route.ts)
  // — it is granted once, automatically, at signup and is never for sale. Without
  // this an org could "buy" Lite here for ₹40/seat against a Razorpay plan that may
  // not even exist, or — worse — an already-paying org could downgrade into what
  // is meant to be a one-time new-signup offer.
  if (plan === 'lite') {
    return NextResponse.json({
      error: 'Lite is a free first-year offer for new signups and isn’t available to switch into — choose Starter or above to upgrade from here.',
    }, { status: 400 });
  }
  const paidPlan = plan as Exclude<PlanKey, 'trial'>;

  // Plans are sold by the seat, so a checkout without a seat count has no price.
  const wanted = Math.floor(Number(seats));
  if (!Number.isFinite(wanted) || wanted < 1) {
    return NextResponse.json({ error: 'Choose how many mailboxes you need' }, { status: 400 });
  }
  if (wanted > MAX_SEATS) {
    return NextResponse.json(
      { error: `That is more than ${MAX_SEATS} seats — contact us and we will quote it properly.` },
      { status: 400 },
    );
  }

  // Buying fewer seats than the organisation is already using would leave existing
  // mailboxes over the cap with no way to bring them back under it except deleting
  // people's mail. Refuse at the till instead, and say what the floor is.
  const inUse = await countOrgMailboxes(session.orgId);
  if (wanted < inUse) {
    return NextResponse.json({
      error: `You already have ${inUse} mailbox${inUse === 1 ? '' : 'es'}. `
           + `Buy at least ${inUse} seats, or delete the ones you no longer need first.`,
      seatsInUse: inUse,
    }, { status: 400 });
  }

  if (!razorpayConfigured()) {
    return NextResponse.json({ error: 'Payment gateway not configured. Please contact support.' }, { status: 503 });
  }

  const planId = RAZORPAY_PLAN_IDS[paidPlan];
  if (!planId) {
    return NextResponse.json({ error: `No Razorpay plan is configured for "${plan}".` }, { status: 503 });
  }

  // Razorpay bills `plan.item.amount × quantity` and adds no tax of its own, so the
  // gateway — not this codebase — decides what the customer actually pays. Read the
  // plan back and refuse if it disagrees with the price the console just displayed;
  // quoting one number and charging another is worse than not selling at all.
  const planLookup = await getPlan(planId);
  if (!planLookup.ok) {
    console.error(`[billing] could not read Razorpay plan ${planId}: ${planLookup.error}`);
    return NextResponse.json(
      { error: `Could not verify the price with the payment gateway (${planLookup.error}). Nothing was charged.` },
      { status: 502 },
    );
  }

  const verdict = classifyPlanAmount(paidPlan, planLookup.data.item.amount);
  if (verdict.kind === 'mismatch') {
    console.error(
      `[billing] Razorpay plan ${planId} charges ${verdict.actualPaise} paise/seat, but "${plan}" is advertised at `
      + `${verdict.exGstPaise} ex-GST / ${verdict.inclGstPaise} incl-GST. Refusing checkout until they agree.`
    );
    return NextResponse.json({
      error: 'This plan is misconfigured in our payment gateway, so we have not charged you. '
           + 'Our team has been alerted — please try again shortly.',
    }, { status: 503 });
  }
  if (verdict.kind === 'ex-gst') {
    // Legal exposure rather than a broken checkout, so it warns instead of blocking.
    console.warn(
      `[billing] Razorpay plan ${planId} is priced ex-GST — no GST will be collected on "${plan}". `
      + `Razorpay plans cannot be edited, so collecting it means creating a new plan at `
      + `₹${(verdict.inclGstPaise / 100).toFixed(2)}.`
    );
  }

  // Amounts are derived from the plan Razorpay will actually bill on, not from our
  // own table. When the plans carry no GST, reporting a GST-inclusive total here
  // would have the API promise ₹566 while the gateway took ₹480.
  const perSeatPaise = planLookup.data.item.amount;
  const chargedPaise = perSeatPaise * wanted;
  const charged = chargedPaise / 100;
  const gstIncluded = verdict.kind === 'incl-gst';
  const net = gstIncluded ? Math.round(charged / (1 + GST_RATE)) : charged;
  const gst = gstIncluded ? charged - net : 0;

  const org = await queryOne<{ name: string; owner_email: string }>(
    'SELECT name, owner_email FROM organizations WHERE id = $1', [session.orgId]
  );
  const existing = await queryOne<{ razorpay_subscription_id: string | null; status: string }>(
    'SELECT razorpay_subscription_id, status FROM subscriptions WHERE org_id = $1', [session.orgId]
  );

  const notes = {
    org_id: session.orgId,
    plan,
    seats: String(wanted),
    org_name: org?.name ?? '',
  };

  // An org that is already paying changes tier or seat count on the subscription it
  // has. Creating a second one would leave both mandates live and bill them twice.
  if (existing?.razorpay_subscription_id && existing.status === 'active') {
    const updated = await updateSubscription(existing.razorpay_subscription_id, {
      plan_id: planId,
      quantity: wanted,
    });
    if (!updated.ok) {
      return NextResponse.json({ error: `Could not update your subscription: ${updated.error}` }, { status: 502 });
    }
    // The webhook confirms the change; this row is optimistic but keeps the
    // dashboard honest between the click and the callback.
    await query(
      'UPDATE subscriptions SET plan = $1, max_users = $2 WHERE org_id = $3',
      [plan, wanted, session.orgId],
    );
    return NextResponse.json({
      updated: true, seats: wanted, plan,
      message: `Your plan is now ${PLANS[paidPlan].name} with ${wanted} seat${wanted === 1 ? '' : 's'}. `
             + 'A pro-rated invoice will follow.',
    });
  }

  const created = await createSubscription({
    plan_id: planId,
    quantity: wanted,
    total_count: TOTAL_BILLING_CYCLES,
    notes,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: 502 });
  }

  // Record the mandate before the customer authorises it, so a webhook that arrives
  // before the browser comes back can still be matched to this org.
  //
  // Deliberately does NOT touch `status`: an abandoned checkout must leave the org
  // exactly as it was. Moving it to 'pending' here would take a trial row out of the
  // 'trial' status that getActiveSub uses to enforce the expiry date, handing anyone
  // who opened the payment sheet and closed it an unlimited free account. Only the
  // webhook, which fires on money actually moving, may set 'active'.
  await query(
    'UPDATE subscriptions SET razorpay_subscription_id = $1 WHERE org_id = $2',
    [created.data.id, session.orgId],
  );

  return NextResponse.json({
    subscriptionId: created.data.id,
    seats: wanted,
    net,
    gst,
    gstRate: GST_RATE,
    total: charged,
    gstCollectedByGateway: gstIncluded,
    pricePerUser: PLANS[paidPlan].pricePerUser,
    currency: 'INR',
    keyId: process.env.RAZORPAY_KEY_ID,
    orgName: org?.name ?? '',
    email: org?.owner_email ?? '',
  });
}
