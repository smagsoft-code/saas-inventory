import { EmptyState } from '../../../../components/ui/empty-state';
import { Badge } from '../../../../components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import { TRANSFER_STATUS_LABELS, transferStatusTone, type TransferStatus } from '../../../../lib/types/inventory';
import {
  isTransferStatusBucket,
  isTransferVariantBucket,
  type TransfersSummary,
} from '../../../../lib/types/inventory-reports';

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

/**
 * The F18-08 transfer report — success rendering only (loading/error/no-access are the caller's job,
 * same posture as `InventoryReportSection`). One horizontally-scrolling table only, never the whole
 * page. `totals` is `groupBy`-independent — the in-transit headline shows on every grouping.
 *
 * - `status` — count of transfers per lifecycle status (all 7). Safe to sum.
 * - `destination` / `variant` — in-transit quantity (`Σ dispatched − received` over open transfers),
 *   which sums cleanly across buckets to `totals.inTransitQuantity`.
 */
export function TransfersReportSection({ summary }: { summary: TransfersSummary }): React.JSX.Element {
  const groupBy = summary.groupBy;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <KpiTile label="Units in transit" value={String(summary.totals.inTransitQuantity)} />
        <KpiTile label="Open transfers" value={String(summary.totals.openTransferCount)} />
      </div>

      {summary.buckets.length === 0 ? (
        <EmptyState
          title={groupBy === 'status' ? 'No transfers yet' : 'Nothing in transit'}
          description={
            groupBy === 'status'
              ? 'Buckets appear here once a transfer is created.'
              : 'A transfer contributes here once it has been dispatched and not yet fully received.'
          }
        />
      ) : groupBy === 'status' ? (
        <Table>
          <THead>
            <TR>
              <TH>Status</TH>
              <TH className="text-right">Transfers</TH>
            </TR>
          </THead>
          <TBody>
            {summary.buckets.map((bucket) =>
              isTransferStatusBucket(bucket) ? (
                <TR key={bucket.key}>
                  <TD className="font-medium">
                    <Badge tone={transferStatusTone(bucket.key)}>
                      {TRANSFER_STATUS_LABELS[bucket.key as TransferStatus] ?? bucket.key}
                    </Badge>
                  </TD>
                  <TD className="text-right">{bucket.transferCount}</TD>
                </TR>
              ) : null,
            )}
          </TBody>
        </Table>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{groupBy === 'variant' ? 'Product' : 'Destination'}</TH>
              <TH className="text-right">In transit</TH>
              {groupBy === 'destination' && <TH className="text-right">Open transfers</TH>}
            </TR>
          </THead>
          <TBody>
            {summary.buckets.map((bucket) => {
              if (isTransferVariantBucket(bucket)) {
                return (
                  <TR key={bucket.key}>
                    <TD className="font-medium">
                      {bucket.productName}
                      <span className="ml-2 text-xs text-slate-500">{bucket.sku}</span>
                    </TD>
                    <TD className="text-right font-medium">{bucket.inTransitQuantity}</TD>
                  </TR>
                );
              }
              if (isTransferStatusBucket(bucket)) return null;
              return (
                <TR key={bucket.key}>
                  <TD className="font-medium">{bucket.destinationName}</TD>
                  <TD className="text-right font-medium">{bucket.inTransitQuantity}</TD>
                  <TD className="text-right text-slate-500">{bucket.openTransferCount}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
