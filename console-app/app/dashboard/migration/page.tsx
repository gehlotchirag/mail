'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

interface MigrationUser {
  id: string; source_email: string; target_email: string; status: string;
  imported_messages: number; failed_messages: number; imported_bytes: number;
  error_message?: string; started_at?: string; completed_at?: string;
}
interface MigrationEvent {
  id: number; event_type: string; payload: Record<string, unknown>;
  created_at: string; user_email?: string;
}
interface MigrationJob {
  id: string; source_type: string; source_host: string; status: string;
  total_users: number | null; completed_users: number; failed_users: number;
  imported_messages: number; imported_bytes: number; error_message?: string;
  created_at: string; started_at?: string; completed_at?: string;
  users: MigrationUser[] | null;
  recent_events?: MigrationEvent[] | null;
  /** Mailboxes in this job that have a stored sign-in password. */
  credential_count?: number;
}

const S = {
  card: { background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 12, padding: '1.5rem' } as React.CSSProperties,
  inp: { width: '100%', padding: '.65rem .9rem', background: '#F0F4FF', border: '1px solid #bfdbfe', borderRadius: 8, color: '#374264', outline: 'none', boxSizing: 'border-box' as const } as React.CSSProperties,
  btn: (c = '#2F56FF', outline = false) => ({ padding: '.6rem 1.2rem', background: outline ? 'transparent' : c, color: outline ? c : '#fff', border: `1.5px solid ${c}`, borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }) as React.CSSProperties,
  label: { display: 'block', color: '#7A8CAE', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: '.3rem' },
};

interface ZohoTokens {
  accessToken: string; refreshToken: string;
  orgId: string; displayEmail: string; region: string;
  isPersonal?: boolean;
}

const PROVIDERS = [
  { key: 'zoho',    label: 'Zoho Mail',        icon: '🔵', desc: 'OAuth — auto-discovers mailboxes' },
  { key: 'gsuite',  label: 'Google Workspace', icon: '🔴', desc: 'Service account, domain-wide delegation' },
  { key: 'cpanel',  label: 'cPanel / WHM',      icon: '🟠', desc: 'WHM API token' },
  { key: 'dovecot', label: 'Dovecot / IMAP',    icon: '🟣', desc: 'IMAP master-user login' },
];

const FIELDS: Record<string, { key: string; label: string; placeholder: string; type?: string; rows?: number }[]> = {
  zoho: [
    { key: 'domain',      label: 'Your Zoho domain',  placeholder: 'company.com' },
    { key: 'orgId',       label: 'Zoho Org ID',        placeholder: 'Auto-filled after Connect' },
    { key: 'accessToken', label: 'Access Token (manual fallback)', placeholder: 'Only needed if not using Connect above', type: 'password' },
  ],
  gsuite: [
    { key: 'domain',             label: 'Google Workspace domain', placeholder: 'company.com' },
    { key: 'adminEmail',         label: 'Super Admin email',       placeholder: 'admin@company.com' },
    { key: 'serviceAccountJson', label: 'Service Account JSON',    placeholder: '{"type":"service_account",...}', type: 'textarea', rows: 5 },
  ],
  cpanel: [
    { key: 'host',       label: 'WHM Hostname / IP',    placeholder: 'mail.company.com' },
    { key: 'adminUser',  label: 'WHM Admin Username',   placeholder: 'root' },
    { key: 'adminToken', label: 'WHM API Token',        placeholder: 'API token from WHM', type: 'password' },
    { key: 'masterPass', label: 'Mail Master Password', placeholder: 'cPanel master password', type: 'password' },
  ],
  dovecot: [
    { key: 'host',       label: 'IMAP Server',    placeholder: 'mail.company.com:993' },
    { key: 'masterUser', label: 'Master Username', placeholder: 'dovecotadmin' },
    { key: 'masterPass', label: 'Master Password', placeholder: 'Master password', type: 'password' },
  ],
};

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function fmtRelTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return `${Math.round(diff / 3600000)}h ago`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending:     ['rgba(148,163,184,.15)', '#7A8CAE'],
    discovering: ['rgba(168,85,247,.12)',  '#7c3aed'],
    migrating:   ['rgba(37,99,235,.1)',    '#2F56FF'],
    running:     ['rgba(37,99,235,.1)',    '#2F56FF'],
    completed:   ['rgba(22,163,74,.1)',    '#0B9E58'],
    failed:      ['rgba(220,38,38,.1)',    '#B0231F'],
    cancelled:   ['rgba(217,119,6,.1)',    '#d97706'],
  };
  const [bg, color] = map[status] ?? map.pending;
  return (
    <span style={{ background: bg, color, fontSize: '0.7rem', fontWeight: 700, padding: '.2rem .55rem', borderRadius: 5, textTransform: 'uppercase', letterSpacing: '.4px' }}>
      {status}
    </span>
  );
}

const EVENT_META: Record<string, { icon: string; label: (p: Record<string, unknown>, email?: string) => string }> = {
  discovery_complete: { icon: '🔍', label: (p) => `Discovered ${p.userCount ?? '?'} user${Number(p.userCount) !== 1 ? 's' : ''}` },
  user_started:      { icon: '👤', label: (p) => `Starting migration — ${p.sourceEmail ?? ''}` },
  user_enqueued:     { icon: '📋', label: (p, e) => `${e ?? p.sourceEmail ?? ''} — queued for migration` },
  user_failed:       { icon: '❌', label: (p, e) => `${e ?? p.sourceEmail ?? ''} — failed: ${String(p.error ?? '').slice(0, 80)}` },
  folder_enqueued:   { icon: '📁', label: (p) => `${p.folderName ?? p.folder ?? ''}: ${p.messageCount ?? '?'} messages queued` },
  message_batch:     { icon: '📬', label: (p) => `${p.folder ?? ''}: ${p.imported ?? 0} imported${p.failed ? `, ${p.failed} failed` : ''} (${fmtBytes(Number(p.bytes ?? 0))})` },
  batch_failed:      { icon: '⚠️',  label: (p) => `${p.folder ?? ''}: batch of ${p.messages ?? '?'} failed — ${String(p.error ?? '').slice(0, 60)}` },
  pagination_aborted:{ icon: '⏹️', label: (p) => `${p.folderName ?? ''}: pagination aborted` },
};

function EventFeed({ events }: { events: MigrationEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length]);

  if (!events.length) return null;
  const sorted = [...events].sort((a, b) => a.id - b.id);
  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ color: '#7A8CAE', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.5rem' }}>Activity</div>
      <div style={{ background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 8, padding: '.5rem .75rem', maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        {sorted.map(ev => {
          const meta = EVENT_META[ev.event_type];
          const icon = meta?.icon ?? '•';
          const label = meta ? meta.label(ev.payload, ev.user_email) : `${ev.event_type}`;
          return (
            <div key={ev.id} style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', fontSize: '0.78rem' }}>
              <span style={{ flexShrink: 0, fontSize: '0.85rem' }}>{icon}</span>
              <span style={{ color: '#374264', flex: 1, lineHeight: 1.4 }}>{label}</span>
              <span style={{ flexShrink: 0, color: '#94a3b8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{fmtRelTime(ev.created_at)}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

const PHASES = [
  { key: 'pending',     label: 'Queued' },
  { key: 'discovering', label: 'Discovering' },
  { key: 'migrating',   label: 'Migrating' },
  { key: 'completed',   label: 'Done' },
];

function PhaseBar({ status }: { status: string }) {
  const activeIdx = status === 'failed' || status === 'cancelled'
    ? -1
    : PHASES.findIndex(p => p.key === status);
  const doneIdx = status === 'completed' ? PHASES.length : activeIdx;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: '1.25rem' }}>
      {PHASES.map((p, i) => {
        const done    = i < doneIdx;
        const current = i === activeIdx && status !== 'completed';
        const future  = !done && !current;
        const color = done ? '#0B9E58' : current ? '#2F56FF' : '#94a3b8';
        return (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', flex: i < PHASES.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: current ? '#2F56FF' : done ? '#0B9E58' : '#e2e8f0', border: `2px solid ${color}`, flexShrink: 0, boxShadow: current ? '0 0 0 3px rgba(37,99,235,.2)' : 'none' }} />
              <span style={{ fontSize: '0.72rem', fontWeight: current ? 700 : 500, color, whiteSpace: 'nowrap' }}>{p.label}</span>
            </div>
            {i < PHASES.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? '#86efac' : '#e2e8f0', margin: '0 .4rem', minWidth: 20 }} />
            )}
          </div>
        );
        void future;
      })}
    </div>
  );
}

function UserRow({ u }: { u: MigrationUser }) {
  const isRunning = u.status === 'running';
  const isFailed  = u.status === 'failed';
  return (
    <div style={{ padding: '.85rem 1rem', background: isRunning ? 'rgba(37,99,235,.04)' : isFailed ? 'rgba(220,38,38,.04)' : '#F0F4FF', border: `1px solid ${isRunning ? '#bfdbfe' : isFailed ? 'rgba(220,38,38,.2)' : '#e8f0fd'}`, borderRadius: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', minWidth: 0 }}>
          {isRunning && (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2F56FF', display: 'inline-block', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
          )}
          <span style={{ color: '#374264', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.source_email}</span>
          {u.source_email !== u.target_email && (
            <>
              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>→</span>
              <span style={{ color: '#7A8CAE', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.target_email}</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0 }}>
          <StatusBadge status={u.status} />
          <span style={{ color: '#7A8CAE', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>{u.imported_messages.toLocaleString()} emails</span>
          <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{fmtBytes(u.imported_bytes)}</span>
          {u.failed_messages > 0 && (
            <span style={{ color: '#B0231F', fontSize: '0.78rem' }}>· {u.failed_messages} failed</span>
          )}
        </div>
      </div>
      {isFailed && u.error_message && (
        <div style={{ marginTop: '.5rem', color: '#B0231F', fontSize: '0.76rem', background: 'rgba(220,38,38,.06)', padding: '.4rem .7rem', borderRadius: 5 }}>
          {u.error_message}
        </div>
      )}
    </div>
  );
}

function LiveJobPanel({ job, onCancel, onRetry }: { job: MigrationJob; onCancel: () => void; onRetry?: () => void }) {
  const isActive = job.status === 'running' || job.status === 'pending' || job.status === 'discovering' || job.status === 'migrating';
  const isDone   = job.status === 'completed';
  const isFailed = job.status === 'failed' || job.status === 'cancelled';

  const pct = job.total_users
    ? Math.min(100, Math.round((job.completed_users / job.total_users) * 100))
    : 0;

  const providerLabel = PROVIDERS.find(p => p.key === job.source_type)?.label ?? job.source_type ?? 'Unknown provider';
  const events = job.recent_events ?? [];

  return (
    <div style={{ ...S.card, marginBottom: '1.5rem', borderColor: isDone ? '#86efac' : isFailed ? 'rgba(220,38,38,.3)' : '#bfdbfe' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <div>
          <div style={{ fontWeight: 700, color: '#0A1228', fontSize: '1rem' }}>
            {isDone ? '✓ Import complete' : isFailed ? 'Import stopped' : `Importing from ${providerLabel}`}
          </div>
          {job.source_host && <div style={{ color: '#7A8CAE', fontSize: '0.8rem', marginTop: '.1rem' }}>{job.source_host}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <StatusBadge status={job.status} />
          {isActive && (
            <button onClick={onCancel} style={S.btn('#B0231F')}>Cancel</button>
          )}
          {(isFailed || job.status === 'cancelled') && onRetry && (
            <button onClick={onRetry} style={S.btn('#2F56FF')}>Retry import</button>
          )}
        </div>
      </div>

      {/* Phase stepper */}
      <PhaseBar status={job.status} />

      {/* Stats strip */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '.75rem 1rem', background: '#F0F4FF', borderRadius: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0A1228', fontVariantNumeric: 'tabular-nums' }}>{job.imported_messages.toLocaleString()}</div>
          <div style={{ fontSize: '0.7rem', color: '#7A8CAE', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>Emails</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0A1228' }}>{fmtBytes(job.imported_bytes)}</div>
          <div style={{ fontSize: '0.7rem', color: '#7A8CAE', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>Data</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0A1228', fontVariantNumeric: 'tabular-nums' }}>{job.completed_users} / {job.total_users ?? '?'}</div>
          <div style={{ fontSize: '0.7rem', color: '#7A8CAE', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>Users</div>
        </div>
        {job.failed_users > 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#B0231F', fontVariantNumeric: 'tabular-nums' }}>{job.failed_users}</div>
            <div style={{ fontSize: '0.7rem', color: '#B0231F', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>Failed</div>
          </div>
        )}
      </div>

      {/* Overall progress bar */}
      {job.total_users != null && job.total_users > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.72rem', marginBottom: '.35rem' }}>
            <span>Users migrated</span>
            <span>{pct}%</span>
          </div>
          <div style={{ background: '#dbeafe', borderRadius: 99, height: 7 }}>
            <div style={{ background: isDone ? 'linear-gradient(90deg,#0B9E58,#087A44)' : 'linear-gradient(90deg,#2F56FF,#1E40E0)', borderRadius: 99, height: 7, width: `${pct}%`, transition: 'width .6s ease' }} />
          </div>
        </div>
      )}

      {/* Per-user rows */}
      {job.users && job.users.length > 0 && (
        <div>
          <div style={{ color: '#7A8CAE', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.5rem' }}>
            Users ({job.users.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {job.users.map(u => <UserRow key={u.id} u={u} />)}
          </div>
        </div>
      )}

      {/* Activity feed */}
      {events.length > 0 && <EventFeed events={events} />}

      {/* Sign-in details for the mailboxes this job created. Without these the
          accounts exist but nobody can tell the users how to log in. */}
      {((job.credential_count ?? 0) > 0 || (job.users && job.users.length > 0)) && (
        <div style={{ marginTop: '1rem', background: 'rgba(37,99,235,.05)', border: '1px solid #bfdbfe', borderRadius: 9, padding: '.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#374264', fontWeight: 600, fontSize: '0.85rem' }}>Mailbox sign-in details</div>
            <div style={{ color: '#7A8CAE', fontSize: '0.78rem' }}>
              {job.credential_count
                ? `Passwords for the ${job.credential_count} mailbox(es) this import created — hand these to your users, then ask them to change it.`
                : 'Passwords for the accounts this import created — hand these to your users, then ask them to change it.'}
            </div>
          </div>
          <a href={`/api/migration/${job.id}/credentials?format=csv`}
             style={{ ...S.btn('#2F56FF'), textDecoration: 'none', fontSize: '0.78rem', padding: '.45rem 1rem' }}>
            ⬇ Download CSV
          </a>
        </div>
      )}

      {/* Error message */}
      {job.error_message && (
        <div style={{ marginTop: '1rem', color: '#B0231F', fontSize: '0.8rem', background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 7, padding: '.6rem .9rem' }}>
          {job.error_message}
        </div>
      )}

      {/* Recovery is automatic, not a per-mailbox button — the worker already
          retries a failing mailbox up to 5 times with backoff, and a
          background sweep re-queues anything left stuck every few minutes.
          Shown honestly rather than a manual "requeue" action the backend
          doesn't expose. */}
      {isFailed && job.failed_users > 0 && (
        <div style={{ marginTop: '1rem', color: '#374264', fontSize: '0.78rem', background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 7, padding: '.6rem .9rem', lineHeight: 1.5 }}>
          Failed mailboxes are retried automatically — each one gets up to 5 attempts with backoff before it&apos;s marked failed, and a background check re-queues anything left stuck every few minutes. Checkpoints mean a retry resumes where it left off rather than re-importing mail. Use <strong>Retry import</strong> above to start a fresh run if this job has stopped for good.
        </div>
      )}
    </div>
  );
}

interface DiscoveryPayload {
  domains?: Array<{ domain: string; userCount: number; alreadyAdded: boolean }>;
  mailboxes?: Array<{
    email: string; displayName: string; domain: string;
    imapEnabled: boolean; existsHere: boolean; role?: string; usedStorageMb?: number;
    tfaEnabled?: boolean; imapBlocked?: boolean;
  }>;
  partial?: boolean;
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
  const [tab, setTab] = useState<'import' | 'history'>('import');
  const sseRef = useRef<EventSource | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [zohoConnected, setZohoConnected] = useState<ZohoTokens | null>(null);
  // A source organisation spanning more domains than the plan allows is an upsell,
  // not an error — shown as a modal naming the domains rather than a red banner.
  const [domainLimit, setDomainLimit] = useState<{ message: string; domains: string[] } | null>(null);
  // What the connected Zoho organisation actually contains. A Zoho org is one
  // billing tenant that can hold several unrelated domains, so "connected" does not
  // imply "import all of this".
  const [orgDomains, setOrgDomains] = useState<Array<{ domain: string; userCount: number; alreadyAdded: boolean }>>([]);
  // Every mailbox in the connected Zoho org, with the status needed to decide what
  // to do with each one. Picking people by name is the difference between "reset
  // this whole domain and hope" and an action you can actually reason about.
  const [orgMailboxes, setOrgMailboxes] = useState<Array<{
    email: string; displayName: string; domain: string;
    imapEnabled: boolean; existsHere: boolean; role?: string; usedStorageMb?: number;
    tfaEnabled?: boolean; imapBlocked?: boolean;
  }>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mbFilter, setMbFilter] = useState('');
  const [mbDomain, setMbDomain] = useState('');
  const [discovering, setDiscovering] = useState(false);
  // Why the mailbox list is missing, if it is. Silently hiding the picker on a
  // failed lookup left no way to tell a broken call from an empty organisation.
  const [discoverError, setDiscoverError] = useState('');
  const [discoverProgress, setDiscoverProgress] = useState(0);
  /** Zoho's listing was cut short — the rows shown are real but incomplete. */
  const [discoverPartial, setDiscoverPartial] = useState(false);
  const [imapBusy, setImapBusy] = useState(false);
  const [imapResult, setImapResult] = useState<{ mode: string; enabled: number; already: number; failed: number; passwordsSet?: number; results: Array<{ email: string; status: string; error?: string }>; passwordFailures?: Array<{ email: string; error: string }>; skippedOwner?: string } | null>(null);
  // Live progress for a run in flight. The request that starts it returns almost
  // immediately (see enableZohoImap) — this is what shows the count climbing
  // instead of leaving the operator staring at a spinner with no number.
  const [imapProgress, setImapProgress] = useState<{ mode: string; total: number; processed: number; changed: number; unchanged: number; failed: number } | null>(null);
  const imapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // For setting a DIFFERENT, admin-chosen password on each of several named
  // mailboxes — as opposed to the bulk actions above, which put every selected
  // mailbox on the same shared value.
  const [pwEntriesText, setPwEntriesText] = useState('');
  const [pwShowValues, setPwShowValues] = useState(false);
  /**
   * The shared value used by a bulk reset, pre-filled with the house default.
   *
   * Deliberately NOT a generic string: Zoho refuses any password that has appeared
   * in a data breach, which is why the previous 'ChangeMe123' failed on every
   * single mailbox. This one is specific enough not to be in a wordlist, and the
   * operator can overwrite it or hit Generate for a random one.
   */
  const [sharedPassword, setSharedPassword] = useState('Arham#2026');
  /**
   * Send Zoho's `oneTimePassword` flag, so each user must choose their own password
   * at first login. Defaulted ON: without it a shared reset leaves every mailbox in
   * the run on one password indefinitely, which is the state that makes a bulk
   * reset dangerous rather than merely disruptive.
   */
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  /**
   * Have "Migrate" do the Zoho-side preparation itself (IMAP on, then a password we
   * can authenticate with) rather than relying on the operator to run two other
   * actions first, in the right order.
   */
  const [autoPrepare, setAutoPrepare] = useState(true);

  // Always load stored Zoho tokens on mount (used both after OAuth redirect and for Retry)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const afterOAuth = params.get('zoho_connected') === '1';

    fetch('/api/auth/zoho/tokens')
      .then(r => r.json() as Promise<{ tokens: ZohoTokens | null }>)
      .then(({ tokens }) => {
        if (tokens) {
          setZohoConnected(tokens);
          setProvider('zoho');
          const autoCreds = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            orgId: tokens.orgId,
            region: tokens.region,
            domain: tokens.displayEmail?.split('@')[1] ?? '',
            isPersonal: String(tokens.isPersonal ?? true),
          };
          setCreds(autoCreds);
          void discoverOrg(autoCreds);
          if (afterOAuth) {
            window.history.replaceState({}, '', '/dashboard/migration');
            // Written before the admin-API buttons existed. For an organisation the
            // app password is the wrong instruction: it only ever authenticates the
            // one mailbox that owns it.
            setMsg(tokens.isPersonal === false
              ? 'Zoho connected! Click "Start import" to begin.'
              : 'Zoho connected. To import every user, click "Prepare all mailboxes" — Zoho only lets an admin read their own mailbox otherwise.');
            setTimeout(() => setMsg(''), 10000);
          }
        }
      })
      .catch(() => {});

    if (params.get('error') === 'zoho_not_configured') {
      setError('Zoho OAuth is not configured yet. Contact your admin.');
      window.history.replaceState({}, '', '/dashboard/migration');
    }
    if (params.get('error') === 'oauth_failed') {
      setError('Zoho OAuth failed. Please try again.');
      window.history.replaceState({}, '', '/dashboard/migration');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadJobs = useCallback(async () => {
    const res = await fetch('/api/migration');
    if (res.ok) setJobs(await res.json() as MigrationJob[]);
    setLoadingJobs(false);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Domain cutover readiness — real data from the same /migration-readiness
  // endpoint the Domains detail page uses, just rolled up across every domain
  // in the org so this page can say "N domains are safe to cut over" without
  // duplicating that page's full DNS/DKIM UI.
  const [domainReadiness, setDomainReadiness] = useState<{
    loading: boolean;
    domains: Array<{ id: string; domain: string; ready: boolean | null; missing: number; sendingReady: boolean }>;
  }>({ loading: true, domains: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/domains');
      if (!res.ok || cancelled) return;
      const { domains } = await res.json() as { domains: Array<{ id: string; domain: string; verified: boolean }> };
      const verified = domains.filter(d => d.verified);
      const results = await Promise.all(verified.map(async d => {
        const r = await fetch(`/api/domains/${d.id}/migration-readiness`);
        if (!r.ok) return { id: d.id, domain: d.domain, ready: null as boolean | null, missing: 0, sendingReady: false };
        const g = await r.json() as { checked: boolean; missing?: string[]; sending?: { ready: boolean } };
        return {
          id: d.id, domain: d.domain,
          ready: g.checked ? (g.missing ?? []).length === 0 && !!g.sending?.ready : null,
          missing: g.missing?.length ?? 0,
          sendingReady: !!g.sending?.ready,
        };
      }));
      if (!cancelled) setDomainReadiness({ loading: false, domains: results });
    })().catch(() => { if (!cancelled) setDomainReadiness(p => ({ ...p, loading: false })); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const running = jobs.find(j => j.status === 'running' || j.status === 'pending' || j.status === 'discovering' || j.status === 'migrating');
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
    es.onerror = () => {
      es.close(); sseRef.current = null;
      // Reconnect after 5 s unless the job has already finished
      setTimeout(() => {
        setLiveJob(prev => {
          if (prev && ['completed', 'failed', 'cancelled'].includes(prev.status)) return prev;
          startSse(jobId);
          return prev;
        });
      }, 5000);
    };
  }

  // Zoho ships with IMAP off for every mailbox and no bulk switch in its admin
  // console, so without this an admin faces one manual toggle per user before any
  // mail can be read. Kept as an explicit action: it changes their Zoho settings.
  async function enableZohoImap(resetPasswords = false, disableImap = false) {
    const pw = resetPasswords ? resolveSharedPassword() : undefined;
    if (disableImap && !confirm(
      'Switch IMAP back OFF for the selected domains?\n\n'
      + 'This does NOT undo password resets — Zoho stores only hashes and offers no way to '
      + 'restore a previous password. Anyone already reset must set a new one in Zoho.\n\n'
      + 'It also cannot tell a mailbox we switched on from one that already had IMAP on, so '
      + 'those will be switched off too. Continue?')) return;

    if (resetPasswords && !confirm(
      `This will set a NEW password (${pw}) on every mailbox in your Zoho organisation.\n\n`
      + 'Those users will be signed out of Zoho and cannot sign back in until you give them '
      + 'the new password. Zoho has no way for an admin to read existing passwords, so this '
      + 'is the only way to migrate everyone without each person creating an app password.\n\n'
      + 'Do this at cutover, not before. Continue?')) return;

    setImapBusy(true); setImapResult(null); setImapProgress(null); setError('');
    try {
      // Starts the run and returns immediately with its id — the change itself
      // happens on the server after this call returns, so it is never bounded by
      // how long a browser request can stay open (an org over ~50 mailboxes was
      // timing out at nginx's 60s limit with the old inline version, silently
      // discarding the result — including passwords that had already been set).
      const res = await fetch('/api/migration/enable-imap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: creds, resetPasswords, disableImap, sharedPassword: pw, forcePasswordChange }),
      });
      const d = await res.json() as { error?: string; runId?: string };
      if (!res.ok || !d.runId) { setError(d.error ?? 'Could not start'); setTimeout(() => setError(''), 8000); setImapBusy(false); return; }

      pollImapRun(d.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setTimeout(() => setError(''), 6000);
      setImapBusy(false);
    }
  }

  /**
   * Resets Zoho passwords and does NOTHING else — IMAP is left exactly as it is.
   *
   * "Prepare mailboxes" also switches IMAP on, because it exists to make a
   * migration possible. For an organisation that is staying on Zoho and only needs
   * people back into their accounts, flipping a mail-access setting they never
   * asked for is an unwanted change to their live system.
   */
  /** A shared password Zoho will accept: unique, mixed, and not from any wordlist. */
  function makeSharedPassword() {
    const words = ['Harbour', 'Lantern', 'Meadow', 'Copper', 'Willow', 'Compass', 'Thistle', 'Quarry'];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    const n = 100 + Math.floor(Math.random() * 900);
    return `${pick()}-${pick()}-${n}`;
  }

  /**
   * The shared value for a bulk reset: whatever the operator typed, or a freshly
   * generated one if they left the box alone. Generating on demand means an empty
   * field can never produce a run that Zoho rejects for every mailbox.
   */
  function resolveSharedPassword(): string {
    const pw = sharedPassword.trim() || makeSharedPassword();
    if (pw !== sharedPassword) setSharedPassword(pw);
    return pw;
  }

  async function resetPasswordsOnly() {
    const pw = resolveSharedPassword();
    const scope = (creds.importDomains ?? '').trim();
    const where = scope ? scope.split(',').filter(Boolean).join(', ') : 'this Zoho organisation';
    if (!confirm(
      `Reset the Zoho password for every mailbox in ${where}?\n\n`
      + 'IMAP is NOT touched — this only sets a new password, so it suits people staying on Zoho.\n\n'
      + 'Everyone affected is signed out of Zoho until you give them that password. '
      + 'The account you connected with is skipped, since resetting it would break this connection.\n\n'
      + 'IRREVERSIBLE: Zoho stores only a hash, so nobody — including Zoho — can recover the previous '
      + 'password.\n\nContinue?')) return;

    setImapBusy(true); setImapResult(null); setImapProgress(null); setError('');
    try {
      const res = await fetch('/api/migration/enable-imap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: creds, imapAction: 'none', resetPasswords: true, sharedPassword: pw, forcePasswordChange }),
      });
      const d = await res.json() as { error?: string; runId?: string };
      if (!res.ok || !d.runId) { setError(d.error ?? 'Could not start'); setTimeout(() => setError(''), 8000); setImapBusy(false); return; }
      pollImapRun(d.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setTimeout(() => setError(''), 6000);
      setImapBusy(false);
    }
  }

  function pollImapRun(runId: string) {
    if (imapPollRef.current) clearInterval(imapPollRef.current);
    const tick = async () => {
      try {
        const res = await fetch(`/api/migration/enable-imap/status/${runId}`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: string };
          if (imapPollRef.current) clearInterval(imapPollRef.current);
          setImapBusy(false); setImapProgress(null);
          setError(d.error ?? 'Lost track of the run.'); setTimeout(() => setError(''), 8000);
          return;
        }
        const d = await res.json() as {
          status: string; mode: string; total: number; processed: number;
          changed: number; unchanged: number; failed: number;
          mailboxes?: Array<{ email: string; status: string; error?: string }>;
          passwords?: Record<string, string>; passwordsSet?: number;
          passwordFailures?: Array<{ email: string; error: string }>;
          skippedOwner?: string; error?: string;
        };
        setImapProgress({ mode: d.mode, total: d.total, processed: d.processed, changed: d.changed, unchanged: d.unchanged, failed: d.failed });

        if (d.status === 'running') return;

        if (imapPollRef.current) clearInterval(imapPollRef.current);
        setImapBusy(false); setImapProgress(null);

        if (d.status === 'error') {
          setError(`Run failed partway through (${d.changed} of ${d.total} completed): ${d.error ?? 'unknown error'}`);
          setTimeout(() => setError(''), 10000);
        }

        // Clear the pasted passwords once the run they belonged to has finished —
        // no reason for plaintext values to sit in the textarea any longer than
        // it takes to run them. The result panel below still shows which
        // addresses succeeded or failed, just not the password values.
        if (d.mode === 'passwords') { setPwEntriesText(''); setPwShowValues(false); }

        // Fold the per-mailbox credentials into the migration credentials, so the
        // worker can authenticate as each user. They are encrypted with the job.
        // Only for the bulk "Prepare mailboxes" flow — a "Set specific passwords"
        // run sets passwords people CHOSE for their own account access, not
        // credentials this platform should turn around and use to read their mail.
        if (d.mode !== 'passwords' && d.passwords && Object.keys(d.passwords).length) {
          setCreds(p => ({ ...p, imapPasswords: JSON.stringify(d.passwords) }));
        }
        setImapResult({
          mode: d.mode,
          enabled: d.changed, already: d.unchanged, failed: d.failed,
          results: (d.mailboxes ?? []).map(m => ({ email: m.email, status: m.status === 'changed' ? 'enabled' : m.status === 'unchanged' ? 'already' : 'failed', error: m.error })),
          passwordsSet: d.passwordsSet, passwordFailures: d.passwordFailures, skippedOwner: d.skippedOwner,
        });
      } catch {
        // A single missed poll is not fatal — the interval tries again in 2s.
      }
    };
    void tick();
    imapPollRef.current = setInterval(() => { void tick(); }, 2000);
  }

  useEffect(() => () => { if (imapPollRef.current) clearInterval(imapPollRef.current); }, []);

  /**
   * One "email,password" pair per line (colon or tab also accepted as the
   * separator). Only the FIRST separator on a line is significant — everything
   * after it is the password verbatim, so a password containing a comma, colon or
   * space is never mis-split. Blank lines and lines starting with # are ignored.
   */
  function parsePwEntries(text: string): { valid: Array<{ email: string; password: string }>; invalid: string[] } {
    const valid: Array<{ email: string; password: string }> = [];
    const invalid: string[] = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([^,:\t]+)[,:\t]\s*(.+)$/);
      const email = m?.[1]?.trim().toLowerCase() ?? '';
      const password = m?.[2]?.trim() ?? '';
      if (!email.includes('@') || password.length < 8) {
        invalid.push(line);
        continue;
      }
      valid.push({ email, password });
    }
    return { valid, invalid };
  }

  const pwParsed = parsePwEntries(pwEntriesText);

  async function setSpecificPasswords() {
    const { valid, invalid } = pwParsed;
    if (valid.length === 0) { setError('No valid "email,password" lines found.'); setTimeout(() => setError(''), 6000); return; }
    if (!confirm(
      `Set a new password on ${valid.length} specific mailbox${valid.length === 1 ? '' : 'es'} in Zoho?\n\n`
      + 'Each one gets the password you entered for it — not a shared value. This signs each user out '
      + 'of Zoho until they use the new password, and it is IRREVERSIBLE: Zoho stores only a hash, so '
      + 'nobody — including Zoho support — can recover the password that was there before.\n\n'
      + (invalid.length ? `${invalid.length} line(s) will be skipped as unreadable.\n\n` : '')
      + 'Continue?'
    )) return;

    setImapBusy(true); setImapResult(null); setImapProgress(null); setError('');
    try {
      const res = await fetch('/api/migration/set-passwords', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: creds, entries: valid, forcePasswordChange }),
      });
      const d = await res.json() as { error?: string; runId?: string };
      if (!res.ok || !d.runId) { setError(d.error ?? 'Could not start'); setTimeout(() => setError(''), 8000); setImapBusy(false); return; }
      // Same registry, same poll loop as the bulk actions — a run id is a run id
      // regardless of which endpoint created it.
      pollImapRun(d.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setTimeout(() => setError(''), 6000);
      setImapBusy(false);
    }
  }

  /** The rows currently shown, after the search box and domain dropdown. */
  const visibleMailboxes = orgMailboxes.filter(m =>
    (!mbDomain || m.domain === mbDomain)
    && (!mbFilter.trim()
      || m.email.includes(mbFilter.trim().toLowerCase())
      || m.displayName.toLowerCase().includes(mbFilter.trim().toLowerCase())));

  /**
   * Everyone in the current view whose address or display name starts with a
   * letter. Matching both matters: "chirag.g@arhamshare.com" and a display name of
   * "Chirag Gehlot" should both answer to C, and staff are as often looked up by
   * one as the other.
   */
  function mailboxesForLetter(letter: string) {
    const l = letter.toLowerCase();
    return visibleMailboxes.filter(m =>
      m.email.charAt(0).toLowerCase() === l
      || m.displayName.trim().charAt(0).toLowerCase() === l);
  }

  /**
   * Toggle a whole letter. Additive by design — pressing A then B leaves both
   * groups ticked — but pressing the same letter again clears that group, so a
   * mis-hit is undone with the same key rather than by starting over.
   */
  function toggleLetter(letter: string) {
    const group = mailboxesForLetter(letter);
    if (group.length === 0) return;
    setPicked(prev => {
      const next = new Set(prev);
      const allOn = group.every(m => next.has(m.email));
      for (const m of group) {
        if (allOn) next.delete(m.email); else next.add(m.email);
      }
      return next;
    });
  }

  // Letter keys select their group, but only when the operator is not typing.
  // Without this guard, searching for "anuj" would fire A, N, U and J and silently
  // tick a few hundred people.
  useEffect(() => {
    if (orgMailboxes.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
      if (!/^[a-z]$/i.test(e.key)) return;
      e.preventDefault();
      toggleLetter(e.key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgMailboxes, visibleMailboxes, picked]);

  function togglePicked(email: string) {
    setPicked(p => {
      const n = new Set(p);
      if (n.has(email)) n.delete(email); else n.add(email);
      return n;
    });
  }

  /**
   * Runs an IMAP and/or password action against exactly the ticked mailboxes.
   *
   * `imapAction: 'none'` is the case that matters most here: someone staying on
   * Zoho who only needs their password back should not have a mail-access setting
   * flipped on their account as a side effect.
   */
  async function runOnPicked(imapAction: 'enable' | 'disable' | 'none', resetPasswords: boolean) {
    const emails = [...picked];
    if (emails.length === 0) return;
    const pw = resetPasswords ? resolveSharedPassword() : undefined;

    const what = [
      imapAction === 'enable' ? 'switch IMAP ON' : imapAction === 'disable' ? 'switch IMAP OFF' : null,
      resetPasswords ? `set the Zoho password to ${pw}` : null,
    ].filter(Boolean).join(' and ');

    if (!confirm(
      `This will ${what} for ${emails.length} selected mailbox${emails.length === 1 ? '' : 'es'} in Zoho.\n\n`
      + (resetPasswords
        ? 'Those users are signed out of Zoho until you give them the new password. It is '
          + 'IRREVERSIBLE — Zoho stores only a hash, so nobody, including Zoho, can recover the '
          + 'password that was there before.\n\n'
        : '')
      + 'Continue?')) return;

    setImapBusy(true); setImapResult(null); setImapProgress(null); setError('');
    try {
      const res = await fetch('/api/migration/enable-imap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: creds, imapAction, resetPasswords, onlyEmails: emails, sharedPassword: pw, forcePasswordChange }),
      });
      const d = await res.json() as { error?: string; runId?: string };
      if (!res.ok || !d.runId) { setError(d.error ?? 'Could not start'); setTimeout(() => setError(''), 8000); setImapBusy(false); return; }
      pollImapRun(d.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setTimeout(() => setError(''), 6000);
      setImapBusy(false);
    }
  }

  /** Imports only the ticked mailboxes, rather than every user on their domains. */
  /**
   * Runs a run to completion and hands back its result. Used to chain the
   * preparation steps ahead of an import without the operator having to press
   * three buttons in the right order and wait between each.
   */
  function awaitRun(runId: string): Promise<{
    changed: number; failed: number; total: number;
    passwords?: Record<string, string>;
    mailboxes?: Array<{ email: string; status: string; error?: string }>;
    error?: string;
  }> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const t = setInterval(async () => {
        try {
          const r = await fetch(`/api/migration/enable-imap/status/${runId}`);
          if (!r.ok) { clearInterval(t); reject(new Error('Lost track of the run.')); return; }
          const d = await r.json() as {
            status: string; mode: string; total: number; processed: number;
            changed: number; unchanged: number; failed: number;
            passwords?: Record<string, string>; error?: string;
            mailboxes?: Array<{ email: string; status: string; error?: string }>;
          };
          setImapProgress({ mode: d.mode, total: d.total, processed: d.processed, changed: d.changed, unchanged: d.unchanged, failed: d.failed });
          if (d.status === 'running') {
            if (Date.now() - started > 10 * 60_000) { clearInterval(t); reject(new Error('Timed out waiting for Zoho.')); }
            return;
          }
          clearInterval(t);
          if (d.status === 'error') { reject(new Error(d.error ?? 'The run failed.')); return; }
          resolve(d);
        } catch { /* transient — retried on the next tick */ }
      }, 2000);
    });
  }

  /**
   * Prepare-then-import, in one action.
   *
   * Zoho's REST API only serves the mailbox belonging to the connected account;
   * every other user returns 404 "Account id is invalid". So an import of other
   * people cannot read anything unless IMAP is on AND we hold a password for each
   * mailbox. Making the operator do those as separate steps, in the right order,
   * meant a migration that looked like it started and then failed nine times over.
   */
  async function migratePicked() {
    const emails = [...picked];
    if (emails.length === 0) return;

    // Zoho will not serve these over IMAP with an admin-set password, so warn
    // before the run instead of letting each one fail individually at the end.
    const blockedPicks = orgMailboxes.filter(m => picked.has(m.email) && (m.tfaEnabled || m.imapBlocked));
    if (blockedPicks.length) {
      const names = blockedPicks.slice(0, 8).map(m => `  ${m.email}${m.tfaEnabled ? ' (2FA)' : ' (IMAP blocked)'}`).join('\n');
      if (!confirm(
        `${blockedPicks.length} of the selected mailboxes cannot be migrated this way:\n\n${names}`
        + (blockedPicks.length > 8 ? `\n  …and ${blockedPicks.length - 8} more` : '')
        + '\n\nWith two-factor authentication on, Zoho requires an app-specific password for IMAP, and only '
        + 'that user can create one. They must either turn 2FA off in Zoho, or hand you an app password.\n\n'
        + 'Continue with the rest? Those listed above will fail.')) return;
    }

    const pw = autoPrepare ? resolveSharedPassword() : '';
    if (!confirm(
      `Import ${emails.length} selected mailbox${emails.length === 1 ? '' : 'es'} into Arham?\n\n`
      + (autoPrepare
          ? `This first prepares them in Zoho, because their mail cannot be read otherwise:\n`
            + `  1. Switch IMAP on\n`
            + `  2. Set their Zoho password to: ${pw}\n`
            + `  3. Copy their mail across\n\n`
            + 'Those users are signed out of Zoho until you give them that password. The password '
            + 'reset is IRREVERSIBLE.\n\n'
            + 'Note: they are NOT asked to change it at first login for this run — a one-time '
            + 'password cannot be used to read their mail over IMAP. Have them change it in Zoho '
            + 'once the import is done.\n\n'
          : 'Preparation is switched off, so this assumes IMAP is already on and a password is '
            + 'already known for each mailbox. Without both, every user will fail.\n\n')
      + 'Nothing in Zoho is deleted. Continue?')) return;

    setStarting(true); setError(''); setImapResult(null); setImapProgress(null);
    let imapPasswords: Record<string, string> | undefined;

    try {
      if (autoPrepare) {
        setImapBusy(true);
        const res = await fetch('/api/migration/enable-imap', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credentials: creds,
            imapAction: 'enable',
            resetPasswords: true,
            onlyEmails: emails,
            sharedPassword: pw,
            // Deliberately NOT a one-time password here. Zoho would demand a change
            // at first login, and an IMAP client cannot satisfy that prompt — the
            // fetch would fail for every mailbox we just prepared.
            forcePasswordChange: false,
          }),
        });
        const d = await res.json() as { error?: string; runId?: string };
        if (!res.ok || !d.runId) throw new Error(d.error ?? 'Could not start preparation');

        const done = await awaitRun(d.runId);
        imapPasswords = done.passwords;
        setImapBusy(false); setImapProgress(null);

        const failures = (done.mailboxes ?? []).filter(m => m.status === 'failed');
        const gotCreds = Object.keys(imapPasswords ?? {}).length;

        // Zoho does not apply an IMAP switch instantly. Starting the import three
        // seconds after enabling it produced "Zoho refused the IMAP login (Command
        // failed)" for a mailbox whose IMAP had just been enabled successfully.
        //
        // Only wait when something actually changed — re-running over mailboxes
        // that already had IMAP on has nothing to propagate, and a silent pause
        // there is indistinguishable from the app having hung.
        const newlyEnabled = (done.mailboxes ?? []).filter(m => m.status === 'changed').length;
        if (newlyEnabled > 0) {
          for (let left = 25; left > 0; left--) {
            setMsg(`IMAP switched on for ${newlyEnabled} mailbox(es). Waiting ${left}s for Zoho to apply it before importing…`);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        setMsg('');
        if (gotCreds === 0) {
          throw new Error('Zoho accepted no password for these mailboxes, so their mail cannot be read. '
            + (failures[0]?.error ? `First failure: ${failures[0].error}` : ''));
        }
        if (failures.length) {
          setMsg(`Prepared ${gotCreds} of ${emails.length} — ${failures.length} could not be prepared and will likely fail.`);
          setTimeout(() => setMsg(''), 10000);
        }
      }

      const res = await fetch('/api/migration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start', sourceType: 'zoho',
          credentials: {
            ...creds,
            importEmails: emails.join(','),
            // The per-mailbox credentials the worker authenticates with. Stored
            // encrypted alongside the job.
            ...(imapPasswords ? { imapPasswords: JSON.stringify(imapPasswords) } : {}),
          },
        }),
      });
      setStarting(false);
      if (res.ok) {
        const { jobId } = await res.json() as { jobId: string };
        setMsg(`Import started for ${emails.length} mailbox(es).`); setTimeout(() => setMsg(''), 6000);
        await loadJobs();
        startSse(jobId);
        return;
      }
      const d = await res.json() as {
        error?: string; limitReached?: boolean; blockedDomains?: string[];
        blockingJobId?: string; blockingJobStalled?: boolean;
      };
      if (d.limitReached) { setDomainLimit({ message: d.error ?? '', domains: d.blockedDomains ?? [] }); return; }

      // A stalled previous job used to be a dead end: the error named no job and
      // the UI offered no way to clear it, so the only route forward was editing
      // the database. Offer the cancel directly.
      if (d.blockingJobId) {
        const ask = (d.error ?? 'A previous import is blocking this one.')
          + '\n\nCancel that job and start this import now?';
        if (confirm(ask)) {
          await cancelJob(d.blockingJobId);
          await loadJobs();
          setMsg('Previous job cancelled — starting the import…');
          setTimeout(() => setMsg(''), 5000);
          await migratePicked();
          return;
        }
        setError(d.error ?? 'A previous import is blocking this one.');
        setTimeout(() => setError(''), 9000);
        return;
      }
      setError(d.error ?? 'Could not start the import'); setTimeout(() => setError(''), 9000);
    } catch (err) {
      setStarting(false); setImapBusy(false); setImapProgress(null);
      setError(err instanceof Error ? err.message : 'Network error');
      setTimeout(() => setError(''), 10000);
    }
  }

  /**
   * Asks Zoho what domains this organisation spans, so the customer can choose.
   * Best effort — a failure leaves the picker hidden and the import behaves as it
   * always did (everything), rather than blocking on a read-only lookup.
   */
  async function discoverOrg(c: Record<string, string>) {
    setDiscovering(true);
    setDiscoverError('');
    try {
      const res = await fetch('/api/migration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', sourceType: 'zoho', credentials: c }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        setDiscoverError(e.error ?? `Could not read the mailbox list (HTTP ${res.status}).`);
        setDiscovering(false);
        return;
      }
      const d = await res.json() as DiscoveryPayload & { runId?: string; status?: string };
      if (d.status === 'done') { applyDiscovery(d); setDiscovering(false); return; }
      if (!d.runId) { setDiscovering(false); return; }

      // Listing a large organisation takes Zoho minutes, so the server does it
      // detached and we poll. Previously this ran inside the request, timed out,
      // and quietly fell back to a single mailbox.
      const runId = d.runId;
      const started = Date.now();
      const poll = setInterval(async () => {
        try {
          const r = await fetch('/api/migration', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'discover-status', sourceType: 'zoho', credentials: c, runId }),
          });
          const s2 = await r.json() as DiscoveryPayload & { status?: string; found?: number; error?: string };
          if (!r.ok || s2.status === 'error') {
            clearInterval(poll); setDiscovering(false);
            setDiscoverError(s2.error ?? 'The mailbox lookup failed.');
            return;
          }
          if (s2.status === 'running') {
            setDiscoverProgress(s2.found ?? 0);
            // A crawl this slow should still end rather than spin forever.
            if (Date.now() - started > 5 * 60_000) {
              clearInterval(poll); setDiscovering(false);
              setDiscoverError('Zoho is taking unusually long to list this organisation. Try again shortly.');
            }
            return;
          }
          clearInterval(poll);
          applyDiscovery(s2);
          setDiscovering(false);
        } catch { /* transient — the next tick retries */ }
      }, 2000);
    } catch {
      setDiscovering(false);
      setDiscoverError('Could not reach the server to list mailboxes.');
    }
  }

  function applyDiscovery(d: DiscoveryPayload) {
    const found = d.domains ?? [];
    setOrgDomains(found);
    setOrgMailboxes(d.mailboxes ?? []);
    setPicked(new Set());
    setDiscoverPartial(Boolean(d.partial));
    // Default to everything, so a single-domain organisation sees no new step and
    // the existing behaviour is unchanged.
    if (found.length) {
      setCreds(p => ({ ...p, importDomains: found.map(x => x.domain).join(',') }));
    }
  }

  function toggleImportDomain(domain: string) {
    setCreds(p => {
      const cur = new Set((p.importDomains ?? '').split(',').map(x => x.trim()).filter(Boolean));
      if (cur.has(domain)) cur.delete(domain); else cur.add(domain);
      return { ...p, importDomains: [...cur].join(',') };
    });
  }

  async function testCreds() {
    setTesting(true); setTestResult(null);
    const res = await fetch('/api/migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', sourceType: provider, credentials: creds }) });
    const d = await res.json() as { ok: boolean; message: string };
    setTesting(false); setTestResult(d);
  }

  async function autoStartImport(autoCreds: Record<string, string>) {
    setStarting(true); setError('');
    setMsg('Zoho connected — starting import automatically…');
    try {
      const res = await fetch('/api/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', sourceType: 'zoho', credentials: autoCreds }),
      });
      setStarting(false);
      if (res.ok) {
        const { jobId } = await res.json() as { jobId: string };
        setMsg('Import started!'); setTimeout(() => setMsg(''), 4000);
        setTestResult(null);
        await loadJobs();
        startSse(jobId);
      } else {
        const d = await res.json() as { error?: string; limitReached?: boolean; blockedDomains?: string[] };
        setMsg('');
        if (d.limitReached) {
          setDomainLimit({ message: d.error ?? '', domains: d.blockedDomains ?? [] });
          return;
        }
        setError(d.error ?? 'Failed to start import. Fill credentials below and try manually.');
        setTimeout(() => setError(''), 8000);
      }
    } catch (err) {
      setStarting(false); setMsg('');
      setError(err instanceof Error ? err.message : 'Network error — please try again.');
      setTimeout(() => setError(''), 8000);
    }
  }

  async function startImport() {
    setStarting(true); setError('');
    try {
      const res = await fetch('/api/migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', sourceType: provider, credentials: creds }) });
      setStarting(false);
      if (res.ok) {
        const { jobId } = await res.json() as { jobId: string };
        setMsg('Import started!'); setTimeout(() => setMsg(''), 4000);
        setCreds({}); setTestResult(null);
        await loadJobs();
        startSse(jobId);
      } else {
        const d = await res.json() as { error?: string; limitReached?: boolean; blockedDomains?: string[] };
        if (d.limitReached) {
          setDomainLimit({ message: d.error ?? '', domains: d.blockedDomains ?? [] });
          return;
        }
        setError(d.error ?? 'Failed to start import');
        setTimeout(() => setError(''), 6000);
      }
    } catch (err) {
      setStarting(false);
      setError(err instanceof Error ? err.message : 'Network error — please try again.');
      setTimeout(() => setError(''), 6000);
    }
  }

  async function cancelJob(jobId: string) {
    try {
      await fetch('/api/migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', sourceType: '', credentials: {}, jobId }) });
    } catch { /* ignore network errors — still clear UI */ }
    sseRef.current?.close(); sseRef.current = null;
    setActiveJobId(null); setLiveJob(null);
    await loadJobs();
  }

  const fields = FIELDS[provider] ?? [];
  const displayJob = liveJob ?? (activeJobId ? jobs.find(j => j.id === activeJobId) ?? null : null);
  const historyJobs = jobs.filter(j => !['running','pending','discovering','migrating'].includes(j.status));
  const activeJobs  = jobs.filter(j =>  ['running','pending','discovering','migrating'].includes(j.status));

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: '.55rem 1.2rem',
    background: 'none',
    border: 'none',
    borderBottom: tab === t ? '2.5px solid #2F56FF' : '2.5px solid transparent',
    color: tab === t ? '#2F56FF' : '#7A8CAE',
    fontWeight: tab === t ? 700 : 500,
    cursor: 'pointer',
    fontSize: '0.875rem',
    marginBottom: -1,
    transition: 'color .15s',
  });

  // Rendered in BOTH the connected and disconnected states. It previously sat inside
  // the connected panel only, which hid it exactly when it was needed: the Zoho token
  // is consumed on the first page load after OAuth, so anyone arriving later to undo
  // something saw the disconnected screen and no guidance at all.
  const imapInstructions = (
                <details style={{ marginTop: '.6rem' }}>
                  <summary style={{ cursor: 'pointer', color: '#2F56FF', fontSize: '0.78rem', fontWeight: 600 }}>
                    How to turn IMAP off
                  </summary>
                  <div style={{ color: '#7A8CAE', fontSize: '0.78rem', lineHeight: 1.6, marginTop: '.5rem' }}>
                    <div style={{ fontWeight: 700, color: '#0A1228', marginBottom: '.25rem' }}>
                      For specific people (recommended)
                    </div>
                    <ol style={{ margin: '0 0 .75rem', paddingLeft: '1.1rem' }}>
                      <li>Connect Zoho as an admin. The connection lasts one page load, so if this panel
                          has disappeared, reconnect before anything else.</li>
                      <li>In <strong>Mailboxes in this Zoho account</strong>, tick the people to act on.
                          Each row shows whether IMAP is currently on or off, so you can see what needs
                          changing before you touch anything.</li>
                      <li>Click <strong>↩ IMAP off</strong>. It acts on ticked rows only and changes
                          nothing else — no password is touched.</li>
                    </ol>

                    <div style={{ fontWeight: 700, color: '#0A1228', marginBottom: '.25rem' }}>
                      For whole domains at once
                    </div>
                    <ol style={{ margin: '0 0 .75rem', paddingLeft: '1.1rem' }}>
                      <li>Tick the domains to act on. Untick everything you want left alone.</li>
                      <li>Click <strong>Turn IMAP back off</strong> and confirm.</li>
                    </ol>
                    <p style={{ margin: '0 0 .75rem' }}>
                      This cannot tell a mailbox we switched on from one that already had IMAP on, so it
                      switches off every mailbox in those domains. The per-person list above avoids that,
                      because you can see each mailbox&apos;s current state and pick accordingly.
                    </p>
                    <div style={{ fontWeight: 700, color: '#0A1228', marginBottom: '.25rem' }}>Directly in Zoho</div>
                    <p style={{ margin: '0 0 .4rem' }}>
                      One mailbox: <strong>Zoho Mail Admin Console</strong> → <strong>Users</strong> → pick the
                      user → their mail account settings → turn <strong>IMAP Access</strong> off.
                    </p>
                    <p style={{ margin: '0 0 .4rem' }}>
                      Everyone at once: <strong>Security &amp; Compliance</strong> → <strong>Policies</strong> →
                      open the policy your users are on → disable <strong>IMAP</strong> under the allowed mail
                      services. Zoho&apos;s admin console has no bulk per-user IMAP switch, which is why the
                      button above exists.
                    </p>
                    <p style={{ margin: 0, color: '#92400e' }}>
                      Turning IMAP off stops us reading mail from Zoho, so do it only if you are abandoning
                      or postponing the import — not between preparing mailboxes and running it.
                    </p>
                  </div>
                </details>
  );

  const bulkPasswordInstructions = (
                <details style={{ marginTop: '.6rem' }}>
                  <summary style={{ cursor: 'pointer', color: '#2F56FF', fontSize: '0.78rem', fontWeight: 600 }}>
                    How to reset passwords in bulk
                  </summary>
                  <div style={{ color: '#7A8CAE', fontSize: '0.78rem', lineHeight: 1.6, marginTop: '.5rem' }}>
                    <p style={{ margin: '0 0 .75rem' }}>
                      Three ways to do this, from most precise to broadest. All of them are
                      irreversible — see the note at the bottom.
                    </p>

                    <div style={{ fontWeight: 700, color: '#0A1228', marginBottom: '.25rem' }}>
                      1. Selected people, same password (recommended)
                    </div>
                    <ol style={{ margin: '0 0 .75rem', paddingLeft: '1.1rem' }}>
                      <li>Connect Zoho as an admin. The connection lasts one page load, so if this panel
                          has disappeared, reconnect before anything else.</li>
                      <li>In <strong>Mailboxes in this Zoho account</strong>, tick the people who need a
                          new password. Search and the domain dropdown help narrow a long list.</li>
                      <li>Click <strong>🔑 Reset Zoho password</strong> and confirm.</li>
                      <li>Watch the progress bar — the run continues on the server even if you close this
                          tab, and shows a live count as each mailbox is set.</li>
                    </ol>
                    <p style={{ margin: '0 0 .75rem' }}>
                      Those mailboxes are set to
                      <code style={{ background: '#F0F4FF', padding: '1px 5px', borderRadius: 4 }}>ChangeMe123</code>.
                      IMAP is <em>not</em> touched, so this is the right choice for people staying on Zoho
                      who simply need to get back in.
                    </p>

                    <div style={{ fontWeight: 700, color: '#0A1228', marginBottom: '.25rem' }}>
                      2. A different password per person
                    </div>
                    <p style={{ margin: '0 0 .75rem' }}>
                      Use <strong>Set specific passwords</strong> lower down: paste one <code style={{ background: '#F0F4FF', padding: '1px 5px', borderRadius: 4 }}>email,password</code> per
                      line, each mailbox getting its own value so nobody shares a password with anyone
                      else. Best when the people involved are staying on Zoho long term.
                    </p>

                    <div style={{ fontWeight: 700, color: '#0A1228', marginBottom: '.25rem' }}>
                      3. Whole domains at once (migration cutover)
                    </div>
                    <p style={{ margin: '0 0 .75rem' }}>
                      Tick the domains, then <strong>🔑 Prepare selected mailboxes</strong>. This resets
                      every mailbox in those domains to the shared password <em>and</em> switches IMAP on,
                      because it is built for migrating everyone at cutover — not for account recovery.
                      The account you connected with is skipped, since resetting it would invalidate the
                      connection mid-run.
                    </p>

                    <div style={{ fontWeight: 700, color: '#0A1228', marginBottom: '.25rem' }}>Directly in Zoho</div>
                    <p style={{ margin: '0 0 .4rem' }}>
                      One mailbox: <strong>Zoho Mail Admin Console</strong> → <strong>Users</strong> → pick the
                      user → <strong>Reset Password</strong>.
                    </p>
                    <p style={{ margin: '0 0 .4rem' }}>
                      Zoho has no bulk password-reset control in its admin console — one user at a time is
                      the only manual option, which is why the buttons above exist for anything larger than
                      a handful of people.
                    </p>
                    <p style={{ margin: 0, color: '#92400e' }}>
                      Irreversible either way. Zoho stores only a hash of a password, never the value
                      itself, so once a reset runs — from here or by hand — nobody, including Zoho, can
                      recover what was there before. Affected users are signed out until they are given
                      the new password, and should change it themselves in Zoho as soon as they are back in.
                    </p>
                  </div>
                </details>
  );

  const isZoho = provider === 'zoho';
  const isConnected = isZoho ? !!zohoConnected : !!testResult?.ok;
  const stage = displayJob ? 3 : isConnected ? 2 : 1;
  const hasEverStarted = jobs.length > 0 || zohoConnected || orgMailboxes.length > 0 || !!displayJob;

  return (
    <div style={{ maxWidth: 1040 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#7A8CAE', fontWeight: 600, marginBottom: 6 }}>
        <span>Workspace</span>
        <span style={{ color: '#dbeafe' }}>/</span>
        <span style={{ color: '#0A1228', fontWeight: 700 }}>Migration</span>
      </div>
      {/* Page header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0A1228', letterSpacing: '-0.5px' }}>Import Email</h1>
        <p style={{ color: '#7A8CAE', marginTop: '.25rem', fontSize: '0.875rem' }}>Migrate mailboxes from Zoho, Google Workspace, cPanel, or Dovecot into your workspace</p>
      </div>

      {/* Stage indicator — reflects real state, not a fixed wizard: "Connect"
          once a provider is picked, "Prepare & Select" once a connection is
          verified (Zoho additionally discovers and lists real mailboxes here),
          "Live Migration" once a job exists. */}
      <div style={{ display: 'inline-flex', alignItems: 'center', background: '#fff', border: '1px solid #dbeafe', borderRadius: 10, padding: 4, fontSize: '0.78rem', fontWeight: 600, marginBottom: '1.25rem', boxShadow: '0 1px 3px rgba(10,18,40,.06)' }}>
        {['Connect', 'Prepare & Select', 'Live Migration'].map((label, i) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{
              padding: '.4rem .8rem', borderRadius: 7,
              color: stage === i + 1 ? '#2F56FF' : stage > i + 1 ? '#0B9E58' : '#7A8CAE',
              background: stage === i + 1 ? 'rgba(47,86,255,.08)' : 'transparent',
            }}>
              {stage > i + 1 ? '✓ ' : `${i + 1}. `}{label}
            </span>
            {i < 2 && <span style={{ color: '#dbeafe', margin: '0 .1rem' }}>→</span>}
          </span>
        ))}
      </div>

      {/* Empty state — only shown before anything real has happened, alongside
          (not instead of) the configure form below, so there is always
          something actionable on screen. */}
      {!loadingJobs && !hasEverStarted && (
        <div style={{ background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 12, padding: '1.5rem', marginBottom: '1.25rem', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(47,86,255,.1)', color: '#2F56FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto .75rem', fontSize: '1.3rem' }}>⇩</div>
          <div style={{ fontWeight: 800, color: '#0A1228', fontSize: '1.05rem', marginBottom: '.4rem' }}>No migration jobs yet</div>
          <p style={{ color: '#7A8CAE', fontSize: '0.85rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
            Connect Zoho Mail, Google Workspace, cPanel/WHM, or Dovecot below to move mailboxes into your workspace — full folder hierarchy, read/unread state, and flags preserved.
          </p>
        </div>
      )}

      {/* Domain migration readiness — rolls up the same per-domain check the
          Domains detail page runs (missing mailboxes + sending readiness)
          across every verified domain in the org, so a cutover risk is visible
          from here without duplicating that page's full DNS UI. */}
      {!domainReadiness.loading && domainReadiness.domains.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1.25rem', boxShadow: '0 1px 3px rgba(10,18,40,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
            <div style={{ fontWeight: 700, color: '#0A1228', fontSize: '0.88rem' }}>Domain cutover readiness</div>
            <a href="/dashboard/domains" style={{ fontSize: '0.78rem', color: '#2F56FF', fontWeight: 700, textDecoration: 'none' }}>View domains →</a>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.6rem' }}>
            {domainReadiness.domains.map(d => (
              <span key={d.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '.35rem .7rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
                background: d.ready === true ? 'rgba(11,158,88,.08)' : d.ready === false ? 'rgba(176,35,31,.06)' : '#F0F4FF',
                color: d.ready === true ? '#0B9E58' : d.ready === false ? '#B0231F' : '#7A8CAE',
              }}>
                {d.ready === true ? '✓' : d.ready === false ? '⚠' : '?'} {d.domain}
                {d.ready === false && d.missing > 0 && <span style={{ fontWeight: 400 }}>· {d.missing} missing</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Banners */}
      {msg   && <div style={{ background: 'rgba(22,163,74,.08)',  border: '1px solid rgba(22,163,74,.25)',  borderRadius: 8, padding: '.75rem 1rem', color: '#0B9E58', marginBottom: '1rem', fontSize: '0.85rem' }}>{msg}</div>}
      {error && <div style={{ background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 8, padding: '.75rem 1rem', color: '#B0231F', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {domainLimit && (
        <div onClick={() => setDomainLimit(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,32,64,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...S.card, maxWidth: 460, width: '100%' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.6rem', textAlign: 'center' }}>🌐</div>
            <h2 style={{ fontWeight: 800, color: '#0A1228', fontSize: '1.05rem', marginBottom: '.5rem', textAlign: 'center' }}>
              This account uses more domains than your plan
            </h2>
            <p style={{ color: '#7A8CAE', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '.9rem', textAlign: 'center' }}>
              {domainLimit.message}
            </p>
            {domainLimit.domains.length > 0 && (
              <div style={{ background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 8, padding: '.7rem .9rem', marginBottom: '1.1rem' }}>
                <div style={{ color: '#7A8CAE', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.35rem' }}>
                  Needs a higher plan
                </div>
                {domainLimit.domains.map(d => (
                  <div key={d} style={{ color: '#374264', fontSize: '0.85rem', fontWeight: 600 }}>{d}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/dashboard/billing" style={{ ...S.btn('#2F56FF'), textDecoration: 'none', display: 'inline-block' }}>Upgrade plan →</a>
              <button onClick={() => setDomainLimit(null)} style={S.btn('#7A8CAE', true)}>Not now</button>
            </div>
          </div>
        </div>
      )}

      {/* Active-job compact strip — always visible across both tabs */}
      {activeJobs.length > 0 && !displayJob && (
        <div style={{ background: 'rgba(37,99,235,.06)', border: '1px solid #bfdbfe', borderRadius: 9, padding: '.7rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2F56FF', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <span style={{ color: '#374264', fontWeight: 600, fontSize: '0.85rem' }}>
              {activeJobs.length} import{activeJobs.length > 1 ? 's' : ''} in progress
            </span>
          </div>
          <button onClick={() => { startSse(activeJobs[0].id); setTab('import'); }} style={{ ...S.btn('#2F56FF'), fontSize: '0.78rem', padding: '.35rem .9rem' }}>Watch progress</button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #dbeafe', marginBottom: '1.5rem' }}>
        <button style={tabStyle('import')} onClick={() => setTab('import')}>New Import</button>
        <button style={tabStyle('history')} onClick={() => setTab('history')}>
          History{historyJobs.length > 0 ? ` (${historyJobs.length})` : ''}
        </button>
      </div>

      {/* ── New Import tab ── */}
      {tab === 'import' && (
        <>
          {/* Live job panel (active import progress) */}
          {displayJob && (
            <LiveJobPanel
              job={displayJob}
              onCancel={() => cancelJob(displayJob.id)}
              onRetry={zohoConnected ? () => autoStartImport(creds) : undefined}
            />
          )}

          {/* Import form card */}
          <div style={S.card}>
            <h2 style={{ fontWeight: 700, color: '#0A1228', marginBottom: '1.25rem', fontSize: '1rem' }}>
              {displayJob && ['running','pending','discovering','migrating'].includes(displayJob.status) ? 'Start another import' : 'Configure import'}
            </h2>

            {/* Provider selector */}
            <div style={{ marginBottom: '.5rem' }}>
              <label style={{ ...S.label, marginBottom: '.6rem' }}>Source provider</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem' }}>
                {PROVIDERS.map(p => {
                  const active = provider === p.key;
                  return (
                    <div key={p.key} onClick={() => { setProvider(p.key); setCreds({}); setTestResult(null); }}
                      style={{ position: 'relative', cursor: 'pointer', padding: '.9rem', borderRadius: 12, border: `2px solid ${active ? '#2F56FF' : '#dbeafe'}`, background: active ? 'rgba(47,86,255,.04)' : '#fff', transition: 'all .15s' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <span style={{ width: 36, height: 36, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: '1.1rem', background: '#F0F4FF' }}>{p.icon}</span>
                        {active && <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#2F56FF', color: '#fff', fontSize: '0.65rem', display: 'grid', placeItems: 'center' }}>✓</span>}
                      </div>
                      <div style={{ fontWeight: 700, color: '#0A1228', fontSize: '0.85rem', marginTop: '.55rem' }}>{p.label}</div>
                      <div style={{ color: '#7A8CAE', fontSize: '0.72rem', marginTop: '.15rem', lineHeight: 1.4 }}>{p.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #F0F4FF', margin: '1.25rem 0' }} />

            {/* Zoho OAuth connect / connected strip */}
            {provider === 'zoho' && !zohoConnected && (
              <div style={{ background: 'rgba(37,99,235,.05)', border: '1px solid rgba(37,99,235,.18)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#374264', marginBottom: '.2rem' }}>Connect with Zoho OAuth</div>
                  <div style={{ color: '#7A8CAE', fontSize: '0.8rem' }}>One click — no manual token needed.</div>
                  {/* The controls for enabling AND for undoing IMAP live behind this
                      connection, and the token only survives one page load. Someone
                      coming back to undo something finds an empty page otherwise, with
                      no clue that reconnecting is what brings the buttons back. */}
                  <div style={{ color: '#7A8CAE', fontSize: '0.78rem', marginTop: '.35rem', lineHeight: 1.5 }}>
                    Reconnect to reach the mailbox controls — including <strong>turning IMAP back off</strong>
                    after an abandoned import. The connection lasts one page load, so it has to be re-made
                    each visit.
                  </div>
                  <div style={{ marginTop: '.5rem' }}>{imapInstructions}</div>
                  <div>{bulkPasswordInstructions}</div>
                </div>
                <a href="/api/auth/zoho" style={{ ...S.btn('#2F56FF'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
                  🔵 Connect Zoho
                </a>
              </div>
            )}
            {provider === 'zoho' && zohoConnected && (
              <div style={{ marginBottom: '1.25rem' }}>
                {/* NOTE: no "(free plan)" badge here. It used to be driven by
                    `isPersonal`, which comes from probing an organisation endpoint
                    that does not exist in Zoho's API — so it always came back true
                    and labelled every account, including paid ones, as free. */}
                <div style={{ background: 'rgba(22,163,74,.06)', border: '1px solid rgba(22,163,74,.2)', borderRadius: '10px 10px 0 0', padding: '.75rem 1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <span style={{ color: '#0B9E58', fontSize: '1rem' }}>✓</span>
                    <span style={{ color: '#087A44', fontWeight: 600, fontSize: '0.875rem' }}>
                      {zohoConnected.displayEmail || 'Zoho account connected'}
                    </span>
                  </div>
                  <button onClick={() => { setZohoConnected(null); setCreds({}); }} style={{ ...S.btn('#B0231F', true), fontSize: '0.78rem', padding: '.3rem .75rem' }}>Disconnect</button>
                </div>

                {/* Domain picker. Sits ABOVE the IMAP/password buttons on purpose:
                    those act on the mailboxes selected here, and "Prepare all
                    mailboxes" resets passwords, so the scope has to be chosen before
                    anything destructive is offered. */}
                {orgDomains.length > 1 && (
                  <div style={{ background: '#fff', border: '1px solid #dbeafe', borderTop: 'none', padding: '1rem 1.1rem' }}>
                    <div style={{ color: '#0A1228', fontWeight: 700, fontSize: '0.875rem', marginBottom: '.35rem' }}>
                      Which domains do you want to import?
                    </div>
                    <p style={{ color: '#7A8CAE', fontSize: '0.82rem', lineHeight: 1.55, marginBottom: '.8rem' }}>
                      This Zoho organisation covers {orgDomains.length} domains. Only the ones you tick are
                      imported — the rest are left completely untouched in Zoho.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                      {orgDomains.map(d => {
                        const on = (creds.importDomains ?? '').split(',').map(x => x.trim()).includes(d.domain);
                        return (
                          <label key={d.domain} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', cursor: 'pointer', padding: '.45rem .6rem', borderRadius: 8, background: on ? 'rgba(37,99,235,.06)' : 'transparent', border: `1px solid ${on ? 'rgba(37,99,235,.25)' : '#F0F4FF'}` }}>
                            <input type="checkbox" checked={on} onChange={() => toggleImportDomain(d.domain)} style={{ width: 16, height: 16, accentColor: '#2F56FF' }} />
                            <span style={{ color: '#0A1228', fontWeight: 600, fontSize: '0.85rem' }}>{d.domain}</span>
                            <span style={{ color: '#7A8CAE', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums' }}>
                              {d.userCount} mailbox{d.userCount === 1 ? '' : 'es'}
                            </span>
                            {d.alreadyAdded && (
                              <span style={{ color: '#087A44', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(22,163,74,.1)', borderRadius: 5, padding: '.1rem .4rem' }}>
                                already added here
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    {!(creds.importDomains ?? '').trim() && (
                      <div style={{ color: '#8E1B17', fontSize: '0.8rem', marginTop: '.6rem', fontWeight: 600 }}>
                        Pick at least one domain to continue.
                      </div>
                    )}
                  </div>
                )}
                {discovering && (
                  <div style={{ background: '#fff', border: '1px solid #dbeafe', borderTop: 'none', padding: '.7rem 1.1rem', color: '#7A8CAE', fontSize: '0.8rem' }}>
                    Listing mailboxes from Zoho
                    {discoverProgress > 0 ? ` — ${discoverProgress} found so far…` : '…'}
                    <div style={{ color: '#7A8CAE', fontSize: '0.75rem', marginTop: '.25rem' }}>
                      A large organisation can take a minute or two. You can leave this page open.
                    </div>
                  </div>
                )}
                {!discovering && orgDomains.length === 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderTop: 'none', padding: '.7rem 1.1rem', color: '#92400e', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    Could not read the domain list from Zoho, so there is nothing to choose from — the actions
                    below will apply to <strong>every mailbox in the organisation</strong>.
                  </div>
                )}

                {/* Per-mailbox picker. The domain-level controls above are the right
                    tool for "migrate this whole domain"; this is for everything else —
                    who is already here, whose IMAP is on, and which specific people to
                    act on. */}
                {discoverError && orgMailboxes.length === 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderTop: 'none', padding: '.8rem 1.1rem', color: '#92400e', fontSize: '0.8rem', lineHeight: 1.55 }}>
                    <strong>Could not load the mailbox list.</strong> {discoverError}
                    <div style={{ marginTop: '.35rem' }}>
                      The per-person picker is hidden because of this. The domain-level actions below still
                      work, but they apply to every mailbox in the ticked domains.
                    </div>
                  </div>
                )}

                {discoverPartial && orgMailboxes.length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderTop: 'none', padding: '.7rem 1.1rem', color: '#92400e', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    <strong>This list is incomplete.</strong> Zoho did not return every mailbox, so people
                    may be missing below. Anything you tick still works — but do not treat this as the full
                    organisation. Reconnect to try listing again.
                  </div>
                )}

                {orgMailboxes.length > 0 && (
                  <div style={{ background: '#fff', border: '1px solid #dbeafe', borderTop: 'none', padding: '1rem 1.1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
                      <div style={{ color: '#0A1228', fontWeight: 700, fontSize: '0.875rem' }}>
                        Mailboxes in this Zoho account ({orgMailboxes.length})
                      </div>
                      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                        <input
                          value={mbFilter}
                          onChange={e => setMbFilter(e.target.value)}
                          placeholder="Search name or address"
                          style={{ padding: '.35rem .6rem', background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 7, color: '#0A1228', fontSize: '0.78rem', minWidth: 180 }}
                        />
                        {orgDomains.length > 1 && (
                          <select value={mbDomain} onChange={e => setMbDomain(e.target.value)}
                            style={{ padding: '.35rem .5rem', background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 7, color: '#0A1228', fontSize: '0.78rem' }}>
                            <option value="">All domains</option>
                            {orgDomains.map(d => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Quick-select by first letter. Ticking a few hundred people one
                        row at a time is not realistic, and "select all" is too blunt
                        when only part of an organisation is moving. */}
                    <div style={{ display: 'flex', gap: '.15rem', flexWrap: 'wrap', marginBottom: '.5rem', alignItems: 'center' }}>
                      <span style={{ color: '#7A8CAE', fontSize: '0.72rem', marginRight: '.25rem' }}>Select by letter:</span>
                      {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => {
                        const group = mailboxesForLetter(letter);
                        const allOn = group.length > 0 && group.every(m => picked.has(m.email));
                        return (
                          <button
                            key={letter}
                            type="button"
                            onClick={() => toggleLetter(letter)}
                            disabled={group.length === 0}
                            title={group.length === 0 ? 'No mailboxes' : `${group.length} mailbox(es) — click or press ${letter}`}
                            style={{
                              width: 22, height: 22, padding: 0, borderRadius: 5, fontSize: '0.7rem', fontWeight: 700,
                              cursor: group.length === 0 ? 'default' : 'pointer',
                              border: `1px solid ${allOn ? '#2F56FF' : group.length ? '#dbeafe' : '#f1f5f9'}`,
                              background: allOn ? '#2F56FF' : '#fff',
                              color: allOn ? '#fff' : group.length ? '#374264' : '#cbd5e1',
                            }}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem', fontSize: '0.76rem' }}>
                      <button type="button" onClick={() => setPicked(new Set(visibleMailboxes.map(m => m.email)))}
                        style={{ background: 'none', border: 'none', color: '#2F56FF', cursor: 'pointer', padding: 0, fontSize: '0.76rem' }}>
                        Select all shown ({visibleMailboxes.length})
                      </button>
                      <button type="button" onClick={() => setPicked(new Set())}
                        style={{ background: 'none', border: 'none', color: '#2F56FF', cursor: 'pointer', padding: 0, fontSize: '0.76rem' }}>
                        Clear
                      </button>
                      <span style={{ color: picked.size ? '#087A44' : '#7A8CAE', fontWeight: picked.size ? 700 : 400 }}>
                        {picked.size} of {orgMailboxes.length} selected
                      </span>
                      {picked.size > 0 && (() => {
                        const mb = orgMailboxes.filter(m => picked.has(m.email)).reduce((n, m) => n + (m.usedStorageMb ?? 0), 0);
                        return (
                          <span style={{ color: '#374264', fontSize: '0.76rem', fontFamily: 'monospace' }}>
                            {mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`} to move
                          </span>
                        );
                      })()}
                      <span style={{ color: '#7A8CAE', fontSize: '0.72rem' }}>
                        Tip: press a letter key to select that group (press it again to clear).
                      </span>
                    </div>

                    <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #F0F4FF', borderRadius: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ position: 'sticky', top: 0, background: '#F0F4FF', textAlign: 'left' }}>
                            <th style={{ padding: '.5rem .6rem', width: 28 }}></th>
                            <th style={{ padding: '.5rem .6rem', color: '#7A8CAE', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Source mailbox</th>
                            <th style={{ padding: '.5rem .6rem', color: '#7A8CAE', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Account flags</th>
                            <th style={{ padding: '.5rem .6rem', color: '#7A8CAE', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Size</th>
                            <th style={{ padding: '.5rem .6rem', color: '#7A8CAE', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Destination</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleMailboxes.map(m => {
                            const on = picked.has(m.email);
                            return (
                              <tr key={m.email} onClick={() => togglePicked(m.email)} style={{ cursor: 'pointer', borderBottom: '1px solid #f8fbff', background: on ? 'rgba(37,99,235,.05)' : 'transparent' }}>
                                <td style={{ padding: '.5rem .6rem' }}>
                                  <input type="checkbox" checked={on} onChange={() => togglePicked(m.email)} onClick={e => e.stopPropagation()} style={{ width: 15, height: 15, accentColor: '#2F56FF' }} />
                                </td>
                                <td style={{ padding: '.5rem .6rem', minWidth: 0 }}>
                                  <div style={{ color: '#0A1228', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{m.email}</div>
                                  {m.displayName && <div style={{ color: '#7A8CAE', fontSize: '0.7rem' }}>{m.displayName}</div>}
                                </td>
                                <td style={{ padding: '.5rem .6rem' }}>
                                  <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                                    {m.role === 'super_admin' && (
                                      <span title="Owns the Zoho connection — its password is never reset in a bulk run"
                                        style={{ fontSize: '0.64rem', fontWeight: 700, color: '#6d28d9', background: 'rgba(109,40,217,.1)', borderRadius: 4, padding: '.1rem .35rem', whiteSpace: 'nowrap' }}>Admin</span>
                                    )}
                                    <span style={{ fontSize: '0.64rem', fontWeight: 700, borderRadius: 4, padding: '.1rem .35rem', whiteSpace: 'nowrap',
                                      color: m.imapEnabled ? '#087A44' : '#7A8CAE',
                                      background: m.imapEnabled ? 'rgba(22,163,74,.1)' : 'rgba(100,116,139,.1)' }}>
                                      {m.imapEnabled ? 'IMAP on' : 'Needs app password'}
                                    </span>
                                    {m.tfaEnabled && (
                                      <span title="Two-factor authentication is on. Zoho then requires an app-specific password for IMAP, which only this user can create — a bulk migration cannot read this mailbox."
                                        style={{ fontSize: '0.64rem', fontWeight: 700, color: '#8E1B17', background: 'rgba(185,28,28,.1)', borderRadius: 4, padding: '.1rem .35rem', whiteSpace: 'nowrap' }}>2FA</span>
                                    )}
                                    {m.imapBlocked && (
                                      <span title="IMAP is blocked by an organisation policy — the per-user switch cannot override it."
                                        style={{ fontSize: '0.64rem', fontWeight: 700, color: '#8E1B17', background: 'rgba(185,28,28,.1)', borderRadius: 4, padding: '.1rem .35rem', whiteSpace: 'nowrap' }}>Blocked</span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ padding: '.5rem .6rem', color: '#374264', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                  {m.usedStorageMb != null ? (m.usedStorageMb >= 1024 ? `${(m.usedStorageMb / 1024).toFixed(1)} GB` : `${m.usedStorageMb} MB`) : '—'}
                                </td>
                                <td style={{ padding: '.5rem .6rem', whiteSpace: 'nowrap' }}>
                                  {m.existsHere ? (
                                    <span style={{ color: '#1E40E0', fontWeight: 600, fontSize: '0.74rem' }}>Already on INBOX</span>
                                  ) : (
                                    <span style={{ color: '#087A44', fontWeight: 600, fontSize: '0.74rem' }}>✓ Ready to move</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {visibleMailboxes.length === 0 && (
                            <tr><td colSpan={5} style={{ padding: '.7rem .6rem', color: '#7A8CAE', fontSize: '0.78rem' }}>Nothing matches that filter.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Actions apply ONLY to ticked rows — never to the whole org. */}
                    <div style={{ marginTop: '.7rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                      <button onClick={() => runOnPicked('none', true)} disabled={imapBusy || picked.size === 0}
                        style={{ ...S.btn('#b45309'), fontSize: '0.76rem', padding: '.35rem .75rem' }}>
                        🔑 Reset Zoho password
                      </button>
                      <button onClick={() => runOnPicked('enable', false)} disabled={imapBusy || picked.size === 0}
                        style={{ ...S.btn('#2F56FF', true), fontSize: '0.76rem', padding: '.35rem .75rem' }}>
                        📥 IMAP on
                      </button>
                      <button onClick={() => runOnPicked('disable', false)} disabled={imapBusy || picked.size === 0}
                        style={{ ...S.btn('#7A8CAE', true), fontSize: '0.76rem', padding: '.35rem .75rem' }}>
                        ↩ IMAP off
                      </button>
                      <button onClick={migratePicked} disabled={starting || imapBusy || picked.size === 0}
                        style={{ ...S.btn('#0B9E58'), fontSize: '0.76rem', padding: '.35rem .75rem' }}>
                        {starting ? 'Working…' : autoPrepare ? '➡ Prepare & migrate' : '➡ Migrate to Arham'}
                      </button>
                    </div>

                    {/* On by default. Zoho's API serves only the connected account's
                        own mailbox, so without preparation every other user fails
                        with 404 "Account id is invalid" — which is precisely how an
                        import of nine real users failed nine times. */}
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginTop: '.55rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={autoPrepare}
                        onChange={e => setAutoPrepare(e.target.checked)}
                        style={{ width: 15, height: 15, accentColor: '#0B9E58', marginTop: 2, flexShrink: 0 }} />
                      <span style={{ color: '#7A8CAE', fontSize: '0.78rem', lineHeight: 1.5 }}>
                        <strong>Prepare mailboxes automatically before importing</strong> — switches IMAP on and
                        sets the password above, then imports. Zoho will not let us read anyone else&apos;s mail
                        without both, so leaving this off only works if you have already done it.
                      </span>
                    </label>

                    <div style={{ color: '#7A8CAE', fontSize: '0.75rem', marginTop: '.45rem', lineHeight: 1.5 }}>
                      Every button here acts on the ticked rows only. <strong>Reset Zoho password</strong> leaves
                      IMAP untouched — use it for people staying on Zoho who just need to get back in.
                      Users prepared for a migration are <em>not</em> forced to change their password at first
                      login, because a one-time password cannot be used to read their mail.
                    </div>
                  </div>
                )}

                <div style={{ background: '#fff', border: '1px solid #dbeafe', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '1rem 1.1rem' }}>
                  <div style={{ color: '#0A1228', fontWeight: 700, fontSize: '0.875rem', marginBottom: '.35rem' }}>
                    Importing other users&apos; mail
                  </div>
                  <p style={{ color: '#7A8CAE', fontSize: '0.82rem', lineHeight: 1.55, marginBottom: '.9rem' }}>
                    Zoho only lets a connected admin read <strong>their own</strong> mailbox. To import anyone
                    else, each mailbox needs IMAP switched on (Zoho disables it by default) and its own
                    password — Zoho has no admin login that works across mailboxes.
                  </p>

                  {/* The shared value is chosen here, not hardcoded. Zoho rejects any
                      password that has appeared in a breach — the old hardcoded
                      'ChangeMe123' failed on every single mailbox — so it has to be
                      something unique, and the operator has to be able to read it
                      back in order to hand it out. */}
                  <div style={{ marginBottom: '.8rem', background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 8, padding: '.7rem .8rem' }}>
                    <label style={{ display: 'block', color: '#7A8CAE', fontSize: '0.76rem', fontWeight: 700, marginBottom: '.35rem' }}>
                      Password to set on every mailbox
                    </label>
                    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                      <input
                        value={sharedPassword}
                        onChange={e => setSharedPassword(e.target.value)}
                        placeholder="type one, or click Generate"
                        style={{ flex: 1, minWidth: 200, padding: '.4rem .6rem', background: '#fff', border: '1px solid #dbeafe', borderRadius: 7, color: '#0A1228', fontSize: '0.82rem', fontFamily: 'ui-monospace, monospace' }}
                      />
                      <button type="button" onClick={() => setSharedPassword(makeSharedPassword())}
                        style={{ ...S.btn('#2F56FF', true), fontSize: '0.75rem', padding: '.35rem .7rem' }}>
                        Generate
                      </button>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginTop: '.55rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={forcePasswordChange}
                        onChange={e => setForcePasswordChange(e.target.checked)}
                        style={{ width: 15, height: 15, accentColor: '#2F56FF', marginTop: 2, flexShrink: 0 }} />
                      <span style={{ color: '#7A8CAE', fontSize: '0.78rem', lineHeight: 1.5 }}>
                        <strong>Make users set their own password at first login</strong> — Zoho treats the
                        value above as one-time. Strongly recommended: without it, everyone you reset stays
                        on the same shared password indefinitely.
                      </span>
                    </label>
                    <div style={{ color: '#7A8CAE', fontSize: '0.74rem', marginTop: '.35rem', lineHeight: 1.5 }}>
                      Defaults to <code>Arham#2026</code>. Zoho refuses any password that has appeared in a
                      data breach — <code>ChangeMe123</code> and similar are rejected on every mailbox — so
                      change this only to something equally unusual. Write it down before you run a reset:
                      it is the only way those users get back in.
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                    {/* Password-only, listed first because it is the least invasive
                        of the three and the one that fits an organisation staying on
                        Zoho. "Prepare mailboxes" below also switches IMAP on, which
                        is unwanted for anybody who is not migrating. */}
                    <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start', flexWrap: 'wrap', background: 'rgba(180,83,9,.05)', border: '1px solid rgba(180,83,9,.2)', borderRadius: 8, padding: '.7rem .8rem' }}>
                      <button onClick={resetPasswordsOnly} disabled={imapBusy || (orgDomains.length > 1 && !(creds.importDomains ?? '').trim())}
                        style={{ ...S.btn('#b45309', true), fontSize: '0.78rem', padding: '.4rem .85rem', whiteSpace: 'nowrap' }}>
                        {imapBusy ? 'Working…' : '🔑 Reset Zoho passwords only'}
                      </button>
                      <div style={{ color: '#78350f', fontSize: '0.8rem', lineHeight: 1.5, flex: 1, minWidth: 220 }}>
                        <strong>For people staying on Zoho.</strong> Sets a new password and changes
                        <em> nothing else</em> — IMAP is left exactly as it is. Use this to get users back
                        into Zoho after a reset, when no migration is happening.
                        <div style={{ marginTop: '.35rem', fontWeight: 600 }}>
                          ⚠ Irreversible, and signs those users out until you give them the new password.
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <button onClick={() => enableZohoImap(false)} disabled={imapBusy || (orgDomains.length > 1 && !(creds.importDomains ?? '').trim())}
                        style={{ ...S.btn('#2F56FF', true), fontSize: '0.78rem', padding: '.4rem .85rem', whiteSpace: 'nowrap' }}>
                        {imapBusy ? 'Working…' : orgDomains.length > 1 ? '📥 Enable IMAP for selected' : '📥 Enable IMAP for all'}
                      </button>
                      <div style={{ color: '#7A8CAE', fontSize: '0.8rem', lineHeight: 1.5, flex: 1, minWidth: 220 }}>
                        Turns IMAP on for every mailbox. Nothing else changes — but each user must then
                        create their own app password in Zoho and give it to you.
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start', flexWrap: 'wrap', background: 'rgba(217,119,6,.06)', border: '1px solid rgba(217,119,6,.25)', borderRadius: 8, padding: '.7rem .8rem' }}>
                      <button onClick={() => enableZohoImap(true)} disabled={imapBusy || (orgDomains.length > 1 && !(creds.importDomains ?? '').trim())}
                        style={{ ...S.btn('#b45309'), fontSize: '0.78rem', padding: '.4rem .85rem', whiteSpace: 'nowrap' }}>
                        {imapBusy ? 'Working…' : orgDomains.length > 1 ? '🔑 IMAP + password (migration)' : '🔑 IMAP + password (migration)'}
                      </button>
                      <div style={{ color: '#78350f', fontSize: '0.8rem', lineHeight: 1.5, flex: 1, minWidth: 220 }}>
                        <strong>Only for a full migration.</strong> Does two things: enables IMAP
                        <em> and</em> resets every selected mailbox to the same password. If you are not
                        migrating these people, use <em>Reset Zoho passwords only</em> above instead.
                        <div style={{ marginTop: '.35rem', fontWeight: 600 }}>
                          ⚠ This signs everyone out of Zoho and leaves all of those mailboxes on one shared
                          password that anyone who knows an address could use to sign in to Zoho. Do it on
                          cutover day, and have users change it in Zoho — or close the accounts — once the
                          import is done.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Undo for the IMAP half only. Password resets are one-way — Zoho
                      stores hashes and exposes no restore — so this never claims to
                      roll a migration back. */}
                  <div style={{ marginTop: '.9rem', paddingTop: '.8rem', borderTop: '1px solid #F0F4FF' }}>
                    <button onClick={() => enableZohoImap(false, true)} disabled={imapBusy || (orgDomains.length > 1 && !(creds.importDomains ?? '').trim())}
                      style={{ ...S.btn('#7A8CAE', true), fontSize: '0.78rem', padding: '.35rem .8rem', whiteSpace: 'nowrap' }}>
                      {imapBusy ? 'Working…' : '↩ Turn IMAP back off'}
                    </button>
                    <div style={{ color: '#7A8CAE', fontSize: '0.76rem', marginTop: '.4rem', lineHeight: 1.5 }}>
                      Abandoning the import? This switches IMAP off again for the selected domains. It cannot
                      undo password resets — those are permanent, and affected users must set a new password
                      in Zoho.
                    </div>
                  </div>

                  {/* Sets a DIFFERENT password per mailbox, unlike "Prepare mailboxes"
                      above which puts everyone on the same shared value. For the case
                      that needs each person to get back into Zoho on their own
                      password rather than a guessable common one. */}
                  <div style={{ marginTop: '.9rem', paddingTop: '.8rem', borderTop: '1px solid #F0F4FF' }}>
                    <div style={{ fontWeight: 700, color: '#0A1228', fontSize: '0.82rem', marginBottom: '.35rem' }}>
                      Set specific passwords
                    </div>
                    <p style={{ color: '#7A8CAE', fontSize: '0.78rem', lineHeight: 1.5, marginBottom: '.5rem' }}>
                      For a handful of named mailboxes, each getting its own password — not the shared
                      one above. One per line: <code style={{ background: '#F0F4FF', padding: '1px 5px', borderRadius: 4 }}>email,password</code>
                    </p>
                    <textarea
                      value={pwEntriesText}
                      onChange={e => setPwEntriesText(e.target.value)}
                      placeholder={'someone@arhamshare.com,TheirNewPass1!\nanother@arhamshare.com,DifferentPass2!'}
                      rows={4}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '.6rem .7rem', background: '#F0F4FF', border: '1px solid #dbeafe', borderRadius: 8, color: '#0A1228', fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
                    />
                    {pwEntriesText.trim() && (
                      <div style={{ marginTop: '.4rem', display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.76rem', color: pwParsed.invalid.length ? '#92400e' : '#087A44' }}>
                          {pwParsed.valid.length} mailbox{pwParsed.valid.length === 1 ? '' : 'es'} ready
                          {pwParsed.invalid.length ? ` · ${pwParsed.invalid.length} line(s) unreadable` : ''}
                        </span>
                        {pwParsed.valid.length > 0 && (
                          <button type="button" onClick={() => setPwShowValues(v => !v)}
                            style={{ background: 'none', border: 'none', color: '#2F56FF', fontSize: '0.74rem', cursor: 'pointer', padding: 0 }}>
                            {pwShowValues ? 'Hide' : 'Show'} parsed list
                          </button>
                        )}
                      </div>
                    )}
                    {pwShowValues && pwParsed.valid.length > 0 && (
                      <div style={{ marginTop: '.4rem', background: '#fff', border: '1px solid #F0F4FF', borderRadius: 6, padding: '.5rem .7rem', fontSize: '0.76rem', color: '#7A8CAE', maxHeight: 140, overflowY: 'auto' }}>
                        {pwParsed.valid.map(e => (
                          <div key={e.email} style={{ fontFamily: 'ui-monospace, monospace' }}>
                            {e.email} → {'•'.repeat(Math.min(e.password.length, 12))}
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={setSpecificPasswords} disabled={imapBusy || pwParsed.valid.length === 0}
                      style={{ ...S.btn('#b45309'), fontSize: '0.78rem', padding: '.4rem .85rem', marginTop: '.6rem' }}>
                      {imapBusy ? 'Working…' : `🔑 Set ${pwParsed.valid.length || ''} password${pwParsed.valid.length === 1 ? '' : 's'}`.trim()}
                    </button>
                    <div style={{ color: '#7A8CAE', fontSize: '0.76rem', marginTop: '.4rem', lineHeight: 1.5 }}>
                      Irreversible, same as any Zoho password reset — there is no way to recover what a
                      mailbox's password was before this runs.
                    </div>
                  </div>

                  {/* The Zoho connection is single-use: the token arrives in a cookie
                      that is consumed on the first page load after OAuth, so anyone
                      returning to this page later finds the button gone. These are the
                      steps for getting back to it, plus the manual route in Zoho for
                      when reconnecting is not an option. */}
                  {imapInstructions}
                  {bulkPasswordInstructions}

                  <div style={{ color: '#7A8CAE', fontSize: '0.76rem', marginTop: '.85rem', lineHeight: 1.5 }}>
                    Then click <strong>Start import</strong>. When it finishes, download the CSV on the job to
                    get each user&apos;s new mailbox password here.
                  </div>
                </div>
              </div>
            )}

            {imapProgress && (
              <div style={{ marginBottom: '1.25rem', background: 'rgba(37,99,235,.06)', border: '1px solid rgba(37,99,235,.2)', borderRadius: 8, padding: '.8rem 1rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1E40E0', marginBottom: '.4rem' }}>
                  {imapProgress.total === 0
                    // The run lists the organisation itself before it can know a
                    // total; showing "0 of 0" here read as though nothing was found.
                    ? 'Listing mailboxes from Zoho… (this org takes a minute or two)'
                    : <>
                        {imapProgress.mode === 'disabled' ? 'Turning IMAP off'
                          : imapProgress.mode === 'passwords' ? 'Resetting passwords'
                          : 'Working'} — {imapProgress.processed} of {imapProgress.total} mailboxes
                      </>}
                </div>
                <div style={{ height: 6, borderRadius: 999, background: '#F0F4FF', overflow: 'hidden', marginBottom: '.4rem' }}>
                  <div style={{
                    height: '100%', borderRadius: 999, background: '#2F56FF',
                    width: `${imapProgress.total ? Math.min(100, (imapProgress.processed / imapProgress.total) * 100) : 0}%`,
                    transition: 'width .3s ease',
                  }} />
                </div>
                <div style={{ color: '#7A8CAE', fontSize: '0.78rem' }}>
                  {imapProgress.changed} changed · {imapProgress.unchanged} already correct
                  {imapProgress.failed ? ` · ${imapProgress.failed} failed` : ''}
                </div>
              </div>
            )}

            {imapResult && (
              <div style={{ marginBottom: '1.25rem', background: imapResult.failed ? 'rgba(217,119,6,.06)' : 'rgba(22,163,74,.06)', border: `1px solid ${imapResult.failed ? 'rgba(217,119,6,.3)' : 'rgba(22,163,74,.25)'}`, borderRadius: 8, padding: '.8rem 1rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: imapResult.failed ? '#92400e' : '#087A44', marginBottom: '.35rem' }}>
                  {imapResult.mode === 'passwords'
                    ? <>Passwords: {imapResult.enabled} set{imapResult.failed ? ` · ${imapResult.failed} failed` : ''}</>
                    : imapResult.mode === 'disabled'
                      ? <>IMAP: {imapResult.enabled} disabled · {imapResult.already} already off{imapResult.failed ? ` · ${imapResult.failed} failed` : ''}</>
                      : <>IMAP: {imapResult.enabled} enabled · {imapResult.already} already on{imapResult.failed ? ` · ${imapResult.failed} failed` : ''}
                          {imapResult.passwordsSet ? ` · ${imapResult.passwordsSet} mailbox credentials provisioned` : ''}</>
                  }
                </div>
                {imapResult.skippedOwner && (
                  <div style={{ color: '#7A8CAE', fontSize: '0.78rem', marginBottom: '.3rem' }}>
                    {imapResult.skippedOwner} — password left unchanged (it owns the Zoho connection; its mail
                    is read directly over the API, so no password is needed).
                  </div>
                )}
                {(imapResult.passwordFailures ?? []).slice(0, 6).map(r => (
                  <div key={'pw-' + r.email} style={{ color: '#78350f', fontSize: '0.78rem' }}>
                    {r.email} — password not set: {r.error}
                  </div>
                ))}
                {imapResult.results.filter(r => r.status === 'failed').slice(0, 6).map(r => (
                  <div key={r.email} style={{ color: '#78350f', fontSize: '0.78rem' }}>{r.email} — {r.error}</div>
                ))}
                <button onClick={() => setImapResult(null)} style={{ ...S.btn('#7A8CAE', true), fontSize: '0.72rem', padding: '.25rem .7rem', marginTop: '.5rem' }}>Dismiss</button>
              </div>
            )}

            {/* Credential fields */}
            {fields.length > 0 && (
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
            )}

            {/* IMAP app password — only for free/personal Zoho accounts */}
            {provider === 'zoho' && zohoConnected?.isPersonal && (
              <div style={{ marginBottom: '1.25rem', background: 'rgba(217,119,6,.06)', border: '1px solid rgba(217,119,6,.25)', borderRadius: 8, padding: '.85rem 1rem' }}>
                <div style={{ color: '#92400e', fontSize: '0.78rem', fontWeight: 600, marginBottom: '.35rem' }}>
                  IMAP App Password required for free Zoho accounts
                </div>
                <div style={{ color: '#78350f', fontSize: '0.75rem', marginBottom: '.6rem' }}>
                  Zoho's free plan restricts API access to message content. Generate an app password at{' '}
                  <a href="https://accounts.zoho.in/home#security" target="_blank" rel="noopener noreferrer" style={{ color: '#b45309' }}>
                    Zoho Account Security → App Passwords
                  </a>.
                </div>
                <label style={S.label}>IMAP App Password</label>
                <input style={S.inp} type="password" placeholder="Paste the app password here"
                  value={creds.imapPassword ?? ''}
                  onChange={e => setCreds(p => ({ ...p, imapPassword: e.target.value }))} />
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div style={{ background: testResult.ok ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.06)', border: `1px solid ${testResult.ok ? 'rgba(22,163,74,.25)' : 'rgba(220,38,38,.2)'}`, borderRadius: 8, padding: '.75rem 1rem', color: testResult.ok ? '#0B9E58' : '#B0231F', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {provider !== 'zoho' && (
                <button onClick={testCreds} style={S.btn('#7A8CAE')} disabled={testing}>
                  {testing ? 'Validating…' : 'Validate credentials'}
                </button>
              )}
              <button
                onClick={startImport}
                style={S.btn()}
                disabled={starting || (!testResult?.ok && !zohoConnected)
                  || (provider === 'zoho' && orgDomains.length > 1 && !(creds.importDomains ?? '').trim())}
              >
                {starting ? 'Starting…'
                  : provider === 'zoho' && orgDomains.length > 1
                    ? `Import ${(creds.importDomains ?? '').split(',').filter(Boolean).length} domain(s)`
                    : 'Start import'}
              </button>
              {provider !== 'zoho' && (
                <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Validate credentials before starting</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── History tab ── */}
      {tab === 'history' && (
        <div>
          {loadingJobs ? (
            <div style={{ color: '#7A8CAE', fontSize: '0.875rem', padding: '2rem 0', textAlign: 'center' }}>Loading…</div>
          ) : historyJobs.length === 0 ? (
            <div style={{ ...S.card, textAlign: 'center', padding: '3rem 1.5rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>📭</div>
              <div style={{ color: '#374264', fontWeight: 600, marginBottom: '.35rem' }}>No completed imports yet</div>
              <div style={{ color: '#7A8CAE', fontSize: '0.85rem' }}>Start an import from the New Import tab — it will appear here when done.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {historyJobs.map(j => {
                const prov = PROVIDERS.find(p => p.key === j.source_type);
                return (
                  <div key={j.id} style={{ ...S.card, padding: '1rem 1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.6rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem' }}>
                        <span style={{ fontSize: '1.1rem' }}>{prov?.icon ?? '📦'}</span>
                        <div>
                          <span style={{ color: '#374264', fontWeight: 700, fontSize: '0.9rem' }}>{prov?.label ?? j.source_type ?? 'Unknown'}</span>
                          {j.source_host && <span style={{ color: '#7A8CAE', fontSize: '0.8rem', marginLeft: '.5rem' }}>{j.source_host}</span>}
                        </div>
                      </div>
                      <StatusBadge status={j.status} />
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: '#7A8CAE', flexWrap: 'wrap', paddingLeft: '1.75rem' }}>
                      <span><strong style={{ color: '#374264' }}>{j.imported_messages.toLocaleString()}</strong> emails</span>
                      <span><strong style={{ color: '#374264' }}>{fmtBytes(j.imported_bytes)}</strong> data</span>
                      <span>{j.completed_users} / {j.total_users ?? '?'} users</span>
                      {j.failed_users > 0 && <span style={{ color: '#B0231F' }}>{j.failed_users} failed</span>}
                      <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>{new Date(j.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    {j.error_message && <div style={{ color: '#B0231F', fontSize: '0.78rem', marginTop: '.5rem', paddingLeft: '1.75rem' }}>{j.error_message}</div>}

                    {/* History renders its own card rather than the detailed one, so
                        the sign-in download has to be repeated here — it was only on
                        the detail view, which is why passwords looked missing.
                        Note this frequently belongs to a job that FAILED: the run
                        that creates the mailboxes is the one that records their
                        passwords, even if its mail import then went nowhere. */}
                    {(j.credential_count ?? 0) > 0 && (
                      <div style={{ marginTop: '.7rem', marginLeft: '1.75rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', background: 'rgba(37,99,235,.05)', border: '1px solid #bfdbfe', borderRadius: 8, padding: '.6rem .8rem' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ color: '#374264', fontWeight: 600, fontSize: '0.82rem' }}>
                            Mailbox sign-in details ({j.credential_count})
                          </div>
                          <div style={{ color: '#7A8CAE', fontSize: '0.76rem', lineHeight: 1.5 }}>
                            Passwords for the mailboxes this run created on Arham — not the Zoho passwords.
                            Give them to your users and ask them to change them.
                          </div>
                        </div>
                        <a href={`/api/migration/${j.id}/credentials?format=csv`}
                           style={{ ...S.btn('#2F56FF'), textDecoration: 'none', fontSize: '0.78rem', padding: '.4rem .9rem', whiteSpace: 'nowrap' }}>
                          ⬇ Download CSV
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
