import { notFound } from 'next/navigation';
import { getCurrentUser } from '../../../../lib/current-user';
import { ApiError } from '../../../../lib/api-client';
import type { Role, TenantUser } from '../../../../lib/core-types';
import { serverApiFetch } from '../../../../lib/server-fetch';
import { EditUserForm } from './edit-user-form';

/** §12/§16/§21 — self vs. others and which permissions the caller holds decide which fields are
 * even shown as editable; the API is the actual boundary (this page's fetch of the target user
 * already goes through the same tenant-scoped, permission-gated GET /users/:id everyone else
 * uses — a cross-tenant id 404s here exactly like it does for a direct API call). */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const currentUser = await getCurrentUser();

  let targetUser: TenantUser;
  try {
    targetUser = await serverApiFetch<TenantUser>(`/api/v1/users/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const isSelf = currentUser?.id === id;
  const canEditFullName = isSelf || (currentUser?.permissions.includes('core.users.update') ?? false);
  const canEditStatus = !isSelf && (currentUser?.permissions.includes('core.users.update') ?? false);
  const canEditRole = !isSelf && (currentUser?.permissions.includes('core.roles.assign') ?? false);
  const roles = canEditRole ? await serverApiFetch<Role[]>('/api/v1/roles') : [];
  const currentRoleId = roles.find((role) => targetUser.roleNames.includes(role.name))?.id ?? '';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-slate-900">{targetUser.fullName}</h1>
      <p className="text-sm text-slate-500">{targetUser.email}</p>
      <EditUserForm
        targetUser={targetUser}
        canEditFullName={canEditFullName}
        canEditStatus={canEditStatus}
        canEditRole={canEditRole}
        roles={roles}
        currentRoleId={currentRoleId}
      />
    </div>
  );
}
