import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listProducts } from '../../../../lib/catalog/products';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import { getActiveCart } from '../../../../lib/sales/cart';
import { getCustomer } from '../../../../lib/sales/customers';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Alert } from '../../../../components/ui/alert';
import { NoAccess } from '../../../../components/ui/no-access';
import { NewSale } from './new-sale';

export const metadata = { title: 'New sale · SaaS Inventory' };

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
        <PageHeader title="New sale" />
        <NoAccess message="You need the cart and order-create permissions to make a sale." />
      </PageContainer>
    );
  }
  const canViewProducts = checker.can('products.view');
  const canViewLocations = checker.can('locations.view');
  const canSearchCustomers = checker.can('sales.customers.view');

  const sp = await searchParams;

  const [cart, products, index] = await Promise.all([
    getActiveCart(),
    canViewProducts ? listProducts({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    buildLocationIndex(checker.can('warehouses.view')),
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
        title="New sale"
        description="Pick the customer and location, add products, then create the order. The order reserves stock — confirming it later commits the sale."
      />
      {!canViewLocations && (
        <Alert tone="warning">You cannot list locations, so the location selector is empty.</Alert>
      )}
      {!canViewProducts && (
        <Alert tone="warning">You cannot list products, so lines cannot be added.</Alert>
      )}
      {!canSearchCustomers && (
        <Alert tone="warning">You cannot search customers — ask someone with that permission to set one.</Alert>
      )}
      <NewSale
        initialCart={cart}
        initialCustomer={initialCustomer}
        {...(sp.customerId && !cart ? { customerIdHint: sp.customerId } : {})}
        products={(products?.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        canSearchCustomers={canSearchCustomers}
      />
    </PageContainer>
  );
}
