'use client';
import { useState, useEffect, useCallback } from 'react';

interface Domain { id: string; domain: string; verified: boolean; verify_token: string; flux_domain_id?: string; }

const S = {
  card: { background: '#161b27', border: '1px solid #1e2535', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  inp: { width: '100%', padding: '.7rem 1rem', background: '#1e2535', border: '1px solid #2d3448', borderRadius: 8, color: '#f1f5f9', outline: 'none' } as React.CSSProperties,
  btn: (c = '#6366f1') => ({ padding: '.6rem 1.2rem', background: c, color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }) as React.CSSProperties,
};

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/domains');
    if (res.ok) { const d = await res.json() as { domains: Domain[] }; setDomains(d.domains); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    const res = await fetch('/api/domains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: newDomain }) });
    setSaving(false);
    if (res.ok) { setShowAdd(false); setNewDomain(''); load(); setMsg('Domain added! Follow the DNS steps to verify it.'); setTimeout(() => setMsg(''), 6000); }
    else { const d = await res.json() as { error: string }; setError(d.error ?? 'Failed'); setTimeout(() => setError(''), 5000); }
  }

  async function verify(id: string) {
    setVerifying(id);
    const res = await fetch(`/api/domains/${id}/verify`, { method: 'POST' });
    const d = await res.json() as { verified: boolean; message?: string };
    setVerifying(null);
    if (d.verified) { load(); setMsg('Domain verified! ✓'); setTimeout(() => setMsg(''), 4000); }
    else { setError(d.message ?? 'Verification failed'); setTimeout(() => setError(''), 8000); }
  }

  async function deleteDomain(id: string, domain: string) {
    if (!confirm(`Remove ${domain}? All email users under this domain will lose access.`)) return;
    await fetch(`/api/domains/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>Domains</h1>
          <p style={{ color: '#64748b', marginTop: '.25rem', fontSize: '0.875rem' }}>Connect your custom domain to start using email</p>
        </div>
        <button style={S.btn()} onClick={() => setShowAdd(!showAdd)}>+ Add domain</button>
      </div>

      {msg && <div style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#4ade80', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#f87171', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {showAdd && (
        <div style={{ ...S.card, marginBottom: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>Add a domain</h2>
          <form onSubmit={addDomain} style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
            <input style={{ ...S.inp, flex: 1, minWidth: 200 }} placeholder="yourdomain.com" value={newDomain} onChange={e => setNewDomain(e.target.value)} required />
            <button type="submit" style={S.btn()} disabled={saving}>{saving ? 'Adding…' : 'Add domain'}</button>
            <button type="button" style={S.btn('#374151')} onClick={() => setShowAdd(false)}>Cancel</button>
          </form>
          <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '.75rem' }}>You&apos;ll need to add DNS records to verify ownership after adding.</p>
        </div>
      )}

      {loading ? (
        <div style={{ ...S.card, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      ) : domains.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#475569' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🌐</div>
          <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: '.5rem' }}>No domains yet</div>
          <div style={{ fontSize: '0.875rem' }}>Add your first domain to start using email</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {domains.map(d => (
            <div key={d.id} style={S.card}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '1.05rem' }}>{d.domain}</span>
                    <span style={{ fontSize: '0.72rem', padding: '.2rem .6rem', borderRadius: 5, background: d.verified ? 'rgba(34,197,94,.12)' : 'rgba(251,191,36,.12)', color: d.verified ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>
                      {d.verified ? '✓ Verified' : '⏳ Pending verification'}
                    </span>
                  </div>
                  {!d.verified && (
                    <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: '.5rem' }}>
                      Add this TXT record to your DNS, then click Verify:
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                  {!d.verified && (
                    <button onClick={() => verify(d.id)} style={S.btn('#0f766e')} disabled={verifying === d.id}>
                      {verifying === d.id ? 'Checking…' : '✓ Verify'}
                    </button>
                  )}
                  <a href={`/dashboard/domains/${d.id}`} style={{ ...S.btn('#334155'), display: 'inline-block' }}>DNS Setup</a>
                  <button onClick={() => deleteDomain(d.id, d.domain)} style={S.btn('#7f1d1d')}>Remove</button>
                </div>
              </div>

              {!d.verified && d.verify_token && (
                <div style={{ marginTop: '1rem', background: '#0f1117', border: '1px solid #2d3448', borderRadius: 8, padding: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '.75rem', marginBottom: '.5rem' }}>
                    <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>TYPE</span>
                    <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>HOST</span>
                    <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>VALUE</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '.75rem', alignItems: 'center' }}>
                    <span style={{ background: 'rgba(16,185,129,.12)', color: '#34d399', padding: '.2rem .5rem', borderRadius: 5, fontSize: '0.72rem', fontWeight: 700, textAlign: 'center' }}>TXT</span>
                    <code style={{ color: '#93c5fd', fontSize: '0.82rem', wordBreak: 'break-all' }}>_arham-verify.{d.domain}</code>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <code style={{ color: '#e2e8f0', fontSize: '0.78rem', wordBreak: 'break-all', flex: 1 }}>{d.verify_token}</code>
                      <button onClick={() => navigator.clipboard.writeText(d.verify_token)} style={{ ...S.btn('#1e293b'), padding: '.3rem .6rem', fontSize: '0.72rem', flexShrink: 0 }}>Copy</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
