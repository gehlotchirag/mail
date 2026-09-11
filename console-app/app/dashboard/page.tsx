import { getSession } from '@/lib/auth';
import { query, queryOne, initDb } from '@/lib/db';
import { resolvePlanLimits, PLANS, type PlanKey } from '@/lib/plans';
import { listAllUsers } from '@/lib/flux';
import { checkMxLive, detectDnsProvider } from '@/lib/dns';
import { getSesIdentity, getSesAccountStatus } from '@/lib/ses';
import { OverviewStyles } from './overview-theme';

interface DomainRow {
  id: string;
  domain: string;
  verified: boolean;
  flux_domain_id: string | null;
  created_at: string;
}
interface SubRow {
  plan: string;
  status: string;
  max_users: number;
  trial_ends_at: string | null;
  razorpay_subscription_id: string | null;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const WarnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);
const UsersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87" /></svg>
);
const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
);

/** Human label for an SES DKIM status. `undefined` covers "no identity yet". */
function dkimLabel(status: string | null | undefined): { text: string; ok: boolean | null } {
  switch (status) {
    case 'SUCCESS': return { text: 'Verified', ok: true };
    case 'PENDING': return { text: 'Propagating', ok: false };
    case 'FAILED': return { text: 'Failed', ok: false };
    case 'TEMPORARY_FAILURE': return { text: 'Retry pending', ok: false };
    default: return { text: 'Not started', ok: null };
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  await initDb();

  const [domainRows, sub, org] = await Promise.all([
    query<DomainRow>(
      'SELECT id, domain, verified, flux_domain_id, created_at FROM domains WHERE org_id = $1 ORDER BY created_at',
      [session.orgId]
    ),
    queryOne<SubRow>(
      'SELECT plan, status, max_users, trial_ends_at, razorpay_subscription_id FROM subscriptions WHERE org_id = $1',
      [session.orgId]
    ),
    queryOne<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [session.orgId]),
  ]);

  // Live per-domain sending status — the same calls /api/domains and the
  // domain detail route make, not a cached or separate notion of "ready".
  const sesAccount = await getSesAccountStatus();
  const domains = await Promise.all(domainRows.map(async (d) => {
    const [mxLive, ses, dnsProvider] = await Promise.all([
      d.verified ? checkMxLive(d.domain) : Promise.resolve(null),
      getSesIdentity(d.domain),
      detectDnsProvider(d.domain),
    ]);
    const sendingReady = !ses.error && ses.verified && !sesAccount.sandbox;
    return {
      ...d,
      mxLive,
      dnsProvider,
      dkim: dkimLabel(ses.dkimStatus),
      sesExists: ses.exists,
      sendingReady,
    };
  }));

  // Mailboxes live on the mail server, not in Postgres — same source
  // /dashboard/users reads from. (The previous version of this page counted
  // an `email_users` table that nothing ever wrote to, so this count was
  // always zero.)
  const fluxDomainIds = new Set(domainRows.map(d => d.flux_domain_id).filter((x): x is string => !!x));
  const allUsers = fluxDomainIds.size ? await listAllUsers() : [];
  const orgUsers = allUsers.filter(u => u.domainId && fluxDomainIds.has(u.domainId));
  const mailboxCount = orgUsers.length;
  const usedBytes = orgUsers.reduce((n, u) => n + (u.usedDiskQuota ?? 0), 0);
  const mailboxesByDomain = new Map<string, number>();
  for (const u of orgUsers) {
    if (u.domainId) mailboxesByDomain.set(u.domainId, (mailboxesByDomain.get(u.domainId) ?? 0) + 1);
  }

  const limits = sub ? resolvePlanLimits(sub) : null;
  const planKey = (limits?.plan ?? 'trial') as PlanKey;
  const seatsMax = limits?.maxUsers ?? 3;
  const seatsPct = seatsMax > 0 ? Math.min(100, Math.round((mailboxCount / seatsMax) * 100)) : 0;
  // Per-mailbox quota × mailboxes actually created — capacity allocated so
  // far, not a shared pool. Each mailbox has its own cap; there is no pooled
  // quota in this billing model, so labelling it as one would misstate it.
  const perMailboxQuota = limits?.storageBytesPerUser ?? 0;
  const allocatedBytes = perMailboxQuota * mailboxCount;
  const storagePct = allocatedBytes > 0 ? Math.min(100, Math.round((usedBytes / allocatedBytes) * 100)) : 0;

  const trialDays = sub?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000))
    : 0;

  const istHour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())
  );
  const greeting = istHour < 12 ? 'Good morning' : istHour < 17 ? 'Good afternoon' : 'Good evening';

  const hasVerifiedDomain = domains.some(d => d.verified);
  const brokenDomains = domains.filter(d => d.verified && !d.sendingReady);

  /* ── Needs attention ────────────────────────────────────────────────── */
  type Attn = { kind: 'warn' | 'info'; title: string; chip?: string; desc: string; ctaLabel: string; ctaHref: string };
  const attention: Attn[] = [];

  for (const d of brokenDomains) {
    const reason = sesAccount.sandbox
      ? 'Your sending account is sandboxed — mail can only reach verified test recipients until this is lifted.'
      : !d.sesExists
        ? 'Ownership is verified, but sending has not been set up for this domain yet.'
        : d.dkim.text === 'Propagating'
          ? 'Ownership is verified, but DKIM keys are still propagating.'
          : d.mxLive === false
            ? 'Ownership is verified, but MX records don’t point here yet — mail may still be routing to your old provider.'
            : 'Ownership is verified, but sending verification has not completed.';
    attention.push({
      kind: 'warn',
      title: 'A domain isn’t ready to send',
      chip: d.domain,
      desc: reason,
      ctaLabel: 'View domain',
      ctaHref: `/dashboard/domains/${d.id}`,
    });
  }
  if (sub?.status === 'trial' && trialDays <= 7) {
    attention.push({
      kind: 'info',
      title: trialDays === 0 ? 'Your trial ends today' : `Your trial ends in ${trialDays} day${trialDays !== 1 ? 's' : ''}`,
      desc: 'Upgrade to a paid plan to keep your mailboxes and domains active without interruption.',
      ctaLabel: 'View plans',
      ctaHref: '/dashboard/billing',
    });
  }
  if (seatsMax > 0 && mailboxCount / seatsMax >= 0.9) {
    attention.push({
      kind: 'info',
      title: 'Mailbox seats are almost full',
      desc: `${mailboxCount} of ${seatsMax} seats used. Add more seats before you need the next mailbox.`,
      ctaLabel: 'Manage plan',
      ctaHref: '/dashboard/billing',
    });
  }

  const healthState: 'ok' | 'warn' | 'neutral' =
    domains.length === 0 ? 'neutral' : brokenDomains.length > 0 ? 'warn' : hasVerifiedDomain ? 'ok' : 'neutral';

  /* ── Empty workspace: keep the guided checklist, not the health table ── */
  const isEmptyWorkspace = domains.length === 0;
  const steps = [
    { done: domains.length > 0, label: 'Add your domain', href: '/dashboard/domains', hint: 'Connect a custom domain to your workspace' },
    { done: hasVerifiedDomain, label: 'Verify your domain', href: '/dashboard/domains', hint: 'Add the DNS records to prove ownership' },
    { done: mailboxCount > 0, label: 'Create your first mailbox', href: '/dashboard/users', hint: 'Set up mailboxes for your team' },
    { done: false, label: 'Import existing emails', href: '/dashboard/migration', hint: 'Migrate from Zoho, Google Workspace, or cPanel' },
  ];

  return (
    <div className="overviewpage">
      <OverviewStyles />

      <div className="o-head">
        <div>
          <div className="o-h1">Overview</div>
          <div className="o-sub">Manage your {org?.name ?? 'workspace'}</div>
        </div>
        <div className="o-who">
          <div className="o-who-text">
            <div className="o-who-name">{org?.name ?? session.name}</div>
            <div className="o-who-email">{session.email}</div>
          </div>
          <span className="o-avatar">{initials(org?.name ?? session.name)}</span>
        </div>
      </div>

      <div className="o-greetrow">
        <div>
          <div className="o-greet">{greeting}, {org?.name ?? session.name}</div>
          <div className="o-greetsub">Here&apos;s the current status of your workspace.</div>
        </div>
        <div className="o-greetactions">
          <span className={`o-healthpill ${healthState}`}>
            {healthState === 'ok' ? 'Mail routing healthy' : healthState === 'warn' ? 'Needs attention' : 'Not set up yet'}
          </span>
          <a className="o-btn" href="/dashboard">
            <RefreshIcon /> Check now
          </a>
        </div>
      </div>

      {!isEmptyWorkspace && (
        attention.length > 0 ? (
          <>
            <div className="o-section-label">
              <div className="o-section-title"><span className="o-dot" />Needs your attention</div>
              <span className="o-badge-count">{attention.length} item{attention.length !== 1 ? 's' : ''} need{attention.length === 1 ? 's' : ''} action</span>
            </div>
            <div className="o-attn">
              {attention.map((a, i) => (
                <div key={i} className={`o-attn-card ${a.kind === 'info' ? 'info' : ''}`}>
                  <span className="o-attn-icon">{a.kind === 'warn' ? <WarnIcon /> : <ClockIcon />}</span>
                  <div className="o-attn-body">
                    <div className="o-attn-title">
                      {a.title}
                      {a.chip && <span className="o-attn-chip">{a.chip}</span>}
                    </div>
                    <div className="o-attn-desc">{a.desc}</div>
                  </div>
                  <a className="o-attn-cta" href={a.ctaHref}>{a.ctaLabel} <ArrowIcon /></a>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="o-allclear">
            <CheckIcon />
            <span>Everything looks healthy — no domains or mailboxes need attention.</span>
          </div>
        )
      )}

      {!isEmptyWorkspace && (
        <div className="o-stats">
          <div className="o-stat">
            <div className="o-stat-top">
              <span className="o-stat-label">Plan</span>
              {sub?.status === 'trial' && <span className="o-stat-tag">Trial</span>}
            </div>
            <div className="o-stat-val">{PLANS[planKey].name}</div>
            <div className="o-stat-meta">
              {sub?.status === 'trial'
                ? <span className={trialDays <= 7 ? 'warn' : ''}>{trialDays} day{trialDays !== 1 ? 's' : ''} left</span>
                : <span>{sub?.razorpay_subscription_id ? 'Razorpay active' : sub?.status}</span>}
            </div>
            <div className="o-stat-foot">
              <a href="/dashboard/billing">Manage plan <ArrowIcon /></a>
            </div>
          </div>

          <div className="o-stat">
            <div className="o-stat-top">
              <span className="o-stat-label">Domains</span>
            </div>
            <div className="o-stat-val">{domains.length}</div>
            <div className="o-stat-meta">
              <span className="ok">{domains.length - brokenDomains.length} ready</span>
              {brokenDomains.length > 0 && <span className="warn">&middot; {brokenDomains.length} needs attention</span>}
            </div>
            <div className="o-stat-foot">
              <a href="/dashboard/domains">Inspect <ArrowIcon /></a>
            </div>
          </div>

          <div className="o-stat">
            <div className="o-stat-top">
              <span className="o-stat-label">Mailboxes</span>
              <span className="o-stat-tag">{Math.max(0, seatsMax - mailboxCount)} left</span>
            </div>
            <div className="o-stat-val">{mailboxCount} <span style={{ fontSize: 15, color: 'var(--o-muted)', fontWeight: 700 }}>/ {seatsMax}</span></div>
            <div className="o-stat-bar"><i style={{ width: `${seatsPct}%` }} /></div>
            <div className="o-stat-foot">
              <span>{seatsPct}% of seats</span>
              <a href="/dashboard/users"><UsersIcon /> New mailbox</a>
            </div>
          </div>

          <div className="o-stat">
            <div className="o-stat-top">
              <span className="o-stat-label">Storage</span>
              {allocatedBytes > 0 && <span className="o-stat-tag">{storagePct}% used</span>}
            </div>
            <div className="o-stat-val">
              {fmtBytes(usedBytes)}
              {allocatedBytes > 0 && <span style={{ fontSize: 15, color: 'var(--o-muted)', fontWeight: 700 }}> / {fmtBytes(allocatedBytes)}</span>}
            </div>
            {allocatedBytes > 0 ? (
              <div className="o-stat-bar"><i style={{ width: `${storagePct}%`, background: storagePct >= 90 ? 'var(--o-red)' : storagePct >= 75 ? 'var(--o-amber)' : 'var(--o-accent)' }} /></div>
            ) : (
              <div className="o-stat-meta">No mailboxes yet</div>
            )}
            <div className="o-stat-foot">
              <span>Allocated across {mailboxCount} mailbox{mailboxCount !== 1 ? 'es' : ''}</span>
              <a href="/dashboard/users">View <ArrowIcon /></a>
            </div>
          </div>
        </div>
      )}

      {isEmptyWorkspace ? (
        <div className="o-group">
          <div className="o-grouphead">
            <div>
              <div className="o-grouptitle">Getting started</div>
              <div className="o-groupsub">Three steps to a working mailbox.</div>
            </div>
          </div>
          <div className="o-steps">
            {steps.map((step, i) => (
              <a key={i} href={step.done ? undefined : step.href} className={`o-step ${step.done ? 'done' : ''}`} style={{ cursor: step.done ? 'default' : 'pointer' }}>
                <span className="o-step-icon" style={{ color: step.done ? 'var(--o-green)' : 'var(--o-border)' }}>
                  {step.done ? <CheckIcon /> : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
                  )}
                </span>
                <div>
                  <div className="o-step-title">{step.label}</div>
                  {!step.done && <div className="o-step-hint">{step.hint}</div>}
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : (
        <div className="o-group">
          <div className="o-grouphead">
            <div>
              <div className="o-grouptitle">Domain health <span className="o-count">{domains.length} total</span></div>
              <div className="o-groupsub">Sending readiness and DKIM status across your configured domains.</div>
            </div>
            <div className="o-groupbadges">
              <span className="o-pill ok">{domains.length - brokenDomains.length} sending ready</span>
              {brokenDomains.length > 0 && <span className="o-pill warn">{brokenDomains.length} needs attention</span>}
              <a className="o-btn o-btn-primary" href="/dashboard/domains">+ Add domain</a>
            </div>
          </div>

          <div className="o-thead">
            <span>Domain</span>
            <span>Ownership</span>
            <span>Sending</span>
            <span>DKIM</span>
            <span>Mailboxes</span>
            <span>Action</span>
          </div>
          {domains.map(d => {
            const mb = d.flux_domain_id ? (mailboxesByDomain.get(d.flux_domain_id) ?? 0) : 0;
            return (
              <div key={d.id} className="o-row">
                <div className="o-domain-cell">
                  <div className="o-domain-name">{d.domain}</div>
                  <div className="o-domain-meta">{d.dnsProvider ? d.dnsProvider[0].toUpperCase() + d.dnsProvider.slice(1) : 'DNS provider not detected'}</div>
                </div>
                {d.verified ? (
                  <span className="o-cell-ok"><CheckIcon /> Verified</span>
                ) : (
                  <span className="o-cell-warn"><WarnIcon /> Pending</span>
                )}
                {d.sendingReady ? (
                  <span className="o-pill ok">Ready to send</span>
                ) : d.verified ? (
                  <span className="o-pill warn">Not ready</span>
                ) : (
                  <span className="o-cell-muted">&mdash;</span>
                )}
                {d.dkim.ok === true ? (
                  <span className="o-cell-ok"><CheckIcon /> {d.dkim.text}</span>
                ) : d.dkim.ok === false ? (
                  <span className="o-cell-warn"><WarnIcon /> {d.dkim.text}</span>
                ) : (
                  <span className="o-cell-muted">{d.dkim.text}</span>
                )}
                <span className="o-cell-muted">{mb} mailbox{mb !== 1 ? 'es' : ''}</span>
                {d.verified && !d.sendingReady ? (
                  <a className="o-row-link warn" href={`/dashboard/domains/${d.id}`}>Resolve <ArrowIcon /></a>
                ) : (
                  <a className="o-row-link" href={`/dashboard/domains/${d.id}`}>View <ArrowIcon /></a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
