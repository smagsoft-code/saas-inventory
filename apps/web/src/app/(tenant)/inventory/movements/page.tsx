import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listMovements } from '../../../../lib/inventory/movements';
import { listProductCatalog } from '../../../../lib/catalog/product-catalog';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import { buildUserIndex } from '../../../../lib/core/users';
import {
  MOVEMENT_TYPE_LABELS,
  MOVEMENT_TYPES,
  type InventoryMovement,
  type MovementType,
} from '../../../../lib/types/inventory';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { NoAccess } from '../../../../components/ui/no-access';
import { Pagination } from '../../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import { MovementsFilters, type MovementsLocationOption } from './movements-filters';
import { MovementsMobileList, type MobileMovement } from './movements-mobile-list';

export const metadata = { title: 'Movimientos de inventario · SaaS Inventory' };

const PAGE_SIZE = 20;

/** What the Motivo / referencia column says when the server could not resolve a document's own name
 * (e.g. the document was removed) — the kind of document, never its raw id. */
const REFERENCE_TYPE_LABELS: Record<string, string> = {
  order: 'Pedido',
  transfer: 'Transferencia',
  transfer_receipt: 'Transferencia',
  sales_return_item: 'Devolución',
  import_job: 'Importación',
  manual_adjustment: 'Ajuste manual',
};

function parseMovementType(value: string | undefined): MovementType | undefined {
  return (MOVEMENT_TYPES as readonly string[]).includes(value ?? '') ? (value as MovementType) : undefined;
}

/**
 * Movement history / kardex (`S-INV-MOVEMENTS`) — `GET /api/v1/inventory/movements`
 * (`inventory.view`), offset paginated. Real filters: `locationId`, `movementType`,
 * `occurredFrom`/`occurredTo` (half-open `[occurredFrom, occurredTo)` on `occurred_at`, F18-03 —
 * `GAP-MOVEMENTS-DATE-FILTER` resolved) and (from a drill-in) `productVariantId`. **Still no
 * sort** — rows are shown in the order the endpoint returns them (newest first).
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    locationId?: string;
    movementType?: string;
    productVariantId?: string;
    occurredFrom?: string;
    occurredTo?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Movimientos de inventario" />
        <NoAccess message="Necesitas el permiso de inventario para ver esta página." />
      </PageContainer>
    );
  }
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const locationId = sp.locationId || undefined;
  const movementType = parseMovementType(sp.movementType);
  const productVariantId = sp.productVariantId || undefined;
  const occurredFrom = sp.occurredFrom || undefined;
  const occurredTo = sp.occurredTo || undefined;

  const [result, index, userIndex] = await Promise.all([
    listMovements({
      page,
      pageSize: PAGE_SIZE,
      ...(locationId ? { locationId } : {}),
      ...(movementType ? { movementType } : {}),
      ...(productVariantId ? { productVariantId } : {}),
      ...(occurredFrom ? { occurredFrom } : {}),
      ...(occurredTo ? { occurredTo } : {}),
    }),
    buildLocationIndex(checker.can('warehouses.view')),
    buildUserIndex(checker.can('core.users.read')),
  ]);
  // Reuse the index's own location fetch for the filter dropdown — no second GET /locations.
  // Warehouse-prefixed, same disambiguation `kardex-all-movements.tsx`'s Almacén column uses (two
  // locations can share a bare name, e.g. "General", across different warehouses).
  const locationOptions: MovementsLocationOption[] = index.locations
    .filter((l) => l.status === 'active')
    .map((l) => ({ id: l.id, label: `${index.warehouseName(l.id)} — ${l.name}` }));

  function buildHref(next: { page?: number; productVariantId?: string | undefined }): string {
    const params = new URLSearchParams();
    const nextVariant = 'productVariantId' in next ? next.productVariantId : productVariantId;
    if (locationId) params.set('locationId', locationId);
    if (movementType) params.set('movementType', movementType);
    if (nextVariant) params.set('productVariantId', nextVariant);
    if (occurredFrom) params.set('occurredFrom', occurredFrom);
    if (occurredTo) params.set('occurredTo', occurredTo);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/inventory/movements${params.toString() ? `?${params}` : ''}`;
  }

  // The drill-in chip names the product (code · name), never the raw variant id.
  let variantLabel: string | undefined;
  if (productVariantId) {
    const item = (await listProductCatalog({ variantId: productVariantId, pageSize: 1 }).catch(() => null))?.data[0];
    variantLabel = item ? `${item.sku} · ${item.productName}` : 'Producto seleccionado';
  }

  const typeLabelOf = (movement: InventoryMovement): string => MOVEMENT_TYPE_LABELS[movement.movementType as MovementType] ?? movement.movementType;
  const referenceOf = (movement: InventoryMovement): string =>
    movement.reason ?? movement.referenceLabel ?? (movement.referenceType ? (REFERENCE_TYPE_LABELS[movement.referenceType] ?? '—') : '—');
  const userOf = (movement: InventoryMovement): string => (movement.actorId ? userIndex.userName(movement.actorId) : movement.actorType);
  const mobileMovements: MobileMovement[] = result.data.map((movement: InventoryMovement) => ({
    id: movement.id,
    whenLabel: new Date(movement.occurredAt).toLocaleString(),
    typeLabel: typeLabelOf(movement),
    quantity: movement.quantity,
    balanceAfter: movement.balanceAfter,
    locationLabel: index.locationName(movement.locationId),
    referenceLabel: referenceOf(movement),
    userLabel: userOf(movement),
  }));

  const hasFilter = Boolean(locationId || movementType || productVariantId || occurredFrom || occurredTo);

  return (
    <PageContainer>
      <PageHeader
        title="Movimientos de inventario"
        help="El libro de movimientos, de solo lectura: cada recepción, venta, transferencia, reserva y ajuste."
      />

      <h2 className="text-sm font-semibold text-slate-900">Historial de movimientos</h2>

      <MovementsFilters initial={{ occurredFrom, occurredTo, locationId, movementType }} locations={locationOptions} />

      {productVariantId && (
        <div>
          <Link
            href={buildHref({ productVariantId: undefined })}
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            {variantLabel} <span aria-hidden="true">×</span>
            <span className="sr-only">Quitar filtro de variante</span>
          </Link>
        </div>
      )}

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'Ningún movimiento coincide con estos filtros' : 'Aún no hay movimientos registrados'}
          description={hasFilter ? 'Prueba con otro almacén, tipo o rango de fechas.' : 'Los movimientos aparecen aquí a medida que cambia el stock.'}
        />
      ) : (
        <>
          <div className="md:hidden">
            <MovementsMobileList movements={mobileMovements} />
          </div>
          <div className="hidden md:block">
          <Table>
            <THead>
              <TR>
                <TH>Cuándo</TH>
                <TH>Tipo</TH>
                <TH>Almacén</TH>
                <TH className="text-right">Cantidad</TH>
                <TH className="text-right">Saldo después</TH>
                <TH>Motivo / referencia</TH>
                <TH>Usuario</TH>
              </TR>
            </THead>
            <TBody className="!divide-slate-200">
              {result.data.map((movement: InventoryMovement) => (
                <TR key={movement.id}>
                  <TD className="whitespace-nowrap text-slate-500">
                    {new Date(movement.occurredAt).toLocaleString()}
                  </TD>
                  <TD>
                    <Badge tone="neutral">{typeLabelOf(movement)}</Badge>
                  </TD>
                  <TD className="text-slate-500">{index.locationName(movement.locationId)}</TD>
                  <TD className="text-right">
                    {movement.quantity >= 0 ? (
                      <Badge tone="success" className="tabular-nums">
                        +{movement.quantity}
                      </Badge>
                    ) : (
                      <Badge tone="danger" className="tabular-nums">
                        {movement.quantity}
                      </Badge>
                    )}
                  </TD>
                  <TD className="bg-blue-50 text-right font-medium text-blue-900">{movement.balanceAfter}</TD>
                  <TD className="text-slate-500">
                    {referenceOf(movement)}
                  </TD>
                  <TD className="text-slate-500">{userOf(movement)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          </div>
          <Pagination
            page={result.meta.page}
            pageSize={result.meta.pageSize}
            total={result.meta.total}
            totalPages={result.meta.totalPages}
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
