import type { KardexResponse, KardexRow } from '../../../lib/types/kardex';
import { Badge, EmptyState, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { useIsMobile } from '../../../lib/use-is-mobile';
import { KardexMobileList } from './kardex-mobile';

function money(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(2);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es');
}

/**
 * The Kardex ledger table itself — UI-UX-SPEC-001 §6's columns (renamed per owner feedback: "Stock
 * U" → "Stock", "Stock S" → "V.Total"), in this order: Fecha del movimiento | Movimiento | Entrada
 * | Costo U | Salida | Costo K | Stock | V.Total. The three cost columns are omitted entirely (not
 * shown as "—" placeholders) when the caller lacks `pricing.cost.view` — inferred from whether the
 * API response carried cost fields at all, never a separately-threaded permission prop (single
 * source of truth). Opening/closing balance are not rendered here — the closing balance lives in
 * the "producto seleccionado" card (`kardex-explorer.tsx`) and the opening balance was dropped
 * entirely per owner feedback ("no es necesario").
 *
 * The chronological sort toggle lives inside the "Fecha del movimiento" header cell itself (a
 * small icon button, header-cell height) rather than in the filters row — per owner feedback,
 * moved here from a standalone button.
 */
export function KardexTable({
  data,
  sortDescending = false,
  onToggleSort,
  productoByMovementId,
  almacenByMovementId,
  onRowClick,
}: {
  data: KardexResponse;
  sortDescending?: boolean;
  onToggleSort?: () => void;
  /** When given, adds a "Producto" column — "Ver todos" spans more than one product, so each row
   * needs to say which one it's for. */
  productoByMovementId?: Map<string, string>;
  /** When given, adds an "Almacén" column — "Ver todos" spans more than one location too. */
  almacenByMovementId?: Map<string, string>;
  /** When given, each row becomes clickable ("Ver todos" jumping straight to that row's own
   * product+variant+location, the same end state as picking it from the search bar). */
  onRowClick?: (row: KardexRow) => void;
}): React.JSX.Element {
  const showCost = data.opening.averageCost !== undefined;
  const isMobile = useIsMobile();

  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="Sin movimientos en este rango"
        description="Prueba con un rango de fechas más amplio, o quítalo para ver todo el historial."
      />
    );
  }

  // Phones get cards (same rows, same columns, same sort and click-through) instead of the table.
  if (isMobile) {
    return (
      <KardexMobileList
        rows={data.rows}
        showCost={showCost}
        truncated={data.truncated}
        sortDescending={sortDescending}
        onToggleSort={onToggleSort}
        productoByMovementId={productoByMovementId}
        almacenByMovementId={almacenByMovementId}
        onRowClick={onRowClick}
      />
    );
  }

  const rows = sortDescending ? [...data.rows].reverse() : data.rows;

  return (
    <div className="flex flex-col gap-2">
      {data.truncated && (
        <Badge tone="warning" className="w-fit">
          Resultado truncado — acota el rango de fechas para ver el resto
        </Badge>
      )}

      <Table>
        <THead>
          <TR>
            <TH>
              <span className="flex items-center gap-1.5">
                Fecha del movimiento
                {onToggleSort && (
                  <button
                    type="button"
                    onClick={onToggleSort}
                    title={sortDescending ? 'Mostrando lo más reciente primero — clic para invertir' : 'Mostrando lo más antiguo primero — clic para invertir'}
                    aria-label="Invertir orden cronológico"
                    className="flex h-5 w-5 items-center justify-center rounded normal-case text-white hover:bg-white/20"
                  >
                    {sortDescending ? '↓' : '↑'}
                  </button>
                )}
              </span>
            </TH>
            <TH>Movimiento</TH>
            {productoByMovementId && <TH>Producto</TH>}
            {almacenByMovementId && <TH>Almacén</TH>}
            <TH className="text-right">Entrada</TH>
            {showCost && <TH className="text-right">Costo U</TH>}
            <TH className="text-right">Salida</TH>
            {showCost && <TH className="text-right">Costo K</TH>}
            <TH className="text-right">Stock</TH>
            {showCost && <TH className="text-right">V.Total</TH>}
          </TR>
        </THead>
        <TBody className="!divide-slate-200">
          {rows.map((row: KardexRow) => (
            <TR
              key={row.movementId}
              {...(onRowClick
                ? { onClick: () => onRowClick(row), className: 'cursor-pointer', title: 'Ver el kardex completo de este producto en este almacén' }
                : {})}
            >
              <TD className="whitespace-nowrap text-slate-700">{formatDateTime(row.occurredAt)}</TD>
              <TD className="text-slate-900">{row.label}</TD>
              {productoByMovementId && <TD className="text-slate-700">{productoByMovementId.get(row.movementId) ?? '—'}</TD>}
              {almacenByMovementId && <TD className="text-slate-700">{almacenByMovementId.get(row.movementId) ?? '—'}</TD>}
              <TD className="text-right">
                {row.entrada > 0 && (
                  <Badge tone="success" className="tabular-nums">
                    +{row.entrada}
                  </Badge>
                )}
              </TD>
              {showCost && <TD className="text-right text-slate-500">{row.entrada > 0 ? money(row.unitCost) : ''}</TD>}
              <TD className="text-right">
                {row.salida > 0 && (
                  <Badge tone="danger" className="tabular-nums">
                    -{row.salida}
                  </Badge>
                )}
              </TD>
              {showCost && <TD className="text-right text-slate-500">{money(row.averageCostAfter)}</TD>}
              <TD className="bg-blue-50 text-right font-medium text-blue-900">{row.stockAfter}</TD>
              {showCost && <TD className="bg-blue-50 text-right font-medium text-blue-900">{money(row.stockValueAfter)}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
