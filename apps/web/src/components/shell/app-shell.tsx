'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { NavSection } from '../../lib/navigation';
import type { Session } from '../../lib/types/session';
import { SessionProvider } from '../../lib/auth/session-context';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';
import { SessionExpiryListener } from './session-expiry-listener';

/**
 * The authenticated application shell (Prompt 016 §12): a persistent sidebar on desktop, a slide-
 * over drawer on mobile, a header with the account menu, and the page content area. It also hosts
 * the single `SessionProvider` and `SessionExpiryListener` for the whole authenticated tree.
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on route change and lock body scroll while it is open.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const brand = (
    <div className="flex h-14 items-center px-5 text-sm font-semibold text-slate-900">
      SaaS Inventory
    </div>
  );

  return (
    <SessionProvider session={session}>
      <SessionExpiryListener />
      <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[16rem_1fr]">
        {/* Desktop sidebar */}
        <aside className="hidden border-r border-slate-200 bg-white lg:flex lg:flex-col">
          {brand}
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarNav sections={navSections} />
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setMobileNavOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-white shadow-xl"
            >
              {brand}
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <SidebarNav sections={navSections} onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                className="rounded-md p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 lg:hidden"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                </svg>
              </button>
              <span className="hidden text-sm text-slate-500 sm:block">{tenantName}</span>
            </div>
            <UserMenu tenantName={tenantName} />
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
