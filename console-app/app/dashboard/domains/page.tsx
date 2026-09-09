'use client';
import { useState, useEffect, useCallback } from 'react';

interface Domain {
  id: string; domain: string; verified: boolean; verify_token: string; flux_domain_id?: string;
  /**
   * true: mail routes here. false: verified but MX points elsewhere — every
   * message from outside the platform is still landing at the old provider.
   * null: could not be checked (no MX, DNS lookup failed) — distinct from false
   * so an unverified/new domain never gets accused of "mail not switched".
   */
  mxLive?: boolean | null;
  /** true = SES will accept mail from this domain; false = outbound bounces; null = unknown. */
  sendingReady?: boolean | null;
}

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

const S = {
  card: { background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  inp:  { width: '100%', padding: '.7rem 1rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, color: '#0f2040', outline: 'none' } as React.CSSProperties,
  btn:  (c = '#2563eb') => ({ padding: '.6rem 1.2rem', background: c, color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }) as React.CSSProperties,
};

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  // Hitting a plan limit is not an error the user did something wrong — it is an
  // upsell moment. Surfaced as a modal with a route to billing rather than a red
  // banner that disappears after 5 seconds.
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/domains');
    if (res.ok) { const d = await res.json() as { domains: Domain[] }; setDomains(d.domains); }
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
        setMsg('Domain added! Click "Set up domain" to continue.'); setTimeout(() => setMsg(''), 6000);
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

  async function deleteDomain(id: string, domain: string, force = false) {
    if (!force && !confirm(`Remove ${domain}? All email users under this domain will lose access.`)) return;

    let res: Response;
    try {
      res = await fetch(`/api/domains/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    } catch {
      setError('Could not reach the server. Please try again.');
      setTimeout(() => setError(''), 6000);
      return;
    }

    if (res.ok) { setMsg(`${domain} removed.`); setTimeout(() => setMsg(''), 4000); load(); return; }

    const d = await res.json().catch(() => ({})) as {
      error?: string; requiresForce?: boolean; mailboxCount?: number; mailboxes?: string[];
    };

    // The server refuses to delete a domain that still has mailboxes, because that
    // destroys their mail irrecoverably. Make the consequence explicit and let the
    // user opt in, rather than silently doing nothing.
    if (res.status === 409 && d.requiresForce) {
      const list = (d.mailboxes ?? []).slice(0, 5).join('\n  ');
      const more = (d.mailboxCount ?? 0) > 5 ? `\n  …and ${(d.mailboxCount ?? 0) - 5} more` : '';
      const ok = confirm(
        `${domain} still has ${d.mailboxCount} mailbox(es):\n  ${list}${more}\n\n` +
        'Deleting the domain permanently destroys these mailboxes and all their mail. ' +
        'This cannot be undone.\n\nDelete anyway?',
      );
      if (ok) await deleteDomain(id, domain, true);
      return;
    }

    setError(d.error ?? `Could not remove ${domain}.`);
    setTimeout(() => setError(''), 8000);
  }

  const meta = detected ? PROVIDER_META[detected] : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f2040', letterSpacing: '-0.5px' }}>Domains</h1>
          <p style={{ color: '#3b5f8a', marginTop: '.25rem', fontSize: '0.875rem' }}>Connect your custom domain to start using email</p>
        </div>
        <button style={S.btn()} onClick={() => { setShowAdd(!showAdd); setDetected(null); }}>+ Add domain</button>
      </div>

      {msg && <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#16a34a', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {limitMsg && (
        <div
          onClick={() => setLimitMsg(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,32,64,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ ...S.card, maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '2.25rem', marginBottom: '.75rem' }}>🚀</div>
            <h2 style={{ fontWeight: 800, color: '#0f2040', fontSize: '1.1rem', marginBottom: '.5rem' }}>
              You&apos;ve reached your plan&apos;s domain limit
            </h2>
            <p style={{ color: '#3b5f8a', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '1.25rem' }}>
              {limitMsg}
            </p>
            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/dashboard/billing" style={{ ...S.btn(), textDecoration: 'none', display: 'inline-block' }}>
                Upgrade plan →
              </a>
              <button onClick={() => setLimitMsg(null)} style={{ ...S.btn('#e2e8f0'), color: '#1e3a5f' }}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div style={{ ...S.card, marginBottom: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '1rem' }}>Add a domain</h2>
          <form onSubmit={addDomain}>
            <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
                <input style={S.inp} placeholder="yourdomain.com" value={newDomain}
                  onChange={e => { setNewDomain(e.target.value.toLowerCase().trim()); setDetected(null); }} required />
              </div>
              {/* Detected provider badge */}
              {detecting && (
                <span style={{ fontSize: '0.78rem', color: '#7fa8d0', whiteSpace: 'nowrap' }}>⏳ Detecting…</span>
              )}
              {meta && !detecting && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '0.78rem', padding: '.35rem .75rem', borderRadius: 20, background: `${meta.color}12`, color: meta.color, border: `1px solid ${meta.color}33`, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {meta.logo} {meta.label} detected
                </span>
              )}
              <button type="submit" style={S.btn()} disabled={saving}>{saving ? 'Adding…' : 'Add domain'}</button>
              <button type="button" style={S.btn('#374151')} onClick={() => { setShowAdd(false); setDetected(null); }}>Cancel</button>
            </div>
            <p style={{ color: '#7fa8d0', fontSize: '0.78rem', marginTop: '.65rem' }}>
              {meta
                ? `We detected ${meta.label} — after adding we'll open the setup wizard and highlight ${meta.label} automatically.`
                : "We'll detect your DNS provider automatically and open the setup wizard."}
            </p>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ ...S.card, textAlign: 'center', color: '#3b5f8a' }}>Loading…</div>
      ) : domains.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#3b5f8a' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🌐</div>
          <div style={{ fontWeight: 600, color: '#7fa8d0', marginBottom: '.5rem' }}>No domains yet</div>
          <div style={{ fontSize: '0.875rem' }}>Add your first domain to start using email</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {domains.map(d => (
            <div key={d.id} style={S.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                    <a href={`/dashboard/domains/${d.id}`} style={{ fontWeight: 700, color: '#0f2040', fontSize: '1.05rem', textDecoration: 'none' }}>{d.domain}</a>
                    <span style={{ fontSize: '0.72rem', padding: '.2rem .6rem', borderRadius: 5, background: d.verified ? 'rgba(22,163,74,.12)' : 'rgba(251,191,36,.12)', color: d.verified ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                      {d.verified ? '✓ Verified' : '⏳ Setup required'}
                    </span>
                    {/* "Verified" only proves ownership — it says nothing about
                        whether mail actually reaches this platform. Without this,
                        a domain could sit green-checkmarked indefinitely while
                        every inbound message still landed at the old provider,
                        with nothing anywhere telling the operator to look. */}
                    {d.verified && d.mxLive === false && (
                      <span style={{ fontSize: '0.72rem', padding: '.2rem .6rem', borderRadius: 5, background: 'rgba(220,38,38,.1)', color: '#dc2626', fontWeight: 700 }}>
                        ⚠ Mail not switched here
                      </span>
                    )}
                    {d.verified && d.sendingReady === false && (
                      <span style={{ fontSize: '0.72rem', padding: '.2rem .6rem', borderRadius: 5, background: 'rgba(220,38,38,.1)', color: '#dc2626', fontWeight: 700 }}>
                        ⚠ Cannot send mail
                      </span>
                    )}
                  </div>
                  {!d.verified && (
                    <p style={{ color: '#7fa8d0', fontSize: '0.8rem', marginTop: '.35rem' }}>
                      Verify ownership and configure DNS to activate email.
                    </p>
                  )}
                  {d.verified && d.mxLive === false && (
                    <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '.35rem' }}>
                      Incoming mail from outside this platform is still being delivered to your old provider, not here.
                    </p>
                  )}
                  {d.verified && d.sendingReady === false && (
                    <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '.35rem' }}>
                      Outbound mail from this domain is being rejected by the sending provider. Open the domain to fix it.
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                  {!d.verified
                    ? <a href={`/dashboard/domains/${d.id}`} style={{ ...S.btn('#2563eb'), display: 'inline-flex', alignItems: 'center', gap: '.35rem', textDecoration: 'none' }}>Set up domain →</a>
                    : d.mxLive === false
                    ? <a href={`/dashboard/domains/${d.id}`} style={{ ...S.btn('#dc2626'), display: 'inline-flex', textDecoration: 'none' }}>Switch mail here →</a>
                    : <a href={`/dashboard/domains/${d.id}`} style={{ ...S.btn('#1d4ed8'), display: 'inline-flex', textDecoration: 'none' }}>DNS Settings</a>
                  }
                  <button onClick={() => deleteDomain(d.id, d.domain)} style={{ ...S.btn('#991b1b'), fontSize: '0.78rem', padding: '.55rem .9rem' }}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
