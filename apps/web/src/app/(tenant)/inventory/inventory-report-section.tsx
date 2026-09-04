import { EmptyState } from '../../../components/ui/empty-state';
import { Badge } from '../../../components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { isCategoryBucket, type InventorySummary, type InventorySummaryBucket } from '../../../lib/types/inventory-reports';

/** A small, honest error surface local to the report section — never a full-page failure, never a
 * redirect to login for a 403 (mirrors `SalesReportError`, F18-02 §18). */
export function InventoryReportError({
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

function BucketRow({ bucket }: { bucket: InventorySummaryBucket }): React.JSX.Element {
  const isCategory = isCategoryBucket(bucket);
  const name = isCategory ? bucket.categoryName : bucket.warehouseName;
  return (
    <TR>
      <TD className="font-medium">{name}</TD>
      <TD className="text-right font-medium">
        {bucket.availableQuantity}
        {bucket.availableQuantity <= 0 && (
          <Badge tone="danger" className="ml-2">
            out
          </Badge>
        )}
      </TD>
      <TD className="text-right text-slate-500">{bucket.reservedQuantity}</TD>
      <TD className="text-right text-slate-500">{bucket.outOfStockCount}</TD>
    </TR>
  );
}

/** The F18-03 report — success rendering only (loading/error/no-access are the caller's job, same
 * posture as `SalesReportSection`). One horizontally-scrolling table only, never the whole page. */
export function InventoryReportSection({ summary }: { summary: InventorySummary }): React.JSX.Element {
  const groupLabel = summary.groupBy === 'category' ? 'Category' : 'Warehouse';

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <KpiTile label="Available" value={String(summary.totals.availableQuantity)} />
        <KpiTile label="Reserved" value={String(summary.totals.reservedQuantity)} />
        <KpiTile label="Out of stock (SKUs)" value={String(summary.totals.outOfStockCount)} />
      </div>

      {summary.buckets.length === 0 ? (
        <EmptyState title="No stock recorded yet" description="Buckets appear here once stock is received or adjusted." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{groupLabel}</TH>
              <TH className="text-right">Available</TH>
              <TH className="text-right">Reserved</TH>
              <TH className="text-right">Out of stock</TH>
            </TR>
          </THead>
          <TBody>
            {summary.buckets.map((bucket) => (
              <BucketRow key={bucket.key} bucket={bucket} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
