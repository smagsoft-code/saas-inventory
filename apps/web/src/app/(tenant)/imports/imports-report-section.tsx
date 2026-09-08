import { EmptyState } from '../../../components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { IMPORT_JOB_STATUS_LABELS, type ImportJobStatus } from '../../../lib/types/imports';
import type { ImportsSummary } from '../../../lib/types/imports-reports';

/** Mirrors `ApprovalsReportError` / `MovementsReportError` exactly — a small, honest error surface
 * local to the report section, never a full-page failure, never a redirect to login for a 403. */
export function ImportsReportError({
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
 * The F18-09 report — success rendering only (loading/error/no-access are the caller's job, same
 * `/approvals` / `/inventory` pattern). One horizontally-scrolling table only, never the whole page.
 *
 * Every column is safe to sum across buckets: `jobCount` because one job lands in exactly one
 * bucket, the row sums because they are frozen per job. `totals` is the endpoint's own
 * `groupBy`-independent aggregate over the completed-job window — the KPI row, never re-derived
 * client-side.
 */
export function ImportsReportSection({ summary }: { summary: ImportsSummary }): React.JSX.Element {
  const isStatus = summary.groupBy === 'status';
  const t = summary.totals;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Jobs completed" value={String(t.jobCount)} />
        <KpiTile label="Rows imported" value={String(t.importedRows)} />
        <KpiTile label="Rows invalid" value={String(t.invalidRows)} />
        <KpiTile label="Rows with warnings" value={String(t.warningRows)} />
      </div>

      {summary.buckets.length === 0 ? (
        <EmptyState
          title="No completed imports in this period"
          description="Only jobs that finished (completed, completed with errors, failed or cancelled) in the date range are counted. Try a wider range."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{isStatus ? 'Status' : 'Period'}</TH>
              <TH className="text-right">Jobs</TH>
              <TH className="text-right">Total rows</TH>
              <TH className="text-right">Valid</TH>
              <TH className="text-right">Warnings</TH>
              <TH className="text-right">Invalid</TH>
              <TH className="text-right">Imported</TH>
            </TR>
          </THead>
          <TBody>
            {summary.buckets.map((bucket) => (
              <TR key={bucket.key}>
                <TD className="font-medium">
                  {isStatus ? IMPORT_JOB_STATUS_LABELS[bucket.key as ImportJobStatus] ?? bucket.key : bucket.key}
                </TD>
                <TD className="text-right">{bucket.jobCount}</TD>
                <TD className="text-right text-slate-500">{bucket.totalRows}</TD>
                <TD className="text-right text-slate-500">{bucket.validRows}</TD>
                <TD className="text-right text-slate-500">{bucket.warningRows}</TD>
                <TD className={`text-right ${bucket.invalidRows > 0 ? 'text-red-600' : 'text-slate-500'}`}>{bucket.invalidRows}</TD>
                <TD className="text-right font-medium">{bucket.importedRows}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
