import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import SideNav from './SideNav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SideNav orgName={session.name} email={session.email} />
      <main className="dash-main">
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 2rem' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
