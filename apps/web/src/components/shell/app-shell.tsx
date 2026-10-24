'use client';

import type { ReactNode } from 'react';
import type { NavSection } from '../../lib/navigation';
import type { Session } from '../../lib/types/session';
import { SessionProvider } from '../../lib/auth/session-context';
import { CompanyBrand } from './company-brand';
import { ShellLayout } from './shell-layout';
import { MobileTabBar } from './mobile-tab-bar';
import { SidebarNav } from './sidebar-nav';
import { SupportModeBanner } from './support-mode-banner';
import { UserMenu } from './user-menu';
import { SessionExpiryListener } from './session-expiry-listener';

/**
 * The authenticated tenant application shell (Prompt 016 §12): the shared `ShellLayout` frame
 * (sidebar + drawer + header) plus the tenant-specific navigation, account menu, and the single
 * `SessionProvider` / `SessionExpiryListener` for the whole authenticated tree.
 */
export function AppShell({
  session,
  tenantName,
  logoVersion,
  navSections,
  children,
}: {
  session: Session;
  tenantName: string;
  /** The company logo's last change (ms) — present only when the company has uploaded one. */
  logoVersion?: number | undefined;
  navSections: NavSection[];
  children: ReactNode;
}): React.JSX.Element {
  const brand = <CompanyBrand name={tenantName} logoVersion={logoVersion} />;

  return (
    <SessionProvider session={session}>
      <SessionExpiryListener />
      <ShellLayout
        brand={brand}
        nav={<SidebarNav sections={navSections} />}
        headerLeft={<span className="hidden text-sm text-slate-500 sm:block">{tenantName}</span>}
        headerRight={<UserMenu tenantName={tenantName} />}
        bottomNav={<MobileTabBar sections={navSections} />}
        banner={session.supportSession ? <SupportModeBanner session={session.supportSession} /> : undefined}
      >
        {children}
      </ShellLayout>
    </SessionProvider>
  );
}
