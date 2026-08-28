import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';
import { PLANS } from '@/lib/plans';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan } = await req.json() as { plan?: string };
  if (!plan || !PLANS[plan as keyof typeof PLANS]) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  if (plan === 'trial') return NextResponse.json({ error: 'Cannot checkout trial plan' }, { status: 400 });

  const rzpKey = process.env.RAZORPAY_KEY_ID;
  const rzpSecret = process.env.RAZORPAY_KEY_SECRET;

  if (!rzpKey || !rzpSecret) {
    return NextResponse.json({ error: 'Payment gateway not configured. Please contact support.' }, { status: 503 });
  }

  const planInfo = PLANS[plan as keyof typeof PLANS];
  const org = await queryOne<{ name: string; owner_email: string }>(
    'SELECT name, owner_email FROM organizations WHERE id = $1', [session.orgId]
  );

  // Create Razorpay order (amount in paise)
  const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${rzpKey}:${rzpSecret}`).toString('base64')}`,
    },
    body: JSON.stringify({
      amount: planInfo.price * 100,
      currency: 'INR',
      notes: { org_id: session.orgId, plan, org_name: org?.name },
    }),
  });

  if (!orderRes.ok) {
    const err = await orderRes.json() as { error?: { description?: string } };
    return NextResponse.json({ error: err.error?.description ?? 'Failed to create order' }, { status: 500 });
  }

  const order = await orderRes.json() as { id: string };

  // Update subscription plan (payment will be verified via webhook or manual confirm)
  await query(
    `UPDATE subscriptions SET plan = $1, max_users = $2, status = 'pending' WHERE org_id = $3`,
    [plan, planInfo.maxUsers, session.orgId]
  );

  return NextResponse.json({
    orderId: order.id,
    amount: planInfo.price * 100,
    currency: 'INR',
    keyId: rzpKey,
    orgName: org?.name ?? '',
    email: org?.owner_email ?? '',
  });
}
