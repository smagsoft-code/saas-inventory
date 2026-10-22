import { HelpTip } from '../../../../components/ui/help-tip';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { serverApiFetch } from '../../../../lib/api/server';
import { listRoles } from '../../../../lib/core/roles';
import { listUserLocations, type UserLocationAssignment } from '../../../../lib/inventory/user-locations';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import type { TenantUser } from '../../../../lib/types/core';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Badge } from '../../../../components/ui/badge';
import { Card, CardBody } from '../../../../components/ui/card';
import { EditUserForm } from './edit-user-form';
import { LocationAccess } from './location-access';

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
  const canManageLocations = checker.can('core.users.locations.manage');
  // Roles are needed for the role picker (canEditRole) AND to detect the ADR-0035 founding-
  // Administrador exception for the location editor (canManageLocations) — a tenant could grant
  // core.users.locations.manage without core.roles.assign now that roles are fully custom
  // (ROLES/PERMISSIONS block), so this can't be gated by canEditRole alone anymore.
  const needsRoles = canEditRole || canManageLocations;

  const [roles, locationData] = await Promise.all([
    needsRoles ? listRoles() : Promise.resolve([]),
    canManageLocations
      ? Promise.all([
          listUserLocations(id).catch((error: unknown) => {
            if (isApiError(error) && error.status === 403) return null;
            throw error;
          }),
          buildLocationIndex(checker.can('warehouses.view')),
        ])
      : Promise.resolve(null),
  ]);

  const currentRoleId = roles.find((role) => targetUser.roleNames.includes(role.name))?.id ?? '';
  const isFoundingAdministrador = roles.some(
    (role) => role.isSystemDefault && role.name === 'Administrador' && targetUser.roleNames.includes(role.name),
  );

  const assignments: UserLocationAssignment[] | null = locationData ? (locationData[0] ?? []) : null;
  const locationOptions = locationData
    ? locationData[1].locations.map((l) => ({
        id: l.id,
        name: l.name,
        warehouseId: l.warehouseId,
        warehouseName: locationData[1].warehouseName(l.id),
        status: l.status,
      }))
    : [];
  const assignedLocationNames = assignments?.map((a) => locationData?.[1].locationName(a.locationId) ?? a.locationId) ?? null;

  return (
    <PageContainer>
      <PageHeader
        title={targetUser.fullName}
        description={targetUser.email}
        actions={
          <div className="flex flex-col items-end gap-1 text-xs text-slate-500">
            <span>
              Rol: <Badge tone="neutral">{targetUser.roleNames.join(', ') || 'Sin rol'}</Badge>
            </span>
            {assignedLocationNames !== null && (
              <span>
                Almacén:{' '}
                <Badge tone={assignedLocationNames.length > 0 ? 'success' : 'warning'}>
                  {isFoundingAdministrador
                    ? 'Todos (Administrador)'
                    : assignedLocationNames.length > 0
                      ? assignedLocationNames.join(', ')
                      : 'Sin asignar'}
                </Badge>
              </span>
            )}
          </div>
        }
      />
      <Card>
        <CardBody>
          {canEditRole && (
            <p className="mb-4 flex items-center gap-1.5 text-xs text-slate-600">
              Rol y almacén asignado
              <HelpTip>
                <strong>Rol</strong> define qué puede hacer este usuario (ver productos, vender, ajustar
                inventario, aprobar transferencias...). <strong>Almacén asignado</strong> define dónde
                puede hacerlo: el usuario puede consultar la ubicación de productos en otros almacenes
                para orientar al cliente, pero no puede vender ni operar inventario fuera de su alcance
                asignado. Son dos configuraciones independientes.
              </HelpTip>
            </p>
          )}
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

      {canManageLocations && assignments !== null && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Acceso a almacenes</h2>
            <LocationAccess
              userId={id}
              userName={targetUser.fullName}
              initialAssignments={assignments}
              locations={locationOptions}
              isFoundingAdministrador={isFoundingAdministrador}
            />
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}
