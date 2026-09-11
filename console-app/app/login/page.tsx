'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthStyles, AuthFonts, BackToHome } from '../auth-theme';

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
      <div className="a-wrap">
        <BackToHome />

        <div className="a-brand">
          <img src="/icon/web/icon-512.png" alt="INBOX" />
          <h1>Welcome back</h1>
          <p>Sign in to your INBOX console</p>
        </div>

        <div className="a-card">
          {error && <div className="a-alert">{error}</div>}

          <form onSubmit={submit}>
            <div className="a-field">
              <label className="a-label" htmlFor="email">Email address</label>
              <input
                id="email" type="email" className="a-input" placeholder="you@company.com" required
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                autoComplete="email"
              />
            </div>

            <div className="a-field">
              <div className="a-row">
                <label className="a-label" htmlFor="password">Password</label>
                <Link href="/forgot-password" className="a-link">Forgot password?</Link>
              </div>
              <div className="a-pwwrap">
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

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
      </div>
    </div>
  );
}
