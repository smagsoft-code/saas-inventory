import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listProducts } from '../../../../lib/catalog/products';
import { listLocations } from '../../../../lib/inventory/locations';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Alert } from '../../../../components/ui/alert';
import { NoAccess } from '../../../../components/ui/no-access';
import { AdjustmentForm } from './adjustment-form';

export const metadata = { title: 'Adjust stock · SaaS Inventory' };

export default async function AdjustStockPage({
  searchParams,
}: {
  searchParams: Promise<{ productVariantId?: string; locationId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.adjust')) {
    return (
      <PageContainer>
        <PageHeader title="Adjust stock" />
        <NoAccess message="You need the inventory-adjust permission to record stock adjustments." />
      </PageContainer>
    );
  }
  const canViewProducts = checker.can('products.view');
  const canViewLocations = checker.can('locations.view');

  const sp = await searchParams;
  const fixedProductVariantId = sp.productVariantId || undefined;

  const [products, locations] = await Promise.all([
    !fixedProductVariantId && canViewProducts
      ? listProducts({ pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
    canViewLocations ? listLocations({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Adjust stock"
        description="Record a receipt or a correction. Transfers and sales use their own flows."
      />
      {!canViewLocations && (
        <Alert tone="warning">
          You cannot list locations, so the location selector is empty. Ask an administrator for the
          locations permission.
        </Alert>
      )}
      {!fixedProductVariantId && !canViewProducts && (
        <Alert tone="warning">
          You cannot list products. Open a variant from the catalogue and use “Adjust stock” there.
        </Alert>
      )}
      <AdjustmentForm
        {...(fixedProductVariantId ? { fixedProductVariantId } : {})}
        {...(sp.locationId ? { fixedLocationId: sp.locationId } : {})}
        products={(products?.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
        locations={(locations?.data ?? []).map((l) => ({ id: l.id, name: l.name }))}
      />
    </PageContainer>
  );
}
