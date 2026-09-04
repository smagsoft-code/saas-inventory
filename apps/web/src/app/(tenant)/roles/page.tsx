import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listRoles } from '../../../lib/core/roles';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { RolesTable } from './roles-table';

export const metadata = { title: 'Roles · SaaS Inventory' };

/**
 * `S-ROLES-LIST` — `GET /api/v1/roles` (`core.roles.read`). **Read-only:** roles are the fixed
 * `DEFAULT_ROLE_TEMPLATES` set, editable only via direct DB access. There is no create/edit/delete
 * endpoint (`GAP-ROLE-CRUD`, future) → no action controls on this page. The array is small and
 * has no server filter/sort/search params — nothing is invented client-side.
 */
export default async function RolesPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('core.roles.read')) {
    return (
      <PageContainer>
        <PageHeader title="Roles" />
        <NoAccess message="You need the roles permission to view this page." />
      </PageContainer>
    );
  }

  const roles = await listRoles();

  return (
    <PageContainer>
      <PageHeader
        title="Roles"
        description="The roles available in this company and the permissions each grants. Roles are managed by the platform team."
      />
      {roles.length === 0 ? (
        <EmptyState title="No roles" description="This company has no roles configured." />
      ) : (
        <RolesTable roles={roles} />
      )}
    </PageContainer>
  );
}
