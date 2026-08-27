import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { serverApiFetch } from '../../../../lib/api/server';
import type { Role } from '../../../../lib/types/core';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { CreateUserForm } from './create-user-form';

export default async function NewUserPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const canAssignRole = createPermissionChecker(session?.permissions ?? []).can(
    'core.roles.assign',
  );
  const roles = canAssignRole ? await serverApiFetch<Role[]>('/api/v1/roles') : [];

  return (
    <PageContainer>
      <PageHeader title="New user" description="Add a person to this workspace." />
      <Card>
        <CardBody>
          <CreateUserForm roles={roles} />
        </CardBody>
      </Card>
    </PageContainer>
  );
}
