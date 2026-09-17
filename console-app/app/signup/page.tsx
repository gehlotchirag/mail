'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthStyles, AuthFonts, AuthPanel } from '../auth-theme';
import { trackPixel } from '@/lib/pixel';

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
      if (res.ok) {
        trackPixel('CompleteRegistration', { content_name: 'Lite plan signup' });
        router.push('/dashboard');
        return;
      }
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
      <AuthPanel />

      <div className="a-right">
        <div className="a-wrap">
          <div className="a-crumb">
            <span className="a-tag">Free for 1 month</span>
            <span className="a-host">no credit card required</span>
          </div>
          <h1 className="a-title">Create your workspace</h1>
          <p className="a-desc">Up to 10 mailboxes, 30 domains, everything unlocked — free for your first month.</p>

          <div className="a-card">
            {error && (
              <div className="a-alert">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                {error}
              </div>
            )}

            <form onSubmit={submit}>
              <div className="a-field">
                <label className="a-label" htmlFor="orgName">Organization name</label>
                <div className="a-inputwrap">
                  <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M6 21V7l6-4 6 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" /></svg>
                  <input
                    id="orgName" type="text" className="a-input" placeholder="Acme Corp" required autoFocus
                    value={form.orgName}
                    onChange={e => setForm(p => ({ ...p, orgName: e.target.value }))}
                    autoComplete="organization"
                  />
                </div>
                <div className="a-hint">This is how your workspace will appear to users.</div>
              </div>

              <div className="a-field">
                <label className="a-label" htmlFor="email">Work email</label>
                <div className="a-inputwrap">
                  <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg>
                  <input
                    id="email" type="email" className="a-input" placeholder="you@company.com" required
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="a-field">
                <label className="a-label" htmlFor="password">Password</label>
                <div className="a-inputwrap">
                  <svg className="a-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
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
                </div>
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
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>{' '}
            and{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
