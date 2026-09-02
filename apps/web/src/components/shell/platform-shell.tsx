'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { PLATFORM_NAVIGATION, isPlatformNavItemActive } from '../../lib/platform-navigation';
import { usePlatformLogout } from '../../lib/auth/use-platform-logout';
import type { PlatformSession } from '../../lib/types/platform-session';
import { AccountMenu } from './account-menu';
import { NavIconGlyph } from './nav-icon';
import { ShellLayout } from './shell-layout';

/**
 * The platform-admin application shell (F17-01 §3.C / §11 / §15–§16) — a **separate context** from
 * the tenant `AppShell`: its own navigation registry, its own account menu (no tenant, no
 * permissions, no location scope), its own logout. Composes the shared `ShellLayout` frame.
 *
 * F17-01 ships the frame + the platform Home entry only. Company management is F17-13.
 */
function PlatformNav(): React.JSX.Element {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform" className="flex flex-col gap-1">
      {PLATFORM_NAVIGATION.map((item) => {
        const active = isPlatformNavItemActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
              active
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            <NavIconGlyph name={item.icon} className="h-5 w-5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function PlatformAccountMenu({ admin }: { admin: PlatformSession }): React.JSX.Element {
  const { logout, pending } = usePlatformLogout();
  return (
    <AccountMenu
      name={admin.fullName}
      email={admin.email}
      contextLabel="Platform administrator"
      onSignOut={logout}
      signingOut={pending}
    />
  );
}

export function PlatformShell({
  admin,
  children,
}: {
  admin: PlatformSession;
  children: ReactNode;
}): React.JSX.Element {
  const brand = (
    <div className="flex h-14 items-center gap-2 px-5 text-sm font-semibold text-slate-900">
      SaaS Inventory
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Platform
      </span>
    </div>
  );

  return (
    <ShellLayout
      brand={brand}
      nav={<PlatformNav />}
      headerLeft={
        <span className="hidden text-sm text-slate-500 sm:block">Platform administration</span>
      }
      headerRight={<PlatformAccountMenu admin={admin} />}
    >
      {children}
    </ShellLayout>
  );
}
