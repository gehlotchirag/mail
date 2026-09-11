'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthStyles, AuthFonts, AuthPanel } from '../auth-theme';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    if (res.ok) { setSent(true); return; }
    const d = await res.json() as { error?: string };
    setError(d.error ?? 'Something went wrong');
  }

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
          <h1 className="a-title">Forgot password?</h1>
          <p className="a-desc">
            {sent ? 'Check your inbox for the reset link.' : "Enter your account email and we'll send you a reset link."}
          </p>

          <div className="a-card">
            {sent ? (
              <div className="a-success">
                <div className="a-sicon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg>
                </div>
                <h2>Reset link sent</h2>
                <p>If <strong style={{ color: 'var(--ink)' }}>{email}</strong> is registered, a link to choose a new password is on its way. It works once and expires in an hour.</p>
                <p className="a-muted2">Nothing after a few minutes? Check your spam folder, then try again.</p>
                <Link href="/login" className="a-link">← Go to sign in</Link>
              </div>
            ) : (
              <>
                {error && (
                  <div className="a-alert">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    {error}
                  </div>
                )}
                <form onSubmit={submit}>
                  <div className="a-field">
                    <label className="a-label" htmlFor="email">Email address</label>
                    <div className="a-inputwrap">
                      <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg>
                      <input
                        id="email" type="email" className="a-input" placeholder="you@company.com" required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        autoFocus
                        autoComplete="email"
                      />
                    </div>
                  </div>
                  <button type="submit" className="a-submit" disabled={loading}>
                    {loading ? 'Sending…' : (
                      <>
                        Send reset link
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </>
                    )}
                  </button>
                </form>
                <p className="a-foot" style={{ marginTop: 22 }}>Remembered it? <Link href="/login">Back to sign in</Link></p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
