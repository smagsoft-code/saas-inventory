import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getCurrentUser } from '../../lib/current-user';
import { LogoutButton } from './logout-button';

/**
 * Authenticated tenant-user area (frontend.md#app-router-structure). Enforces session presence
 * for UX — redirect to /login if there is none — never as the actual authorization boundary; the
 * API re-checks every request regardless (CLAUDE.md §7.6).
 */
export default async function TenantLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <span className="text-sm text-slate-700">
          {user.fullName} · <span className="text-slate-400">{user.tenantSlug}</span>
        </span>
        <LogoutButton />
      </header>
      <main className="p-8">{children}</main>
    </div>
  );
}
