'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/lib/auth-context';

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function IconGrid(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function IconLayers(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  );
}
function IconInbox(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}
function IconBarChart(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}
function IconSettings(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
function IconLogOut(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function IconUser(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconCalendar(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// ── Nav config ────────────────────────────────────────────────────────────────

const navItems = [
  { href: '/dashboard', label: 'Overview',    Icon: IconGrid,     exact: true },
  { href: '/estimators', label: 'Estimators', Icon: IconLayers,   exact: false },
  { href: '/submissions', label: 'Submissions',Icon: IconInbox,   exact: false },
  { href: '/analytics',  label: 'Analytics',  Icon: IconBarChart, exact: false },
  { href: '/settings',   label: 'Settings',   Icon: IconSettings, exact: false },
];

// ── Page title map ────────────────────────────────────────────────────────────

function usePageTitle(pathname: string | null): string {
  if (!pathname) return 'Dashboard';
  if (pathname === '/dashboard') return 'Dashboard';
  if (pathname.startsWith('/estimators')) return 'Estimators';
  if (pathname.startsWith('/submissions')) return 'Submissions';
  if (pathname.startsWith('/analytics')) return 'Analytics';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'Dashboard';
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tenant, logout } = useAuthContext();
  const pageTitle = usePageTitle(pathname);
  const logoUrl = tenant?.branding?.logoUrl ?? '';

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || (pathname ?? '').startsWith(href + '/');

  // Today's date formatted
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a1628' }}>

      {/* ── Narrow icon sidebar ── */}
      <aside
        style={{
          width: 64,
          background: '#0a1628',
          borderRight: '1px solid #1e3048',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 16,
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        {/* Logo mark — tenant's synced org logo, falling back to the EstimatorPro glyph */}
        <Link
          href="/dashboard"
          title="EstimatorPro"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 10,
            overflow: 'hidden',
            background: logoUrl
              ? 'rgba(255,255,255,0.06)'
              : 'linear-gradient(135deg, #00cfff 0%, #0080ff 100%)',
            marginBottom: 24,
            textDecoration: 'none',
            fontSize: 18,
            color: '#0a1628',
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            '≋'
          )}
        </Link>

        {/* Nav icons */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, width: '100%', padding: '0 8px' }}>
          {navItems.map(({ href, label, Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 48,
                  height: 44,
                  borderRadius: 10,
                  color: active ? '#00cfff' : 'rgba(255,255,255,0.38)',
                  background: active ? 'rgba(0,207,255,0.1)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'color 0.15s, background 0.15s',
                  margin: '0 auto',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'rgba(255,255,255,0.75)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'rgba(255,255,255,0.38)';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <Icon width={20} height={20} />
              </Link>
            );
          })}
        </nav>

        {/* Sign out at bottom */}
        <div style={{ paddingBottom: 16 }}>
          <button
            onClick={logout}
            title="Sign out"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 44,
              borderRadius: 10,
              color: 'rgba(255,255,255,0.3)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#ff6b6b';
              e.currentTarget.style.background = 'rgba(255,107,107,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(255,255,255,0.3)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <IconLogOut width={20} height={20} />
          </button>
        </div>
      </aside>

      {/* ── Main area (header + content) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top header bar */}
        <header
          style={{
            height: 56,
            background: '#0a1628',
            borderBottom: '1px solid #1e3048',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 28px',
            flexShrink: 0,
          }}
        >
          {/* Left: breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
              {tenant?.name ?? 'Dashboard'}
            </span>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{pageTitle}</span>
          </div>

          {/* Right: date + user */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#111d2e',
                border: '1px solid #1e3048',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 12,
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              <IconCalendar width={13} height={13} />
              <span>{today}</span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#111d2e',
                border: '1px solid #1e3048',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 12,
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #00cfff 0%, #0080ff 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconUser width={13} height={13} style={{ color: '#0a1628' }} />
              </div>
              <span>{tenant?.name ?? 'Account'}</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '28px 28px',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
