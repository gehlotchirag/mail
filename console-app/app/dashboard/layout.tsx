import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { queryOne, ensureDb } from '@/lib/db';
import { getActiveSub, countOrgMailboxes } from '@/lib/subscription';
import { resolvePlanLimits } from '@/lib/plans';
import SideNav from './SideNav';
import VerifyBanner from './VerifyBanner';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Read the flag rather than trusting the session: the JWT lives for seven days, so
  // a token minted at signup would keep claiming "unverified" long after the owner
  // clicked the link.
  await ensureDb();
  const [owner, sub, mailboxCount] = await Promise.all([
    queryOne<{ email_verified: boolean; owner_email: string }>(
      'SELECT email_verified, owner_email FROM organizations WHERE id = $1',
      [session.orgId]
    ),
    getActiveSub(session.orgId),
    countOrgMailboxes(session.orgId),
  ]);

  // The sidebar's "Overview" badge, shown on every dashboard page. Deliberately
  // cheap signals only (trial window, seat count) — NOT the live per-domain
  // MX/DKIM checks the Overview page itself runs, which would mean an extra
  // DNS lookup and SES API call per domain on every single page navigation in
  // the app, not just Overview. The Overview page's own "Needs your attention"
  // count may therefore run slightly higher than this badge when a domain has
  // gone unready — this badge is a cheap approximation, not a duplicate of it.
  let attentionCount = 0;
  if (sub?.status === 'trial' && sub.trial_ends_at) {
    const days = Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000);
    if (days <= 7) attentionCount++;
  }
  if (sub) {
    const seatsMax = resolvePlanLimits(sub).maxUsers;
    if (seatsMax > 0 && mailboxCount / seatsMax >= 0.9) attentionCount++;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <SideNav orgName={session.name} attentionCount={attentionCount} />
      <main className="dash-main" style={{ height: '100%' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '2rem 2rem' }}>
          {owner && !owner.email_verified && <VerifyBanner email={owner.owner_email} />}
          {children}
        </div>
      </main>
    </div>
  );
}
