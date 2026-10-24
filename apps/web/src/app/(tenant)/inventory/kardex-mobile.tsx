'use client';

import { cn } from '../../../lib/cn';
import type { KardexLocationBalance, KardexRow } from '../../../lib/types/kardex';
import { Badge, EmptyState } from '../../../components/ui';
import { PRODUCTS_MOBILE_THEMES } from '../products/products-mobile-theme';
import type { AllLocationsOption } from './kardex-all-locations';

/**
 * The phone layout of Inventario's tables — one card per row, same data and same columns as the
 * desktop tables (nothing added, nothing dropped), in the type and colours of Inicio / Productos /
 * Historial de ventas (`PRODUCTS_MOBILE_THEMES`, light now, dark kept in the tokens).
 */
const T = PRODUCTS_MOBILE_THEMES.light;

const money = (value: number | undefined): string => (value === undefined ? '—' : value.toFixed(2));
const formatDateTime = (iso: string): string => new Date(iso).toLocaleString('es');

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn(T.tile, 'p-2.5', className)}>
      <dt className={T.tileLabel}>{label}</dt>
      <dd className={cn(T.tileValueMono, 'font-semibold')}>{children}</dd>
    </div>
  );
}

// --- Kardex ledger -------------------------------------------------------------------------------

export function KardexMobileList({
  rows,
  showCost,
  truncated,
  sortDescending,
  onToggleSort,
  productoByMovementId,
  almacenByMovementId,
  onRowClick,
}: {
  rows: KardexRow[];
  showCost: boolean;
  truncated: boolean;
  sortDescending: boolean;
  onToggleSort?: (() => void) | undefined;
  productoByMovementId?: Map<string, string> | undefined;
  almacenByMovementId?: Map<string, string> | undefined;
  onRowClick?: ((row: KardexRow) => void) | undefined;
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin movimientos en este rango"
        description="Prueba con un rango de fechas más amplio, o quítalo para ver todo el historial."
      />
    );
  }
  const ordered = sortDescending ? [...rows].reverse() : rows;

  return (
    <div className="flex flex-col gap-3">
      {truncated && (
        <Badge tone="warning" className="w-fit">
          Resultado truncado — acota el rango de fechas para ver el resto
        </Badge>
      )}
      {onToggleSort && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onToggleSort}
            title={sortDescending ? 'Mostrando lo más reciente primero — clic para invertir' : 'Mostrando lo más antiguo primero — clic para invertir'}
            aria-label="Invertir orden cronológico"
            className={cn(T.chip, 'font-semibold')}
          >
            Fecha del movimiento <span aria-hidden="true">{sortDescending ? '↓' : '↑'}</span>
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {ordered.map((row) => {
          const producto = productoByMovementId?.get(row.movementId);
          const almacen = almacenByMovementId?.get(row.movementId);
          const body = (
            <>
              <span className="flex items-start justify-between gap-3">
                <span className={cn(T.stockLine, 'min-w-0')}>{formatDateTime(row.occurredAt)}</span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-lg font-bold tabular-nums text-blue-700">{row.stockAfter}</span>
                  <span className={T.currency}>Stock</span>
                </span>
              </span>
              <span className={T.title}>{row.label}</span>
              {producto !== undefined && (
                <span className={T.meta}>
                  Producto: <span className="font-medium text-slate-700">{producto}</span>
                </span>
              )}
              {almacen !== undefined && (
                <span className={T.meta}>
                  Almacén: <span className="font-medium text-slate-700">{almacen}</span>
                </span>
              )}
              <span className={cn('flex flex-wrap items-center gap-2 border-t pt-2', T.divider)}>
                {row.entrada > 0 && <span className={T.badgeStock}>Entrada +{row.entrada}</span>}
                {row.salida > 0 && <span className={T.badgeOut}>Salida −{row.salida}</span>}
              </span>
              {showCost && (
                <dl className="grid grid-cols-3 gap-2">
                  <Stat label="Costo U">{row.entrada > 0 ? money(row.unitCost) : '—'}</Stat>
                  <Stat label="Costo K">{money(row.averageCostAfter)}</Stat>
                  <Stat label="V.Total">{money(row.stockValueAfter)}</Stat>
                </dl>
              )}
            </>
          );
          return (
            <li key={row.movementId} className={T.card}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  title="Ver el kardex completo de este producto en este almacén"
                  className="flex w-full flex-col gap-2 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
                >
                  {body}
                </button>
              ) : (
                <div className="flex flex-col gap-2 p-4">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Stock por sucursal --------------------------------------------------------------------------

export function StockByLocationMobile({ rows }: { rows: KardexLocationBalance[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.locationId} className={cn(T.card, 'flex flex-col gap-2 p-4')}>
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className={cn('block', T.tileLabel)}>Sucursal</span>
              <span className={cn('block', T.meta, 'font-medium text-slate-700')}>{row.warehouseName}</span>
            </span>
          </span>
          <span className={T.title}>{row.locationName}</span>
          <dl className={cn('grid grid-cols-2 gap-2 border-t pt-2', T.divider)}>
            <Stat label="Físico">{row.stockPhysical}</Stat>
            <Stat label="Disponible">{row.stockAvailable ?? '—'}</Stat>
          </dl>
        </li>
      ))}
    </ul>
  );
}

// --- "Todos los almacenes" breakdown -------------------------------------------------------------

export interface AllLocationsMobileRow {
  location: AllLocationsOption;
  stockUnits: number;
  averageCost?: number | undefined;
  stockValue?: number | undefined;
}

export function AllLocationsMobileList({ rows, showCost }: { rows: AllLocationsMobileRow[]; showCost: boolean }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.location.id} className={cn(T.card, 'flex flex-col gap-2 p-4')}>
          <span>
            <span className={cn('block', T.tileLabel)}>Sucursal</span>
            <span className={cn('block', T.meta, 'font-medium text-slate-700')}>{row.location.warehouseName || '—'}</span>
          </span>
          <span className={T.title}>{row.location.name}</span>
          <dl className={cn('grid gap-2 border-t pt-2', T.divider, showCost ? 'grid-cols-3' : 'grid-cols-1')}>
            <Stat label="Disponible">{row.stockUnits}</Stat>
            {showCost && (
              <>
                <Stat label="Costo promedio">${money(row.averageCost)}</Stat>
                <Stat label="Costo total">${money(row.stockValue)}</Stat>
              </>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}
