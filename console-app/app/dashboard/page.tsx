import { getSession } from '@/lib/auth';
import { query, queryOne, initDb } from '@/lib/db';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  await initDb();

  const [domains, sub, emailUserCount] = await Promise.all([
    query<{ id: string; domain: string; verified: boolean }>(
      'SELECT id, domain, verified FROM domains WHERE org_id = $1', [session.orgId]
    ),
    queryOne<{ plan: string; status: string; max_users: number; trial_ends_at: string }>(
      'SELECT plan, status, max_users, trial_ends_at FROM subscriptions WHERE org_id = $1', [session.orgId]
    ),
    /* email users — best-effort; table may not exist yet */
    query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM email_users WHERE org_id = $1', [session.orgId]
    ).catch(() => [{ count: '0' }]),
  ]);

  const trialDays = sub?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000))
    : 0;

  const hasVerifiedDomain = domains.some(d => d.verified);
  const userCount         = parseInt(emailUserCount[0]?.count ?? '0', 10);

  /* Getting started checklist steps */
  const steps = [
    { done: domains.length > 0, label: 'Add your domain', href: '/dashboard/domains', hint: 'Connect a custom domain to your workspace' },
    { done: hasVerifiedDomain,  label: 'Verify your domain', href: '/dashboard/domains', hint: 'Add the DNS records to prove ownership' },
    { done: userCount > 0,      label: 'Create your first email user', href: '/dashboard/users', hint: 'Set up mailboxes for your team' },
    { done: false,              label: 'Import existing emails', href: '/dashboard/migration', hint: 'Migrate from Zoho, Google Workspace, or cPanel' },
  ];
  const allDone = steps.slice(0, 3).every(s => s.done);

  return (
    <div>
      <div className="page-header">
        <h1>Welcome back, {session.name}</h1>
        <p>Here&apos;s an overview of your workspace</p>
      </div>

      {/* Trial expiry banner */}
      {sub?.status === 'trial' && trialDays <= 7 && (
        <div style={{ background: 'var(--warn-bg,rgba(251,191,36,.08))', border: '1px solid var(--warn-border,rgba(251,191,36,.25))', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', color: '#fbbf24', fontSize: '0.875rem', fontWeight: 500 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Free trial {trialDays === 0 ? 'expires today' : `expires in ${trialDays} day${trialDays !== 1 ? 's' : ''}`}
          </div>
          <a href="/dashboard/billing" style={{ background: '#fbbf24', color: '#1a1200', padding: '.4rem .9rem', borderRadius: 7, fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            Upgrade now →
          </a>
        </div>
      )}

      {/* Stats grid — 4 cols on large, 2 on medium, 1 on mobile */}
      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        {[
          { value: domains.length,                        label: 'Domains added',   cap: false },
          { value: domains.filter(d=>d.verified).length,  label: 'Verified',         cap: false },
          { value: sub?.plan ?? 'trial',                  label: 'Plan',             cap: true  },
          { value: sub?.max_users ?? 3,                   label: 'Max email users',  cap: false },
        ].map((s, i) => (
          <div key={i} className="card">
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-1px', textTransform: s.cap ? ('capitalize' as const) : undefined }}>
              {s.value}
            </div>
            <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '.25rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Lower section: 2-col on desktop, 1-col on mobile */}
      <div className="grid-2">
        {/* Getting started checklist */}
        {!allDone && (
          <div className="card">
            <h2 style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
              Getting started
            </h2>
            {steps.map((step, i) => (
              <a
                key={i}
                href={step.done ? undefined : step.href}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '.75rem',
                  padding: '.65rem 0',
                  borderBottom: i < steps.length - 1 ? '1px solid #1e2535' : 'none',
                  cursor: step.done ? 'default' : 'pointer',
                  textDecoration: 'none',
                }}
              >
                {/* Check circle */}
                <div style={{ marginTop: '1px', flexShrink: 0 }}>
                  {step.done ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2d3448" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                    </svg>
                  )}
                </div>
                <div>
                  <div style={{ color: step.done ? '#64748b' : '#e2e8f0', fontWeight: step.done ? 400 : 500, fontSize: '0.875rem', textDecoration: step.done ? 'line-through' : 'none' }}>
                    {step.label}
                  </div>
                  {!step.done && (
                    <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: '.1rem' }}>{step.hint}</div>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Domains overview */}
        <div className="card">
          <h2 style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem', fontSize: '0.95rem' }}>Your domains</h2>
          {domains.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.875rem' }}>
              No domains yet.{' '}
              <a href="/dashboard/domains" style={{ color: '#818cf8' }}>Add your first domain →</a>
            </div>
          ) : (
            domains.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.6rem 0', borderBottom: '1px solid #1e2535' }}>
                <span style={{ color: '#e2e8f0', fontSize: '0.875rem' }}>{d.domain}</span>
                <span className={`badge ${d.verified ? 'badge-success' : 'badge-warn'}`}>
                  {d.verified ? '✓ Verified' : 'Pending'}
                </span>
              </div>
            ))
          )}
          {domains.length > 0 && (
            <a href="/dashboard/domains" style={{ display: 'inline-block', marginTop: '.75rem', color: '#818cf8', fontSize: '0.8rem' }}>
              Manage domains →
            </a>
          )}
        </div>

        {/* Quick actions */}
        <div className="card">
          <h2 style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem', fontSize: '0.95rem' }}>Quick actions</h2>
          {[
            { href: '/dashboard/domains',   label: 'Add a domain',       desc: 'Connect your custom domain' },
            { href: '/dashboard/users',     label: 'Add email user',     desc: 'Create mailboxes for your team' },
            { href: '/dashboard/migration', label: 'Import emails',      desc: 'Migrate from Zoho, Google or cPanel' },
            { href: '/dashboard/billing',   label: 'View plans',         desc: 'Upgrade for more users & storage' },
          ].map(a => (
            <a key={a.href} href={a.href} style={{ display: 'block', padding: '.65rem .85rem', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: '1px solid #2d3448', marginBottom: '.5rem', transition: 'border-color .15s' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 500, fontSize: '0.875rem' }}>{a.label}</div>
              <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '.1rem' }}>{a.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
