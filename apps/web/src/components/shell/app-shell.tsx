'use client';

import type { ReactNode } from 'react';
import type { NavSection } from '../../lib/navigation';
import type { Session } from '../../lib/types/session';
import { SessionProvider } from '../../lib/auth/session-context';
import { ShellLayout } from './shell-layout';
import { SidebarNav } from './sidebar-nav';
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
  navSections,
  children,
}: {
  session: Session;
  tenantName: string;
  navSections: NavSection[];
  children: ReactNode;
}): React.JSX.Element {
  const brand = (
    <div className="flex h-14 items-center px-5 text-sm font-semibold text-slate-900">
      SaaS Inventory
    </div>
  );

  return (
    <SessionProvider session={session}>
      <SessionExpiryListener />
      <ShellLayout
        brand={brand}
        nav={<SidebarNav sections={navSections} />}
        headerLeft={<span className="hidden text-sm text-slate-500 sm:block">{tenantName}</span>}
        headerRight={<UserMenu tenantName={tenantName} />}
      >
        {children}
      </ShellLayout>
    </SessionProvider>
  );
}
