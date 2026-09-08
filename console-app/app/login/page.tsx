'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#f0f6ff,#1a1f2e)', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', marginBottom: '1rem', fontSize: 24 }}>⚡</div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f2040', letterSpacing: '-0.5px' }}>Welcome back</h1>
          <p style={{ color: '#3b5f8a', marginTop: '.5rem' }}>Sign in to your Arham Console</p>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 16, padding: '2rem' }}>
          {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1.25rem', fontSize: '0.85rem' }}>{error}</div>}
          <form onSubmit={submit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', color: '#7fa8d0', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.35rem' }}>Email address</label>
              <input type="email" placeholder="you@company.com" required value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                style={{ width: '100%', padding: '.7rem 1rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, color: '#0f2040', outline: 'none' }} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.35rem' }}>
                <label style={{ color: '#7fa8d0', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Password</label>
                <Link href="/forgot-password" style={{ color: '#818cf8', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>Forgot password?</Link>
              </div>
              <input type="password" placeholder="Your password" required value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                style={{ width: '100%', padding: '.7rem 1rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, color: '#0f2040', outline: 'none' }} />
            </div>
            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '.85rem', background: loading ? '#374151' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.95rem' }}>
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '1.25rem', color: '#3b5f8a', fontSize: '0.85rem' }}>
            No account yet?{' '}
            <a href="/signup" style={{ color: '#818cf8', fontWeight: 600 }}>Start free trial</a>
          </p>
        </div>
      </div>
    </div>
  );
}
