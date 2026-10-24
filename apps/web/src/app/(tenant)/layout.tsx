import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '../../components/shell/app-shell';
import { getSession } from '../../lib/auth/session';
import { createPermissionChecker } from '../../lib/auth/permissions';
import { serverApiFetch } from '../../lib/api/server';
import { isApiError } from '../../lib/api/errors';
import { filterNavigation, NAVIGATION } from '../../lib/navigation';
import type { Tenant } from '../../lib/types/core';

/**
 * Authenticated tenant-user area (frontend.md#app-router-structure). Fetches the session once,
 * renders the app shell, and passes the session + permission-filtered navigation down. This is a
 * UX gate — an unauthenticated request is redirected to `/login` — never the authorization
 * boundary: the API re-checks every request regardless (CLAUDE.md §7.6).
 */
export default async function TenantLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const checker = createPermissionChecker(session.permissions);
  const navSections = filterNavigation(NAVIGATION, checker);

  // The tenant record carries the display name for the shell. If it briefly fails (transient API
  // error) fall back to the slug rather than blocking the whole app.
  let tenantName = session.tenantSlug;
  let logoVersion: number | undefined;
  try {
    const tenant = await serverApiFetch<Tenant>('/api/v1/tenant');
    tenantName = tenant.name;
    logoVersion = tenant.logoVersion;
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      redirect('/login');
    }
    // else: keep the slug fallback
  }

  return (
    <AppShell session={session} tenantName={tenantName} logoVersion={logoVersion} navSections={navSections}>
      {children}
    </AppShell>
  );
}
