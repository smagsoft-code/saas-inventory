import type { ApprovalsPeriodBucket, ApprovalsSummary } from '../../../lib/types/approvals-reports';

/** Mirrors `ReturnsReportError` / `SalesReportError` exactly — a small, honest error surface local
 * to the cards, never a full-page failure, never a redirect to login for a 403. */
export function ApprovalsReportError({
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

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

/** approvalRate is a 0..1 ratio or null ("nothing decided yet") — never rendered as a fake 0%. */
function rate(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function KpiTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold tabular-nums text-slate-900 sm:mt-2 sm:text-2xl">{value}</p>
    </div>
  );
}

/** The four figures, summed from the day buckets (every request filed in the range appears in exactly
 * one bucket, so summing is exact). The headline approval rate is recomputed from the summed
 * approved/rejected totals — never an average of per-bucket rates, which would misweight. */
export function summarizeApprovals(buckets: ApprovalsPeriodBucket[]): {
  requestCount: number;
  approvalRate: number | null;
  pending: number;
  approvedDiscountValue: number;
} {
  const requestCount = buckets.reduce((n, b) => n + b.requestCount, 0);
  const approved = buckets.reduce((n, b) => n + b.approvedCount, 0);
  const rejected = buckets.reduce((n, b) => n + b.rejectedCount, 0);
  const pending = buckets.reduce((n, b) => n + b.pendingCount, 0);
  const approvedDiscountValue = Math.round(buckets.reduce((n, b) => n + b.approvedDiscountValue, 0) * 100) / 100;
  return {
    requestCount,
    approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
    pending,
    approvedDiscountValue,
  };
}

/**
 * The approvals cards (Solicitudes, Tasa de aprobación, Pendientes, Descuento aprobado) — same
 * values as before, now without the period table. Success rendering only; with no requests the
 * cards show real zeros (rate "—"), an empty period being a valid answer.
 */
export function ApprovalsSummaryCards({ summary }: { summary: ApprovalsSummary }): React.JSX.Element {
  const { requestCount, approvalRate, pending, approvedDiscountValue } = summarizeApprovals(
    summary.buckets as ApprovalsPeriodBucket[],
  );
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile label="Solicitudes" value={String(requestCount)} />
      <KpiTile label="Tasa de aprobación" value={rate(approvalRate)} />
      <KpiTile label="Pendientes" value={String(pending)} />
      <KpiTile label="Descuento aprobado" value={money(approvedDiscountValue, summary.currency)} />
    </div>
  );
}
