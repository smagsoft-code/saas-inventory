import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listProducts } from '../../../../lib/catalog/products';
import { listWarehouses } from '../../../../lib/inventory/warehouses';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
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
 * `sales.carts.manage` (cart ops) and `sales.orders.create` (`POST /orders`). The pickers reuse
 * existing contracts: locations from `buildLocationIndex()` (`GET /locations`), products from
 * `GET /products?status=active` then per-product `GET /products/:id/variants` (`GAP-VARIANT-LIST`),
 * customers from `GET /customers?q=` (real search).
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

  const sp = await searchParams;

  const [cart, products, warehouses, index] = await Promise.all([
    getActiveCart(),
    canViewProducts ? listProducts({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    buildLocationIndex(canViewWarehouses),
  ]);
  const locations = index.locations.filter((l) => l.status === 'active');

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
        description="Elige el cliente y el almacén, agrega productos y crea el pedido. El pedido reserva stock — confirmarlo después cierra la venta."
      />
      {!canViewLocations && (
        <Alert tone="warning">No puedes listar almacenes, por eso el selector de almacén está vacío.</Alert>
      )}
      {!canViewProducts && (
        <Alert tone="warning">No puedes listar productos, por eso no se pueden agregar líneas.</Alert>
      )}
      {!canSearchCustomers && (
        <Alert tone="warning">No puedes buscar clientes — pide a alguien con ese permiso que elija uno.</Alert>
      )}
      <NewSale
        initialCart={cart}
        initialCustomer={initialCustomer}
        {...(sp.customerId && !cart ? { customerIdHint: sp.customerId } : {})}
        products={(products?.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
        warehouses={(warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }))}
        locations={locations.map((l) => ({ id: l.id, warehouseId: l.warehouseId, name: l.name }))}
        canSearchCustomers={canSearchCustomers}
      />
    </PageContainer>
  );
}
