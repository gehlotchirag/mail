'use client';
import { useState } from 'react';

/**
 * Shown until the owner confirms the address they signed up with. It states the
 * one thing that is actually blocked (adding a domain) rather than nagging without
 * saying why, and carries the resend inline so the fix never leaves the page.
 */
export default function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function resend() {
    setState('sending');
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const d = await res.json() as { error?: string; alreadyVerified?: boolean };
      if (res.ok) {
        setState('sent');
        setMessage(d.alreadyVerified ? 'Already confirmed — reload the page.' : `Sent to ${email}.`);
      } else {
        setState('error');
        setMessage(d.error ?? 'Could not send the email.');
      }
    } catch {
      setState('error');
      setMessage('Could not reach the server.');
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
      background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
      padding: '.85rem 1.1rem', marginBottom: '1.5rem',
    }}>
      <span style={{ fontSize: '1.1rem' }} aria-hidden="true">📬</span>
      <p style={{ margin: 0, flex: '1 1 320px', color: '#92400e', fontSize: '0.85rem', lineHeight: 1.5 }}>
        Confirm <strong>{email}</strong> to finish setting up your account. Adding a domain stays locked until you do.
      </p>
      {state === 'sent' || state === 'error' ? (
        <span style={{ color: state === 'sent' ? '#15803d' : '#b91c1c', fontSize: '0.8rem', fontWeight: 600 }}>
          {message}
        </span>
      ) : (
        <button
          onClick={resend}
          disabled={state === 'sending'}
          style={{
            padding: '.45rem 1rem', background: '#b45309', color: '#fff', border: 'none',
            borderRadius: 8, fontWeight: 700, fontSize: '0.8rem',
            cursor: state === 'sending' ? 'default' : 'pointer',
          }}
        >
          {state === 'sending' ? 'Sending…' : 'Resend email'}
        </button>
      )}
    </div>
  );
}
