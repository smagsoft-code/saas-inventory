import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { serverApiFetch } from '../../../../lib/api/server';
import type { Role, TenantUser } from '../../../../lib/types/core';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { EditUserForm } from './edit-user-form';

/** Self vs. others and which permissions the caller holds decide which fields are shown as
 * editable; the API is the actual boundary. The target-user fetch goes through the same
 * tenant-scoped, permission-gated `GET /users/:id` — a cross-tenant id 404s here exactly as it
 * does for a direct API call. */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();

  let targetUser: TenantUser;
  try {
    targetUser = await serverApiFetch<TenantUser>(`/api/v1/users/${id}`);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const checker = createPermissionChecker(session?.permissions ?? []);
  const isSelf = session?.id === id;
  const canEditFullName = isSelf || checker.can('core.users.update');
  const canEditStatus = !isSelf && checker.can('core.users.update');
  const canEditRole = !isSelf && checker.can('core.roles.assign');
  const roles = canEditRole ? await serverApiFetch<Role[]>('/api/v1/roles') : [];
  const currentRoleId = roles.find((role) => targetUser.roleNames.includes(role.name))?.id ?? '';

  return (
    <PageContainer>
      <PageHeader title={targetUser.fullName} description={targetUser.email} />
      <Card>
        <CardBody>
          <EditUserForm
            targetUser={targetUser}
            canEditFullName={canEditFullName}
            canEditStatus={canEditStatus}
            canEditRole={canEditRole}
            roles={roles}
            currentRoleId={currentRoleId}
          />
        </CardBody>
      </Card>
    </PageContainer>
  );
}
