import { HelpTip } from '../../../components/ui/help-tip';
import type { ReturnsPeriodBucket, ReturnsSummary } from '../../../lib/types/returns-reports';

/** Mirrors `SalesReportError` (F18-02) exactly — a small, honest error surface local to the cards,
 * never a full-page failure, never a redirect to login for a 403. */
export function ReturnsReportError({
  status,
  message,
  correlationId,
}: {
  status: number;
  message: string;
  correlationId?: string | undefined;
}): React.JSX.Element {
  const title =
    status === 403
      ? 'Acceso denegado'
      : status >= 500
        ? 'Algo salió mal de nuestro lado'
        : 'No se pudo cargar el reporte';
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
        {correlationId && (
          <p className="mt-1 text-xs text-red-600/80">Referencia: {correlationId}</p>
        )}
      </div>
      <a
        href="#report"
        className="text-sm font-medium text-red-800 underline-offset-2 hover:underline"
      >
        Reintentar
      </a>
    </div>
  );
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function KpiTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">
        {label}
      </p>
      <p className="mt-1 break-words text-xl font-semibold tabular-nums text-slate-900 sm:mt-2 sm:text-2xl">
        {value}
      </p>
    </div>
  );
}

/** The four figures, summed from the day buckets (every return appears in exactly one day bucket,
 * so summing is exact). Same values as before — only the period table is gone. */
export function summarizeReturns(buckets: ReturnsPeriodBucket[]): {
  returnCount: number;
  quantity: number;
  returnedValue: number;
  avgReturnValue: number;
} {
  const returnCount = buckets.reduce((n, b) => n + b.returnCount, 0);
  const quantity = buckets.reduce((n, b) => n + b.quantity, 0);
  const returnedValue = Math.round(buckets.reduce((n, b) => n + b.returnedValue, 0) * 100) / 100;
  return {
    returnCount,
    quantity,
    returnedValue,
    avgReturnValue: returnCount > 0 ? Math.round((returnedValue / returnCount) * 100) / 100 : 0,
  };
}

/** The returns cards. Success rendering only; an empty period shows real zeros, never a fake table.
 * `statusLabel` names which return status the figures count. */
export function ReturnsSummaryCards({
  summary,
  statusLabel,
}: {
  summary: ReturnsSummary;
  statusLabel: string;
}): React.JSX.Element {
  const { returnCount, quantity, returnedValue, avgReturnValue } = summarizeReturns(
    summary.buckets as ReturnsPeriodBucket[],
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Devoluciones" value={String(returnCount)} />
        <KpiTile label="Unidades devueltas" value={String(quantity)} />
        <KpiTile label="Valor devuelto" value={money(returnedValue, summary.currency)} />
        <KpiTile label="Promedio por devolución" value={money(avgReturnValue, summary.currency)} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        Cómo se calculan las tarjetas
        <HelpTip>
          Las tarjetas cuentan devoluciones {statusLabel} con los filtros activos. El valor devuelto
          es informativo: no es un reembolso.
        </HelpTip>
      </p>
    </div>
  );
}
