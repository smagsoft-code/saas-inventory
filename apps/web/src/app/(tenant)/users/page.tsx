import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { serverApiFetch } from '../../../lib/api/server';
import type { PaginatedUsers } from '../../../lib/types/core';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { ButtonLink } from '../../../components/ui/button';

/** Listing is gated by `core.users.read` server-side. A direct visit without it gets the API's
 * 403, surfaced by the route error boundary — the API is the authority, not this page. */
export default async function UsersPage(): Promise<React.JSX.Element> {
  const [session, page] = await Promise.all([
    getSession(),
    serverApiFetch<PaginatedUsers>('/api/v1/users', { query: { page: 1, pageSize: 50 } }),
  ]);
  const canCreate = createPermissionChecker(session?.permissions ?? []).can('core.users.create');

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="People with access to this workspace."
        actions={
          canCreate ? (
            <ButtonLink href="/users/new" size="sm">
              New user
            </ButtonLink>
          ) : null
        }
      />

      {page.data.length === 0 ? (
        <EmptyState
          title="No users yet"
          description="Invite a colleague to give them access to this workspace."
          action={
            canCreate ? (
              <Link href="/users/new" className="text-sm font-medium text-slate-900 underline">
                Create the first user
              </Link>
            ) : null
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {page.data.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/users/${row.id}`}
                        className="font-medium text-slate-900 underline"
                      >
                        {row.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.email}</td>
                    <td className="px-4 py-3 text-slate-600">{row.roleNames.join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
