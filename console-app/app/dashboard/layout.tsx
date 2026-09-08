import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { queryOne, ensureDb } from '@/lib/db';
import SideNav from './SideNav';
import VerifyBanner from './VerifyBanner';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Read the flag rather than trusting the session: the JWT lives for seven days, so
  // a token minted at signup would keep claiming "unverified" long after the owner
  // clicked the link.
  await ensureDb();
  const owner = await queryOne<{ email_verified: boolean; owner_email: string }>(
    'SELECT email_verified, owner_email FROM organizations WHERE id = $1',
    [session.orgId]
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SideNav orgName={session.name} email={session.email} />
      <main className="dash-main">
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 2rem' }}>
          {owner && !owner.email_verified && <VerifyBanner email={owner.owner_email} />}
          {children}
        </div>
      </main>
    </div>
  );
}
