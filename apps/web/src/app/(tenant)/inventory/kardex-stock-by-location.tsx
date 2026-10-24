import type { KardexLocationBalance } from '../../../lib/types/kardex';
import { EmptyState, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { useIsMobile } from '../../../lib/use-is-mobile';
import { StockByLocationMobile } from './kardex-mobile';

/**
 * "Stock por sucursal" (UI-UX-SPEC-001 §16) — always the LAST section on the page, never before the
 * Kardex. This variant's current balance at every location it has one, tenant-wide — not limited to
 * whichever single location the Kardex above is showing.
 */
export function KardexStockByLocation({ rows }: { rows: KardexLocationBalance[] }): React.JSX.Element {
  const isMobile = useIsMobile();
  if (rows.length === 0) {
    return <EmptyState title="Sin existencias registradas en ninguna sucursal" />;
  }

  if (isMobile) {
    return <StockByLocationMobile rows={rows} />;
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Sucursal</TH>
          <TH>Almacén</TH>
          <TH className="text-right">Físico</TH>
          <TH className="text-right">Disponible</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.locationId}>
            <TD className="text-slate-700">{row.warehouseName}</TD>
            <TD className="text-slate-900">{row.locationName}</TD>
            <TD className="text-right font-medium text-slate-900">{row.stockPhysical}</TD>
            <TD className="text-right text-slate-500">{row.stockAvailable ?? '—'}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
