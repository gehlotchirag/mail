'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthStyles, AuthFonts, BackToHome } from '../auth-theme';

/* ── Password strength ─────────────────────────────────────────────────────── */
type Req = { label: string; met: (pw: string) => boolean };
const PW_REQS: Req[] = [
  { label: 'At least 8 characters',      met: pw => pw.length >= 8 },
  { label: 'One uppercase letter (A–Z)', met: pw => /[A-Z]/.test(pw) },
  { label: 'One number (0–9)',           met: pw => /[0-9]/.test(pw) },
  { label: 'One symbol (!@#$…)',         met: pw => /[^A-Za-z0-9]/.test(pw) },
];

function PasswordHints({ pw }: { pw: string }) {
  if (!pw) return null;
  return (
    <div className="a-pwreqs">
      {PW_REQS.map(r => {
        const met = r.met(pw);
        return (
          <div key={r.label} className={`a-req ${met ? 'met' : 'unmet'}`}>
            {met ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /></svg>
            )}
            {r.label}
          </div>
        );
      })}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ orgName: '', email: '', password: '' });
  const [showHints, setShowHints] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const pwValid = PW_REQS.every(r => r.met(form.password));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pwValid) {
      setError('Please choose a stronger password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.orgName.trim(), email: form.email.trim().toLowerCase(), password: form.password }),
      });
      if (res.ok) { router.push('/dashboard'); return; }
      const d = await res.json() as { error?: string };
      setError(d.error ?? 'Signup failed. Please try again.');
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authpage">
      <AuthStyles />
      <AuthFonts />
      <div className="a-wrap">
        <BackToHome />

        <div className="a-brand">
          <img src="/icon/web/icon-512.png" alt="INBOX" />
          <h1>Create your workspace</h1>
          <p>14-day free trial — no credit card required</p>
        </div>

        <div className="a-card">
          {error && <div className="a-alert">{error}</div>}

          <form onSubmit={submit}>
            <div className="a-field">
              <label className="a-label" htmlFor="orgName">Organization name</label>
              <input
                id="orgName" type="text" className="a-input" placeholder="Acme Corp" required autoFocus
                value={form.orgName}
                onChange={e => setForm(p => ({ ...p, orgName: e.target.value }))}
                autoComplete="organization"
              />
              <div className="a-hint">This is how your workspace will appear to users.</div>
            </div>

            <div className="a-field">
              <label className="a-label" htmlFor="email">Work email</label>
              <input
                id="email" type="email" className="a-input" placeholder="you@company.com" required
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                autoComplete="email"
              />
            </div>

            <div className="a-field">
              <label className="a-label" htmlFor="password">Password</label>
              <input
                id="password" type="password" className="a-input" placeholder="Create a strong password" required
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                onFocus={() => setShowHints(true)}
                autoComplete="new-password"
                style={
                  showHints && form.password && !pwValid ? { borderColor: 'var(--danger)' } :
                  showHints && pwValid ? { borderColor: 'var(--green)' } : undefined
                }
              />
              {showHints && <PasswordHints pw={form.password} />}
            </div>

            <button type="submit" className="a-submit" disabled={loading}>
              {loading ? 'Creating your workspace…' : (
                <>
                  Start free trial
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </>
              )}
            </button>
          </form>

          <div className="a-divider">or</div>
          <p className="a-foot">Already have an account? <a href="/login">Sign in</a></p>
        </div>

        <p className="a-legal">
          By signing up you agree to our{' '}
          <a href="https://arhamworkspace.tech/terms">Terms of Service</a>{' '}
          and{' '}
          <a href="https://arhamworkspace.tech/privacy">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
