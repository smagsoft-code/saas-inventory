import type { TransfersSummary } from '../../../../lib/types/inventory-reports';

/** A small, honest error surface local to the report section — never a full-page failure, never a
 * redirect to login for a 403 (mirrors `InventoryReportError` / `MovementsReportError`, F18-02 §18). */
export function TransfersReportError({
  status,
  message,
  correlationId,
}: {
  status: number;
  message: string;
  correlationId?: string | undefined;
}): React.JSX.Element {
  const title = status === 403 ? 'Acceso denegado' : status >= 500 ? 'Algo salió mal de nuestro lado' : 'No se pudo cargar el reporte';
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
        {correlationId && <p className="mt-1 text-xs text-red-600/80">Referencia: {correlationId}</p>}
      </div>
      <a href="#report" className="text-sm font-medium text-red-800 underline-offset-2 hover:underline">
        Reintentar
      </a>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/**
 * The F18-08 transfer report — just the two always-on KPI tiles (owner feedback: the "Agrupar
 * por" selector and its grouped breakdown table added more than the headline numbers were worth;
 * removed, keeping only what never needs a grouping choice). `summary.buckets`/`summary.groupBy`
 * are still part of the backend contract (`GET /reports/transfers-summary`) and still typed here —
 * just not rendered.
 */
export function TransfersReportSection({ summary }: { summary: TransfersSummary }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      <KpiTile label="Unidades en tránsito" value={String(summary.totals.inTransitQuantity)} />
      <KpiTile label="Transferencias abiertas" value={String(summary.totals.openTransferCount)} />
    </div>
  );
}
