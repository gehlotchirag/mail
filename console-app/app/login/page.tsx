'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthStyles, AuthFonts, AuthPanel } from '../auth-theme';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) { router.push('/dashboard'); return; }
    const d = await res.json() as { error?: string };
    setError(d.error ?? 'Login failed');
  }

  return (
    <div className="authpage">
      <AuthStyles />
      <AuthFonts />
      <AuthPanel />

      <div className="a-right">
        <div className="a-wrap">
          <div className="a-crumb">
            <span className="a-tag">Workspace Console</span>
            <span className="a-host">inbox.arhamworkspace.tech</span>
          </div>
          <h1 className="a-title">Welcome back</h1>
          <p className="a-desc">Sign in to manage your domains, mailboxes and billing.</p>

          <div className="a-card">
            {error && (
              <div className="a-alert">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                {error}
              </div>
            )}

            <form onSubmit={submit}>
              <div className="a-field">
                <label className="a-label" htmlFor="email">Email or domain name</label>
                <div className="a-inputwrap">
                  <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg>
                  <input
                    id="email" type="text" className="a-input" placeholder="admin@yourcompany.com or yourcompany.com" required
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="a-field">
                <div className="a-row">
                  <label className="a-label" htmlFor="password">Password</label>
                  <Link href="/forgot-password" className="a-link">Forgot password?</Link>
                </div>
                <div className="a-inputwrap a-pwwrap">
                  <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                  <input
                    id="password" type={showPassword ? 'text' : 'password'} className="a-input"
                    placeholder="Your password" required
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    autoComplete="current-password"
                  />
                  <button
                    type="button" className="a-pwtoggle" onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 17, height: 17 }}>
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                        <line x1="2" y1="2" x2="22" y2="22" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 17, height: 17 }}>
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <label className="a-check">
                <input type="checkbox" defaultChecked />
                <span>Remember this console device</span>
              </label>

              <button type="submit" className="a-submit" disabled={loading}>
                {loading ? 'Signing in…' : (
                  <>
                    Sign in
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </>
                )}
              </button>
            </form>

            <div className="a-divider">or</div>
            <p className="a-foot">No account yet? <a href="/signup">Start free trial</a></p>
          </div>

          <p className="a-trust">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            Secure access to your workspace console
          </p>
        </div>
      </div>
    </div>
  );
}
