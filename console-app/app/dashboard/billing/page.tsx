'use client';
import { useState, useEffect } from 'react';

interface Subscription { plan: string; status: string; max_users: number; trial_ends_at?: string; }
interface PlanInfo {
  name: string;
  pricePerUser: number;
  storageGbPerUser: number;
  maxDomains: number;
  includedUsers: number;
  features: readonly string[];
}
type Plans = Record<string, PlanInfo>;

const PLAN_COLOR: Record<string, string> = {
  trial: '#64748b', lite: '#0ea5e9', starter: '#2563eb', business: '#1d4ed8', enterprise: '#f59e0b',
};

// What the same mailbox costs at Zoho India (per user/month, ex-GST, annual
// billing), so the saving on each card is a stated comparison rather than a vague
// "cheaper than the competition".
const ZOHO_COMPARISON: Record<string, { plan: string; price: number }> = {
  lite:       { plan: 'Zoho Mail Lite 5GB',  price: 59 },
  starter:    { plan: 'Zoho Mail Lite 10GB', price: 75 },
  business:   { plan: 'Zoho Mail Premium',   price: 199 },
  enterprise: { plan: 'Zoho Workplace Pro',  price: 399 },
};

const S = {
  card: { background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  btn: (c = '#2563eb', outline = false) => ({
    padding: '.65rem 1.4rem', background: outline ? 'transparent' : c, color: outline ? c : '#fff',
    border: `1.5px solid ${c}`, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem', width: '100%',
  }) as React.CSSProperties,
};

declare global { interface Window { Razorpay: new (opts: object) => { open(): void }; } }

export default function BillingPage() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plans>({});
  const [planOrder, setPlanOrder] = useState<string[]>([]);
  const [seatsInUse, setSeatsInUse] = useState(0);
  const [gstRate, setGstRate] = useState(0.18);
  const [gstMode, setGstMode] = useState<'ex-gst' | 'incl-gst' | 'mixed' | 'unknown'>('unknown');
  const [maxSeats, setMaxSeats] = useState(2000);
  const [seats, setSeats] = useState(1);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/billing')
      .then(r => r.json() as Promise<{
        subscription: Subscription; plans: Plans; planOrder: string[];
        seatsInUse: number; gstRate: number; maxSeats: number;
        gstMode: 'ex-gst' | 'incl-gst' | 'mixed' | 'unknown';
      }>)
      .then(d => {
        setSub(d.subscription);
        setPlans(d.plans);
        setPlanOrder(d.planOrder ?? Object.keys(d.plans));
        setSeatsInUse(d.seatsInUse ?? 0);
        setGstRate(d.gstRate ?? 0.18);
        setGstMode(d.gstMode ?? 'unknown');
        setMaxSeats(d.maxSeats ?? 2000);
        // Default to what they already run, so the quote reflects their real bill
        // the moment the page opens.
        setSeats(Math.max(1, d.seatsInUse ?? 0, d.subscription?.max_users ?? 0));
        setLoading(false);
      });
  }, []);

  const trialDays = sub?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000))
    : 0;

  const minSeats = Math.max(1, seatsInUse);

  async function refreshSubscription() {
    const r = await fetch('/api/billing');
    if (!r.ok) return;
    const d = await r.json() as { subscription: Subscription; seatsInUse: number };
    setSub(d.subscription);
    setSeatsInUse(d.seatsInUse ?? 0);
  }

  async function startCheckout(planKey: string) {
    setUpgrading(planKey); setError('');
    const res = await fetch('/api/billing/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planKey, seats }),
    });
    setUpgrading(null);
    if (!res.ok) {
      const d = await res.json() as { error: string };
      setError(d.error ?? 'Payment gateway not configured yet. Contact support.');
      setTimeout(() => setError(''), 7000);
      return;
    }
    const d = await res.json() as {
      subscriptionId?: string; updated?: boolean; message?: string;
      keyId: string; orgName: string; email: string;
    };

    // Changing tier or seat count on a live subscription needs no payment sheet —
    // the mandate already exists and Razorpay raises a pro-rated invoice itself.
    if (d.updated) {
      setMsg(d.message ?? 'Your plan has been updated.');
      setTimeout(() => setMsg(''), 8000);
      await refreshSubscription();
      return;
    }

    if (!window.Razorpay) {
      setError('Razorpay not loaded. Please refresh the page.');
      return;
    }
    const rzp = new window.Razorpay({
      key: d.keyId,
      subscription_id: d.subscriptionId,
      name: 'Arham Workspace',
      description: `${plans[planKey]?.name ?? planKey} — ${seats} mailbox${seats === 1 ? '' : 'es'}`,
      prefill: { name: d.orgName, email: d.email },
      theme: { color: '#2563eb' },
      handler: async () => {
        setMsg('Payment authorised. Your plan will switch over as soon as the first charge settles.');
        setTimeout(() => setMsg(''), 10000);
        await refreshSubscription();
      },
    });
    rzp.open();
  }

  async function cancelPlan() {
    if (!confirm('Cancel your subscription? Mail keeps working until the end of the period you have already paid for.')) return;
    setCancelling(true); setError('');
    const res = await fetch('/api/billing/cancel', { method: 'POST' });
    const d = await res.json() as { message?: string; error?: string };
    setCancelling(false);
    if (!res.ok) { setError(d.error ?? 'Could not cancel.'); setTimeout(() => setError(''), 7000); return; }
    setMsg(d.message ?? 'Your subscription will not renew.');
    setTimeout(() => setMsg(''), 10000);
    await refreshSubscription();
  }

  if (loading) return <div style={{ color: '#3b5f8a', padding: '2rem' }}>Loading…</div>;

  const paidKeys = planOrder.filter(k => k !== 'trial' && plans[k]);

  // Say what will be charged, not what we wish were charged.
  const gstPct = Math.round(gstRate * 100);
  const gstNote = gstMode === 'incl-gst' ? ` · incl. ${gstPct}% GST`
    : gstMode === 'ex-gst' ? ''
    : ` · +${gstPct}% GST`;

  return (
    <div>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f2040', letterSpacing: '-0.5px' }}>Billing &amp; Plans</h1>
        <p style={{ color: '#3b5f8a', marginTop: '.25rem', fontSize: '0.875rem' }}>Pay for the mailboxes you use — nothing per domain.</p>
      </div>

      {msg && <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#16a34a', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {/* Current plan */}
      <div style={{ ...S.card, marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#3b5f8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.5rem' }}>Current plan</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: PLAN_COLOR[sub?.plan ?? 'trial'] }}>
            {plans[sub?.plan ?? 'trial']?.name ?? sub?.plan}
          </span>
          {(() => {
            const st = sub?.status ?? 'trial';
            const label = st === 'trial' ? `Trial — ${trialDays} day${trialDays !== 1 ? 's' : ''} left`
              : st === 'pending'   ? 'Payment retrying'
              : st === 'expired'   ? 'Payment failed'
              : st === 'cancelled' ? 'Cancelled'
              : 'Active';
            const warn = st === 'trial' || st === 'pending';
            const bad = st === 'expired' || st === 'cancelled';
            return (
              <span style={{ padding: '.25rem .7rem', borderRadius: 6, background: bad ? 'rgba(220,38,38,.1)' : warn ? 'rgba(251,191,36,.12)' : 'rgba(22,163,74,.12)', color: bad ? '#b91c1c' : warn ? '#b45309' : '#16a34a', fontSize: '0.75rem', fontWeight: 700 }}>
                {label}
              </span>
            );
          })()}
        </div>
        <div style={{ color: '#3b5f8a', fontSize: '0.875rem', marginTop: '.5rem' }}>
          {sub?.max_users} seat{sub?.max_users === 1 ? '' : 's'} · {seatsInUse} in use
          {sub?.status === 'trial' && sub.trial_ends_at
            ? ` · Expires ${new Date(sub.trial_ends_at).toLocaleDateString()}`
            : ' · Billed monthly, auto-renewing'}
        </div>
        {sub && sub.status !== 'trial' && sub.status !== 'cancelled' && (
          <button
            onClick={cancelPlan}
            disabled={cancelling}
            style={{ marginTop: '.9rem', padding: '.4rem .9rem', background: 'transparent', color: '#b91c1c', border: '1px solid rgba(185,28,28,.35)', borderRadius: 8, fontWeight: 600, fontSize: '0.78rem', cursor: cancelling ? 'default' : 'pointer' }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel subscription'}
          </button>
        )}
      </div>

      {/* Seat picker — one control drives the price on every card below */}
      <div style={{ ...S.card, marginBottom: '1.5rem' }}>
        <label htmlFor="seats" style={{ display: 'block', fontSize: '0.75rem', color: '#3b5f8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.6rem' }}>
          How many mailboxes?
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            id="seats"
            type="number"
            min={minSeats}
            max={maxSeats}
            value={seats}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              setSeats(Number.isFinite(v) ? Math.min(Math.max(v, 1), maxSeats) : 1);
            }}
            onBlur={() => setSeats(s => Math.max(s, minSeats))}
            style={{ width: 110, padding: '.6rem .8rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, color: '#0f2040', fontWeight: 700, fontSize: '1rem' }}
          />
          <span style={{ color: '#7fa8d0', fontSize: '0.82rem' }}>
            {seatsInUse > 0
              ? `You have ${seatsInUse} mailbox${seatsInUse === 1 ? '' : 'es'} today, so ${minSeats} is the minimum.`
              : 'Add or remove seats any time — you are billed for what you hold.'}
          </span>
        </div>
      </div>

      {/* Plan cards */}
      <h2 style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '1rem', fontSize: '1rem' }}>Choose a plan</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem' }}>
        {paidKeys.map(key => {
          const p = plans[key];
          const isCurrent = sub?.plan === key;
          const color = PLAN_COLOR[key] ?? '#2563eb';
          const monthly = p.pricePerUser * seats;
          const zoho = ZOHO_COMPARISON[key];
          const saving = zoho ? Math.round((1 - p.pricePerUser / zoho.price) * 100) : 0;
          return (
            <div key={key} style={{ ...S.card, borderColor: isCurrent ? color : '#eff6ff', position: 'relative' }}>
              {isCurrent && (
                <div style={{ position: 'absolute', top: -1, right: -1, background: color, color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '.2rem .55rem', borderRadius: '0 10px 0 8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>Current</div>
              )}
              {key === 'business' && !isCurrent && (
                <div style={{ position: 'absolute', top: -1, right: -1, background: '#1d4ed8', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '.2rem .55rem', borderRadius: '0 10px 0 8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>Popular</div>
              )}
              <div style={{ fontWeight: 700, color, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.5rem' }}>{p.name}</div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '.25rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f2040' }}>₹{p.pricePerUser}</span>
                <span style={{ color: '#3b5f8a', fontSize: '0.8rem' }}>/mailbox/month</span>
              </div>
              <div style={{ color: '#3b5f8a', fontSize: '0.82rem', marginTop: '.2rem', fontVariantNumeric: 'tabular-nums' }}>
                ₹{monthly.toLocaleString('en-IN')}/month for {seats}{gstNote}
              </div>
              {zoho && saving > 0 && (
                <div style={{ marginTop: '.55rem', display: 'inline-block', background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.25)', color: '#15803d', borderRadius: 6, padding: '.2rem .5rem', fontSize: '0.72rem', fontWeight: 700 }}>
                  {saving}% under {zoho.plan} (₹{zoho.price})
                </div>
              )}

              <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {p.features.map(f => (
                  <li key={f} style={{ color: '#7fa8d0', fontSize: '0.82rem', display: 'flex', alignItems: 'flex-start', gap: '.5rem' }}>
                    <span style={{ color: '#16a34a', flexShrink: 0 }}>✓</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => startCheckout(key)}
                style={S.btn(color, isCurrent)}
                disabled={upgrading === key}
              >
                {upgrading === key
                  ? 'Redirecting…'
                  : isCurrent ? 'Change seat count' : `Switch to ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(37,99,235,.05)', border: '1px solid rgba(37,99,235,.15)', borderRadius: 10 }}>
        <p style={{ color: '#3b5f8a', fontSize: '0.82rem', margin: 0, lineHeight: 1.6 }}>
          Prices are per mailbox per month in INR and billed monthly — Zoho bills its Mail plans annually.
          {gstMode === 'incl-gst' && ` GST at ${gstPct}% is included in the price shown.`}
          {gstMode === 'ex-gst' && ` The price shown is the total charged.`}
          {(gstMode === 'mixed' || gstMode === 'unknown') && ` GST of ${gstPct}% applies where chargeable.`} Domains are never charged for; every paid plan holds up to 30.
          Payments are processed securely via Razorpay. Cancel any time — your plan stays active until the end of the
          billing period. Need more than {maxSeats.toLocaleString('en-IN')} seats?{' '}
          <a href="mailto:support@arhamworkspace.tech" style={{ color: '#2563eb' }}>Contact us</a>.
        </p>
      </div>
    </div>
  );
}
