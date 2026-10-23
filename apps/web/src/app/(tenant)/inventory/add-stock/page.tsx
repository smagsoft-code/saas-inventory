import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listWarehouses } from '../../../../lib/inventory/warehouses';
import { listLocations } from '../../../../lib/inventory/locations';
import { listProductCatalog } from '../../../../lib/catalog/product-catalog';
import { apiPublicUrl } from '../../../../lib/api/public-url';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Alert } from '../../../../components/ui/alert';
import { ButtonLink } from '../../../../components/ui/button';
import { NoAccess } from '../../../../components/ui/no-access';
import { AddStockForm } from './add-stock-form';

export const metadata = { title: 'Agregar stock · SaaS Inventory' };

/**
 * `S-INV-ADD-STOCK` (OUI-011) — **new, additive** screen. Ingreso de nuevas unidades al
 * inventario (producción propia, compra directa, etc.) — conceptualmente distinto de
 * `/inventory/adjust` ("Ajustar existencias", una corrección de una existencia ya registrada),
 * que queda completamente sin tocar.
 *
 * Auditoría previa a esta implementación (sin cambios de backend): el modelo ya tiene un tipo de
 * movimiento exacto para esto — `RECEIPT` ("an operational inbound event not tied to a transfer" —
 * `create-adjustment.dto.ts`'s own doc comment), que ya afecta `quantity_physical` con signo
 * positivo (`StockLedgerService.MOVEMENT_EFFECT.RECEIPT`) sin tocar reservado/comprometido. Este
 * formulario llama al mismo `POST /inventory/adjustments` que "Ajustar existencias" ya usa, fijando
 * `movementType: 'RECEIPT'` — nunca expuesto al usuario como opción — y exige el mismo permiso
 * `inventory.adjust` (única RBAC que existe para esta escritura; no hay un permiso más granular
 * "recibir stock" en el catálogo — reutilizado tal cual, sin crear uno nuevo). La autorización de
 * ubicación (ADR-0024, `LocationAuthorizationService`) también se aplica igual, sin cambios.
 *
 * Único elemento nuevo de UX (no de backend): un selector en cascada Sucursal → Almacén (GL-1) en
 * vez de la lista plana de "Ajustar existencias" — más claro para elegir dónde entra la mercancía
 * nueva. Motivo y observación se combinan en un solo campo porque el backend solo tiene una columna
 * de texto libre (`inventory_movements.reason`); no se inventa una segunda para no crear contrato
 * nuevo por comodidad de UI.
 */
export default async function AddStockPage({
  searchParams,
}: {
  searchParams: Promise<{ productVariantId?: string; sku?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.adjust')) {
    return (
      <PageContainer>
        <PageHeader title="Agregar stock" />
        <NoAccess message="Necesitas el permiso de ajuste de inventario para registrar ingresos de stock." />
      </PageContainer>
    );
  }
  const canViewProducts = checker.can('products.view');
  const canViewWarehouses = checker.can('warehouses.view');
  const canViewLocations = checker.can('locations.view');

  const sp = await searchParams;
  const fixedProductVariantId = sp.productVariantId || undefined;
  // A fixed variant arrives as an id only: resolve its product + code so the form shows names (and the
  // photo/QR panel knows which product to look up) instead of the raw identifier.
  const fixedRow =
    fixedProductVariantId && canViewProducts
      ? (await listProductCatalog({ variantId: fixedProductVariantId, pageSize: 1 }).catch(() => null))?.data[0]
      : undefined;
  const fixedSku = sp.sku || fixedRow?.sku;

  const [warehouses, locations] = await Promise.all([
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    canViewLocations ? listLocations({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Agregar stock"
        actions={
          <ButtonLink href="/inventory/add-stock/bulk" variant="ghost">
            Carga masiva
          </ButtonLink>
        }
        help="Registra el ingreso de nuevas unidades al inventario — producción propia, compra directa, u otro ingreso. Para corregir una existencia ya registrada, usa «Ajustar existencias»."
      />
      {!canViewWarehouses && (
        <Alert tone="warning">
          No puedes listar sucursales, por eso el selector de sucursal está vacío. Pide a un administrador el permiso de sucursales.
        </Alert>
      )}
      {!canViewLocations && (
        <Alert tone="warning">
          No puedes listar almacenes, por eso el selector de almacén está vacío. Pide a un administrador el permiso de almacenes.
        </Alert>
      )}
      {!fixedProductVariantId && !canViewProducts && (
        <Alert tone="warning">
          No puedes listar productos. Abre una variante desde el catálogo y usa «Agregar stock» ahí.
        </Alert>
      )}
      <AddStockForm
        {...(fixedProductVariantId ? { fixedProductVariantId } : {})}
        {...(fixedProductVariantId && fixedSku ? { fixedVariantLabel: fixedSku } : {})}
        {...(fixedRow ? { fixedProduct: { id: fixedRow.productId, name: fixedRow.productName } } : {})}
        apiPublicUrl={apiPublicUrl()}
        canViewQr={checker.can('catalog.qr.manage')}
        warehouses={(warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }))}
        locations={(locations?.data ?? []).map((l) => ({ id: l.id, warehouseId: l.warehouseId, name: l.name }))}
      />
    </PageContainer>
  );
}
