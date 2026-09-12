'use client';
import { useState, useEffect, useRef } from 'react';
import { BillingStyles } from './billing-theme';

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

// What the same mailbox costs at Zoho India (per user/month, ex-GST, annual
// billing), so the saving on each card is a stated comparison rather than a vague
// "cheaper than the competition".
const ZOHO_COMPARISON: Record<string, { plan: string; price: number }> = {
  lite:       { plan: 'Zoho Mail Lite 5GB',  price: 59 },
  starter:    { plan: 'Zoho Mail Lite 10GB', price: 75 },
  business:   { plan: 'Zoho Mail Premium',   price: 199 },
  enterprise: { plan: 'Zoho Workplace Pro',  price: 399 },
};

function fmtINR(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

/** Total pooled storage across every purchased seat — real arithmetic from
 *  real plan/seat numbers, not a marketing figure. */
function fmtPooledStorage(gbPerUser: number, seats: number): string {
  const totalGb = gbPerUser * seats;
  return totalGb >= 1000 ? `${(totalGb / 1000).toFixed(1)} TB` : `${totalGb.toLocaleString('en-IN')} GB`;
}

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
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const calcRef = useRef<HTMLDivElement>(null);
  const seatInputRef = useRef<HTMLInputElement>(null);

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
      theme: { color: '#2F56FF' },
      handler: async () => {
        setMsg('Payment authorised. Your plan will switch over as soon as the first charge settles.');
        setTimeout(() => setMsg(''), 10000);
        await refreshSubscription();
      },
    });
    rzp.open();
  }

  async function cancelPlan() {
    setShowCancelModal(false);
    setCancelling(true); setError('');
    const res = await fetch('/api/billing/cancel', { method: 'POST' });
    const d = await res.json() as { message?: string; error?: string };
    setCancelling(false);
    if (!res.ok) { setError(d.error ?? 'Could not cancel.'); setTimeout(() => setError(''), 7000); return; }
    setMsg(d.message ?? 'Your subscription will not renew.');
    setTimeout(() => setMsg(''), 10000);
    await refreshSubscription();
  }

  function scrollToCalculator() {
    calcRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
  function focusSeatInput() {
    scrollToCalculator();
    setTimeout(() => { seatInputRef.current?.focus(); seatInputRef.current?.select(); }, 300);
  }

  if (loading) return <div className="billingpage" style={{ color: 'var(--b-muted)', padding: '2rem' }}><BillingStyles />Loading…</div>;

  const paidKeys = planOrder.filter(k => k !== 'trial' && plans[k]);
  const currentPlan = plans[sub?.plan ?? 'trial'];
  const currentPrice = currentPlan?.pricePerUser ?? 0;

  const gstPct = Math.round(gstRate * 100);
  const gstNote = gstMode === 'incl-gst' ? ` · incl. ${gstPct}% GST`
    : gstMode === 'ex-gst' ? ''
    : ` · +${gstPct}% GST`;

  const seatPct = sub?.max_users ? Math.min(100, Math.round((seatsInUse / sub.max_users) * 100)) : 0;
  const target = switchTarget ? plans[switchTarget] : null;

  const paymentFailed = sub?.status === 'expired';
  const paymentRetrying = sub?.status === 'pending';

  return (
    <div className="billingpage">
      <BillingStyles />
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <div className="b-head">
        <h1>Billing &amp; Plans</h1>
        <p>Pay for the mailboxes you use — nothing per domain.</p>
      </div>

      {msg && <div className="b-alert b-alert-success">{msg}</div>}
      {error && <div className="b-alert b-alert-error">{error}</div>}

      {/* Real payment-state banner — sub.status is the same field the small
          badge below reads; elevated here only when it actually needs action. */}
      {(paymentFailed || paymentRetrying) && (
        <div className="b-failbanner">
          <div>
            <div className="b-failbanner-title">{paymentFailed ? 'Payment failed' : 'Payment retrying'}</div>
            <div className="b-failbanner-desc">
              {paymentFailed
                ? 'Your last charge did not go through. Update your payment method with Razorpay or your mail routing may be affected.'
                : 'Razorpay is retrying your last charge. No action needed yet — we’ll update this once it settles.'}
            </div>
          </div>
        </div>
      )}

      {/* Section 1: current plan + seat allocation */}
      <div className="b-toprow">
        <div className="b-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
              <span className="b-eyebrow">Active plan</span>
              {(() => {
                const st = sub?.status ?? 'trial';
                const label = st === 'trial' ? `Trial — ${trialDays} day${trialDays !== 1 ? 's' : ''} left`
                  : st === 'pending'   ? 'Payment retrying'
                  : st === 'expired'   ? 'Payment failed'
                  : st === 'cancelled' ? 'Cancelled'
                  : 'Active';
                const kind = st === 'expired' || st === 'cancelled' ? 'bad' : st === 'trial' || st === 'pending' ? 'warn' : 'ok';
                return <span className={`b-pill ${kind}`}>{label}</span>;
              })()}
            </div>
            <div className="b-planname">{currentPlan?.name ?? sub?.plan}</div>
            <div style={{ color: 'var(--b-muted)', fontSize: '.82rem' }}>
              Billed monthly via Razorpay
            </div>

            <div className="b-substat-grid">
              <div>
                <div className="b-substat-label">Purchased seats</div>
                <div className="b-substat-val">{sub?.max_users ?? 0}</div>
              </div>
              <div>
                <div className="b-substat-label">In use</div>
                <div className="b-substat-val">{seatsInUse}</div>
                <div className="b-substat-sub">{Math.max(0, (sub?.max_users ?? 0) - seatsInUse)} unassigned</div>
              </div>
            </div>

            <div style={{ marginTop: '.75rem', fontSize: '.8rem', color: 'var(--b-ink2)' }}>
              {sub?.status === 'trial' && sub.trial_ends_at
                ? <>Trial expires <strong>{new Date(sub.trial_ends_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}</strong></>
                : <>Auto-renews monthly{currentPrice > 0 && <> · <span className="b-mono">{fmtINR(currentPrice * (sub?.max_users ?? 0))}{gstNote}</span></>}</>}
            </div>
          </div>

          <div className="b-cardfoot">
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
              <button className="b-btn" onClick={scrollToCalculator}>Change plan</button>
              <button className="b-btn" onClick={focusSeatInput}>Change seat count</button>
            </div>
            {sub && sub.status !== 'trial' && sub.status !== 'cancelled' && (
              <button className="b-btn-text" onClick={() => setShowCancelModal(true)} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            )}
          </div>
        </div>

        <div className="b-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
            <div>
              <span className="b-eyebrow">Mailbox seat allocation</span>
              <div style={{ fontWeight: 800, color: 'var(--b-ink)', fontSize: '1.05rem', marginTop: '.2rem' }}>Capacity utilization</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="b-mono" style={{ fontWeight: 800, color: 'var(--b-accent)', fontSize: '1.05rem' }}>{seatsInUse} / {sub?.max_users ?? 0} used</div>
              <div style={{ fontSize: '.75rem', color: 'var(--b-muted)' }}>{seatPct}% of purchased capacity</div>
            </div>
          </div>
          <div className="b-gaugebar"><i style={{ width: `${seatPct}%` }} /></div>
          <div className="b-gaugelabels"><span>0</span><span>{sub?.max_users ?? 0} purchased</span></div>

          <div className="b-chip3">
            <div className="b-chip">
              <div className="b-chip-label">Used mailboxes</div>
              <div className="b-chip-val">{seatsInUse}</div>
            </div>
            <div className="b-chip">
              <div className="b-chip-label">Available headroom</div>
              <div className="b-chip-val" style={{ color: 'var(--b-green)' }}>{Math.max(0, (sub?.max_users ?? 0) - seatsInUse)}</div>
            </div>
            <div className="b-chip">
              <div className="b-chip-label">Pooled quota</div>
              <div className="b-chip-val" style={{ color: 'var(--b-ink)' }}>{currentPlan ? fmtPooledStorage(currentPlan.storageGbPerUser, sub?.max_users ?? 0) : '—'}</div>
              <div className="b-chip-sub">{currentPlan?.storageGbPerUser ?? 0} GB × {sub?.max_users ?? 0} seats</div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: seat calculator */}
      <div className="b-card" ref={calcRef} style={{ marginBottom: '1.25rem' }}>
        <div className="b-cardhead" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.9rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <div>
            <div style={{ fontWeight: 800, color: 'var(--b-ink)', fontSize: '1.05rem' }}>How many mailboxes?</div>
            <p style={{ color: 'var(--b-muted)', fontSize: '.82rem', marginTop: '.2rem' }}>Adjust seat allocation — pricing updates on every plan card below.</p>
          </div>
        </div>
        <div className="b-calc-controls">
          <div className="b-stepper">
            <button type="button" onClick={() => setSeats(s => Math.max(minSeats, s - (s > 500 ? 100 : s > 100 ? 50 : 10)))}>−</button>
            <input
              ref={seatInputRef}
              type="number" min={minSeats} max={maxSeats} value={seats}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                setSeats(Number.isFinite(v) ? Math.min(Math.max(v, 1), maxSeats) : 1);
              }}
              onBlur={() => setSeats(s => Math.max(s, minSeats))}
            />
            <button type="button" onClick={() => setSeats(s => Math.min(maxSeats, s + (s >= 500 ? 100 : s >= 100 ? 50 : 10)))}>+</button>
          </div>
          <span style={{ color: 'var(--b-ink2)', fontSize: '.82rem', fontWeight: 600 }}>mailboxes</span>
          <div className="b-presets" style={{ marginLeft: 'auto' }}>
            {[minSeats, 50, 100, 500, 1000].filter((v, i, arr) => arr.indexOf(v) === i).map(n => (
              <button key={n} className={`b-preset ${seats === n ? 'active' : ''}`} onClick={() => setSeats(Math.max(n, minSeats))}>
                {n.toLocaleString('en-IN')}{n === minSeats && minSeats === seatsInUse ? ' (current)' : ''}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: '.6rem', fontSize: '.78rem', color: 'var(--b-muted)' }}>
          {seatsInUse > 0
            ? `You have ${seatsInUse} mailbox${seatsInUse === 1 ? '' : 'es'} today, so ${minSeats} is the minimum.`
            : 'Add or remove seats any time — you are billed for what you hold.'}
        </div>
      </div>

      {/* Section 3: plan comparison */}
      <div style={{ marginBottom: '.9rem' }}>
        <div style={{ fontWeight: 800, color: 'var(--b-ink)', fontSize: '1.05rem' }}>Choose a plan</div>
        <p style={{ color: 'var(--b-muted)', fontSize: '.82rem', marginTop: '.2rem' }}>All tiers include Indian hosting and up to 30 domains.</p>
      </div>
      <div className="b-plangrid">
        {paidKeys.map(key => {
          const p = plans[key];
          const isCurrent = sub?.plan === key;
          const monthly = p.pricePerUser * seats;
          const zoho = ZOHO_COMPARISON[key];
          const saving = zoho ? Math.round((1 - p.pricePerUser / zoho.price) * 100) : 0;
          return (
            <div key={key} className={`b-plancard ${isCurrent ? 'current' : ''}`}>
              {isCurrent && <div className="b-plantag current">Current</div>}
              {key === 'business' && !isCurrent && <div className="b-plantag popular">Popular</div>}
              <div className="b-planlabel">{p.name}</div>
              <div className="b-planprice"><b>₹{p.pricePerUser}</b><span>/mailbox/month</span></div>
              <div className="b-plantotal">{fmtINR(monthly)}/month for {seats}{gstNote}</div>
              {zoho && saving > 0 && <div className="b-plansaving">{saving}% under {zoho.plan} (₹{zoho.price})</div>}
              <ul className="b-planfeatures">
                {p.features.map(f => <li key={f}>{f}</li>)}
              </ul>
              <button
                className={isCurrent ? 'b-btn' : 'b-btn b-btn-primary'}
                onClick={() => isCurrent ? focusSeatInput() : setSwitchTarget(key)}
                disabled={upgrading === key}
                style={{ width: '100%' }}
              >
                {upgrading === key ? 'Redirecting…' : isCurrent ? 'Change seat count' : `Switch to ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="b-footnote">
        <p>
          Prices are per mailbox per month in INR and billed monthly — Zoho bills its Mail plans annually.
          {gstMode === 'incl-gst' && ` GST at ${gstPct}% is included in the price shown.`}
          {gstMode === 'ex-gst' && ` The price shown is the total charged.`}
          {(gstMode === 'mixed' || gstMode === 'unknown') && ` GST of ${gstPct}% applies where chargeable.`} Domains are never charged for; every paid plan holds up to 30.
          Payments are processed securely via Razorpay. Cancel any time — your plan stays active until the end of the
          billing period. Need more than {maxSeats.toLocaleString('en-IN')} seats?{' '}
          <a href="mailto:support@arhamworkspace.tech">Contact us</a>.
        </p>
      </div>

      {/* Plan switch confirmation modal — real before/after price, real storage diff */}
      {target && switchTarget && (
        <div className="b-modal-overlay" onClick={() => setSwitchTarget(null)}>
          <div className="b-modal" onClick={e => e.stopPropagation()}>
            <h2>Switch to {target.name}?</h2>
            <div className="b-modal-sub">Subscription change preview</div>
            <div className="b-modal-rows">
              <div className="b-modal-row"><span>Path</span><span>{currentPlan?.name ?? sub?.plan} → {target.name}</span></div>
              <div className="b-modal-row"><span>Seat count</span><span className="b-mono">{seats.toLocaleString('en-IN')} mailboxes</span></div>
              <div className="b-modal-row">
                <span>Monthly rate</span>
                <span className="b-mono">
                  <span className="b-strike">{fmtINR(currentPrice * seats)}</span>
                  → {fmtINR(target.pricePerUser * seats)}
                </span>
              </div>
              {target.storageGbPerUser !== currentPlan?.storageGbPerUser && (
                <div className="b-modal-row"><span>Storage / mailbox</span><span>{currentPlan?.storageGbPerUser ?? 0} GB → {target.storageGbPerUser} GB</span></div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem' }}>
              <button className="b-btn" onClick={() => setSwitchTarget(null)}>Cancel</button>
              <button className="b-btn b-btn-primary" onClick={() => { const k = switchTarget; setSwitchTarget(null); startCheckout(k); }}>
                Confirm plan change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div className="b-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="b-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ color: 'var(--b-red)' }}>Cancel subscription?</h2>
            <p style={{ color: 'var(--b-ink2)', fontSize: '.85rem', lineHeight: 1.5, marginBottom: '1rem' }}>
              Mail keeps working until the end of the period you have already paid for. After that, sending and receiving stop until you resubscribe.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem' }}>
              <button className="b-btn" onClick={() => setShowCancelModal(false)}>Keep subscription</button>
              <button className="b-btn" style={{ background: 'var(--b-red)', color: '#fff', borderColor: 'transparent' }} onClick={cancelPlan}>
                Confirm cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
