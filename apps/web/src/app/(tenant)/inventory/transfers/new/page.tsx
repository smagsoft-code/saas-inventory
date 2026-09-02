import { getSession } from '../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../lib/auth/permissions';
import { listProducts } from '../../../../../lib/catalog/products';
import { buildLocationIndex } from '../../../../../lib/inventory/location-index';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Alert } from '../../../../../components/ui/alert';
import { NoAccess } from '../../../../../components/ui/no-access';
import { TransferForm } from '../transfer-form';

export const metadata = { title: 'New transfer · SaaS Inventory' };

/**
 * Create a transfer (`S-INV-TRANSFER-NEW`) — `POST /api/v1/inventory/transfers`
 * (`inventory.transfers.request`). The pickers reuse existing contracts: locations from the shared
 * `buildLocationIndex()` (`GET /locations`, `locations.view`), products from `GET /products`
 * (`products.view`) then per-product `GET /products/:id/variants` — there is no tenant-wide variant
 * list (`GAP-VARIANT-LIST`).
 */
export default async function NewTransferPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.transfers.request')) {
    return (
      <PageContainer>
        <PageHeader title="New transfer" />
        <NoAccess message="You need the transfer-request permission to create a transfer." />
      </PageContainer>
    );
  }
  const canViewProducts = checker.can('products.view');
  const canViewLocations = checker.can('locations.view');

  const [products, index] = await Promise.all([
    canViewProducts ? listProducts({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);
  const locations = index.locations.filter((l) => l.status === 'active');

  return (
    <PageContainer>
      <PageHeader
        title="New transfer"
        description="Request a stock movement between two locations. It starts as a draft — approval, preparation and dispatch happen from the transfer detail."
      />
      {!canViewLocations && (
        <Alert tone="warning">
          You cannot list locations, so the location selectors are empty. Ask an administrator for the
          locations permission.
        </Alert>
      )}
      {!canViewProducts && (
        <Alert tone="warning">
          You cannot list products, so lines cannot be added here. Ask an administrator for the
          products permission.
        </Alert>
      )}
      <TransferForm
        products={(products?.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      />
    </PageContainer>
  );
}
