'use client';
import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/* ── Inline SVG icon set ───────────────────────────────────────────────────── */
const Icon = {
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  ),
  globe: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/>
      <path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  download: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  creditCard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  inbox: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
    </svg>
  ),
  logout: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  menu: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  close: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  bolt: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
};

const NAV = [
  { href: '/dashboard',           label: 'Overview',        icon: Icon.home },
  { href: '/dashboard/domains',   label: 'Domains',         icon: Icon.globe },
  { href: '/dashboard/users',     label: 'Email Users',     icon: Icon.users },
  { href: '/dashboard/migration', label: 'Import Email',    icon: Icon.download },
  { href: '/dashboard/billing',   label: 'Billing & Plans', icon: Icon.creditCard },
  { href: '/dashboard/settings',  label: 'Settings',        icon: Icon.settings },
];

export default function SideNav({ orgName, email }: { orgName: string; email: string }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  /* Close sidebar on route change */
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  /* Prevent body scroll when overlay is open */
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const navLink = (item: typeof NAV[number]) => {
    const active = item.href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname.startsWith(item.href);
    return (
      <a key={item.href} href={item.href} style={{
        display: 'flex', alignItems: 'center', gap: '.65rem',
        padding: '.55rem .75rem', borderRadius: 8, marginBottom: '.1rem',
        fontSize: '0.875rem',
        color: active ? '#a5b4fc' : '#94a3b8',
        background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
        fontWeight: active ? 600 : 400,
        transition: 'all .12s',
      }}>
        <span style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {item.icon}
        </span>
        {item.label}
      </a>
    );
  };

  return (
    <>
      {/* Mobile top bar ─────────────────────────────────── */}
      <div className="topbar">
        <button className="hamburger" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          {Icon.menu}
        </button>
        <div className="topbar-brand">
          <span style={{ display:'inline-flex',alignItems:'center',justifyContent:'center',width:28,height:28,borderRadius:7,background:'linear-gradient(135deg,#6366f1,#8b5cf6)',flexShrink:0 }}>
            {Icon.bolt}
          </span>
          <span>{orgName}</span>
        </div>
      </div>

      {/* Overlay backdrop ────────────────────────────────── */}
      <div
        className={`nav-overlay${mobileOpen ? ' open' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar ─────────────────────────────────────────── */}
      <aside className={`sidebar${mobileOpen ? ' open' : ''}`} style={{
        width: 240,
        background: '#161b27',
        borderRight: '1px solid #1e2535',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        minHeight: '100vh',
      }}>
        {/* Logo */}
        <div style={{ padding: '1.25rem 1.25rem 1.1rem', borderBottom: '1px solid #1e2535', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', flexShrink: 0 }}>
              {Icon.bolt}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {orgName}
              </div>
              <div style={{ color: '#475569', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email}
              </div>
            </div>
          </div>
          {/* Close button — only visible on mobile via inline style (CSS class handles display) */}
          <button
            onClick={() => setMobileOpen(false)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'transparent', border: '1px solid #2d3448', borderRadius: 6, cursor: 'pointer', color: '#64748b', flexShrink: 0 }}
            className="sidebar-close"
            aria-label="Close navigation"
          >
            {Icon.close}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '1rem .75rem' }}>
          <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', padding: '.25rem .75rem', marginBottom: '.4rem' }}>
            Menu
          </div>
          {NAV.map(navLink)}
        </nav>

        {/* Footer */}
        <div style={{ padding: '1rem .75rem', borderTop: '1px solid #1e2535' }}>
          <a
            href="https://app.arhamworkspace.tech"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: '.65rem', padding: '.55rem .75rem', borderRadius: 8, color: '#64748b', fontSize: '0.875rem', marginBottom: '.1rem', transition: 'color .12s' }}
          >
            <span style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.inbox}</span>
            Open Inbox
          </a>
          <button
            onClick={logout}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '.65rem', padding: '.55rem .75rem', borderRadius: 8, background: 'transparent', border: 'none', color: '#64748b', fontSize: '0.875rem', cursor: 'pointer', textAlign: 'left', transition: 'color .12s' }}
          >
            <span style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.logout}</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* Hide close button on desktop */}
      <style>{`
        @media (min-width: 769px) { .sidebar-close { display: none !important; } }
      `}</style>
    </>
  );
}
