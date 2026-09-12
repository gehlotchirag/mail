'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { resolvePlanLimits, type PlanKey } from '@/lib/plans';
import { DomainsStyles } from './domains-theme';

interface Domain {
  id: string; domain: string; verified: boolean; verify_token: string; flux_domain_id?: string;
  /**
   * true: mail routes here. false: verified but MX points elsewhere — every
   * message from outside the platform is still landing at the old provider.
   * null: could not be checked (no MX, DNS lookup failed) — distinct from false
   * so an unverified/new domain never gets accused of "mail not switched".
   */
  mxLive?: boolean | null;
  /** The actual MX exchange hosts this domain currently resolves to, lowest priority first. */
  mxHosts?: string[] | null;
  /** true = SES will accept mail from this domain; false = outbound bounces; null = unknown. */
  sendingReady?: boolean | null;
  /** PENDING | SUCCESS | FAILED | TEMPORARY_FAILURE | undefined (no identity yet) */
  dkimStatus?: string | null;
}

interface FluxUserLite { id: string; emailAddress: string; usedDiskQuota?: number }
interface UsersByDomain { domainId: string; domain: string; users: FluxUserLite[] }

const PROVIDER_META: Record<string, { label: string; color: string; logo: string }> = {
  cloudflare:   { label: 'Cloudflare',     color: '#f97316', logo: '🟠' },
  godaddy:      { label: 'GoDaddy',        color: '#1aad1a', logo: '🟢' },
  digitalocean: { label: 'DigitalOcean',   color: '#0069ff', logo: '🔵' },
  porkbun:      { label: 'Porkbun',        color: '#ef4444', logo: '🐷' },
  namecheap:    { label: 'Namecheap',      color: '#de3723', logo: '🔴' },
  route53:      { label: 'AWS Route 53',   color: '#ff9900', logo: '🟡' },
  squarespace:  { label: 'Squarespace',    color: '#555555', logo: '⬛' },
};

async function detectDnsProvider(domain: string): Promise<string | null> {
  if (!domain.includes('.')) return null;
  try {
    const apex = domain.split('.').slice(-2).join('.');
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(apex)}&type=NS`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) return null;
    const data = await res.json() as { Answer?: { data: string }[] };
    const ns = (data.Answer ?? []).map(r => r.data.toLowerCase()).join(' ');
    if (ns.includes('cloudflare'))   return 'cloudflare';
    if (ns.includes('domaincontrol') || ns.includes('godaddy')) return 'godaddy';
    if (ns.includes('registrar-servers') || ns.includes('namecheap')) return 'namecheap';
    if (ns.includes('awsdns'))       return 'route53';
    if (ns.includes('digitalocean')) return 'digitalocean';
    if (ns.includes('porkbun'))      return 'porkbun';
    if (ns.includes('squarespace') || ns.includes('google')) return 'squarespace';
    return null;
  } catch { return null; }
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function initials(domain: string): string {
  const parts = domain.split('.');
  return (parts[0].slice(0, 2) || domain.slice(0, 2)).toUpperCase();
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const WarnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);

function dkimLabel(status: string | null | undefined): { text: string; ok: boolean | null } {
  switch (status) {
    case 'SUCCESS': return { text: 'Verified', ok: true };
    case 'PENDING': return { text: 'Pending', ok: false };
    case 'FAILED': return { text: 'Failed', ok: false };
    case 'TEMPORARY_FAILURE': return { text: 'Retry pending', ok: false };
    default: return { text: 'Not started', ok: null };
  }
}

type FilterKey = 'all' | 'attention' | 'ready' | 'notrouted' | 'pending';

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [usersByDomain, setUsersByDomain] = useState<UsersByDomain[]>([]);
  const [planLimits, setPlanLimits] = useState<{ planName: string; maxDomains: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  // Hitting a plan limit is not an error the user did something wrong — it is an
  // upsell moment. Surfaced as a modal with a route to billing rather than a red
  // banner that disappears after 5 seconds.
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [domainsRes, usersRes, billingRes] = await Promise.all([
      fetch('/api/domains'),
      fetch('/api/users'),
      fetch('/api/billing'),
    ]);
    if (domainsRes.ok) { const d = await domainsRes.json() as { domains: Domain[] }; setDomains(d.domains); }
    if (usersRes.ok) { const d = await usersRes.json() as { domains: UsersByDomain[] }; setUsersByDomain(d.domains); }
    if (billingRes.ok) {
      const d = await billingRes.json() as { subscription: { plan: string; max_users: number } | null };
      if (d.subscription) {
        const limits = resolvePlanLimits(d.subscription);
        const PLAN_NAMES: Record<PlanKey, string> = {
          trial: 'Free Trial', lite: 'Lite', starter: 'Starter', business: 'Business', enterprise: 'Enterprise',
        };
        setPlanLimits({ planName: PLAN_NAMES[limits.plan], maxDomains: limits.maxDomains });
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Detect DNS provider as user types
  useEffect(() => {
    if (!newDomain || !newDomain.includes('.')) { setDetected(null); return; }
    setDetecting(true);
    const t = setTimeout(async () => {
      const p = await detectDnsProvider(newDomain);
      setDetected(p); setDetecting(false);
    }, 650);
    return () => { clearTimeout(t); setDetecting(false); };
  }, [newDomain]);

  const mailboxCountByDomainId = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of usersByDomain) m.set(d.domainId, d.users.length);
    return m;
  }, [usersByDomain]);
  const totalMailboxes = usersByDomain.reduce((n, d) => n + d.users.length, 0);

  const rows = useMemo(() => domains.map(d => {
    const dkim = dkimLabel(d.dkimStatus);
    const needsAttention = d.verified && (d.sendingReady === false || d.mxLive === false);
    return { ...d, dkim, needsAttention, mailboxCount: mailboxCountByDomainId.get(d.id) ?? 0 };
  }), [domains, mailboxCountByDomainId]);

  const attentionRows = rows.filter(r => r.needsAttention);
  const readyCount = rows.filter(r => r.sendingReady === true).length;

  const filtered = rows.filter(r => {
    if (search.trim() && !r.domain.toLowerCase().includes(search.trim().toLowerCase())) return false;
    switch (filter) {
      case 'attention': return r.needsAttention;
      case 'ready': return r.sendingReady === true;
      case 'notrouted': return r.verified && r.mxLive === false;
      case 'pending': return r.dkim.ok === false;
      default: return true;
    }
  });

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    const res = await fetch('/api/domains', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: newDomain }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json() as { id?: string };
      if (data.id) {
        window.location.href = `/dashboard/domains/${data.id}`;
      } else {
        setShowAdd(false); setNewDomain(''); setDetected(null); load();
        setMsg('Domain added! Click "Manage" to continue setup.'); setTimeout(() => setMsg(''), 6000);
      }
    } else {
      const d = await res.json() as { error?: string; limitReached?: boolean };
      if (d.limitReached) {
        setShowAdd(false);
        setLimitMsg(d.error ?? 'You have reached the domain limit for your plan.');
        return;
      }
      setError(d.error ?? 'Failed'); setTimeout(() => setError(''), 5000);
    }
  }

  const meta = detected ? PROVIDER_META[detected] : null;

  return (
    <div className="domainspage">
      <DomainsStyles />

      <div className="d-crumb">
        <span>Workspace</span>
        <ArrowIcon />
        <b>Domains</b>
      </div>

      <div className="d-head">
        <div className="d-h1">
          <span>Domains</span>
          <span className="d-count">{domains.length} registered</span>
        </div>
        <div className="d-headactions">
          <button className="d-btn d-btn-primary" onClick={() => { setShowAdd(!showAdd); setDetected(null); }}>
            <span>+</span> Add Domain
          </button>
        </div>
      </div>

      {msg && <div style={{ background: 'var(--d-green-soft)', border: '1px solid #BFE5D2', borderRadius: 10, padding: '.75rem 1rem', color: 'var(--d-green)', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>{msg}</div>}
      {error && <div style={{ background: 'var(--d-red-soft)', border: '1px solid #F3C6C4', borderRadius: 10, padding: '.75rem 1rem', color: 'var(--d-red)', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>{error}</div>}

      {limitMsg && (
        <div
          onClick={() => setLimitMsg(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,40,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}
        >
          <div onClick={e => e.stopPropagation()} className="d-addcard" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '2.25rem', marginBottom: '.75rem' }}>🚀</div>
            <h2 style={{ fontWeight: 800, color: 'var(--d-ink)', fontSize: '1.1rem', marginBottom: '.5rem' }}>
              You&apos;ve reached your plan&apos;s domain limit
            </h2>
            <p style={{ color: 'var(--d-muted)', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '1.25rem' }}>
              {limitMsg}
            </p>
            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/dashboard/billing" className="d-btn d-btn-primary">Upgrade plan →</a>
              <button onClick={() => setLimitMsg(null)} className="d-btn">Not now</button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="d-addcard" style={{ marginBottom: 20 }}>
          <form onSubmit={addDomain}>
            <div className="d-addrow">
              <input className="d-inp" placeholder="yourdomain.com" value={newDomain}
                onChange={e => { setNewDomain(e.target.value.toLowerCase().trim()); setDetected(null); }} required />
              {detecting && <span style={{ fontSize: '0.78rem', color: 'var(--d-muted)', whiteSpace: 'nowrap' }}>⏳ Detecting…</span>}
              {meta && !detecting && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '0.78rem', padding: '.35rem .75rem', borderRadius: 20, background: `${meta.color}12`, color: meta.color, border: `1px solid ${meta.color}33`, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {meta.logo} {meta.label} detected
                </span>
              )}
              <button type="submit" className="d-btn d-btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add domain'}</button>
              <button type="button" className="d-btn" onClick={() => { setShowAdd(false); setDetected(null); }}>Cancel</button>
            </div>
            {planLimits && (
              <div className="d-planinfo">
                <span>Fleet allocation: <b>{domains.length} of {planLimits.maxDomains}</b> domains allowed on your <b>{planLimits.planName}</b> plan.</span>
              </div>
            )}
          </form>
        </div>
      )}

      {!loading && attentionRows.map(r => (
        <div className="d-alert" key={r.id}>
          <span className="d-alert-icon"><WarnIcon /></span>
          <div className="d-alert-body">
            <div className="d-alert-title">
              <span>Mail is not routed to Arham yet</span>
              <span className="d-alert-chip">{r.domain}</span>
            </div>
            <div className="d-alert-desc">
              {r.mxLive === false
                ? `Domain ownership is verified, but MX records point to ${r.mxHosts?.[0] ?? 'another provider'}. Inbound email will not route through Arham until MX is updated.`
                : r.dkim.ok === false
                  ? `Domain ownership is verified, but DKIM keys are ${r.dkim.text.toLowerCase()} — outbound mail cannot send until this resolves.`
                  : 'Sending is not ready for this domain yet — open it to see why.'}
            </div>
          </div>
          <a className="d-alert-cta" href={`/dashboard/domains/${r.id}`}>
            <span>Configure DNS</span> <ArrowIcon />
          </a>
        </div>
      ))}

      <div className="d-metrics">
        <div className="d-metric">
          <div className="d-metric-top"><span>Total Domains</span></div>
          <div className="d-metric-val">{domains.length}</div>
          <div className="d-metric-sub">{rows.filter(r => r.verified).length} verified</div>
        </div>
        <div className="d-metric">
          <div className="d-metric-top"><span>Sending Ready</span></div>
          <div className="d-metric-val">{readyCount}</div>
          <div className="d-metric-sub"><span className="d-metric-tag">sesVerified &amp; production</span></div>
        </div>
        <div className="d-metric">
          <div className="d-metric-top"><span>Needs Attention</span></div>
          <div className={`d-metric-val ${attentionRows.length ? 'warn' : ''}`}>{attentionRows.length}</div>
          <div className="d-metric-sub">
            <span className={`d-metric-tag ${attentionRows.length ? 'warn' : ''}`}>
              {attentionRows.length ? 'MX / DKIM incomplete' : 'All passing'}
            </span>
          </div>
        </div>
        <div className="d-metric">
          <div className="d-metric-top"><span>Mailboxes Configured</span></div>
          <div className="d-metric-val">{totalMailboxes}</div>
          <div className="d-metric-sub">allocated mailboxes</div>
        </div>
      </div>

      <div className="d-filterbar">
        <div className="d-tabs">
          {([
            ['all', `All (${rows.length})`],
            ['attention', `Needs Attention (${attentionRows.length})`],
            ['ready', `Sending Ready (${readyCount})`],
            ['notrouted', `Mail Not Routed (${rows.filter(r => r.verified && r.mxLive === false).length})`],
            ['pending', `DKIM Pending (${rows.filter(r => r.dkim.ok === false).length})`],
          ] as [FilterKey, string][]).map(([key, label]) => (
            <button key={key} className={`d-tab ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <div className="d-search">
          <SearchIcon />
          <input placeholder="Search domains…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="d-group">
        {loading ? (
          <div className="d-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="d-empty">
            <div className="d-empty-icon">🌐</div>
            <div style={{ fontWeight: 700, color: 'var(--d-ink2)', marginBottom: 6 }}>
              {domains.length === 0 ? 'No domains yet' : 'No domains match this filter'}
            </div>
            <div style={{ fontSize: 13 }}>{domains.length === 0 ? 'Add your first domain to start using email.' : 'Try a different filter or search term.'}</div>
          </div>
        ) : (
          <>
            <div className="d-thead">
              <span>Domain</span>
              <span>Ownership</span>
              <span>Mail Routing</span>
              <span>Sending Identity</span>
              <span>DKIM Auth</span>
              <span>Mailboxes</span>
              <span>Action</span>
            </div>
            {filtered.map(r => (
              <div key={r.id} className={`d-row ${r.needsAttention ? 'attn' : ''}`}>
                <div className="d-domain-cell">
                  <div className={`d-favicon ${r.needsAttention ? 'attn' : ''}`}>{initials(r.domain)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="d-domain-name">{r.domain}</span>
                      {r.needsAttention && <span className="d-tag" style={{ background: 'var(--d-red-soft)', color: 'var(--d-red)' }}>Needs Attention</span>}
                    </div>
                    <div className={`d-domain-meta ${r.mxLive === false ? 'attn' : ''}`}>
                      {r.mxLive === false && r.mxHosts?.[0] ? `Points to ${r.mxHosts[0]}` : 'Registered domain'}
                    </div>
                  </div>
                </div>
                {r.verified ? (
                  <span className="d-cell-ok"><CheckIcon /> Verified</span>
                ) : (
                  <span className="d-cell-warn"><WarnIcon /> Pending</span>
                )}
                {r.mxLive === true ? (
                  <span className="d-pill ok">Routed to Arham</span>
                ) : r.mxLive === false ? (
                  <span className="d-pill warn">Routed Elsewhere</span>
                ) : (
                  <span className="d-pill neutral">Not detected</span>
                )}
                {r.sendingReady === true ? (
                  <span className="d-pill ok">Production Ready</span>
                ) : r.verified ? (
                  <span className="d-pill warn">Not Ready</span>
                ) : (
                  <span className="d-cell-muted">&mdash;</span>
                )}
                {r.dkim.ok === true ? (
                  <span className="d-cell-ok"><CheckIcon /> {r.dkim.text}</span>
                ) : r.dkim.ok === false ? (
                  <span className="d-cell-warn"><WarnIcon /> {r.dkim.text}</span>
                ) : (
                  <span className="d-cell-muted">{r.dkim.text}</span>
                )}
                <span className="d-cell-muted">{r.mailboxCount} mailbox{r.mailboxCount !== 1 ? 'es' : ''}</span>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {!r.verified
                    ? <a className="d-row-link" href={`/dashboard/domains/${r.id}`}>Set up →</a>
                    : r.mxLive === false
                    ? <a className="d-row-link warn" href={`/dashboard/domains/${r.id}`}>Switch mail →</a>
                    : <a className="d-row-link" href={`/dashboard/domains/${r.id}`}>Manage →</a>
                  }
                </div>
              </div>
            ))}
          </>
        )}
      </div>

    </div>
  );
}
