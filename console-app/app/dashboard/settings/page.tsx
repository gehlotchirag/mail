'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Profile {
  name: string;
  email: string;
}

type Msg = { type: 'success' | 'error'; text: string } | null;

/* ── Password strength helper ─────────────────────────────────────────────── */
function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '#2d3448' };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Weak',   color: '#f87171' };
  if (score <= 3) return { score, label: 'Fair',   color: '#fbbf24' };
  return              { score, label: 'Strong', color: '#4ade80' };
}

function StrengthBar({ pw }: { pw: string }) {
  const { score, label, color } = passwordStrength(pw);
  if (!pw) return null;
  return (
    <div style={{ marginTop: '.5rem' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: '.3rem' }}>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= score ? color : '#2d3448', transition: 'background .2s' }} />
        ))}
      </div>
      <div style={{ fontSize: '0.75rem', color }}>{label}</div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile]       = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passMsg, setPassMsg]     = useState<Msg>(null);
  const [passLoading, setPassLoading] = useState(false);

  const [showDelete, setShowDelete]   = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.json())
      .then((d: Profile) => { setProfile(d); setDisplayName(d.name); })
      .catch(() => {});
  }, []);

  /* ── Profile ── */
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setProfileLoading(true);
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName.trim() }),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) setProfileMsg({ type: 'success', text: 'Display name updated.' });
      else setProfileMsg({ type: 'error', text: d.error ?? 'Update failed' });
    } finally {
      setProfileLoading(false);
    }
  }

  /* ── Password ── */
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPassMsg(null);
    if (passwords.next !== passwords.confirm) {
      setPassMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (passwords.next.length < 8) {
      setPassMsg({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    setPassLoading(true);
    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: passwords.current, next: passwords.next }),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) {
        setPassMsg({ type: 'success', text: 'Password changed successfully.' });
        setPasswords({ current: '', next: '', confirm: '' });
      } else {
        setPassMsg({ type: 'error', text: d.error ?? 'Failed to change password.' });
      }
    } finally {
      setPassLoading(false);
    }
  }

  /* ── Delete account ── */
  async function deleteAccount() {
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/settings/profile', { method: 'DELETE' });
      if (res.ok) {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/signup');
      } else {
        const d = await res.json() as { error?: string };
        alert(d.error ?? 'Delete failed. Please try again.');
        setShowDelete(false);
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Manage your organization profile and account security</p>
      </div>

      {/* ── Organization Profile ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1.25rem' }}>
          Organization profile
        </h2>

        {profileMsg && (
          <div className={`alert-${profileMsg.type}`}>{profileMsg.text}</div>
        )}

        <div className="field">
          <label className="label">Email address</label>
          <input className="inp" value={profile?.email ?? '—'} disabled />
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '.3rem' }}>
            Contact support to change your login email.
          </div>
        </div>

        <form onSubmit={saveProfile}>
          <div className="field">
            <label className="label" htmlFor="display-name">Organization / display name</label>
            <input
              id="display-name"
              className="inp"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Acme Corp"
              required
              maxLength={120}
            />
          </div>
          <button type="submit" className="btn" disabled={profileLoading || !displayName.trim()}>
            {profileLoading ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>

      {/* ── Security ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1.25rem' }}>
          Change password
        </h2>

        {passMsg && (
          <div className={`alert-${passMsg.type}`}>{passMsg.text}</div>
        )}

        <form onSubmit={changePassword}>
          <div className="field">
            <label className="label" htmlFor="cur-pw">Current password</label>
            <input
              id="cur-pw"
              type="password"
              className="inp"
              value={passwords.current}
              onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))}
              required
              autoComplete="current-password"
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="new-pw">New password</label>
            <input
              id="new-pw"
              type="password"
              className="inp"
              value={passwords.next}
              onChange={e => setPasswords(p => ({ ...p, next: e.target.value }))}
              required
              minLength={8}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <StrengthBar pw={passwords.next} />
          </div>

          <div className="field">
            <label className="label" htmlFor="confirm-pw">Confirm new password</label>
            <input
              id="confirm-pw"
              type="password"
              className="inp"
              value={passwords.confirm}
              onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))}
              required
              minLength={8}
              autoComplete="new-password"
              style={passwords.confirm && passwords.next !== passwords.confirm ? { borderColor: '#f87171' } : {}}
            />
            {passwords.confirm && passwords.next !== passwords.confirm && (
              <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '.3rem' }}>Passwords do not match</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" className="btn" disabled={passLoading}>
              {passLoading ? 'Updating…' : 'Change password'}
            </button>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Use 8+ chars, a mix of letters, numbers &amp; symbols for a strong password.
            </div>
          </div>
        </form>
      </div>

      {/* ── Danger Zone ──────────────────────────────────────── */}
      <div className="card" style={{ borderColor: 'rgba(239,68,68,0.25)' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#f87171', marginBottom: '.5rem' }}>
          Danger zone
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
          Permanently delete your organization and all associated domains, users, and data.
          This action <strong style={{ color: '#94a3b8' }}>cannot be undone</strong>.
        </p>
        <button className="btn-danger" onClick={() => setShowDelete(true)}>
          Delete account
        </button>
      </div>

      {/* ── Delete confirm modal ─────────────────────────────── */}
      {showDelete && (
        <div className="modal-overlay" onClick={() => { if (!deleteLoading) setShowDelete(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Delete your account?</h2>
            <p>
              This will permanently delete <strong style={{ color: '#e2e8f0' }}>{profile?.name}</strong>,
              all domains, email users, and settings. Type your email to confirm:
            </p>
            <div className="field">
              <label className="label">Your email</label>
              <input
                className="inp"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder={profile?.email}
                autoComplete="off"
              />
            </div>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button
                className="btn-secondary"
                onClick={() => { setShowDelete(false); setDeleteInput(''); }}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={deleteInput !== profile?.email || deleteLoading}
                onClick={deleteAccount}
              >
                {deleteLoading ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
