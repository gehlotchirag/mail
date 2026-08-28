'use client';
import { useState, useEffect, useCallback } from 'react';

interface User { id: string; name: string; emailAddress: string; description?: string; }
interface DomainGroup { domainId: string; domain: string; users: User[]; }

const S = {
  card: { background: '#161b27', border: '1px solid #1e2535', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  inp: { width: '100%', padding: '.65rem .9rem', background: '#1e2535', border: '1px solid #2d3448', borderRadius: 8, color: '#f1f5f9', outline: 'none' } as React.CSSProperties,
  btn: (c = '#6366f1') => ({ padding: '.55rem 1.1rem', background: c, color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }) as React.CSSProperties,
  label: { display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: '.3rem' },
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
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>Email Users</h1>
          <p style={{ color: '#64748b', marginTop: '.25rem', fontSize: '0.875rem' }}>{totalUsers} user{totalUsers !== 1 ? 's' : ''} across {groups.length} domain{groups.length !== 1 ? 's' : ''}</p>
        </div>
        {allDomains.length > 0 && <button style={S.btn()} onClick={() => setShowAdd(!showAdd)}>+ Add user</button>}
      </div>

      {msg && <div style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#4ade80', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#f87171', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {showAdd && (
        <div style={{ ...S.card, marginBottom: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '1.25rem' }}>Create email user</h2>
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
              <p style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: '1rem' }}>
                Email address: <strong style={{ color: '#a5b4fc' }}>{form.username}@{allDomains.find(d => d.id === form.domainId)?.domain ?? '…'}</strong>
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
        <div style={{ ...S.card, textAlign: 'center', color: '#64748b' }}>Loading users…</div>
      ) : allDomains.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: '3rem', color: '#475569' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>👥</div>
          <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: '.5rem' }}>No domains configured</div>
          <a href="/dashboard/domains" style={{ color: '#818cf8', fontSize: '0.875rem' }}>Add a domain first →</a>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {groups.map(g => (
            <div key={g.domainId} style={S.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#e2e8f0' }}>@{g.domain}</div>
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{g.users.length} user{g.users.length !== 1 ? 's' : ''}</span>
              </div>
              {g.users.length === 0 ? (
                <p style={{ color: '#475569', fontSize: '0.875rem' }}>No users yet for this domain.</p>
              ) : (
                g.users.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.75rem 0', borderBottom: '1px solid #1e2535', flexWrap: 'wrap', gap: '.75rem' }}>
                    <div>
                      <div style={{ color: '#e2e8f0', fontWeight: 500 }}>{u.emailAddress}</div>
                      {u.description && <div style={{ color: '#64748b', fontSize: '0.78rem' }}>{u.description}</div>}
                    </div>
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
          <div style={{ background: '#161b27', border: '1px solid #2d3448', borderRadius: 14, padding: '2rem', width: '100%', maxWidth: 400 }}>
            <h3 style={{ color: '#f1f5f9', fontWeight: 700, marginBottom: '.5rem' }}>Reset password</h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{resetModal.email}</p>
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
