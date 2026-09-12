'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SettingsStyles } from './settings-theme';

interface Profile {
  name: string;
  email: string;
}

type Msg = { type: 'success' | 'error'; text: string } | null;

/** Real password strength — the same checks the backend does NOT enforce
 *  (it only requires 8+ chars) — so these are shown as guidance, not as a
 *  compliance requirement the account actually enforces. */
function checkPassword(pw: string) {
  return {
    len: pw.length >= 8,
    caseMix: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    num: /[0-9]/.test(pw),
    sym: /[^A-Za-z0-9]/.test(pw),
  };
}
function strengthScore(pw: string): number {
  if (!pw) return 0;
  const c = checkPassword(pw);
  return [c.len, c.caseMix, c.num, c.sym].filter(Boolean).length;
}
const STRENGTH_LABEL = ['Awaiting input', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLOR = ['var(--s-muted)', 'var(--s-red)', 'var(--s-amber)', 'var(--s-accent)', 'var(--s-green)'];

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile]       = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passMsg, setPassMsg]     = useState<Msg>(null);
  const [passLoading, setPassLoading] = useState(false);

  const [showDelete, setShowDelete]   = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Real counts of what deleting the org actually destroys — from the same
  // endpoints Domains and Mailboxes read, not a made-up number.
  const [orgStats, setOrgStats] = useState<{ domains: number; mailboxes: number } | null>(null);

  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.json())
      .then((d: Profile) => { setProfile(d); setDisplayName(d.name); })
      .catch(() => {});
    Promise.all([
      fetch('/api/domains').then(r => r.ok ? r.json() as Promise<{ domains: unknown[] }> : { domains: [] }),
      fetch('/api/users').then(r => r.ok ? r.json() as Promise<{ domains: Array<{ users: unknown[] }> }> : { domains: [] }),
    ]).then(([d, u]) => {
      setOrgStats({
        domains: d.domains.length,
        mailboxes: u.domains.reduce((n, x) => n + x.users.length, 0),
      });
    }).catch(() => {});
  }, []);

  const isDirty = displayName.trim() !== (profile?.name ?? '') && displayName.trim().length > 0;

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
      if (res.ok) {
        setProfileMsg({ type: 'success', text: 'Display name updated.' });
        setProfile(p => p ? { ...p, name: displayName.trim() } : p);
        setSavedAt(fmtTime(new Date()));
      } else {
        setProfileMsg({ type: 'error', text: d.error ?? 'Update failed' });
      }
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

  const pwChecks = checkPassword(passwords.next);
  const score = strengthScore(passwords.next);

  return (
    <div className="settingspage">
      <SettingsStyles />

      <div className="s-head">
        <h1>Settings</h1>
        <p>Manage your organization profile and account security</p>
      </div>

      {/* ── Organization Profile ─────────────────────────────── */}
      <div className="s-card">
        <div className="s-cardhead">
          <span className="s-cardtitle">Organization profile</span>
          {savedAt && !isDirty && (
            <span className="s-savedbadge">✓ Saved <span className="s-mono">{savedAt}</span></span>
          )}
        </div>

        {profileMsg && <div className={`s-alert s-alert-${profileMsg.type}`}>{profileMsg.text}</div>}

        <div className="s-field">
          <div className="s-labelrow"><span className="s-label">Login email</span></div>
          <input className="s-inp" value={profile?.email ?? '—'} disabled />
          <div className="s-hint">Contact support to change your login email.</div>
        </div>

        <form onSubmit={saveProfile}>
          <div className="s-field">
            <div className="s-labelrow">
              <label className="s-label" htmlFor="display-name">Organization / display name</label>
              <span className="s-counter">{displayName.length} / 120 characters</span>
            </div>
            <input
              id="display-name"
              className="s-inp"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Acme Corp"
              required
              maxLength={120}
            />
            <div className="s-hint">This name appears in console banners and team member invitations.</div>
          </div>
          <div style={{ display: 'flex', gap: '.75rem' }}>
            <button type="submit" className="s-btn s-btn-primary" disabled={profileLoading || !isDirty}>
              {profileLoading ? 'Saving…' : 'Save changes'}
            </button>
            {isDirty && (
              <button type="button" className="s-btn" onClick={() => { setDisplayName(profile?.name ?? ''); setProfileMsg(null); }}>
                Reset
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Security ─────────────────────────────────────────── */}
      <div className="s-card">
        <div className="s-cardhead"><span className="s-cardtitle">Change password</span></div>

        {passMsg && <div className={`s-alert s-alert-${passMsg.type}`}>{passMsg.text}</div>}

        <form onSubmit={changePassword}>
          <div className="s-pwgrid">
            <div>
              <div className="s-field">
                <div className="s-labelrow"><label className="s-label" htmlFor="cur-pw">Current password</label></div>
                <input
                  id="cur-pw" type="password" className="s-inp"
                  value={passwords.current}
                  onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))}
                  required autoComplete="current-password"
                />
              </div>
              <div className="s-field">
                <div className="s-labelrow"><label className="s-label" htmlFor="new-pw">New password</label></div>
                <input
                  id="new-pw" type="password" className="s-inp"
                  value={passwords.next}
                  onChange={e => setPasswords(p => ({ ...p, next: e.target.value }))}
                  required minLength={8} placeholder="At least 8 characters" autoComplete="new-password"
                />
              </div>
              <div className="s-field" style={{ marginBottom: 0 }}>
                <div className="s-labelrow"><label className="s-label" htmlFor="confirm-pw">Confirm new password</label></div>
                <input
                  id="confirm-pw" type="password" className="s-inp"
                  value={passwords.confirm}
                  onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                  required minLength={8} autoComplete="new-password"
                  style={passwords.confirm && passwords.next !== passwords.confirm ? { borderColor: 'var(--s-red)' } : {}}
                />
                {passwords.confirm && passwords.next !== passwords.confirm && (
                  <div className="s-hint" style={{ color: 'var(--s-red)' }}>Passwords do not match</div>
                )}
              </div>
            </div>

            <div className="s-strengthcard">
              <div className="s-strengthtop">
                <span className="s-label">Password strength</span>
                <span className="s-mono" style={{ fontSize: '.75rem', fontWeight: 700, color: STRENGTH_COLOR[score] }}>{STRENGTH_LABEL[score]}</span>
              </div>
              <div className="s-strengthbars">
                {[1, 2, 3, 4].map(i => (
                  <i key={i} style={{ background: score >= i ? STRENGTH_COLOR[score] : 'var(--s-border)' }} />
                ))}
              </div>
              <span className="s-reqlabel">Makes a password harder to guess</span>
              {([
                ['At least 8 characters', pwChecks.len],
                ['Upper & lowercase letters', pwChecks.caseMix],
                ['At least one number', pwChecks.num],
                ['At least one symbol (!@#$%^&*)', pwChecks.sym],
              ] as [string, boolean][]).map(([label, ok], i) => (
                <div key={i} className={`s-req ${ok ? 'ok' : ''}`}>
                  <span className="s-dot">{ok ? '✓' : ''}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <div className="s-notice" style={{ gridColumn: '1 / -1' }}>
              <span>ℹ️</span>
              <span><strong>After changing your password</strong>, you&apos;ll need to sign in again on any other device or session.</span>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="s-btn s-btn-primary" disabled={passLoading}>
                {passLoading ? 'Updating…' : 'Change password'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Danger Zone ──────────────────────────────────────── */}
      <div className="s-danger">
        <h2>Danger zone</h2>
        <p>
          Permanently delete your organization and all associated domains, users, and data.
          This action <strong>cannot be undone</strong>.
        </p>
        {orgStats && (
          <div className="s-danger-meta">
            Currently hosting {orgStats.domains} domain{orgStats.domains !== 1 ? 's' : ''} and {orgStats.mailboxes} mailbox{orgStats.mailboxes !== 1 ? 'es' : ''}.
          </div>
        )}
        <button className="s-btn s-btn-danger" onClick={() => setShowDelete(true)}>
          Delete organization
        </button>
      </div>

      {/* ── Delete confirm modal ─────────────────────────────── */}
      {showDelete && (
        <div className="s-modal-overlay" onClick={() => { if (!deleteLoading) setShowDelete(false); }}>
          <div className="s-modal" onClick={e => e.stopPropagation()}>
            <h2>Delete your organization?</h2>
            <p>
              This will permanently delete <strong>{profile?.name}</strong>
              {orgStats && <> — {orgStats.domains} domain{orgStats.domains !== 1 ? 's' : ''} and {orgStats.mailboxes} mailbox{orgStats.mailboxes !== 1 ? 'es' : ''}</>},
              all settings, and cannot be recovered. Type your email to confirm:
            </p>
            <div className="s-field">
              <div className="s-labelrow"><span className="s-label">Your email</span></div>
              <input
                className="s-inp"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder={profile?.email}
                autoComplete="off"
              />
            </div>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button
                className="s-btn"
                onClick={() => { setShowDelete(false); setDeleteInput(''); }}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                className="s-btn s-btn-danger"
                disabled={deleteInput !== profile?.email || deleteLoading}
                onClick={deleteAccount}
              >
                {deleteLoading ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
