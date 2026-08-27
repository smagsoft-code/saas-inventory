'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Session } from '../types/session';
import { createPermissionChecker, type PermissionChecker } from './permissions';

/**
 * Makes the already-fetched session available to Client Components without another `/auth/me`
 * call (Prompt 016 §16). The authenticated layout is a Server Component that calls `getSession()`
 * once and renders this provider with the result; interactive descendants read it with
 * `useSession()` / `usePermissions()`.
 */
const SessionContext = createContext<Session | null | undefined>(undefined);

export function SessionProvider({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}): React.JSX.Element {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === undefined) {
    throw new Error('useSession must be used within a <SessionProvider>.');
  }
  if (session === null) {
    throw new Error('useSession used outside an authenticated area.');
  }
  return session;
}

export function usePermissions(): PermissionChecker {
  const session = useSession();
  return useMemo(() => createPermissionChecker(session.permissions), [session.permissions]);
}
