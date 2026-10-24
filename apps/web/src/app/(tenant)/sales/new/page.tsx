import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listWarehouses } from '../../../../lib/inventory/warehouses';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import { getLocationScope, type LocationScope } from '../../../../lib/inventory/location-scope';
import { getActiveCart } from '../../../../lib/sales/cart';
import { getCustomer } from '../../../../lib/sales/customers';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Alert } from '../../../../components/ui/alert';
import { NoAccess } from '../../../../components/ui/no-access';
import { NewSale } from './new-sale';

export const metadata = { title: 'Nueva venta · SaaS Inventory' };

/**
 * New sale (`S-SALE-NEW`) — the vendor cart → order flow. Completing a sale needs both
 * `sales.carts.manage` (cart ops) and `sales.orders.create` (`POST /orders`).
 *
 * Sucursal/Almacén only ever offers the caller's own ADR-0024 operating scope
 * (`getLocationScope()`), the same pattern `/inventory/transfers/new` already established — the
 * backend still re-asserts access at `POST/PATCH /cart` (`CartsService.assertLocationSellable`),
 * this is just what the picker offers. Products are no longer preloaded here: the "Crear venta"
 * modal searches `GET /products?q=` itself, so there is nothing to fetch up front.
 */
export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.carts.manage') || !checker.can('sales.orders.create')) {
    return (
      <PageContainer>
        <PageHeader title="Nueva venta" />
        <NoAccess message="Necesitas los permisos de carrito y creación de pedidos para hacer una venta." />
      </PageContainer>
    );
  }
  const canViewProducts = checker.can('products.view');
  const canViewWarehouses = checker.can('warehouses.view');
  const canViewLocations = checker.can('locations.view');
  const canSearchCustomers = checker.can('sales.customers.view');
  const canManageCustomers = checker.can('sales.customers.manage');

  const sp = await searchParams;

  const [cart, warehouses, index, scope] = await Promise.all([
    getActiveCart(),
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    buildLocationIndex(canViewWarehouses),
    getLocationScope().catch((): LocationScope => ({ unrestricted: false, locationIds: [] })),
  ]);
  const locations = index.locations.filter((l) => l.status === 'active');
  const warehouseOptions = (warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }));
  // Only offer sucursales that have at least one location in scope — the backend is still the
  // final authority (`assertLocationSellable`), this is only what the picker offers.
  const scopedWarehouses = scope.unrestricted
    ? warehouseOptions
    : warehouseOptions.filter((w) => locations.some((l) => l.warehouseId === w.id && scope.locationIds.includes(l.id)));

  // Resolve the display name of whoever is already on the cart (or the ?customerId= hint).
  const customerIdToResolve = cart?.customerId ?? (sp.customerId || undefined);
  const initialCustomer =
    customerIdToResolve && canSearchCustomers
      ? await getCustomer(customerIdToResolve)
          .then((c) => ({ id: c.id, displayName: c.displayName }))
          .catch(() => null)
      : null;

  return (
    <PageContainer>
      <PageHeader
        title="Nueva venta"
        help="Elige la sucursal y el almacén, crea la venta y agrega productos desde la ventana de carrito. El pedido reserva stock — confirmarlo después cierra la venta."
      />
      {!canViewLocations && (
        <Alert tone="warning">No puedes listar almacenes, por eso el selector de almacén está vacío.</Alert>
      )}
      {!canViewProducts && (
        <Alert tone="warning">No puedes listar productos, por eso no se pueden agregar al carrito.</Alert>
      )}
      {!canSearchCustomers && (
        <Alert tone="warning">No puedes buscar clientes — pide a alguien con ese permiso que elija uno.</Alert>
      )}
      <NewSale
        initialCart={cart}
        initialCustomer={initialCustomer}
        {...(sp.customerId && !cart ? { customerIdHint: sp.customerId } : {})}
        warehouses={scopedWarehouses}
        locations={locations.map((l) => ({ id: l.id, warehouseId: l.warehouseId, name: l.name }))}
        scope={scope}
        canViewProducts={canViewProducts}
        canManageProducts={checker.can('products.manage')}
        canSearchCustomers={canSearchCustomers}
        canManageCustomers={canManageCustomers}
      />
    </PageContainer>
  );
}
