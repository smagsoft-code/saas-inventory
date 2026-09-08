import { EmptyState } from '../../../../components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import { MOVEMENT_TYPE_LABELS, type MovementType } from '../../../../lib/types/inventory';
import type { MovementsSummary } from '../../../../lib/types/inventory-reports';

/** A small, honest error surface local to the report section — never a full-page failure, never a
 * redirect to login for a 403 (mirrors `SalesReportError` / `InventoryReportError`, F18-02 §18). */
export function MovementsReportError({
  status,
  message,
  correlationId,
}: {
  status: number;
  message: string;
  correlationId?: string | undefined;
}): React.JSX.Element {
  const title = status === 403 ? 'Access denied' : status >= 500 ? 'Something went wrong on our end' : 'Could not load the report';
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
        {correlationId && <p className="mt-1 text-xs text-red-600/80">Reference: {correlationId}</p>}
      </div>
      <a href="#report" className="text-sm font-medium text-red-800 underline-offset-2 hover:underline">
        Try again
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

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * The F18-07 movements report — success rendering only (loading/error/no-access are the caller's
 * job, same posture as `SalesReportSection`). One horizontally-scrolling table only, never the whole
 * page. `movementCount` sums cleanly across buckets (each movement lands in one bucket);
 * `totalQuantity` is the signed net — meaningful per `type` bucket, a mixed net for a period bucket
 * with no movement-type filter (shown as-is, never re-interpreted).
 */
export function MovementsReportSection({ summary }: { summary: MovementsSummary }): React.JSX.Element {
  const isType = summary.groupBy === 'type';
  const totalMovements = summary.buckets.reduce((n, b) => n + b.movementCount, 0);
  const netQuantity = summary.buckets.reduce((n, b) => n + b.totalQuantity, 0);

  if (summary.buckets.length === 0) {
    return (
      <EmptyState
        title="No movements in this period"
        description="Try a wider date range, or a different movement type."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiTile label="Movements" value={String(totalMovements)} />
        <KpiTile label="Net quantity" value={signed(netQuantity)} />
        <KpiTile label={isType ? 'Types' : 'Periods'} value={String(summary.buckets.length)} />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>{isType ? 'Movement type' : 'Period'}</TH>
            <TH className="text-right">Movements</TH>
            <TH className="text-right">Net quantity</TH>
          </TR>
        </THead>
        <TBody>
          {summary.buckets.map((bucket) => (
            <TR key={bucket.key}>
              <TD className="font-medium">
                {isType ? (MOVEMENT_TYPE_LABELS[bucket.key as MovementType] ?? bucket.key) : bucket.key}
              </TD>
              <TD className="text-right">{bucket.movementCount}</TD>
              <TD className={`text-right ${bucket.totalQuantity < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {signed(bucket.totalQuantity)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
