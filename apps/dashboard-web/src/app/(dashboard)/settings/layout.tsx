'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/branding', label: 'Branding' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/service-area', label: 'Service Area' },
  { href: '/settings/billing', label: 'Billing' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500 mt-1">Manage your organization</p>
      </div>

      {/* Sub-nav */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6 overflow-x-auto">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`pb-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                (pathname ?? '') === t.href || (pathname ?? '').startsWith(t.href + '/')
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {children}
    </>
  );
}
