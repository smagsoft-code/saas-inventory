import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listRoles } from '../../../lib/core/roles';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { ButtonLink } from '../../../components/ui/button';
import { RolesTable } from './roles-table';

export const metadata = { title: 'Roles · SaaS Inventory' };

/**
 * `S-ROLES-LIST` — `GET /api/v1/roles` (`core.roles.read`). Roles/permisos son gestionables
 * (ROLES/PERMISSIONS block, cierra `GAP-ROLE-CRUD`) — `canManage` (`core.roles.manage`) controla
 * el botón "Crear rol" y las acciones de fila en `RolesTable`. El array es pequeño y no tiene
 * parámetros de filtro/orden en el contrato — nada se inventa del lado del cliente.
 */
export default async function RolesPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('core.roles.read')) {
    return (
      <PageContainer>
        <PageHeader title="Roles" />
        <NoAccess message="Necesitas el permiso de roles para ver esta página." />
      </PageContainer>
    );
  }

  const canManage = checker.can('core.roles.manage');
  const roles = await listRoles();

  return (
    <PageContainer>
      <PageHeader
        title="Roles"
        description="Los roles disponibles en esta empresa y los permisos que otorga cada uno. El almacén donde cada usuario puede operar se define aparte, en su ficha de usuario."
        actions={
          canManage ? (
            <ButtonLink href="/roles/new" size="sm">
              Crear rol
            </ButtonLink>
          ) : null
        }
      />
      {roles.length === 0 ? (
        <EmptyState title="Sin roles" description="Esta empresa no tiene roles configurados." />
      ) : (
        <RolesTable roles={roles} canManage={canManage} />
      )}
    </PageContainer>
  );
}
