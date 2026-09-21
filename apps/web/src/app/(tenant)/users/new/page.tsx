import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listRoles } from '../../../../lib/core/roles';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { CreateUserForm } from './create-user-form';

/** `S-USER-NEW`. `canAssignRole`/`canManageLocations` decide which optional sections render — the
 * form always POSTs the user first, then (single flow, one submit) PUTs its location scope via the
 * existing `PUT /users/:id/locations` if the admin selected one — no parallel assignment mechanism. */
export default async function NewUserPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  const canAssignRole = checker.can('core.roles.assign');
  const canManageLocations = checker.can('core.users.locations.manage');

  const [roles, locationIndex] = await Promise.all([
    canAssignRole ? listRoles() : Promise.resolve([]),
    canManageLocations ? buildLocationIndex(checker.can('warehouses.view')) : Promise.resolve(null),
  ]);
  const locationOptions = locationIndex
    ? locationIndex.locations.map((l) => ({
        id: l.id,
        name: l.name,
        warehouseId: l.warehouseId,
        warehouseName: locationIndex.warehouseName(l.id),
        status: l.status,
      }))
    : [];

  return (
    <PageContainer>
      <PageHeader title="Nuevo usuario" description="Agrega a una persona a este espacio de trabajo." />
      <Card>
        <CardBody>
          <CreateUserForm roles={roles} locationOptions={locationOptions} />
        </CardBody>
      </Card>
    </PageContainer>
  );
}
