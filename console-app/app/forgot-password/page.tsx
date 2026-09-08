'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const inp: React.CSSProperties = { width: '100%', padding: '.7rem 1rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, color: '#0f2040', outline: 'none', boxSizing: 'border-box' };
  const btn = (bg = 'linear-gradient(135deg,#2563eb,#1d4ed8)'): React.CSSProperties => ({
    width: '100%', padding: '.85rem', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem',
  });

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#f0f6ff,#1a1f2e)', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', marginBottom: '1rem', fontSize: 24 }}>⚡</div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f2040', letterSpacing: '-0.5px' }}>Forgot password?</h1>
          <p style={{ color: '#3b5f8a', marginTop: '.5rem' }}>
            {sent ? "Check your inbox." : "Enter your account email and we'll send you a reset link."}
          </p>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 16, padding: '2rem' }}>
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📬</div>
              <p style={{ color: '#1e3a5f', fontWeight: 600, marginBottom: '.5rem' }}>Reset link sent</p>
              <p style={{ color: '#3b5f8a', fontSize: '0.85rem', marginBottom: '.75rem' }}>
                If <strong style={{ color: '#0f2040' }}>{email}</strong> is registered, a link to choose a new
                password is on its way. It works once and expires in an hour.
              </p>
              <p style={{ color: '#7fa8d0', fontSize: '0.78rem', marginBottom: '1.25rem' }}>
                Nothing after a few minutes? Check your spam folder, then try again.
              </p>
              <Link href="/login" style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none' }}>
                ← Go to sign in
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
                  {error}
                </div>
              )}
              <form onSubmit={submit}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', color: '#7fa8d0', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.35rem' }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    placeholder="you@company.com"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    style={inp}
                    autoFocus
                  />
                </div>
                <button type="submit" disabled={loading} style={btn(loading ? '#374151' : undefined)}>
                  {loading ? 'Sending…' : 'Send reset link →'}
                </button>
              </form>
              <p style={{ textAlign: 'center', marginTop: '1.25rem', color: '#3b5f8a', fontSize: '0.85rem' }}>
                Remembered it?{' '}
                <Link href="/login" style={{ color: '#818cf8', fontWeight: 600, textDecoration: 'none' }}>Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
