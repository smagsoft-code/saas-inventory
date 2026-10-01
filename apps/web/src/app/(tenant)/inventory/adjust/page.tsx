import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listProducts } from '../../../../lib/catalog/products';
import { listWarehouses } from '../../../../lib/inventory/warehouses';
import { listLocations } from '../../../../lib/inventory/locations';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Alert } from '../../../../components/ui/alert';
import { NoAccess } from '../../../../components/ui/no-access';
import { AdjustmentForm } from './adjustment-form';

export const metadata = { title: 'Ajustar existencias · SaaS Inventory' };

export default async function AdjustStockPage({
  searchParams,
}: {
  searchParams: Promise<{ productVariantId?: string; locationId?: string; sku?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.adjust')) {
    return (
      <PageContainer>
        <PageHeader title="Ajustar existencias" />
        <NoAccess message="Necesitas el permiso de ajuste de inventario para registrar ajustes de existencias." />
      </PageContainer>
    );
  }
  const canViewProducts = checker.can('products.view');
  const canViewWarehouses = checker.can('warehouses.view');
  const canViewLocations = checker.can('locations.view');

  const sp = await searchParams;
  const fixedProductVariantId = sp.productVariantId || undefined;

  const [products, warehouses, locations] = await Promise.all([
    !fixedProductVariantId && canViewProducts
      ? listProducts({ pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    canViewLocations ? listLocations({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Ajustar existencias"
        description="Registra una recepción o una corrección. Las transferencias y ventas usan sus propios flujos."
      />
      {!canViewWarehouses && (
        <Alert tone="warning">
          No puedes listar sucursales, por eso el selector de sucursal está vacío. Pide a un
          administrador el permiso de sucursales.
        </Alert>
      )}
      {!canViewLocations && (
        <Alert tone="warning">
          No puedes listar almacenes, por eso el selector de almacén está vacío. Pide a un
          administrador el permiso de almacenes.
        </Alert>
      )}
      {!fixedProductVariantId && !canViewProducts && (
        <Alert tone="warning">
          No puedes listar productos. Abre una variante desde el catálogo y usa «Ajustar existencias» ahí.
        </Alert>
      )}
      <AdjustmentForm
        {...(fixedProductVariantId ? { fixedProductVariantId } : {})}
        {...(fixedProductVariantId && sp.sku ? { fixedVariantLabel: sp.sku } : {})}
        {...(sp.locationId ? { fixedLocationId: sp.locationId } : {})}
        products={(products?.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
        warehouses={(warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }))}
        locations={(locations?.data ?? []).map((l) => ({ id: l.id, warehouseId: l.warehouseId, name: l.name }))}
      />
    </PageContainer>
  );
}
