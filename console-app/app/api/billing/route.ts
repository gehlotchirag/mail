import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { PLANS } from '@/lib/plans';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sub = await queryOne<{
    plan: string; max_users: number; status: string;
    trial_ends_at: string; razorpay_subscription_id: string;
    current_period_end: string;
  }>('SELECT * FROM subscriptions WHERE org_id = $1', [session.orgId]);

  return NextResponse.json({ subscription: sub, plans: PLANS });
}
