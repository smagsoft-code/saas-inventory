import Link from 'next/link';
import { getCurrentUser } from '../../../lib/current-user';
import type { PaginatedUsers } from '../../../lib/core-types';
import { serverApiFetch } from '../../../lib/server-fetch';

/** §10/§11 — listing is gated by core.users.read server-side; this page assumes it already has
 * that (TenantLayout links here, but a direct visit without the permission gets the API's 403,
 * surfaced by the error boundary — the API is the authority, not this check). */
export default async function UsersPage(): Promise<React.JSX.Element> {
  const [user, page] = await Promise.all([
    getCurrentUser(),
    serverApiFetch<PaginatedUsers>('/api/v1/users?page=1&pageSize=50'),
  ]);
  const canCreate = user?.permissions.includes('core.users.create') ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Users</h1>
        {canCreate && (
          <Link href="/users/new" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
            New user
          </Link>
        )}
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Email</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {page.data.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="py-2">
                <Link href={`/users/${row.id}`} className="underline">
                  {row.fullName}
                </Link>
              </td>
              <td className="py-2 text-slate-600">{row.email}</td>
              <td className="py-2 text-slate-600">{row.roleNames.join(', ') || '—'}</td>
              <td className="py-2 text-slate-600">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {page.data.length === 0 && <p className="text-sm text-slate-400">No users yet.</p>}
    </div>
  );
}
