'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthStyles, AuthFonts, AuthPanel } from '../auth-theme';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) setError('Invalid reset link — no token found.');
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true); setError('');
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (res.ok) { setDone(true); setTimeout(() => router.push('/login'), 2500); return; }
    const d = await res.json() as { error?: string };
    setError(d.error ?? 'Something went wrong');
  }

  if (done) {
    return (
      <div className="a-success">
        <div className="a-sicon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <h2>Password updated</h2>
        <p>Redirecting you to sign in…</p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="a-alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {error}
        </div>
      )}
      <form onSubmit={submit}>
        <div className="a-field">
          <label className="a-label" htmlFor="password">New password</label>
          <div className="a-inputwrap">
            <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            <input
              id="password" type="password" className="a-input" placeholder="At least 8 characters" required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              disabled={!token}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="a-field">
          <label className="a-label" htmlFor="confirm">Confirm new password</label>
          <div className="a-inputwrap">
            <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            <input
              id="confirm" type="password" className="a-input" placeholder="Repeat your new password" required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              disabled={!token}
              autoComplete="new-password"
            />
          </div>
        </div>
        <button type="submit" className="a-submit" disabled={loading || !token}>
          {loading ? 'Saving…' : (
            <>
              Set new password
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </>
          )}
        </button>
      </form>
      <p className="a-foot" style={{ marginTop: 22 }}><Link href="/login">← Back to sign in</Link></p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="authpage">
      <AuthStyles />
      <AuthFonts />
      <AuthPanel />

      <div className="a-right">
        <div className="a-wrap">
          <div className="a-crumb">
            <span className="a-tag">Account recovery</span>
          </div>
          <h1 className="a-title">Set new password</h1>
          <p className="a-desc">Choose a strong new password for your account.</p>

          <div className="a-card">
            <Suspense fallback={<p style={{ textAlign: 'center', color: 'var(--muted)' }}>Loading…</p>}>
              <ResetPasswordForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
