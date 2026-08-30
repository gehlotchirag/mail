'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

interface MigrationUser {
  id: string; source_email: string; target_email: string; status: string;
  imported_messages: number; failed_messages: number; imported_bytes: number; error_message?: string;
}
interface MigrationJob {
  id: string; source_type: string; source_host: string; status: string;
  total_users: number | null; completed_users: number; failed_users: number;
  imported_messages: number; imported_bytes: number; error_message?: string;
  created_at: string; started_at?: string; completed_at?: string;
  users: MigrationUser[] | null;
}

const S = {
  card: { background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  inp: { width: '100%', padding: '.65rem .9rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, color: '#1e3a5f', outline: 'none', boxSizing: 'border-box' as const } as React.CSSProperties,
  btn: (c = '#2563eb', outline = false) => ({ padding: '.6rem 1.2rem', background: outline ? 'transparent' : c, color: outline ? c : '#fff', border: `1.5px solid ${c}`, borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }) as React.CSSProperties,
  label: { display: 'block', color: '#3b5f8a', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: '.3rem' },
};

interface ZohoTokens {
  accessToken: string; refreshToken: string;
  orgId: string; displayEmail: string; region: string;
}

const PROVIDERS = [
  { key: 'zoho',    label: 'Zoho Mail',          icon: '🔵' },
  { key: 'gsuite',  label: 'Google Workspace',   icon: '🔴' },
  { key: 'cpanel',  label: 'cPanel / WHM',        icon: '🟠' },
  { key: 'dovecot', label: 'Dovecot / IMAP',      icon: '🟣' },
];

const FIELDS: Record<string, { key: string; label: string; placeholder: string; type?: string; rows?: number }[]> = {
  zoho: [
    { key: 'domain',      label: 'Your Zoho domain',  placeholder: 'company.com' },
    { key: 'orgId',       label: 'Zoho Org ID',        placeholder: 'Auto-filled after Connect, or find in Zoho Admin → Settings → Org Details' },
    { key: 'accessToken', label: 'Access Token (manual fallback)', placeholder: 'Only needed if not using Connect above', type: 'password' },
  ],
  gsuite: [
    { key: 'domain',             label: 'Google Workspace domain', placeholder: 'company.com' },
    { key: 'adminEmail',         label: 'Super Admin email',       placeholder: 'admin@company.com' },
    { key: 'serviceAccountJson', label: 'Service Account JSON',    placeholder: '{"type":"service_account",...}', type: 'textarea', rows: 5 },
  ],
  cpanel: [
    { key: 'host',       label: 'WHM Hostname / IP',  placeholder: 'mail.company.com or 1.2.3.4' },
    { key: 'adminUser',  label: 'WHM Admin Username', placeholder: 'root' },
    { key: 'adminToken', label: 'WHM API Token',      placeholder: 'API token from WHM', type: 'password' },
    { key: 'masterPass', label: 'Mail Master Password', placeholder: 'cPanel master password', type: 'password' },
  ],
  dovecot: [
    { key: 'host',       label: 'IMAP Server',        placeholder: 'mail.company.com:993' },
    { key: 'masterUser', label: 'Master Username',    placeholder: 'dovecotadmin' },
    { key: 'masterPass', label: 'Master Password',    placeholder: 'Master password', type: 'password' },
  ],
};

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending:   ['rgba(148,163,184,.15)', '#64748b'],
    running:   ['rgba(37,99,235,.1)',    '#2563eb'],
    completed: ['rgba(22,163,74,.1)',    '#16a34a'],
    failed:    ['rgba(220,38,38,.1)',    '#dc2626'],
    cancelled: ['rgba(217,119,6,.1)',    '#d97706'],
  };
  const [bg, color] = map[status] ?? map.pending;
  return <span style={{ background: bg, color, fontSize: '0.7rem', fontWeight: 700, padding: '.2rem .55rem', borderRadius: 5, textTransform: 'uppercase', letterSpacing: '.4px' }}>{status}</span>;
}

export default function MigrationPage() {
  const [jobs, setJobs] = useState<MigrationJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [provider, setProvider] = useState('zoho');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [liveJob, setLiveJob] = useState<MigrationJob | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [zohoConnected, setZohoConnected] = useState<ZohoTokens | null>(null);

  // After Zoho OAuth redirect back here with ?zoho_connected=1, fetch tokens once
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('zoho_connected') === '1') {
      fetch('/api/auth/zoho/tokens')
        .then(r => r.json() as Promise<{ tokens: ZohoTokens | null }>)
        .then(({ tokens }) => {
          if (tokens) {
            setZohoConnected(tokens);
            setProvider('zoho');
            setCreds({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              orgId: tokens.orgId,
              region: tokens.region,
            });
            // Clean URL
            window.history.replaceState({}, '', '/dashboard/migration');
          }
        })
        .catch(() => { /* ignore */ });
    }
    if (params.get('error') === 'zoho_not_configured') {
      setError('Zoho OAuth is not configured yet. Contact your admin to add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET.');
      window.history.replaceState({}, '', '/dashboard/migration');
    }
    if (params.get('error') === 'oauth_failed') {
      setError('Zoho OAuth failed. Please try again or enter credentials manually.');
      window.history.replaceState({}, '', '/dashboard/migration');
    }
  }, []);

  const loadJobs = useCallback(async () => {
    const res = await fetch('/api/migration');
    if (res.ok) setJobs(await res.json() as MigrationJob[]);
    setLoadingJobs(false);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Auto-attach SSE if there's a running job on load
  useEffect(() => {
    const running = jobs.find(j => j.status === 'running' || j.status === 'pending');
    if (running && !activeJobId) startSse(running.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  function startSse(jobId: string) {
    sseRef.current?.close();
    setActiveJobId(jobId);
    const es = new EventSource(`/api/migration/${jobId}/progress`);
    sseRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as MigrationJob & { error?: string };
      if (data.error) return;
      setLiveJob(data);
      if (['completed', 'failed', 'cancelled'].includes(data.status)) {
        es.close(); sseRef.current = null;
        loadJobs();
      }
    };
    es.onerror = () => { es.close(); sseRef.current = null; };
  }

  async function testCreds() {
    setTesting(true); setTestResult(null);
    const res = await fetch('/api/migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', sourceType: provider, credentials: creds }) });
    const d = await res.json() as { ok: boolean; message: string };
    setTesting(false); setTestResult(d);
  }

  async function startImport() {
    setStarting(true); setError('');
    const res = await fetch('/api/migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', sourceType: provider, credentials: creds }) });
    setStarting(false);
    if (res.ok) {
      const { jobId } = await res.json() as { jobId: string };
      setMsg('Import started! Watching progress…'); setTimeout(() => setMsg(''), 5000);
      setCreds({}); setTestResult(null);
      await loadJobs();
      startSse(jobId);
    } else {
      const d = await res.json() as { error: string };
      setError(d.error ?? 'Failed to start import');
      setTimeout(() => setError(''), 6000);
    }
  }

  async function cancelJob(jobId: string) {
    await fetch('/api/migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', sourceType: '', credentials: {}, jobId }) });
    sseRef.current?.close(); sseRef.current = null;
    setActiveJobId(null); setLiveJob(null);
    loadJobs();
  }

  const fields = FIELDS[provider] ?? [];
  const displayJob = liveJob ?? (activeJobId ? jobs.find(j => j.id === activeJobId) ?? null : null);

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f2040', letterSpacing: '-0.5px' }}>Import Email</h1>
        <p style={{ color: '#3b5f8a', marginTop: '.25rem', fontSize: '0.875rem' }}>Migrate all mailboxes from Zoho, Google Workspace, cPanel, or Dovecot into your workspace</p>
      </div>

      {msg && <div style={{ background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.25)', borderRadius: 8, padding: '.75rem 1rem', color: '#16a34a', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 8, padding: '.75rem 1rem', color: '#dc2626', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {/* Live job progress */}
      {displayJob && (displayJob.status === 'running' || displayJob.status === 'pending') && (
        <div style={{ ...S.card, marginBottom: '1.5rem', borderColor: '#bfdbfe' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#0f2040' }}>Import in progress — <span style={{ color: '#2563eb', textTransform: 'capitalize' }}>{displayJob.source_type}</span></div>
              {displayJob.source_host && <div style={{ color: '#3b5f8a', fontSize: '0.8rem', marginTop: '.15rem' }}>{displayJob.source_host}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <StatusBadge status={displayJob.status} />
              <button onClick={() => cancelJob(displayJob.id)} style={S.btn('#dc2626')}>Cancel</button>
            </div>
          </div>

          {/* Progress bar */}
          {displayJob.total_users != null && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#7fa8d0', fontSize: '0.78rem', marginBottom: '.4rem' }}>
                <span>{displayJob.completed_users} / {displayJob.total_users} users</span>
                <span>{displayJob.imported_messages.toLocaleString()} emails · {fmtBytes(displayJob.imported_bytes)}</span>
              </div>
              <div style={{ background: '#dbeafe', borderRadius: 99, height: 8 }}>
                <div style={{ background: 'linear-gradient(90deg,#2563eb,#1d4ed8)', borderRadius: 99, height: 8, width: `${Math.round((displayJob.completed_users / displayJob.total_users) * 100)}%`, transition: 'width .5s ease' }} />
              </div>
              {displayJob.failed_users > 0 && <div style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '.3rem' }}>{displayJob.failed_users} user{displayJob.failed_users !== 1 ? 's' : ''} failed</div>}
            </div>
          )}

          {/* Per-user table */}
          {displayJob.users && displayJob.users.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #dbeafe' }}>
                    {['Source', 'Target', 'Status', 'Messages', 'Size'].map(h => (
                      <th key={h} style={{ color: '#3b5f8a', fontWeight: 600, padding: '.5rem .75rem', textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayJob.users.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f0f6ff' }}>
                      <td style={{ padding: '.5rem .75rem', color: '#7fa8d0' }}>{u.source_email}</td>
                      <td style={{ padding: '.5rem .75rem', color: '#1e3a5f' }}>{u.target_email}</td>
                      <td style={{ padding: '.5rem .75rem' }}><StatusBadge status={u.status} /></td>
                      <td style={{ padding: '.5rem .75rem', color: '#1e3a5f' }}>{u.imported_messages.toLocaleString()}</td>
                      <td style={{ padding: '.5rem .75rem', color: '#7fa8d0' }}>{fmtBytes(u.imported_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* New import form */}
      <div style={{ ...S.card, marginBottom: '1.5rem' }}>
        <h2 style={{ fontWeight: 700, color: '#0f2040', marginBottom: '1.25rem', fontSize: '1rem' }}>New import</h2>

        {/* Provider tabs */}
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {PROVIDERS.map(p => (
            <button key={p.key} onClick={() => { setProvider(p.key); setCreds({}); setTestResult(null); }}
              style={{ padding: '.5rem 1rem', borderRadius: 8, border: `1.5px solid ${provider === p.key ? '#2563eb' : '#dbeafe'}`, background: provider === p.key ? 'rgba(37,99,235,.08)' : 'transparent', color: provider === p.key ? '#2563eb' : '#3b5f8a', fontWeight: provider === p.key ? 700 : 400, cursor: 'pointer', fontSize: '0.85rem' }}>
              {p.icon} {p.label}
            </button>
          ))}
        </div>

        {/* Zoho: show OAuth connect button OR "connected" state */}
        {provider === 'zoho' && !zohoConnected && (
          <div style={{ background: 'rgba(37,99,235,.05)', border: '1px solid rgba(37,99,235,.2)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
            <div>
              <div style={{ fontWeight: 600, color: '#1e3a5f', marginBottom: '.2rem' }}>Connect with Zoho</div>
              <div style={{ color: '#7fa8d0', fontSize: '0.8rem' }}>One click — no manual token needed. Redirects to Zoho to authorise.</div>
            </div>
            <a href="/api/auth/zoho" style={{ ...S.btn('#2563eb'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
              🔵 Connect Zoho
            </a>
          </div>
        )}
        {provider === 'zoho' && zohoConnected && (
          <div style={{ background: 'rgba(22,163,74,.06)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 10, padding: '.85rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
            <div style={{ color: '#16a34a', fontWeight: 600 }}>✓ Connected as {zohoConnected.displayEmail || 'Zoho account'}</div>
            <button onClick={() => { setZohoConnected(null); setCreds({}); }} style={{ ...S.btn('#dc2626', true), fontSize: '0.78rem', padding: '.35rem .8rem' }}>Disconnect</button>
          </div>
        )}

        {/* Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          {fields.map(f => (
            <div key={f.key} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : {}}>
              <label style={S.label}>{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea style={{ ...S.inp, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.78rem' }} rows={f.rows ?? 4}
                  placeholder={f.placeholder} value={creds[f.key] ?? ''} onChange={e => setCreds(p => ({ ...p, [f.key]: e.target.value }))} />
              ) : (
                <input style={S.inp} type={f.type ?? 'text'} placeholder={f.placeholder}
                  value={creds[f.key] ?? ''} onChange={e => setCreds(p => ({ ...p, [f.key]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>

        {testResult && (
          <div style={{ background: testResult.ok ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.06)', border: `1px solid ${testResult.ok ? 'rgba(22,163,74,.25)' : 'rgba(220,38,38,.2)'}`, borderRadius: 8, padding: '.75rem 1rem', color: testResult.ok ? '#16a34a' : '#dc2626', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
          <button onClick={testCreds} style={S.btn('#64748b')} disabled={testing}>{testing ? 'Validating…' : 'Validate credentials'}</button>
          <button onClick={startImport} style={S.btn()} disabled={starting || !testResult?.ok}>{starting ? 'Starting…' : 'Start import'}</button>
        </div>
        <p style={{ color: '#7fa8d0', fontSize: '0.78rem', marginTop: '.75rem' }}>Validate first to check your credentials, then start the import. All mailboxes in your source will be migrated.</p>
      </div>

      {/* Past jobs */}
      {!loadingJobs && jobs.length > 0 && (
        <div style={S.card}>
          <h2 style={{ fontWeight: 700, color: '#0f2040', marginBottom: '1rem', fontSize: '1rem' }}>Import history</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {jobs.map(j => (
              <div key={j.id} style={{ padding: '.85rem 1rem', background: '#eff6ff', borderRadius: 9, border: '1px solid #dbeafe' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                    <span style={{ color: '#1e3a5f', fontWeight: 600, textTransform: 'capitalize' }}>{j.source_type}</span>
                    {j.source_host && <span style={{ color: '#3b5f8a', fontSize: '0.8rem' }}>{j.source_host}</span>}
                  </div>
                  <StatusBadge status={j.status} />
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: '#7fa8d0', flexWrap: 'wrap' }}>
                  <span>{j.completed_users} / {j.total_users ?? '?'} users</span>
                  <span>{j.imported_messages.toLocaleString()} emails</span>
                  <span>{fmtBytes(j.imported_bytes)}</span>
                  <span>{new Date(j.created_at).toLocaleDateString()}</span>
                </div>
                {j.error_message && <div style={{ color: '#dc2626', fontSize: '0.78rem', marginTop: '.4rem' }}>{j.error_message}</div>}
                {(j.status === 'running' || j.status === 'pending') && j.id !== activeJobId && (
                  <button onClick={() => startSse(j.id)} style={{ ...S.btn('#64748b'), marginTop: '.6rem', fontSize: '0.75rem' }}>Watch progress</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
