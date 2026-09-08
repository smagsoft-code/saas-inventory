import { EmptyState } from '../../../components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { PRICE_APPROVAL_STATUS_LABELS, type PriceApprovalStatus } from '../../../lib/types/sales';
import {
  isApprovalsStatusBucket,
  type ApprovalsPeriodBucket,
  type ApprovalsStatusBucket,
  type ApprovalsSummary,
  type ApprovalsSummaryBucket,
} from '../../../lib/types/approvals-reports';

/** Mirrors `ReturnsReportError` / `SalesReportError` exactly — a small, honest error surface local
 * to the report section, never a full-page failure, never a redirect to login for a 403. */
export function ApprovalsReportError({
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

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

/** approvalRate is a 0..1 ratio or null ("nothing decided yet") — never rendered as a fake 0%. */
function rate(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function KpiTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/** Period buckets (day/week/month) are request-level and safe to sum — every request filed in the
 * range appears in exactly one bucket. The headline approval rate is recomputed from the summed
 * approved/rejected totals (never an average of per-bucket rates, which would misweight). */
function PeriodKpis({ buckets, currency }: { buckets: ApprovalsPeriodBucket[]; currency: string }): React.JSX.Element {
  const requestCount = buckets.reduce((n, b) => n + b.requestCount, 0);
  const approved = buckets.reduce((n, b) => n + b.approvedCount, 0);
  const rejected = buckets.reduce((n, b) => n + b.rejectedCount, 0);
  const pending = buckets.reduce((n, b) => n + b.pendingCount, 0);
  const discountValue = buckets.reduce((n, b) => n + b.approvedDiscountValue, 0);
  const overallRate = approved + rejected > 0 ? approved / (approved + rejected) : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiTile label="Requests" value={String(requestCount)} />
      <KpiTile label="Approval rate" value={rate(overallRate)} />
      <KpiTile label="Pending" value={String(pending)} />
      <KpiTile label="Approved discount" value={money(discountValue, currency)} />
    </div>
  );
}

/** Status buckets partition the same request set by current status — `requestCount` sums to the
 * total, `discountValue` sums to the all-status discount total. No approval rate here (a
 * single-status bucket has no internal rate). */
function StatusKpis({ buckets, currency }: { buckets: ApprovalsStatusBucket[]; currency: string }): React.JSX.Element {
  const requestCount = buckets.reduce((n, b) => n + b.requestCount, 0);
  const discountValue = buckets.reduce((n, b) => n + b.discountValue, 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <KpiTile label="Requests" value={String(requestCount)} />
      <KpiTile label="Statuses" value={String(buckets.length)} />
      <KpiTile label="Total discount" value={money(discountValue, currency)} />
    </div>
  );
}

function PeriodRow({ bucket, currency }: { bucket: ApprovalsPeriodBucket; currency: string }): React.JSX.Element {
  return (
    <TR>
      <TD className="font-medium">{bucket.key}</TD>
      <TD className="text-right">{bucket.requestCount}</TD>
      <TD className="text-right">{bucket.approvedCount}</TD>
      <TD className="text-right">{bucket.rejectedCount}</TD>
      <TD className="text-right text-slate-500">{bucket.pendingCount}</TD>
      <TD className="text-right">{rate(bucket.approvalRate)}</TD>
      <TD className="text-right">{money(bucket.approvedDiscountValue, currency)}</TD>
    </TR>
  );
}

function StatusRow({ bucket, currency }: { bucket: ApprovalsStatusBucket; currency: string }): React.JSX.Element {
  return (
    <TR>
      <TD className="font-medium">{PRICE_APPROVAL_STATUS_LABELS[bucket.key as PriceApprovalStatus] ?? bucket.key}</TD>
      <TD className="text-right">{bucket.requestCount}</TD>
      <TD className="text-right">{money(bucket.discountValue, currency)}</TD>
    </TR>
  );
}

/**
 * The F18-05 report — success rendering only (loading/error/no-access are the caller's job, same
 * `/approvals` page pattern `ReturnsReportSection` established: pre-check permission, let a real
 * failure surface as a local `ApprovalsReportError`, never a redirect). One
 * horizontally-scrolling table only, never the whole page.
 */
export function ApprovalsReportSection({ summary, currency }: { summary: ApprovalsSummary; currency: string }): React.JSX.Element {
  if (summary.buckets.length === 0) {
    return <EmptyState title="No approval requests in this period" description="Try a wider date range, or a different status." />;
  }

  const isStatus = summary.groupBy === 'status';
  const buckets = summary.buckets as ApprovalsSummaryBucket[];

  return (
    <div className="flex flex-col gap-3">
      {isStatus ? (
        <StatusKpis buckets={buckets as ApprovalsStatusBucket[]} currency={currency} />
      ) : (
        <PeriodKpis buckets={buckets as ApprovalsPeriodBucket[]} currency={currency} />
      )}

      <Table>
        <THead>
          {isStatus ? (
            <TR>
              <TH>Status</TH>
              <TH className="text-right">Requests</TH>
              <TH className="text-right">Discount value</TH>
            </TR>
          ) : (
            <TR>
              <TH>Period</TH>
              <TH className="text-right">Requests</TH>
              <TH className="text-right">Approved</TH>
              <TH className="text-right">Rejected</TH>
              <TH className="text-right">Pending</TH>
              <TH className="text-right">Approval rate</TH>
              <TH className="text-right">Approved discount</TH>
            </TR>
          )}
        </THead>
        <TBody>
          {buckets.map((bucket) =>
            isApprovalsStatusBucket(bucket) ? (
              <StatusRow key={bucket.key} bucket={bucket} currency={currency} />
            ) : (
              <PeriodRow key={bucket.key} bucket={bucket} currency={currency} />
            ),
          )}
        </TBody>
      </Table>
    </div>
  );
}
