'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/* ── Password strength ─────────────────────────────────────────────────────── */
type Req = { label: string; met: (pw: string) => boolean };
const PW_REQS: Req[] = [
  { label: 'At least 8 characters',       met: pw => pw.length >= 8 },
  { label: 'One uppercase letter (A–Z)',   met: pw => /[A-Z]/.test(pw) },
  { label: 'One number (0–9)',             met: pw => /[0-9]/.test(pw) },
  { label: 'One symbol (!@#$…)',           met: pw => /[^A-Za-z0-9]/.test(pw) },
];

function PasswordHints({ pw }: { pw: string }) {
  if (!pw) return null;
  return (
    <div style={{ marginTop: '.6rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
      {PW_REQS.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', fontSize: '0.78rem', color: r.met(pw) ? '#4ade80' : '#64748b' }}>
          {r.met(pw) ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9"/>
            </svg>
          )}
          {r.label}
        </div>
      ))}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ orgName: '', email: '', password: '' });
  const [showHints, setShowHints] = useState(false);
  const [error, setError]     = useState('');
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0f1117 0%,#1a1f2e 100%)', padding: '2rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <a href="https://arhamworkspace.tech" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', marginBottom: '1.75rem', color: '#64748b', fontSize: '0.83rem', transition: 'color .15s' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
            arhamworkspace.tech
          </a>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', marginBottom: '1rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>
            Create your workspace
          </h1>
          <p style={{ color: '#64748b', marginTop: '.5rem', fontSize: '0.9rem' }}>
            14-day free trial &mdash; no credit card required
          </p>
        </div>

        {/* Card */}
        <div style={{ background: '#161b27', border: '1px solid #1e2535', borderRadius: 16, padding: '2rem' }}>

          {error && (
            <div className="alert-error">{error}</div>
          )}

          <form onSubmit={submit}>
            {/* Organization name */}
            <div className="field">
              <label className="label" htmlFor="orgName">Organization name</label>
              <input
                id="orgName"
                type="text"
                className="inp"
                placeholder="Acme Corp"
                required
                autoFocus
                value={form.orgName}
                onChange={e => setForm(p => ({ ...p, orgName: e.target.value }))}
                autoComplete="organization"
              />
              <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '.3rem' }}>
                This is how your workspace will appear to users.
              </div>
            </div>

            {/* Email */}
            <div className="field">
              <label className="label" htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                className="inp"
                placeholder="you@company.com"
                required
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div className="field">
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="inp"
                placeholder="Create a strong password"
                required
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                onFocus={() => setShowHints(true)}
                autoComplete="new-password"
                style={showHints && form.password && !pwValid ? { borderColor: '#f87171' } : showHints && pwValid ? { borderColor: '#4ade80' } : {}}
              />
              {showHints && <PasswordHints pw={form.password} />}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-full"
              style={{ marginTop: '.75rem', background: loading ? '#374151' : 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
            >
              {loading ? 'Creating your workspace…' : 'Start free trial →'}
            </button>
          </form>

          {/* Divider + sign-in link */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', margin: '1.5rem 0 1.25rem' }}>
            <div style={{ flex: 1, borderTop: '1px solid #1e2535' }} />
            <span style={{ color: '#475569', fontSize: '0.78rem' }}>or</span>
            <div style={{ flex: 1, borderTop: '1px solid #1e2535' }} />
          </div>

          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: '#818cf8', fontWeight: 600 }}>Sign in →</a>
          </p>
        </div>

        {/* Footer note */}
        <p style={{ textAlign: 'center', marginTop: '1.25rem', color: '#334155', fontSize: '0.78rem' }}>
          By signing up you agree to our{' '}
          <a href="https://arhamworkspace.tech/terms" style={{ color: '#475569' }}>Terms of Service</a>
          {' '}and{' '}
          <a href="https://arhamworkspace.tech/privacy" style={{ color: '#475569' }}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
