'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { getKardex } from '../../../lib/inventory/kardex';
import type { KardexResponse, KardexRow } from '../../../lib/types/kardex';
import type { InventoryMovement } from '../../../lib/types/inventory';
import { Button, ErrorState, Spinner } from '../../../components/ui';
import { KardexTable } from './kardex-table';
import type { LocationOption } from './kardex-explorer';

const PAGE_SIZE = 20;

// Only these carry a physical stock effect — the same exclusion the per-variant Kardex applies
// (RESERVATION/COMMITMENT never move physical stock, so they never get an Entrada/Salida/Costo
// row there either; this view stays consistent with it for the same reason).
const PHYSICAL_MOVEMENT_TYPES = new Set(['RECEIPT', 'SALE', 'RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'INITIAL_STOCK']);

export interface RowSelection {
  productId: string;
  productName: string;
  productVariantId: string;
  locationId: string;
}

/**
 * "Ver todos" — a tenant-wide movement feed spanning every product, with the exact same columns
 * as the per-variant Kardex table plus two additions (owner feedback): "Producto" and "Almacén",
 * since rows here span more than one of each. Costo K / Stock / V.Total are only well-defined per
 * (variant, location) pair, so this view does not fake them: for every distinct pair appearing on
 * the current page, it calls the same `GET /reports/kardex` the per-variant table uses (once per
 * pair, not once per row — most pages only touch a handful of distinct pairs) and reads each row's
 * own, correctly-computed values back out by `movementId`. No new backend logic for the numbers —
 * this reuses the existing, already-tested Kardex engine, just fans it out across the products
 * present on this page instead of one.
 *
 * Clicking a row calls `onSelectRow` with that row's own product/variant/location — the caller
 * (`kardex-explorer.tsx`) uses it to jump straight to that product's normal Kardex view, the same
 * end state as picking it from the search bar, except the location is this row's own rather than
 * auto-selected or prompted.
 */
export function KardexAllMovements({
  locations,
  occurredFrom,
  occurredTo,
  onSelectRow,
}: {
  locations: LocationOption[];
  occurredFrom?: string;
  occurredTo?: string;
  onSelectRow?: (selection: RowSelection) => void;
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [tableData, setTableData] = useState<KardexResponse | null>(null);
  const [almacenByMovementId, setAlmacenByMovementId] = useState<Map<string, string>>(new Map());
  const [productoByMovementId, setProductoByMovementId] = useState<Map<string, string>>(new Map());
  const [selectionByMovementId, setSelectionByMovementId] = useState<Map<string, RowSelection>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sortDescending, setSortDescending] = useState(false);

  const locationsById = new Map(locations.map((l) => [l.id, l]));

  async function fetchPage(nextPage: number): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const flat = await apiFetch<{ data: InventoryMovement[]; meta: { total: number; totalPages: number } }>('/api/v1/inventory/movements', {
        query: { page: nextPage, pageSize: PAGE_SIZE, ...(occurredFrom ? { occurredFrom } : {}), ...(occurredTo ? { occurredTo } : {}) },
      });
      const physicalMovements = flat.data.filter((m) => PHYSICAL_MOVEMENT_TYPES.has(m.movementType));

      const pairs = new Map<string, { productVariantId: string; locationId: string }>();
      for (const movement of physicalMovements) {
        pairs.set(`${movement.productVariantId}:${movement.locationId}`, { productVariantId: movement.productVariantId, locationId: movement.locationId });
      }

      const kardexByPair = await Promise.all(
        Array.from(pairs.values()).map((pair) =>
          getKardex({ productVariantId: pair.productVariantId, locationId: pair.locationId, ...(occurredFrom ? { from: occurredFrom } : {}), ...(occurredTo ? { to: occurredTo } : {}) }),
        ),
      );

      const rowsById = new Map<string, KardexRow>();
      const nextAlmacenById = new Map<string, string>();
      const nextProductoById = new Map<string, string>();
      const nextSelectionById = new Map<string, RowSelection>();
      let anyCost = false;
      for (const kardex of kardexByPair) {
        if (kardex.opening.averageCost !== undefined) anyCost = true;
        const location = locationsById.get(kardex.locationId);
        const almacenLabel = location ? `${location.warehouseName} — ${location.name}` : kardex.locationId;
        for (const row of kardex.rows) {
          rowsById.set(row.movementId, row);
          nextAlmacenById.set(row.movementId, almacenLabel);
          nextProductoById.set(row.movementId, kardex.productName);
          nextSelectionById.set(row.movementId, {
            productId: kardex.productId,
            productName: kardex.productName,
            productVariantId: kardex.productVariantId,
            locationId: kardex.locationId,
          });
        }
      }

      const combinedRows = physicalMovements
        .map((m) => rowsById.get(m.id))
        .filter((row): row is KardexRow => Boolean(row))
        .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

      setTableData({
        productVariantId: '',
        locationId: '',
        productId: '',
        productName: '',
        sku: '',
        opening: anyCost ? { stockUnits: 0, averageCost: 0, stockValue: 0, estimated: false } : { stockUnits: 0 },
        rows: combinedRows,
        closing: anyCost ? { stockUnits: 0, averageCost: 0, stockValue: 0, estimated: false } : { stockUnits: 0 },
        truncated: false,
        stockByLocation: [],
      });
      setAlmacenByMovementId(nextAlmacenById);
      setProductoByMovementId(nextProductoById);
      setSelectionByMovementId(nextSelectionById);
      setTotalPages(flat.meta.totalPages);
      setPage(nextPage);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPage(1);
  }, [occurredFrom, occurredTo]);

  if (loading && !tableData) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Cargando movimientos…
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={() => void fetchPage(page)} />;
  }

  if (!tableData) {
    return <></>;
  }

  return (
    <div className="flex flex-col gap-2">
      <KardexTable
        data={tableData}
        sortDescending={sortDescending}
        onToggleSort={() => setSortDescending((current) => !current)}
        productoByMovementId={productoByMovementId}
        almacenByMovementId={almacenByMovementId}
        {...(onSelectRow
          ? {
              onRowClick: (row: KardexRow) => {
                const selection = selectionByMovementId.get(row.movementId);
                if (selection) onSelectRow(selection);
              },
            }
          : {})}
      />
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-3 text-sm text-slate-600">
          <span>
            Página {page} de {totalPages}
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1 || loading} onClick={() => void fetchPage(page - 1)}>
            Anterior
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages || loading} onClick={() => void fetchPage(page + 1)}>
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
