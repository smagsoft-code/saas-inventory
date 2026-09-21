import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listPermissionCatalog } from '../../../../lib/core/permissions-catalog';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { RoleCreateForm } from './role-create-form';

export const metadata = { title: 'Crear rol · SaaS Inventory' };

/** `S-ROLES-NEW` — `POST /api/v1/roles` (`core.roles.manage`). Gated the same way every other
 * `/new` screen is (users/new, warehouses/new). */
export default async function NewRolePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('core.roles.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Crear rol" />
        <NoAccess message="Necesitas el permiso de gestión de roles para crear roles." />
      </PageContainer>
    );
  }

  const catalog = await listPermissionCatalog();

  return (
    <PageContainer>
      <PageHeader title="Crear rol" description="Nombre, descripción y los permisos que otorga este rol personalizado." />
      <RoleCreateForm catalog={catalog} />
    </PageContainer>
  );
}
