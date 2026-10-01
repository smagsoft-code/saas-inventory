import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listWarehouses } from '../../../../lib/inventory/warehouses';
import { listLocations } from '../../../../lib/inventory/locations';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Alert } from '../../../../components/ui/alert';
import { NoAccess } from '../../../../components/ui/no-access';
import { LocationForm } from '../location-form';

export const metadata = { title: 'Nuevo almacén · SaaS Inventory' };

export default async function NewLocationPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('locations.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Nuevo almacén" />
        <NoAccess message="Necesitas el permiso de gestión de almacenes para crear almacenes." />
      </PageContainer>
    );
  }
  const canViewWarehouses = checker.can('warehouses.view');
  const canViewLocations = checker.can('locations.view');

  const [warehouses, parents] = await Promise.all([
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }) : Promise.resolve(null),
    canViewLocations ? listLocations({ pageSize: 100, status: 'active' }) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Nuevo almacén" description="Agrega un lugar dentro de una sucursal." />
      {!canViewWarehouses && (
        <Alert tone="warning">
          No puedes listar sucursales, por eso el selector de sucursal está vacío. Pide a un
          administrador el permiso de sucursales.
        </Alert>
      )}
      <LocationForm
        mode="create"
        warehouses={(warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }))}
        parentCandidates={(parents?.data ?? []).map((l) => ({
          id: l.id,
          warehouseId: l.warehouseId,
          name: l.name,
          code: l.code,
        }))}
      />
    </PageContainer>
  );
}
