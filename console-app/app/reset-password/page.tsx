'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const inp: React.CSSProperties = { width: '100%', padding: '.7rem 1rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, color: '#0f2040', outline: 'none', boxSizing: 'border-box' };
  const btn = (bg = 'linear-gradient(135deg,#2563eb,#1d4ed8)'): React.CSSProperties => ({
    width: '100%', padding: '.85rem', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem',
  });

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

  return (
    <>
      {done ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <p style={{ color: '#16a34a', fontWeight: 600, marginBottom: '.5rem' }}>Password updated successfully</p>
          <p style={{ color: '#3b5f8a', fontSize: '0.85rem' }}>Redirecting you to sign in…</p>
        </div>
      ) : (
        <>
          {error && (
            <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', color: '#7fa8d0', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.35rem' }}>
                New password
              </label>
              <input
                type="password"
                placeholder="At least 8 characters"
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inp}
                autoFocus
                disabled={!token}
              />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: '#7fa8d0', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.35rem' }}>
                Confirm new password
              </label>
              <input
                type="password"
                placeholder="Repeat your new password"
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                style={inp}
                disabled={!token}
              />
            </div>
            <button type="submit" disabled={loading || !token} style={btn(loading || !token ? '#374151' : undefined)}>
              {loading ? 'Saving…' : 'Set new password →'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '1.25rem', color: '#3b5f8a', fontSize: '0.85rem' }}>
            <Link href="/login" style={{ color: '#818cf8', fontWeight: 600, textDecoration: 'none' }}>← Back to sign in</Link>
          </p>
        </>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#f0f6ff,#1a1f2e)', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', marginBottom: '1rem', fontSize: 24 }}>⚡</div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f2040', letterSpacing: '-0.5px' }}>Set new password</h1>
          <p style={{ color: '#3b5f8a', marginTop: '.5rem' }}>Choose a strong new password for your account.</p>
        </div>
        <div style={{ background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 16, padding: '2rem' }}>
          <Suspense fallback={<div style={{ textAlign: 'center', color: '#3b5f8a' }}>Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
