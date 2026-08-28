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
  card: { background: '#161b27', border: '1px solid #1e2535', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  inp: { width: '100%', padding: '.65rem .9rem', background: '#1e2535', border: '1px solid #2d3448', borderRadius: 8, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' as const } as React.CSSProperties,
  btn: (c = '#6366f1', outline = false) => ({ padding: '.6rem 1.2rem', background: outline ? 'transparent' : c, color: outline ? c : '#fff', border: `1.5px solid ${c}`, borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }) as React.CSSProperties,
  label: { display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: '.3rem' },
};

const PROVIDERS = [
  { key: 'zoho',    label: 'Zoho Mail',          icon: '🔵' },
  { key: 'gsuite',  label: 'Google Workspace',   icon: '🔴' },
  { key: 'cpanel',  label: 'cPanel / WHM',        icon: '🟠' },
  { key: 'dovecot', label: 'Dovecot / IMAP',      icon: '🟣' },
];

const FIELDS: Record<string, { key: string; label: string; placeholder: string; type?: string; rows?: number }[]> = {
  zoho: [
    { key: 'domain',      label: 'Your Zoho domain',      placeholder: 'company.com' },
    { key: 'orgId',       label: 'Zoho Org ID',           placeholder: 'From Zoho Admin → Settings → Org Details' },
    { key: 'accessToken', label: 'OAuth Access Token',     placeholder: 'Zoho OAuth2 bearer token', type: 'password' },
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
    pending:   ['rgba(100,116,139,.2)', '#94a3b8'],
    running:   ['rgba(99,102,241,.15)', '#818cf8'],
    completed: ['rgba(34,197,94,.12)',  '#4ade80'],
    failed:    ['rgba(239,68,68,.12)',  '#f87171'],
    cancelled: ['rgba(251,191,36,.1)',  '#fbbf24'],
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
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>Import Email</h1>
        <p style={{ color: '#64748b', marginTop: '.25rem', fontSize: '0.875rem' }}>Migrate all mailboxes from Zoho, Google Workspace, cPanel, or Dovecot into your workspace</p>
      </div>

      {msg && <div style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#4ade80', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#f87171', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {/* Live job progress */}
      {displayJob && (displayJob.status === 'running' || displayJob.status === 'pending') && (
        <div style={{ ...S.card, marginBottom: '1.5rem', borderColor: 'rgba(99,102,241,.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#e2e8f0' }}>Import in progress — <span style={{ color: '#a5b4fc', textTransform: 'capitalize' }}>{displayJob.source_type}</span></div>
              {displayJob.source_host && <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '.15rem' }}>{displayJob.source_host}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <StatusBadge status={displayJob.status} />
              <button onClick={() => cancelJob(displayJob.id)} style={S.btn('#7f1d1d')}>Cancel</button>
            </div>
          </div>

          {/* Progress bar */}
          {displayJob.total_users != null && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.78rem', marginBottom: '.4rem' }}>
                <span>{displayJob.completed_users} / {displayJob.total_users} users</span>
                <span>{displayJob.imported_messages.toLocaleString()} emails · {fmtBytes(displayJob.imported_bytes)}</span>
              </div>
              <div style={{ background: '#1e2535', borderRadius: 99, height: 8 }}>
                <div style={{ background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', borderRadius: 99, height: 8, width: `${Math.round((displayJob.completed_users / displayJob.total_users) * 100)}%`, transition: 'width .5s ease' }} />
              </div>
              {displayJob.failed_users > 0 && <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '.3rem' }}>{displayJob.failed_users} user{displayJob.failed_users !== 1 ? 's' : ''} failed</div>}
            </div>
          )}

          {/* Per-user table */}
          {displayJob.users && displayJob.users.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2d3448' }}>
                    {['Source', 'Target', 'Status', 'Messages', 'Size'].map(h => (
                      <th key={h} style={{ color: '#64748b', fontWeight: 600, padding: '.5rem .75rem', textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayJob.users.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #1e2535' }}>
                      <td style={{ padding: '.5rem .75rem', color: '#94a3b8' }}>{u.source_email}</td>
                      <td style={{ padding: '.5rem .75rem', color: '#e2e8f0' }}>{u.target_email}</td>
                      <td style={{ padding: '.5rem .75rem' }}><StatusBadge status={u.status} /></td>
                      <td style={{ padding: '.5rem .75rem', color: '#e2e8f0' }}>{u.imported_messages.toLocaleString()}</td>
                      <td style={{ padding: '.5rem .75rem', color: '#94a3b8' }}>{fmtBytes(u.imported_bytes)}</td>
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
        <h2 style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '1.25rem', fontSize: '1rem' }}>New import</h2>

        {/* Provider tabs */}
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {PROVIDERS.map(p => (
            <button key={p.key} onClick={() => { setProvider(p.key); setCreds({}); setTestResult(null); }}
              style={{ padding: '.5rem 1rem', borderRadius: 8, border: `1.5px solid ${provider === p.key ? '#6366f1' : '#2d3448'}`, background: provider === p.key ? 'rgba(99,102,241,.15)' : 'transparent', color: provider === p.key ? '#a5b4fc' : '#64748b', fontWeight: provider === p.key ? 700 : 400, cursor: 'pointer', fontSize: '0.85rem' }}>
              {p.icon} {p.label}
            </button>
          ))}
        </div>

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
          <div style={{ background: testResult.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)', border: `1px solid ${testResult.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`, borderRadius: 8, padding: '.75rem 1rem', color: testResult.ok ? '#4ade80' : '#f87171', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
          <button onClick={testCreds} style={S.btn('#334155')} disabled={testing}>{testing ? 'Validating…' : 'Validate credentials'}</button>
          <button onClick={startImport} style={S.btn()} disabled={starting || !testResult?.ok}>{starting ? 'Starting…' : 'Start import'}</button>
        </div>
        <p style={{ color: '#475569', fontSize: '0.78rem', marginTop: '.75rem' }}>Validate first to check your credentials, then start the import. All mailboxes in your source will be migrated.</p>
      </div>

      {/* Past jobs */}
      {!loadingJobs && jobs.length > 0 && (
        <div style={S.card}>
          <h2 style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem', fontSize: '1rem' }}>Import history</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {jobs.map(j => (
              <div key={j.id} style={{ padding: '.85rem 1rem', background: '#0f1117', borderRadius: 9, border: '1px solid #2d3448' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                    <span style={{ color: '#e2e8f0', fontWeight: 600, textTransform: 'capitalize' }}>{j.source_type}</span>
                    {j.source_host && <span style={{ color: '#475569', fontSize: '0.8rem' }}>{j.source_host}</span>}
                  </div>
                  <StatusBadge status={j.status} />
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: '#64748b', flexWrap: 'wrap' }}>
                  <span>{j.completed_users} / {j.total_users ?? '?'} users</span>
                  <span>{j.imported_messages.toLocaleString()} emails</span>
                  <span>{fmtBytes(j.imported_bytes)}</span>
                  <span>{new Date(j.created_at).toLocaleDateString()}</span>
                </div>
                {j.error_message && <div style={{ color: '#f87171', fontSize: '0.78rem', marginTop: '.4rem' }}>{j.error_message}</div>}
                {(j.status === 'running' || j.status === 'pending') && j.id !== activeJobId && (
                  <button onClick={() => startSse(j.id)} style={{ ...S.btn('#334155'), marginTop: '.6rem', fontSize: '0.75rem' }}>Watch progress</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
