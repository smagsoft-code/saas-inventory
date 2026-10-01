import { getSession } from '../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../lib/auth/permissions';
import { listWarehouses } from '../../../../../lib/inventory/warehouses';
import { buildLocationIndex } from '../../../../../lib/inventory/location-index';
import { getLocationScope, type LocationScope } from '../../../../../lib/inventory/location-scope';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Alert } from '../../../../../components/ui/alert';
import { NoAccess } from '../../../../../components/ui/no-access';
import { TransferForm } from '../transfer-form';

export const metadata = { title: 'Nueva transferencia · SaaS Inventory' };

/**
 * Create a transfer (`S-INV-TRANSFER-NEW`) — `POST /api/v1/inventory/transfers`
 * (`inventory.transfers.request`). The pickers reuse existing contracts: locations from the shared
 * `buildLocationIndex()` (`GET /locations`, `locations.view`). "Producto" is gated behind picking
 * an origin — the form fetches `GET /inventory/products-in-stock?locationId=` client-side once the
 * source location is known (`inventory.view`), never the tenant's whole catalog; per-product
 * variants still come from `GET /products/:id/variants` — there is no tenant-wide variant list
 * (`GAP-VARIANT-LIST`).
 */
export default async function NewTransferPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.transfers.request')) {
    return (
      <PageContainer>
        <PageHeader title="Nueva transferencia" />
        <NoAccess message="Necesitas el permiso de solicitud de transferencias para crear una transferencia." />
      </PageContainer>
    );
  }
  const canViewInventory = checker.can('inventory.view');
  const canViewWarehouses = checker.can('warehouses.view');
  const canViewLocations = checker.can('locations.view');

  const [warehouses, index, scope] = await Promise.all([
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    buildLocationIndex(canViewWarehouses),
    getLocationScope().catch((): LocationScope => ({ unrestricted: false, locationIds: [] })),
  ]);
  const locations = index.locations.filter((l) => l.status === 'active');
  const warehouseOptions = (warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }));
  // §6: "Sucursal/Almacén de origen" only ever offer what the caller can actually operate on —
  // the backend still re-asserts this at create(), this is just what the picker offers.
  const sourceWarehouseOptions = scope.unrestricted
    ? warehouseOptions
    : warehouseOptions.filter((w) => locations.some((l) => l.warehouseId === w.id && scope.locationIds.includes(l.id)));

  return (
    <PageContainer>
      <PageHeader
        title="Nueva transferencia"
        description="Solicita un movimiento de stock entre dos almacenes. Empieza como borrador — la aprobación, preparación y despacho se hacen desde el detalle de la transferencia."
      />
      {!canViewWarehouses && (
        <Alert tone="warning">
          No puedes listar sucursales, por eso los selectores de sucursal están vacíos. Pide a un
          administrador el permiso de sucursales.
        </Alert>
      )}
      {!canViewLocations && (
        <Alert tone="warning">
          No puedes listar almacenes, por eso los selectores de almacén están vacíos. Pide a un
          administrador el permiso de almacenes.
        </Alert>
      )}
      {!canViewInventory && (
        <Alert tone="warning">
          No puedes ver el inventario, por eso no se pueden agregar líneas aquí. Pide a un
          administrador el permiso de inventario.
        </Alert>
      )}
      <TransferForm
        canViewInventory={canViewInventory}
        warehouses={warehouseOptions}
        sourceWarehouses={sourceWarehouseOptions}
        locations={locations.map((l) => ({ id: l.id, warehouseId: l.warehouseId, name: l.name }))}
        scope={scope}
      />
    </PageContainer>
  );
}
