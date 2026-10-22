import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listLocations } from '../../../lib/inventory/locations';
import { listWarehouses } from '../../../lib/inventory/warehouses';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { NoAccess } from '../../../components/ui/no-access';
import { KardexExplorer, type LocationOption } from './kardex-explorer';

export const metadata = { title: 'Inventario · SaaS Inventory' };

/**
 * Inventario / Kardex (UI-UX-SPEC-001) — replaces the old "Reporte de inventario" (KPIs + Agrupar
 * por warehouse/category) and "Existencias" (unfiltered balances list) sections, both of which
 * auto-loaded on every visit. The new flow — búsqueda de producto → fechas → seleccionar producto /
 * Ver todos → Kardex → Stock por sucursal — loads nothing beyond this page's own header until the
 * user searches or picks "Ver todos" (§1/§22); everything else lives in `KardexExplorer`, a client
 * component. Sucursal/Categoría filters were tried and removed per owner feedback.
 *
 * `GET /reports/inventory-summary`'s `groupBy` (warehouse/category) is untouched server-side —
 * FASE 18's Home dashboard and other reports still use it; only this page's UI control is removed
 * (§4), consistent with "no rompas otros reportes que puedan utilizar ese parámetro".
 *
 * Warehouses/locations (bounded, ≤100 each) are still fetched eagerly here, same as every other
 * inventory form (add-stock, adjust) — the §22 lazy-loading requirement is about the tenant's full
 * product catalog and movement history, not this small reference list.
 */
export default async function InventoryKardexPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Inventario" />
        <NoAccess message="Necesitas el permiso de inventario para ver esta página." />
      </PageContainer>
    );
  }
  const canAdjust = checker.can('inventory.adjust');
  const canViewLocations = checker.can('locations.view');
  const canViewWarehouses = checker.can('warehouses.view');

  let locationOptions: LocationOption[] = [];
  if (canViewLocations && canViewWarehouses) {
    const [locationsResult, warehousesResult] = await Promise.all([
      listLocations({ pageSize: 100, status: 'active' }),
      listWarehouses({ pageSize: 100, status: 'active' }),
    ]);
    const warehouseNameById = new Map(warehousesResult.data.map((w) => [w.id, w.name]));
    locationOptions = locationsResult.data.map((location) => ({
      id: location.id,
      name: location.name,
      warehouseId: location.warehouseId,
      warehouseName: warehouseNameById.get(location.warehouseId) ?? '',
    }));
  }

  return (
    <PageContainer>
      <PageHeader
        title="Inventario"
        help="Kardex de inventario: historial cronológico de movimientos, costo promedio y stock por sucursal."
        actions={
          canAdjust ? (
            <div className="flex gap-2">
              <ButtonLink href="/inventory/add-stock">Agregar stock</ButtonLink>
              <ButtonLink href="/inventory/adjust" variant="secondary">
                Ajustar existencias
              </ButtonLink>
            </div>
          ) : undefined
        }
      />

      <KardexExplorer locations={locationOptions} />
    </PageContainer>
  );
}
