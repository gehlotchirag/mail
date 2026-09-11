'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { UsersStyles, avatarColor, initials } from './users-theme';

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
  if (used == null) return <span className="u-nodata">—</span>;
  if (!limit) {
    return <div className="u-usage-num"><b>{fmtBytes(used)}</b></div>;
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const barColor = pct >= 90 ? 'var(--u-red)' : pct >= 75 ? 'var(--u-amber)' : 'var(--u-accent)';
  return (
    <div>
      <div className="u-usage-num"><b>{fmtBytes(used)}</b> <span className="u-of">of {fmtBytes(limit)} · {pct}%</span></div>
      <div className="u-usage-bar"><i style={{ width: `${pct}%`, background: barColor }} /></div>
    </div>
  );
}

interface DomainGroup { domainId: string; domain: string; users: User[]; }

function matchesSearch(u: User, q: string): boolean {
  if (!q) return true;
  const hay = `${u.emailAddress} ${u.name ?? ''} ${u.description ?? ''}`.toLowerCase();
  return hay.includes(q);
}

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
  // Client-side only — filters what's already loaded, doesn't touch data fetching.
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/users');
    if (res.ok) { const d = await res.json() as { domains: DomainGroup[] }; setGroups(d.domains); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const allDomains = groups.map(g => ({ id: g.domainId, domain: g.domain }));
  const totalUsers = groups.reduce((n, g) => n + g.users.length, 0);

  const allUsers = useMemo(() => groups.flatMap(g => g.users), [groups]);
  const usersWithUsage = allUsers.filter(u => u.usedDiskQuota != null);
  const totalUsedBytes = usersWithUsage.reduce((n, u) => n + (u.usedDiskQuota ?? 0), 0);
  const usersWithQuota = allUsers.filter(u => u.quotas?.maxDiskQuota != null);
  const totalQuotaBytes = usersWithQuota.reduce((n, u) => n + (u.quotas!.maxDiskQuota ?? 0), 0);
  const usagePct = totalQuotaBytes > 0 ? Math.min(100, Math.round((totalUsedBytes / totalQuotaBytes) * 100)) : null;

  const q = search.trim().toLowerCase();
  const filteredGroups = q
    ? groups.map(g => ({ ...g, users: g.users.filter(u => matchesSearch(u, q)) })).filter(g => g.users.length > 0)
    : groups;

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
    <div className="userspage">
      <UsersStyles />

      <div className="u-head">
        <div>
          <div className="u-h1row">
            <h1>Email Users</h1>
            {!loading && totalUsers > 0 && <span className="u-count">{totalUsers} provisioned</span>}
          </div>
          <p className="u-sub">
            {loading ? 'Loading…' : totalUsers === 0 ? 'No mailboxes yet' : (
              <>
                {totalUsers} user{totalUsers !== 1 ? 's' : ''} across {groups.length} domain{groups.length !== 1 ? 's' : ''}
                {usersWithUsage.length > 0 && <> · {fmtBytes(totalUsedBytes)}{totalQuotaBytes > 0 && <> of {fmtBytes(totalQuotaBytes)}</>} storage used</>}
              </>
            )}
          </p>
        </div>
        <div className="u-headbtns">
          {allDomains.length > 0 && (
            <a href="/dashboard/migration" className="u-btn u-btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Import
            </a>
          )}
          {allDomains.length > 0 && (
            <button className="u-btn u-btn-primary" onClick={() => setShowAdd(!showAdd)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add user
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="u-alert u-alert-ok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          {msg}
        </div>
      )}
      {error && (
        <div className="u-alert u-alert-err">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {error}
        </div>
      )}

      {!loading && totalUsers > 0 && (
        <div className="u-stats">
          <div className="u-stat">
            <div className="u-slabel">Mailboxes</div>
            <div className="u-sval">{totalUsers}</div>
          </div>
          <div className="u-stat">
            <div className="u-slabel">Domains</div>
            <div className="u-sval">{groups.length}</div>
          </div>
          {usersWithUsage.length > 0 && (
            <div className="u-stat">
              <div className="u-slabel">Storage used</div>
              <div className="u-sval">
                {fmtBytes(totalUsedBytes)}
                {totalQuotaBytes > 0 && <span>of {fmtBytes(totalQuotaBytes)}</span>}
              </div>
              {usagePct != null && (
                <div className="u-sbar"><i style={{ width: `${usagePct}%` }} /></div>
              )}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <div className="u-card">
          <h2>Create email user</h2>
          <form onSubmit={addUser}>
            <div className="u-grid2">
              <div className="u-field">
                <label className="u-label" htmlFor="add-username">Username</label>
                <input id="add-username" className="u-input" placeholder="john" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} required />
              </div>
              <div className="u-field">
                <label className="u-label" htmlFor="add-domain">Domain</label>
                <select id="add-domain" className="u-input" value={form.domainId} onChange={e => setForm(p => ({ ...p, domainId: e.target.value }))} required>
                  <option value="">Select domain…</option>
                  {allDomains.map(d => <option key={d.id} value={d.id}>{d.domain}</option>)}
                </select>
              </div>
              <div className="u-field">
                <label className="u-label" htmlFor="add-password">Password</label>
                <input id="add-password" className="u-input" type="password" placeholder="Secure password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required minLength={8} />
              </div>
              <div className="u-field">
                <label className="u-label" htmlFor="add-displayname">Display name (optional)</label>
                <input id="add-displayname" className="u-input" placeholder="John Smith" value={form.displayName} onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))} />
              </div>
            </div>
            {form.username && form.domainId && (
              <p className="u-preview">
                Email address: <b>{form.username}@{allDomains.find(d => d.id === form.domainId)?.domain ?? '…'}</b>
              </p>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="u-btn u-btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create user'}</button>
              <button type="button" className="u-btn u-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="u-group"><div className="u-empty">Loading users…</div></div>
      ) : allDomains.length === 0 ? (
        <div className="u-group">
          <div className="u-empty">
            No domains configured yet.{' '}
            <a href="/dashboard/domains" style={{ color: 'var(--u-accent)', fontWeight: 700 }}>Add a domain first →</a>
          </div>
        </div>
      ) : (
        <>
          {groups.some(g => g.users.length > 0) && (
            <div className="u-searchrow">
              <div className="u-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <input
                  type="text" placeholder="Search by name, email or address…"
                  value={search} onChange={e => setSearch(e.target.value)}
                  aria-label="Search users"
                />
              </div>
            </div>
          )}

          {filteredGroups.length === 0 ? (
            <div className="u-group"><div className="u-empty">No users match &quot;{search}&quot;.</div></div>
          ) : (
            filteredGroups.map(g => (
              <div key={g.domainId} className="u-group">
                <div className="u-grouphead">
                  <div className="u-domain">@{g.domain}</div>
                  <div className="u-groupmeta">
                    {g.users.length} user{g.users.length !== 1 ? 's' : ''}
                    {g.users.some(u => u.usedDiskQuota != null) && (
                      <> · {fmtBytes(g.users.reduce((n, u) => n + (u.usedDiskQuota ?? 0), 0))} used</>
                    )}
                  </div>
                </div>

                {g.users.length === 0 ? (
                  <div className="u-empty">No users yet for this domain.</div>
                ) : (
                  <>
                    <div className="u-thead">
                      <span>User &amp; address</span>
                      <span>Storage</span>
                      <span style={{ textAlign: 'right' }}>Actions</span>
                    </div>
                    {g.users.map(u => (
                      <div key={u.id} className="u-row">
                        <div className="u-who">
                          <span className="u-avatar" style={{ background: avatarColor(u.emailAddress) }}>{initials(u.name || u.emailAddress)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="u-addr">{u.emailAddress}</div>
                            {u.description && <div className="u-desc">{u.description}</div>}
                          </div>
                        </div>
                        <StorageCell used={u.usedDiskQuota} limit={u.quotas?.maxDiskQuota} />
                        <div className="u-actions">
                          <button className="u-btn u-btn-ghost u-btn-sm" onClick={() => { setResetModal({ id: u.id, email: u.emailAddress }); setNewPw(''); }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="4" /><path d="M10.5 12.5L20 3M20 3v5M20 3h-5" /></svg>
                            Reset
                          </button>
                          <button className="u-iconbtn" title={`Delete ${u.emailAddress}`} aria-label={`Delete ${u.emailAddress}`} onClick={() => deleteUser(u.id, u.emailAddress)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ))
          )}
        </>
      )}

      {resetModal && (
        <div className="u-modalbg">
          <div className="u-modal">
            <h3>Reset password</h3>
            <p className="u-modalsub">{resetModal.email}</p>
            <label className="u-label" htmlFor="reset-pw">New password</label>
            <input id="reset-pw" className="u-input" style={{ marginBottom: 18 }} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New secure password" autoFocus minLength={8} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="u-btn u-btn-primary" onClick={doReset}>Reset password</button>
              <button className="u-btn u-btn-ghost" onClick={() => setResetModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
