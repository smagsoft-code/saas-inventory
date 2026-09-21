import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getRole } from '../../../../lib/core/roles';
import { listPermissionCatalog } from '../../../../lib/core/permissions-catalog';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Badge } from '../../../../components/ui/badge';
import { Card, CardBody } from '../../../../components/ui/card';
import { NoAccess } from '../../../../components/ui/no-access';
import { RoleEditForm } from './role-edit-form';
import { RolePermissionsEditor } from './role-permissions-editor';

export const metadata = { title: 'Editar rol · SaaS Inventory' };

/** `S-ROLES-EDIT` — `GET /api/v1/roles/:id` (`core.roles.read`), `PATCH /api/v1/roles/:id` and
 * `PUT /api/v1/roles/:id/permissions` (both `core.roles.manage`). `role.isAssignedToCaller`
 * (ADR-0034) decides whether the permission picker is editable — the API is the actual boundary;
 * this only decides what to render disabled vs. enabled. */
export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);

  if (!checker.can('core.roles.read')) {
    return (
      <PageContainer>
        <PageHeader title="Rol" />
        <NoAccess message="Necesitas el permiso de roles para ver esta página." />
      </PageContainer>
    );
  }

  let role;
  try {
    role = await getRole(id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const canManage = checker.can('core.roles.manage');
  const catalog = canManage ? await listPermissionCatalog() : [];

  return (
    <PageContainer>
      <PageHeader
        title={role.name}
        description={role.description || 'Sin descripción.'}
        actions={
          <Badge tone={role.isSystemDefault ? 'neutral' : 'success'}>
            {role.isSystemDefault ? 'Predefinido del sistema' : 'Personalizado'}
          </Badge>
        }
      />

      <Card>
        <CardBody>
          <RoleEditForm role={role} canManage={canManage} />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Permisos</h2>
          {canManage ? (
            <RolePermissionsEditor role={role} catalog={catalog} />
          ) : (
            <p className="text-sm text-slate-500">
              {role.permissionCodes.length} permiso(s) — necesitas el permiso de gestión de roles para modificarlos.
            </p>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
