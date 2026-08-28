'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0f1117,#1a1f2e)', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', marginBottom: '1rem', fontSize: 24 }}>⚡</div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>Welcome back</h1>
          <p style={{ color: '#64748b', marginTop: '.5rem' }}>Sign in to your Arham Console</p>
        </div>

        <div style={{ background: '#161b27', border: '1px solid #2d3448', borderRadius: 16, padding: '2rem' }}>
          {error && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#f87171', marginBottom: '1.25rem', fontSize: '0.85rem' }}>{error}</div>}
          <form onSubmit={submit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.35rem' }}>Email address</label>
              <input type="email" placeholder="you@company.com" required value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                style={{ width: '100%', padding: '.7rem 1rem', background: '#1e2535', border: '1px solid #2d3448', borderRadius: 8, color: '#f1f5f9', outline: 'none' }} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.35rem' }}>Password</label>
              <input type="password" placeholder="Your password" required value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                style={{ width: '100%', padding: '.7rem 1rem', background: '#1e2535', border: '1px solid #2d3448', borderRadius: 8, color: '#f1f5f9', outline: 'none' }} />
            </div>
            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '.85rem', background: loading ? '#374151' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.95rem' }}>
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '1.25rem', color: '#64748b', fontSize: '0.85rem' }}>
            No account yet?{' '}
            <a href="/signup" style={{ color: '#818cf8', fontWeight: 600 }}>Start free trial</a>
          </p>
        </div>
      </div>
    </div>
  );
}
