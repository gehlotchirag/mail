'use client';
import { useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  name: string;
  emailAddress: string;
  description?: string;
  /** Bytes stored by this mailbox, from x:Account.usedDiskQuota. */
  usedDiskQuota?: number;
  /** maxDiskQuota is the cap in bytes, when the plan sets one. */
  quotas?: { maxDiskQuota?: number };
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

/** Usage for one mailbox: a bar only when a quota exists to measure against. */
function StorageCell({ used, limit }: { used?: number; limit?: number }) {
  if (used == null) return <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>—</span>;
  if (!limit) {
    return (
      <span style={{ color: '#3b5f8a', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
        {fmtBytes(used)}
      </span>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const bar = pct >= 90 ? '#dc2626' : pct >= 75 ? '#d97706' : '#2563eb';
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ color: '#3b5f8a', fontSize: '0.78rem', marginBottom: 3, fontVariantNumeric: 'tabular-nums' }}>
        {fmtBytes(used)} <span style={{ color: '#94a3b8' }}>of {fmtBytes(limit)} · {pct}%</span>
      </div>
      <div style={{ background: '#dbeafe', borderRadius: 99, height: 5 }}>
        <div style={{ background: bar, borderRadius: 99, height: 5, width: `${pct}%`, transition: 'width .4s ease' }} />
      </div>
    </div>
  );
}
interface DomainGroup { domainId: string; domain: string; users: User[]; }

const S = {
  card: { background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  inp: { width: '100%', padding: '.65rem .9rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, color: '#0f2040', outline: 'none' } as React.CSSProperties,
  btn: (c = '#2563eb') => ({ padding: '.55rem 1.1rem', background: c, color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }) as React.CSSProperties,
  label: { display: 'block', color: '#7fa8d0', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: '.3rem' },
};

export default function UsersPage() {
  const [groups, setGroups] = useState<DomainGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: '', domainId: '', password: '', displayName: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [resetModal, setResetModal] = useState<{ id: string; email: string } | null>(null);
  const [newPw, setNewPw] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/users');
    if (res.ok) { const d = await res.json() as { domains: DomainGroup[] }; setGroups(d.domains); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const allDomains = groups.map(g => ({ id: g.domainId, domain: g.domain }));
  const totalUsers = groups.reduce((n, g) => n + g.users.length, 0);

  async function addUser(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false);
    if (res.ok) { setMsg('User created! They can sign in at app.arhamworkspace.tech'); setShowAdd(false); setForm({ username: '', domainId: '', password: '', displayName: '' }); load(); setTimeout(() => setMsg(''), 6000); }
    else {
      const d = await res.json() as { error: string; limitReached?: boolean };
      if (d.limitReached) { setError(d.error + ' → Upgrade your plan'); }
      else setError(d.error ?? 'Failed');
      setTimeout(() => setError(''), 7000);
    }
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`Delete ${email}? This will permanently remove their mailbox and all emails.`)) return;
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (res.ok) { setMsg('User deleted'); load(); setTimeout(() => setMsg(''), 3000); }
    else { const d = await res.json() as { error: string }; setError(d.error); setTimeout(() => setError(''), 4000); }
  }

  async function doReset() {
    if (!resetModal || !newPw) return;
    const res = await fetch(`/api/users/${resetModal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newPw }) });
    if (res.ok) { setMsg('Password reset'); setResetModal(null); setNewPw(''); setTimeout(() => setMsg(''), 3000); }
    else { const d = await res.json() as { error: string }; setError(d.error); setTimeout(() => setError(''), 4000); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f2040',  letterSpacing: '-0.5px' }}>Email Users</h1>
          <p style={{ color: '#3b5f8a', marginTop: '.25rem', fontSize: '0.875rem' }}>{totalUsers} user{totalUsers !== 1 ? 's' : ''} across {groups.length} domain{groups.length !== 1 ? 's' : ''}</p>
        </div>
        {allDomains.length > 0 && <button style={S.btn()} onClick={() => setShowAdd(!showAdd)}>+ Add user</button>}
      </div>

      {msg && <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#16a34a', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {showAdd && (
        <div style={{ ...S.card, marginBottom: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '1.25rem' }}>Create email user</h2>
          <form onSubmit={addUser}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={S.label}>Username</label>
                <input style={S.inp} placeholder="john" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} required />
              </div>
              <div>
                <label style={S.label}>Domain</label>
                <select style={{ ...S.inp, cursor: 'pointer' }} value={form.domainId} onChange={e => setForm(p => ({ ...p, domainId: e.target.value }))} required>
                  <option value="">Select domain…</option>
                  {allDomains.map(d => <option key={d.id} value={d.id}>{d.domain}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Password</label>
                <input style={S.inp} type="password" placeholder="Secure password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required minLength={8} />
              </div>
              <div>
                <label style={S.label}>Display name (optional)</label>
                <input style={S.inp} placeholder="John Smith" value={form.displayName} onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))} />
              </div>
            </div>
            {form.username && form.domainId && (
              <p style={{ color: '#3b5f8a', fontSize: '0.82rem', marginBottom: '1rem' }}>
                Email address: <strong style={{ color: '#2563eb' }}>{form.username}@{allDomains.find(d => d.id === form.domainId)?.domain ?? '…'}</strong>
              </p>
            )}
            <div style={{ display: 'flex', gap: '.75rem' }}>
              <button type="submit" style={S.btn()} disabled={saving}>{saving ? 'Creating…' : 'Create user'}</button>
              <button type="button" style={S.btn('#374151')} onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ ...S.card, textAlign: 'center', color: '#3b5f8a' }}>Loading users…</div>
      ) : allDomains.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#3b5f8a' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>👥</div>
          <div style={{ fontWeight: 600, color: '#7fa8d0', marginBottom: '.5rem' }}>No domains configured</div>
          <a href="/dashboard/domains" style={{ color: '#2563eb', fontSize: '0.875rem' }}>Add a domain first →</a>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {groups.map(g => (
            <div key={g.domainId} style={S.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#1e3a5f' }}>@{g.domain}</div>
                <span style={{ color: '#3b5f8a', fontSize: '0.8rem' }}>
                  {g.users.length} user{g.users.length !== 1 ? 's' : ''}
                  {g.users.some(u => u.usedDiskQuota != null) && (
                    <> · {fmtBytes(g.users.reduce((n, u) => n + (u.usedDiskQuota ?? 0), 0))} used</>
                  )}
                </span>
              </div>
              {g.users.length === 0 ? (
                <p style={{ color: '#3b5f8a', fontSize: '0.875rem' }}>No users yet for this domain.</p>
              ) : (
                g.users.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.75rem 0', borderBottom: '1px solid #dbeafe', flexWrap: 'wrap', gap: '.75rem' }}>
                    <div>
                      <div style={{ color: '#1e3a5f', fontWeight: 500 }}>{u.emailAddress}</div>
                      {u.description && <div style={{ color: '#3b5f8a', fontSize: '0.78rem' }}>{u.description}</div>}
                    </div>
                    <StorageCell used={u.usedDiskQuota} limit={u.quotas?.maxDiskQuota} />
                    <div style={{ display: 'flex', gap: '.5rem' }}>
                      <button onClick={() => { setResetModal({ id: u.id, email: u.emailAddress }); setNewPw(''); }} style={{ ...S.btn('#334155'), fontSize: '0.75rem' }}>🔑 Reset password</button>
                      <button onClick={() => deleteUser(u.id, u.emailAddress)} style={{ ...S.btn('#7f1d1d'), fontSize: '0.75rem' }}>🗑 Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}

      {resetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div style={{ background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 14, padding: '2rem', width: '100%', maxWidth: 400 }}>
            <h3 style={{ color: '#0f2040', fontWeight: 700, marginBottom: '.5rem' }}>Reset password</h3>
            <p style={{ color: '#3b5f8a', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{resetModal.email}</p>
            <label style={S.label}>New password</label>
            <input style={{ ...S.inp, marginBottom: '1.25rem' }} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New secure password" autoFocus minLength={8} />
            <div style={{ display: 'flex', gap: '.75rem' }}>
              <button onClick={doReset} style={S.btn()}>Reset password</button>
              <button onClick={() => setResetModal(null)} style={S.btn('#374151')}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
