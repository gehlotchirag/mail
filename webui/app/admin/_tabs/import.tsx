'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download, Play, Square, RefreshCw, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle, Clock, Loader2, User, Database,
} from 'lucide-react';
import { apiFetch } from '@/lib/browser-navigation';

type SourceType = 'cpanel' | 'gsuite' | 'zoho' | 'dovecot';
type JobStatus = 'pending' | 'discovering' | 'migrating' | 'paused' | 'completed' | 'failed' | 'cancelled';
type UserStatus = 'pending' | 'creating' | 'migrating' | 'completed' | 'failed' | 'skipped';

interface MigrationUser {
  id: string;
  source_email: string;
  target_email: string;
  status: UserStatus;
  imported_messages: number;
  failed_messages: number;
  imported_bytes: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface MigrationJob {
  id: string;
  workspace_id: string;
  initiated_by: string;
  source_type: SourceType;
  source_host: string;
  status: JobStatus;
  total_users: number | null;
  completed_users: number;
  failed_users: number;
  imported_messages: number;
  imported_bytes: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  users?: MigrationUser[];
}

const SOURCE_CONFIGS: Record<SourceType, {
  label: string;
  icon: string;
  desc: string;
  fields: { key: string; label: string; type: string; placeholder: string; hint?: string }[];
}> = {
  cpanel: {
    label: 'cPanel / WHM',
    icon: '🖥',
    desc: 'Migrate all email accounts from a cPanel/WHM server using WHM API + Dovecot master-user access. No per-user passwords needed.',
    fields: [
      {
        key: 'host', label: 'WHM Hostname', type: 'text', placeholder: 'cpanel.yourdomain.com',
        hint: 'The hostname or IP of your WHM server. Usually the same as your cPanel login URL without the port.',
      },
      {
        key: 'adminUser', label: 'WHM Admin Username', type: 'text', placeholder: 'root',
        hint: 'Your WHM root or reseller username. Log into WHM — your username is shown top-right.',
      },
      {
        key: 'adminToken', label: 'WHM API Token', type: 'password', placeholder: 'Paste token here',
        hint: 'WHM → Home → Development → Manage API Tokens → Create Token. Name it anything, select "All" permissions.',
      },
      {
        key: 'masterPass', label: 'Dovecot Master Password', type: 'password', placeholder: 'Master user password',
        hint: 'The password for the Dovecot master user (usually configured in /etc/dovecot/conf.d/auth-master.conf on your server). Ask your hosting provider if unsure.',
      },
    ],
  },
  gsuite: {
    label: 'Google Workspace',
    icon: '📧',
    desc: 'Migrate from Google Workspace using a service account with domain-wide delegation. Discovers all users automatically.',
    fields: [
      {
        key: 'domain', label: 'Google Workspace Domain', type: 'text', placeholder: 'yourcompany.com',
        hint: 'Your primary Google Workspace domain (the part after @ in your email addresses).',
      },
      {
        key: 'serviceAccountJson', label: 'Service Account JSON', type: 'textarea', placeholder: '{"type": "service_account", "project_id": "..."}',
        hint: 'Google Cloud Console → IAM & Admin → Service Accounts → Create → Grant domain-wide delegation → Keys → Add Key → JSON. Then in Google Admin Console → Security → API Controls → Domain-wide Delegation → Add the client ID with scope: https://mail.google.com/',
      },
      {
        key: 'adminEmail', label: 'Super Admin Email', type: 'email', placeholder: 'admin@yourcompany.com',
        hint: 'A Google Workspace Super Admin email. The service account impersonates this user to discover and access all mailboxes.',
      },
    ],
  },
  zoho: {
    label: 'Zoho Workplace',
    icon: '📮',
    desc: 'Migrate from Zoho Mail using the Zoho Admin API. Requires an OAuth2 access token with organization and mail read scopes.',
    fields: [
      {
        key: 'domain', label: 'Zoho Domain', type: 'text', placeholder: 'yourcompany.com',
        hint: 'Your organization\'s email domain in Zoho (the part after @ in your Zoho email addresses).',
      },
      {
        key: 'orgId', label: 'Zoho Organization ID', type: 'text', placeholder: '123456789',
        hint: 'Zoho Admin Console (mail.zoho.com/ac) → Settings → Organization → scroll down to find "Organization ID". It\'s a numeric ID.',
      },
      {
        key: 'accessToken', label: 'Zoho OAuth2 Access Token', type: 'password', placeholder: 'Paste token here',
        hint: 'Generate at api-console.zoho.com → Self Client → Create → Scope: ZohoMail.organization.accounts.READ,ZohoMail.messages.READ → Duration: 10 minutes → Generate. Copy the access token immediately.',
      },
      {
        key: 'region', label: 'Zoho Region', type: 'select:com,in,eu,com.au,jp', placeholder: 'com (Global)',
        hint: 'Select the Zoho data center for your account. India accounts use mail.zoho.in, EU accounts use mail.zoho.eu. Check your Zoho login URL if unsure.',
      },
    ],
  },
  dovecot: {
    label: 'Dovecot / IMAP',
    icon: '📬',
    desc: 'Migrate from any Dovecot or IMAP server using master-user authentication. Paste the list of user emails to migrate.',
    fields: [
      {
        key: 'host', label: 'IMAP Server Hostname', type: 'text', placeholder: 'mail.yourdomain.com',
        hint: 'Hostname or IP of your IMAP server. This is usually your incoming mail server address.',
      },
      {
        key: 'port', label: 'IMAP Port', type: 'text', placeholder: '993',
        hint: 'Use 993 for IMAPS (SSL/TLS, recommended) or 143 for IMAP with STARTTLS.',
      },
      {
        key: 'masterUser', label: 'Master Username', type: 'text', placeholder: 'masteruser',
        hint: 'The Dovecot master user configured in auth-master.conf. This user can authenticate as any other user on the server.',
      },
      {
        key: 'masterPass', label: 'Master Password', type: 'password', placeholder: 'Master user password',
        hint: 'Password for the master user account defined in your Dovecot configuration.',
      },
      {
        key: 'userList', label: 'User Emails (one per line)', type: 'textarea', placeholder: 'user1@domain.com\nuser2@domain.com\nuser3@domain.com',
        hint: 'List the email addresses you want to migrate, one per line. All mailbox contents will be copied for each user.',
      },
    ],
  },
};

function StatusBadge({ status }: { status: JobStatus | UserStatus }) {
  const map: Record<string, { color: string; label: string; dot?: string }> = {
    pending:     { color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',           label: 'Pending' },
    discovering: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',        label: 'Discovering',  dot: 'bg-blue-500' },
    creating:    { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',        label: 'Creating',     dot: 'bg-blue-500' },
    migrating:   { color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',    label: 'Migrating',    dot: 'bg-amber-500' },
    paused:      { color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400', label: 'Paused' },
    completed:   { color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',    label: 'Completed' },
    failed:      { color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',            label: 'Failed' },
    cancelled:   { color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',           label: 'Cancelled' },
    skipped:     { color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',           label: 'Skipped' },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.color}`}>
      {s.dot && <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${s.dot}`} />}
      {s.label}
    </span>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(start: string | null, end: string | null) {
  if (!start) return null;
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function JobCard({ job, onRefresh }: { job: MigrationJob; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [users, setUsers] = useState<MigrationUser[]>(job.users ?? []);
  const [jobStats, setJobStats] = useState({ completed_users: job.completed_users, failed_users: job.failed_users, imported_messages: job.imported_messages, imported_bytes: job.imported_bytes });
  const [cancelling, setCancelling] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActive = job.status === 'discovering' || job.status === 'migrating';

  // Fetch latest user list for this job
  const fetchUsers = useCallback(async () => {
    const r = await apiFetch(`/api/migration/${job.id}`);
    if (!r.ok) return;
    const data = await r.json() as { users?: MigrationUser[]; completed_users?: number; failed_users?: number; imported_messages?: number; imported_bytes?: number };
    if (data.users) setUsers(data.users);
    setJobStats({
      completed_users: data.completed_users ?? jobStats.completed_users,
      failed_users: data.failed_users ?? jobStats.failed_users,
      imported_messages: data.imported_messages ?? jobStats.imported_messages,
      imported_bytes: data.imported_bytes ?? jobStats.imported_bytes,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  useEffect(() => {
    if (!isActive) return;

    // Poll user list every 4s for real-time row updates
    pollRef.current = setInterval(fetchUsers, 4000);
    fetchUsers();

    // SSE only for terminal events (job done / failed)
    const es = new EventSource(`/api/migration/${job.id}/progress`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; users?: MigrationUser[] };
        if (evt.type === 'snapshot' && evt.users) {
          setUsers(evt.users);
        } else if (evt.type === 'job_completed' || evt.type === 'job_failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          es.close();
          onRefresh();
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* SSE error — polling keeps things alive */ };

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      es.close();
    };
  }, [isActive, job.id, fetchUsers, onRefresh]);

  async function cancel() {
    setCancelling(true);
    await apiFetch(`/api/migration/${job.id}`, { method: 'DELETE' });
    setCancelling(false);
    onRefresh();
  }

  const total = job.total_users ?? 0;
  const done = jobStats.completed_users + jobStats.failed_users;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const sourceLabel = SOURCE_CONFIGS[job.source_type]?.label ?? job.source_type;
  const duration = formatDuration(job.started_at, job.completed_at);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="px-4 py-3 bg-muted/30 flex items-start gap-3">
        <button onClick={() => { setExpanded(e => !e); if (!expanded) fetchUsers(); }} className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{sourceLabel}</span>
            <span className="text-xs text-muted-foreground">from</span>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground truncate max-w-[200px]">{job.source_host}</code>
            <StatusBadge status={job.status} />
            {duration && <span className="text-xs text-muted-foreground">· {duration}</span>}
          </div>

          {/* Progress bar + stats */}
          {total > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      job.status === 'failed' ? 'bg-red-500' :
                      job.status === 'completed' ? 'bg-green-500' : 'bg-primary'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{pct}%</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {done}/{total} users
                  {jobStats.failed_users > 0 && <span className="text-red-500 ml-1">({jobStats.failed_users} failed)</span>}
                </span>
                <span className="flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  {jobStats.imported_messages.toLocaleString()} messages
                </span>
                <span>{formatBytes(jobStats.imported_bytes)}</span>
              </div>
            </div>
          )}

          {/* Discovering state — no users yet */}
          {job.status === 'discovering' && !total && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Discovering user accounts on source server…
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isActive && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          {isActive && (
            <button
              onClick={cancel}
              disabled={cancelling}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              Cancel
            </button>
          )}
          <span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Error banner */}
      {job.error_message && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-950/20 text-xs text-red-600 dark:text-red-400 flex items-start gap-2 border-t border-red-200 dark:border-red-900/40">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {job.error_message}
        </div>
      )}

      {/* Expanded per-user table */}
      {expanded && (
        <div className="border-t border-border">
          {users.length === 0 ? (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">
              {isActive ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Discovering accounts on source server…
                </span>
              ) : 'No user records found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Source email</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Messages</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Size</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-foreground">{u.source_email}</td>
                      <td className="px-4 py-2"><StatusBadge status={u.status} /></td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {u.imported_messages.toLocaleString()}
                        {u.failed_messages > 0 && <span className="text-red-500 ml-1">({u.failed_messages} failed)</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatBytes(u.imported_bytes)}</td>
                      <td className="px-4 py-2 text-muted-foreground max-w-[200px] truncate">
                        {u.error_message
                          ? <span className="text-red-500">{u.error_message}</span>
                          : u.status === 'completed' && u.started_at
                          ? formatDuration(u.started_at, u.completed_at)
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

type Step = 'source' | 'credentials' | 'confirm';

export function ImportTab() {
  const [jobs, setJobs] = useState<MigrationJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Wizard state
  const [step, setStep] = useState<Step>('source');
  const [sourceType, setSourceType] = useState<SourceType>('cpanel');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; userCount?: number; message?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const config = SOURCE_CONFIGS[sourceType];

  function resetWizard() {
    setStep('source');
    setFields({});
    setTestResult(null);
    setSubmitError('');
  }

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const r = await apiFetch('/api/migration');
      if (r.ok) setJobs(await r.json());
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  async function handleTest(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);
    try {
      const r = await apiFetch('/api/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType, credentials: fields, testOnly: true }),
      });
      const data = await r.json();
      setTestResult(data);
      if (data.ok) setStep('confirm');
    } catch {
      setTestResult({ ok: false, message: 'Request failed — check your network' });
    } finally {
      setTesting(false);
    }
  }

  async function handleStart() {
    setSubmitting(true);
    setSubmitError('');
    try {
      const r = await apiFetch('/api/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType, credentials: fields }),
      });
      const data = await r.json();
      if (!r.ok) { setSubmitError(data.error ?? 'Failed to start migration'); return; }
      resetWizard();
      await loadJobs();
    } catch {
      setSubmitError('Request failed — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Download className="w-5 h-5" /> Email Import
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Migrate entire mail servers into Arham Workspace. Enter one set of admin credentials —
          the system discovers all accounts and migrates all email in the background.
        </p>
      </div>

      {/* ── Wizard ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        {/* Step indicator */}
        <div className="flex border-b border-border bg-muted/20">
          {(['source', 'credentials', 'confirm'] as Step[]).map((s, i) => {
            const labels = ['1. Source', '2. Credentials', '3. Confirm'];
            const active = s === step;
            const done = (step === 'credentials' && s === 'source') || (step === 'confirm' && s !== 'confirm');
            return (
              <div key={s} className={`flex-1 px-4 py-2.5 text-xs font-medium text-center transition-colors border-r last:border-r-0 border-border ${active ? 'bg-background text-foreground' : done ? 'text-primary cursor-pointer hover:bg-muted/50' : 'text-muted-foreground'}`}
                onClick={() => { if (done) setStep(s); }}>
                {done ? <CheckCircle className="w-3.5 h-3.5 inline mr-1 text-green-500" /> : null}
                {labels[i]}
              </div>
            );
          })}
        </div>

        <div className="p-5">
          {/* Step 1: Source type */}
          {step === 'source' && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-foreground">Where are the emails coming from?</p>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(SOURCE_CONFIGS) as SourceType[]).map(type => {
                  const c = SOURCE_CONFIGS[type];
                  return (
                    <button
                      key={type}
                      onClick={() => { setSourceType(type); setFields({}); setTestResult(null); }}
                      className={`text-left px-4 py-3 rounded-lg border-2 transition-all ${
                        sourceType === type
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40 hover:bg-muted/50'
                      }`}
                    >
                      <div className="text-lg mb-0.5">{c.icon}</div>
                      <div className="text-sm font-medium text-foreground">{c.label}</div>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2 leading-relaxed">
                {config.desc}
              </p>
              <button
                onClick={() => setStep('credentials')}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Continue with {config.label} →
              </button>
            </div>
          )}

          {/* Step 2: Credentials */}
          {step === 'credentials' && (
            <form onSubmit={handleTest} className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Enter {config.label} credentials</p>
                <button type="button" onClick={() => setStep('source')} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
              </div>

              {config.fields.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-foreground mb-1">{f.label}</label>
                  {f.hint && (
                    <p className="text-xs text-muted-foreground mb-1.5 leading-relaxed">{f.hint}</p>
                  )}
                  {f.type === 'textarea' ? (
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y min-h-[90px] focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={f.placeholder}
                      value={fields[f.key] ?? ''}
                      onChange={e => setFields(p => ({ ...p, [f.key]: e.target.value }))}
                      required
                    />
                  ) : f.type.startsWith('select:') ? (
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={fields[f.key] ?? f.type.split(':')[1]?.split(',')[0] ?? ''}
                      onChange={e => setFields(p => ({ ...p, [f.key]: e.target.value }))}
                    >
                      {f.type.split(':')[1]?.split(',').map(opt => (
                        <option key={opt} value={opt}>{opt === 'com' ? 'com — Global' : opt === 'in' ? 'in — India' : opt === 'eu' ? 'eu — Europe' : opt === 'com.au' ? 'com.au — Australia' : opt === 'jp' ? 'jp — Japan' : opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={f.placeholder}
                      value={fields[f.key] ?? ''}
                      onChange={e => setFields(p => ({ ...p, [f.key]: e.target.value }))}
                      required
                    />
                  )}
                </div>
              ))}

              {testResult && !testResult.ok && (
                <div className="rounded-md px-3 py-2.5 text-sm flex items-start gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {testResult.message ?? 'Connection failed'}
                </div>
              )}

              <button
                type="submit"
                disabled={testing}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {testing ? <><Loader2 className="w-4 h-4 animate-spin" /> Validating credentials…</> : 'Validate & Continue →'}
              </button>
            </form>
          )}

          {/* Step 3: Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Ready to start migration</p>
                <button type="button" onClick={() => setStep('credentials')} className="text-xs text-muted-foreground hover:text-foreground">← Edit credentials</button>
              </div>

              <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 px-4 py-3 flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">Credentials validated</p>
                  <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                    {testResult?.userCount != null
                      ? `${testResult.userCount} user account${testResult.userCount === 1 ? '' : 's'} discovered on source server`
                      : testResult?.message ?? 'Source server accepted credentials — user discovery runs when migration starts'}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/30 border border-border px-4 py-3 space-y-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground text-sm">What happens next</p>
                <ul className="space-y-1.5 list-none">
                  <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">1.</span> Worker discovers all user accounts on <strong className="text-foreground">{fields.host ?? fields.domain ?? sourceType}</strong></li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">2.</span> Creates each user account in Arham Workspace</li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">3.</span> Connects via IMAP master-user and migrates all folders and messages</li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">4.</span> Progress shown live below — you can close this page and come back anytime</li>
                </ul>
              </div>

              {submitError && (
                <div className="rounded-md px-3 py-2 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{submitError}
                </div>
              )}

              <button
                onClick={handleStart}
                disabled={submitting}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Play className="w-4 h-4" /> Start migration</>}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Job list ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Migration jobs</h3>
          <button
            onClick={loadJobs}
            disabled={loadingJobs}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingJobs ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {loadingJobs && jobs.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-10 border border-dashed border-border rounded-xl">
            <Download className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p>No migration jobs yet.</p>
            <p className="text-xs mt-1">Start one above to migrate your first mail server.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => (
              <JobCard key={job.id} job={job} onRefresh={loadJobs} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
