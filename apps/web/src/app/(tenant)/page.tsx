import { getCurrentUser } from '../../lib/current-user';

/** Placeholder authenticated landing page — no business modules are built yet (CLAUDE.md's
 * "Current project status"). Demonstrates the authenticated shell and current-user access. */
export default async function DashboardPage(): Promise<React.JSX.Element> {
  const user = await getCurrentUser();

  if (!user) {
    // TenantLayout already redirects unauthenticated requests to /login before this renders;
    // this is an unreachable-in-practice guard, not the enforcement point.
    return <p>Not signed in.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Welcome, {user.fullName}</h1>
      <p className="text-sm text-slate-500">Signed in to {user.tenantSlug}.</p>
      <div>
        <h2 className="text-sm font-medium text-slate-700">Your permissions</h2>
        {user.permissions.length === 0 ? (
          <p className="text-sm text-slate-400">No permissions assigned yet.</p>
        ) : (
          <ul className="list-inside list-disc text-sm text-slate-600">
            {user.permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
