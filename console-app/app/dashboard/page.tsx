import { getSession } from '@/lib/auth';
import { query, queryOne, initDb } from '@/lib/db';
import { resolvePlanLimits, PLANS, PLAN_ORDER, type PlanKey } from '@/lib/plans';
import { listAllUsers } from '@/lib/flux';
import { checkMxLive, detectDnsProvider } from '@/lib/dns';
import { getSesIdentity, getSesAccountStatus } from '@/lib/ses';
import { runPool } from '@/lib/run-pool';
import { OverviewStyles } from './overview-theme';

interface SuppressionRow {
  email: string;
  reason: string;
  sub_type: string | null;
  diagnostic: string | null;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
}
interface MigrationJobRow {
  id: string;
  source_type: string;
  source_host: string | null;
  status: string;
  total_users: number | null;
  completed_users: number;
  failed_users: number;
  imported_messages: number;
  imported_bytes: number;
  created_at: string;
  completed_at: string | null;
}

const MIGRATION_PROVIDER_LABEL: Record<string, string> = {
  zoho: 'Zoho Mail',
  gsuite: 'Google Workspace',
  cpanel: 'cPanel / WHM',
  dovecot: 'Dovecot / IMAP',
};
const MIGRATION_ACTIVE_STATUSES = new Set(['pending', 'discovering', 'migrating', 'running']);

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
const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
);
const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
);
const ImportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
);
const CardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
);

function fmtRelDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

/** Human label for a suppression's `reason` column (email_suppressions.reason). */
function suppressionReasonLabel(reason: string): string {
  switch (reason) {
    case 'bounce': return 'Hard Bounce';
    case 'transient_bounce': return 'Transient Bounce';
    case 'complaint': return 'Spam Complaint';
    default: return reason;
  }
}

/** Human label for an SES DKIM status. `undefined` covers "no identity yet". */
function dkimLabel(status: string | null | undefined): { text: string; detail?: string; ok: boolean | null } {
  switch (status) {
    // RSA-2048 isn't re-read per check — getSesIdentity's read path doesn't
    // return a key length — but every domain here is provisioned with Easy
    // DKIM's NextSigningKeyLength: 'RSA_2048_BIT' (see ses.ts), so it's a
    // true constant for a SUCCESS domain, not a live-queried detail.
    case 'SUCCESS': return { text: 'Verified', detail: 'RSA-2048', ok: true };
    case 'PENDING': return { text: 'Pending CNAME', ok: false };
    case 'FAILED': return { text: 'Failed', ok: false };
    case 'TEMPORARY_FAILURE': return { text: 'Retry pending', ok: false };
    default: return { text: 'Not started', ok: null };
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  await initDb();

  const [domainRows, sub, org, suppressions, suppressionCount, migrationJobs] = await Promise.all([
    query<DomainRow>(
      'SELECT id, domain, verified, flux_domain_id, created_at FROM domains WHERE org_id = $1 ORDER BY created_at',
      [session.orgId]
    ),
    queryOne<SubRow>(
      'SELECT plan, status, max_users, trial_ends_at, razorpay_subscription_id FROM subscriptions WHERE org_id = $1',
      [session.orgId]
    ),
    queryOne<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [session.orgId]),
    query<SuppressionRow>(
      `SELECT email, reason, sub_type, diagnostic, occurrences, first_seen_at, last_seen_at
       FROM email_suppressions WHERE org_id = $1 AND suppressed = TRUE
       ORDER BY last_seen_at DESC LIMIT 3`,
      [session.orgId]
    ),
    // The full count — the list above is capped at 3 for the panel, but the
    // badge next to "Deliverability" should reflect every suppressed address.
    queryOne<{ count: string }>(
      'SELECT COUNT(*) FROM email_suppressions WHERE org_id = $1 AND suppressed = TRUE',
      [session.orgId]
    ),
    // Migration jobs live in a separate database (see lib/run-pool.ts) from
    // everything else on this page — same table /dashboard/migration reads.
    runPool().query<MigrationJobRow>(
      `SELECT id, source_type, source_host, status, total_users, completed_users,
              failed_users, imported_messages, imported_bytes, created_at, completed_at
       FROM migration_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [session.orgId]
    ).then(r => r.rows).catch(() => [] as MigrationJobRow[]),
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
  const domainNameByFluxId = new Map(domainRows.filter(d => d.flux_domain_id).map(d => [d.flux_domain_id as string, d.domain]));

  // Busiest mailboxes by real usage — the same usedDiskQuota/quotas.maxDiskQuota
  // fields /dashboard/users reads, just sorted and capped for a compact panel.
  const topMailboxes = [...orgUsers]
    .sort((a, b) => (b.usedDiskQuota ?? 0) - (a.usedDiskQuota ?? 0))
    .slice(0, 4);

  const totalSuppressed = Number(suppressionCount?.count ?? 0);

  const activeMigration = migrationJobs.find(j => MIGRATION_ACTIVE_STATUSES.has(j.status));
  const recentMigrations = migrationJobs.filter(j => j.id !== activeMigration?.id).slice(0, 2);

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

  // The next tier up from whatever is active now — a real, priced recommendation
  // from PLANS, not a hardcoded "Business" suggestion that would drift the moment
  // pricing or the tier list changes.
  const planOrderIdx = PLAN_ORDER.indexOf(planKey);
  const nextTierKey = planOrderIdx >= 0 && planOrderIdx < PLAN_ORDER.length - 1 ? PLAN_ORDER[planOrderIdx + 1] : null;

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
    let reason: string;
    if (sesAccount.sandbox) {
      reason = 'Your sending account is sandboxed — mail can only reach verified test recipients until this is lifted.';
    } else if (!d.sesExists) {
      reason = 'Ownership is verified, but sending has not been set up for this domain yet.';
    } else {
      const mxBroken = d.mxLive === false;
      const dkimBroken = d.dkim.ok !== true;
      reason = mxBroken && dkimBroken
        ? 'Ownership is verified, but MX mail routing and DKIM keys are not resolved yet.'
        : mxBroken
          ? 'Ownership is verified, but MX records don’t point here yet — mail may still be routing to your old provider.'
          : dkimBroken
            ? `Ownership is verified, but DKIM keys are ${d.dkim.text.toLowerCase()}.`
            : 'Ownership is verified, but sending verification has not completed.';
    }
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
      // "Expires", not "renews" — trials don't auto-renew or charge anything
      // in this app; they lapse to 'expired' unless manually upgraded.
      chip: sub.trial_ends_at
        ? `Expires ${new Date(sub.trial_ends_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`
        : undefined,
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
          <div className="o-sub">Manage your Arham Workspace</div>
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
            {sub?.status === 'trial' ? (
              <>
                <div className="o-stat-val">{trialDays} day{trialDays !== 1 ? 's' : ''} left</div>
                <div className="o-stat-meta">
                  {sub.trial_ends_at && <span>Expires {new Date(sub.trial_ends_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}</span>}
                </div>
              </>
            ) : (
              <>
                <div className="o-stat-val">{PLANS[planKey].name}</div>
                <div className="o-stat-meta">
                  <span>{sub?.razorpay_subscription_id ? 'Razorpay active' : sub?.status}</span>
                </div>
              </>
            )}
            <div className="o-stat-foot">
              <span />
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
              {/* True, not a stored/cached timestamp: every domain here was
                  MX- and DKIM-checked live during this exact page render
                  (see the Promise.all above), so "just now" always holds. */}
              <span>Checked just now</span>
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
                  <div className="o-domain-meta">
                    {d.dnsProvider ? d.dnsProvider[0].toUpperCase() + d.dnsProvider.slice(1) : 'DNS provider not detected'}
                    {/* The real mail-server domain id, not a fabricated one —
                        labelled plainly rather than "Flux ID": Flux is this
                        platform's internal codename for the mail server, not
                        something a customer should see as if it were a brand. */}
                    {d.flux_domain_id && <> &middot; ID #{d.flux_domain_id}</>}
                  </div>
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
                  <span className="o-cell-ok"><CheckIcon /> {d.dkim.detail ?? d.dkim.text}</span>
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

      {!isEmptyWorkspace && (
        <div className="o-grid2">
          {/* Mailboxes — same usedDiskQuota/quotas.maxDiskQuota fields as /dashboard/users, just capped to the busiest few. */}
          <div className="o-panel">
            <div className="o-panelhead">
              <div>
                <div className="o-paneltitle">
                  Mailboxes
                  <span className="o-stat-tag">{mailboxCount} of {seatsMax} seats</span>
                </div>
                <div className="o-panelsub">Live storage consumption from the mail server.</div>
              </div>
              <a className="o-btn" href="/dashboard/users"><UsersIcon /> Create mailbox</a>
            </div>
            {topMailboxes.length > 0 ? (
              <table className="o-mtable">
                <thead>
                  <tr><th>Mailbox</th><th>Domain</th><th>Storage</th><th>Usage</th></tr>
                </thead>
                <tbody>
                  {topMailboxes.map(u => {
                    const quota = u.quotas?.maxDiskQuota ?? 0;
                    const used = u.usedDiskQuota ?? 0;
                    const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : null;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="o-mname">{u.name || u.emailAddress}</div>
                          <div className="o-mmail">{u.emailAddress}</div>
                        </td>
                        <td className="o-mdomain">{u.domainId ? (domainNameByFluxId.get(u.domainId) ?? '—') : '—'}</td>
                        <td>
                          {quota > 0
                            ? <>{fmtBytes(used)} <span style={{ color: 'var(--o-muted)' }}>/ {fmtBytes(quota)}</span></>
                            : fmtBytes(used)}
                        </td>
                        <td>
                          {pct !== null ? (
                            <div className="o-musagewrap">
                              <div className="o-musagebar"><i style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--o-red)' : pct >= 75 ? 'var(--o-amber)' : 'var(--o-accent)' }} /></div>
                              <span className="o-musagepct" style={{ color: pct >= 90 ? 'var(--o-red)' : pct >= 75 ? 'var(--o-amber)' : 'var(--o-ink2)' }}>{pct}%</span>
                            </div>
                          ) : <span className="o-cell-muted">No quota</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="o-migempty">No mailboxes yet — <a href="/dashboard/users">create your first one</a>.</div>
            )}
            {mailboxCount > topMailboxes.length && (
              <div className="o-panelfoot">
                <span>Showing {topMailboxes.length} of {mailboxCount} mailboxes</span>
                <a href="/dashboard/users">View all mailboxes &rarr;</a>
              </div>
            )}
          </div>

          {/* Migration — the same migration_jobs rows /dashboard/migration and its SSE progress stream read. */}
          <div className="o-panel">
            <div className="o-panelhead">
              <div>
                <div className="o-paneltitle">
                  Migration
                  {activeMigration && (
                    <span className="o-livepill"><i /> Live</span>
                  )}
                </div>
              </div>
              <a href="/dashboard/migration" style={{ fontSize: 12, color: 'var(--o-accent)', fontWeight: 700, textDecoration: 'none' }}>View details &rarr;</a>
            </div>

            {activeMigration ? (
              <div className="o-migbody">
                <div className="o-migrow">
                  <div>
                    <div className="o-migsrc-label">Source</div>
                    <div className="o-migsrc">
                      <span>{MIGRATION_PROVIDER_LABEL[activeMigration.source_type] ?? activeMigration.source_type}</span>
                      <ArrowIcon />
                      <span style={{ color: 'var(--o-accent)' }}>INBOX</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="o-migsrc-label">Progress</div>
                    <div className="o-mono" style={{ fontWeight: 800, color: 'var(--o-ink)' }}>
                      {activeMigration.completed_users} / {activeMigration.total_users ?? '?'} mailboxes
                    </div>
                  </div>
                </div>
                {activeMigration.total_users != null && activeMigration.total_users > 0 && (
                  <>
                    <div className="o-migprogtitle">
                      <span>Overall transfer</span>
                      <b>{Math.round((activeMigration.completed_users / activeMigration.total_users) * 100)}% complete</b>
                    </div>
                    <div className="o-migbar"><i style={{ width: `${Math.min(100, Math.round((activeMigration.completed_users / activeMigration.total_users) * 100))}%` }} /></div>
                  </>
                )}
                <div className="o-migmetrics">
                  <div className="o-migmetric"><b>{activeMigration.imported_messages.toLocaleString()}</b><span>Imported</span></div>
                  <div className="o-migmetric"><b>{fmtBytes(activeMigration.imported_bytes)}</b><span>Data</span></div>
                  <div className="o-migmetric"><b style={{ color: activeMigration.failed_users > 0 ? 'var(--o-red)' : undefined }}>{activeMigration.failed_users} failed</b><span>Failed</span></div>
                </div>
              </div>
            ) : (
              <div className="o-migempty">No migration in progress — <a href="/dashboard/migration">import from Zoho, Google Workspace, or cPanel</a>.</div>
            )}

            {recentMigrations.length > 0 && (
              <div className="o-recentmig">
                <div className="o-recentmig-label">Recent migrations</div>
                {recentMigrations.map(j => (
                  <div key={j.id} className="o-recentmig-row">
                    <span className="o-recentmig-src">{MIGRATION_PROVIDER_LABEL[j.source_type] ?? j.source_type}</span>
                    <span className={`o-recentmig-status ${j.status === 'completed' ? 'ok' : j.status === 'failed' || j.status === 'cancelled' ? 'fail' : ''}`}>
                      {j.status[0].toUpperCase() + j.status.slice(1)}
                    </span>
                    <span className="o-mono">{j.completed_users} user{j.completed_users !== 1 ? 's' : ''}</span>
                    <span className="o-recentmig-date">{fmtRelDate(j.completed_at ?? j.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!isEmptyWorkspace && (
        <div className="o-grid2">
          {/* Deliverability — email_suppressions, written from real SES bounce/complaint notifications. */}
          <div className="o-panel">
            <div className="o-panelhead">
              <div>
                <div className="o-paneltitle">
                  Deliverability
                  {totalSuppressed > 0 && <span className="o-badge-count">{totalSuppressed} active suppression{totalSuppressed !== 1 ? 's' : ''}</span>}
                </div>
                <div className="o-panelsub">Addresses suppressed after a bounce or spam complaint, to protect your sender reputation.</div>
              </div>
            </div>
            {suppressions.length > 0 ? (
              <div>
                {suppressions.map(s => (
                  <div key={s.email} className="o-suppr-row">
                    <span className="o-suppr-email">{s.email}</span>
                    <span className="o-suppr-badge">{suppressionReasonLabel(s.reason)}</span>
                    <span className="o-suppr-count">{s.occurrences}&times;</span>
                    <span className="o-suppr-time">{fmtRelDate(s.last_seen_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="o-migempty">No suppressed addresses — every recipient on your list is currently sendable.</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Billing summary — the same subscription/plan fields the stat tiles above draw from. */}
            <div className="o-panel">
              <div className="o-panelhead">
                <div>
                  <div className="o-paneltitle">
                    Subscription &amp; tier
                    {sub?.status === 'trial' && <span className="o-stat-tag">Trial</span>}
                  </div>
                </div>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <div className="o-billrow"><span>Seat quota</span><span>{seatsMax} seats</span></div>
                <div className="o-billrow"><span>Active mailboxes</span><span>{mailboxCount} seats used</span></div>
                {sub?.status === 'trial' && nextTierKey ? (
                  <div className="o-billrow"><span>Suggested next tier</span><span>{PLANS[nextTierKey].name} (&#8377;{PLANS[nextTierKey].pricePerUser} / seat / mo)</span></div>
                ) : (
                  <div className="o-billrow"><span>Current tier</span><span>{PLANS[planKey].name}{PLANS[planKey].pricePerUser > 0 && <> (&#8377;{PLANS[planKey].pricePerUser} / seat / mo)</>}</span></div>
                )}
                <div className="o-billrow"><span>Billing provider</span><span>{sub?.razorpay_subscription_id ? 'Razorpay active' : 'Not set up'}</span></div>
              </div>
              <div className="o-panelfoot">
                <span>{sub?.status === 'trial' ? `${trialDays} day${trialDays !== 1 ? 's' : ''} remaining` : sub?.status ?? 'No subscription'}</span>
                <a href="/dashboard/billing">{sub?.status === 'trial' ? 'Upgrade plan' : 'Manage plan'} &rarr;</a>
              </div>
            </div>

            {/* Quick actions — real routes only; no bulk/invite/report actions that don't exist. */}
            <div className="o-panel">
              <div className="o-panelhead"><div className="o-paneltitle">Quick actions</div></div>
              <div className="o-qa-grid">
                <a className="o-qa" href="/dashboard/domains">
                  <div className="o-qa-icon"><GlobeIcon /></div>
                  <div className="o-qa-title">Add domain</div>
                  <div className="o-qa-hint">Verify DNS &amp; DKIM</div>
                </a>
                <a className="o-qa" href="/dashboard/users">
                  <div className="o-qa-icon"><MailIcon /></div>
                  <div className="o-qa-title">Create mailbox</div>
                  <div className="o-qa-hint">Allocate a seat</div>
                </a>
                <a className="o-qa" href="/dashboard/migration">
                  <div className="o-qa-icon"><ImportIcon /></div>
                  <div className="o-qa-title">Start migration</div>
                  <div className="o-qa-hint">Import from Zoho, Google</div>
                </a>
                <a className="o-qa" href="/dashboard/billing">
                  <div className="o-qa-icon"><CardIcon /></div>
                  <div className="o-qa-title">Manage billing</div>
                  <div className="o-qa-hint">Plan &amp; payment details</div>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
