'use client';
import { useState, useEffect } from 'react';

interface Subscription { plan: string; status: string; max_users: number; trial_ends_at?: string; }
interface PlanInfo { name: string; price: number; maxUsers: number; }
type Plans = Record<string, PlanInfo>;

const PLAN_FEATURES: Record<string, string[]> = {
  trial:      ['3 email users', '14-day free trial', 'All core features', 'Email support'],
  starter:    ['10 email users', 'Custom domain', 'All core features', 'Email support'],
  business:   ['50 email users', 'Custom domain', 'All core features', 'Priority support'],
  enterprise: ['Unlimited users', 'Multiple domains', 'All core features', 'Dedicated support'],
};

const PLAN_COLOR: Record<string, string> = {
  trial: '#64748b', starter: '#2563eb', business: '#1d4ed8', enterprise: '#f59e0b',
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
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/billing').then(r => r.json() as Promise<{ subscription: Subscription; plans: Plans }>).then(d => {
      setSub(d.subscription); setPlans(d.plans); setLoading(false);
    });
  }, []);

  const trialDays = sub?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000))
    : 0;

  async function startCheckout(planKey: string) {
    setUpgrading(planKey); setError('');
    const res = await fetch('/api/billing/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planKey }),
    });
    setUpgrading(null);
    if (!res.ok) {
      const d = await res.json() as { error: string };
      setError(d.error ?? 'Payment gateway not configured yet. Contact support.');
      setTimeout(() => setError(''), 7000);
      return;
    }
    const { orderId, amount, keyId, orgName, email } = await res.json() as { orderId: string; amount: number; keyId: string; orgName: string; email: string };
    if (!window.Razorpay) {
      setError('Razorpay not loaded. Please refresh the page.');
      return;
    }
    const rzp = new window.Razorpay({
      key: keyId, amount, currency: 'INR', order_id: orderId,
      name: 'Arham Workspace', description: `${plans[planKey]?.name ?? planKey} Plan`,
      prefill: { name: orgName, email },
      theme: { color: '#2563eb' },
      handler: async () => {
        setMsg('Payment successful! Your plan will be updated shortly.');
        setTimeout(() => setMsg(''), 8000);
        const r = await fetch('/api/billing'); if (r.ok) { const d = await r.json() as { subscription: Subscription; plans: Plans }; setSub(d.subscription); }
      },
    });
    rzp.open();
  }

  if (loading) return <div style={{ color: '#3b5f8a', padding: '2rem' }}>Loading…</div>;

  const planKeys = Object.keys(plans).filter(k => k !== 'trial');

  return (
    <div>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f2040',  letterSpacing: '-0.5px' }}>Billing & Plans</h1>
        <p style={{ color: '#3b5f8a', marginTop: '.25rem', fontSize: '0.875rem' }}>Manage your subscription</p>
      </div>

      {msg && <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#16a34a', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {/* Current plan */}
      <div style={{ ...S.card, marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#3b5f8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.5rem' }}>Current plan</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: PLAN_COLOR[sub?.plan ?? 'trial'], textTransform: 'capitalize' }}>
            {plans[sub?.plan ?? 'trial']?.name ?? sub?.plan}
          </span>
          <span style={{ padding: '.25rem .7rem', borderRadius: 6, background: sub?.status === 'trial' ? 'rgba(251,191,36,.12)' : 'rgba(22,163,74,.12)', color: sub?.status === 'trial' ? '#fbbf24' : '#16a34a', fontSize: '0.75rem', fontWeight: 700 }}>
            {sub?.status === 'trial' ? `Trial — ${trialDays} day${trialDays !== 1 ? 's' : ''} left` : 'Active'}
          </span>
        </div>
        <div style={{ color: '#3b5f8a', fontSize: '0.875rem', marginTop: '.5rem' }}>
          {sub?.max_users} email users · {sub?.status === 'trial' && sub.trial_ends_at ? `Expires ${new Date(sub.trial_ends_at).toLocaleDateString()}` : 'Billed monthly'}
        </div>
      </div>

      {/* Plan cards */}
      <h2 style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '1rem', fontSize: '1rem' }}>Choose a plan</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        {planKeys.map(key => {
          const p = plans[key];
          const isCurrent = sub?.plan === key;
          const features = PLAN_FEATURES[key] ?? [];
          const color = PLAN_COLOR[key] ?? '#2563eb';
          return (
            <div key={key} style={{ ...S.card, borderColor: isCurrent ? color : '#eff6ff', position: 'relative' }}>
              {isCurrent && (
                <div style={{ position: 'absolute', top: -1, right: -1, background: color, color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '.2rem .55rem', borderRadius: '0 10px 0 8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>Current</div>
              )}
              {key === 'business' && !isCurrent && (
                <div style={{ position: 'absolute', top: -1, right: -1, background: '#1d4ed8', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '.2rem .55rem', borderRadius: '0 10px 0 8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>Popular</div>
              )}
              <div style={{ fontWeight: 700, color: color, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.5rem' }}>{p.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '.25rem', marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f2040' }}>₹{p.price}</span>
                <span style={{ color: '#3b5f8a', fontSize: '0.8rem' }}>/month</span>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {features.map(f => (
                  <li key={f} style={{ color: '#7fa8d0', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <span style={{ color: '#16a34a', flexShrink: 0 }}>✓</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => !isCurrent && startCheckout(key)}
                style={S.btn(color, isCurrent)}
                disabled={isCurrent || upgrading === key}
              >
                {upgrading === key ? 'Redirecting…' : isCurrent ? 'Current plan' : `Upgrade to ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(37,99,235,.05)', border: '1px solid rgba(37,99,235,.15)', borderRadius: 10 }}>
        <p style={{ color: '#3b5f8a', fontSize: '0.82rem', margin: 0 }}>
          Payments are processed securely via Razorpay. All prices are in INR and billed monthly.
          Cancel any time — your plan stays active until the end of the billing period.
          Need a custom quote? <a href="mailto:support@arhamworkspace.tech" style={{ color: '#2563eb' }}>Contact us</a>.
        </p>
      </div>
    </div>
  );
}
