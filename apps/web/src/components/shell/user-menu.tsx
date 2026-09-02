'use client';

import { useLogout } from '../../lib/auth/use-logout';
import { useSession } from '../../lib/auth/session-context';
import { AccountMenu } from './account-menu';

/**
 * The tenant account menu (Prompt 016 §41): binds the current session + the real backend logout
 * to the presentational `AccountMenu`.
 */
export function UserMenu({ tenantName }: { tenantName: string }): React.JSX.Element {
  const session = useSession();
  const { logout, pending } = useLogout();

  return (
    <AccountMenu
      name={session.fullName}
      email={session.email}
      contextLabel={tenantName}
      onSignOut={logout}
      signingOut={pending}
    />
  );
}
