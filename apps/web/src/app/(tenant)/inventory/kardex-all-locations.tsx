'use client';

import { useEffect, useState } from 'react';
import { getKardex } from '../../../lib/inventory/kardex';
import type { KardexResponse } from '../../../lib/types/kardex';
import { ErrorState, Spinner } from '../../../components/ui';
import { useIsMobile } from '../../../lib/use-is-mobile';
import { AllLocationsMobileList } from './kardex-mobile';

export interface AllLocationsOption {
  id: string;
  name: string;
  warehouseName: string;
}

interface LocationTotals {
  location: AllLocationsOption;
  stockUnits: number;
  averageCost?: number;
  stockValue?: number;
}

function money(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(2);
}

// Same tiles as the selected-product card, always one row.
const STAT_BOX = 'min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3';
const STAT_LABEL = 'truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500';
const STAT_VALUE = 'mt-1 truncate font-mono text-lg font-bold tabular-nums text-slate-900 md:text-xl';

const TH_CLASS = 'px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600';

/**
 * "Todos los almacenes" for one variant: the totals across every location that holds it — stock,
 * weighted-average cost and total cost — plus a collapsible per-sucursal/almacén breakdown in the
 * same compact secondary-table format as the "Existencias" card of the products screen.
 *
 * A Kardex ledger only makes sense per variant+location (two locations can hold the same variant at
 * different average costs), so the per-location figures are each location's own closing balance
 * (`GET /reports/kardex`, one call per location, in parallel) and the totals are derived from them:
 * total cost = Σ per-location value; average cost = total cost ÷ total units, so it is the true
 * weighted average. Cost figures are omitted by the API without `pricing.cost.view` — then only the
 * stock is shown.
 */
export function KardexAllLocations({
  productVariantId,
  locations,
  from,
  to,
}: {
  productVariantId: string;
  locations: AllLocationsOption[];
  from?: string;
  to?: string;
}): React.JSX.Element {
  const [rows, setRows] = useState<LocationTotals[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    Promise.all(
      locations.map((location) =>
        getKardex({ productVariantId, locationId: location.id, ...(from ? { from } : {}), ...(to ? { to } : {}) }).then(
          (data: KardexResponse): LocationTotals => ({
            location,
            stockUnits: data.closing.stockUnits,
            ...(data.closing.averageCost !== undefined ? { averageCost: data.closing.averageCost } : {}),
            ...(data.closing.stockValue !== undefined ? { stockValue: data.closing.stockValue } : {}),
          }),
        ),
      ),
    )
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [productVariantId, locations, from, to]);

  if (error !== null) {
    return <ErrorState error={error} />;
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Cargando existencias de todos los almacenes…
      </div>
    );
  }

  const showCost = rows.every((row) => row.stockValue !== undefined);
  const totalUnits = rows.reduce((sum, row) => sum + row.stockUnits, 0);
  const totalValue = rows.reduce((sum, row) => sum + (row.stockValue ?? 0), 0);
  const averageCost = totalUnits > 0 ? totalValue / totalUnits : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid gap-2 ${showCost ? 'grid-cols-3' : 'max-w-[12rem] grid-cols-1'}`} data-testid="all-locations-totals">
        <div className={STAT_BOX}>
          <p className={STAT_LABEL}>Stock disponible</p>
          <p className={STAT_VALUE}>{totalUnits}</p>
        </div>
        {showCost && (
          <>
            <div className={STAT_BOX}>
              <p className={STAT_LABEL}>Costo promedio</p>
              <p className={STAT_VALUE}>${money(averageCost)}</p>
            </div>
            <div className={STAT_BOX}>
              <p className={STAT_LABEL}>Costo total</p>
              <p className={STAT_VALUE}>${money(totalValue)}</p>
            </div>
          </>
        )}
      </div>

      {rows.length > 1 && (
        // Same secondary-table treatment as the products screen's "Existencias": indented under the
        // summary with a left rule, small type and a light header.
        <div className={isMobile ? '' : 'ml-6 border-l-2 border-slate-300 pl-4'}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            Existencias por sucursal y almacén ({rows.length})
          </button>
          {open && isMobile && <AllLocationsMobileList rows={rows} showCost={showCost} />}
          {open && !isMobile && (
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th scope="col" className={TH_CLASS}>
                      Sucursal
                    </th>
                    <th scope="col" className={TH_CLASS}>
                      Almacén
                    </th>
                    <th scope="col" className={`${TH_CLASS} text-right`}>
                      Disponible
                    </th>
                    {showCost && (
                      <>
                        <th scope="col" className={`${TH_CLASS} text-right`}>
                          Costo promedio
                        </th>
                        <th scope="col" className={`${TH_CLASS} text-right`}>
                          Costo total
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.location.id}>
                      <td className="px-2 py-1.5 text-slate-500">{row.location.warehouseName || '—'}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-700">{row.location.name}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-slate-800">{row.stockUnits}</td>
                      {showCost && (
                        <>
                          <td className="px-2 py-1.5 text-right text-slate-500">${money(row.averageCost)}</td>
                          <td className="px-2 py-1.5 text-right text-slate-500">${money(row.stockValue)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
