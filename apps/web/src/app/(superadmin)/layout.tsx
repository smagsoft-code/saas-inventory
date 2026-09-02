import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlatformShell } from '../../components/shell/platform-shell';
import { getPlatformSession } from '../../lib/auth/platform-session';

/**
 * Platform-admin area (`(superadmin)/`, F17-01 §3.C / §11 / §13) — **structurally separate** from
 * the tenant `(tenant)/` area: its own session (`GET /platform/auth/me`), its own shell, its own
 * navigation. A UX gate — an unauthenticated request is redirected to `/platform/login` — never
 * the authorization boundary: every `@PlatformOnly()` request is re-checked by the backend.
 *
 * A tenant user is not a platform principal, so a tenant session here resolves to `null` and is
 * redirected out, exactly as an anonymous visitor would be.
 */
export default async function SuperadminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const admin = await getPlatformSession();
  if (!admin) {
    redirect('/platform/login');
  }

  return <PlatformShell admin={admin}>{children}</PlatformShell>;
}
