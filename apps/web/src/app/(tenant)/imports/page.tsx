import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listImportJobs } from '../../../lib/imports/imports';
import { getImportsSummary } from '../../../lib/imports/reports';
import { tenantStartOfDayUtc } from '../../../lib/home/tenant-day';
import {
  IMPORT_JOB_STATUSES,
  IMPORT_JOB_STATUS_LABELS,
  importJobStatusTone,
  type ImportJobStatus,
} from '../../../lib/types/imports';
import {
  IMPORTS_SUMMARY_GROUP_BY,
  type ImportsSummary,
  type ImportsSummaryGroupBy,
} from '../../../lib/types/imports-reports';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { ImportsReportFilters, type ImportsReportFilterValues } from './imports-report-filters';
import { ImportsReportError, ImportsReportSection } from './imports-report-section';

export const metadata = { title: 'Imports · SaaS Inventory' };

const PAGE_SIZE = 20;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function pickStatus(value: string | undefined): ImportJobStatus | undefined {
  return (IMPORT_JOB_STATUSES as readonly string[]).includes(value ?? '') ? (value as ImportJobStatus) : undefined;
}

function pickReportGroupBy(value: string | undefined): ImportsSummaryGroupBy {
  return (IMPORTS_SUMMARY_GROUP_BY as readonly string[]).includes(value ?? '') ? (value as ImportsSummaryGroupBy) : 'day';
}

function pickReportStatus(value: string | undefined): string {
  return (IMPORT_JOB_STATUSES as readonly string[]).includes(value ?? '') ? (value as string) : '';
}

/**
 * Import history (`S-IMP-LIST`) — `GET /api/v1/imports` (`import.execute`), offset paginated,
 * newest first. The only real filter is a single `status` (`GAP-MULTI-STATUS`); there is no text
 * search (`GAP-SEARCH`) and no date range. The DTO already carries the counters and filename, so
 * there is no per-row enrichment fetch.
 */
export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    reportFrom?: string;
    reportTo?: string;
    reportGroupBy?: string;
    reportStatus?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('import.execute')) {
    return (
      <PageContainer>
        <PageHeader title="Imports" />
        <NoAccess message="You need the import permission to view this page." />
      </PageContainer>
    );
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = pickStatus(sp.status);

  // F18-09 imports report — a separate section, its own params, independent of the job list below.
  // Default period: last 30 days, resolved in the tenant's own timezone (session.timezone, F18-01) —
  // same precedent as /approvals, /returns, /sales, so a normal visit never hits the endpoint's
  // required-from/to 400.
  const now = new Date();
  const reportFrom = sp.reportFrom || tenantStartOfDayUtc(session?.timezone ?? 'UTC', new Date(now.getTime() - THIRTY_DAYS_MS));
  const reportTo = sp.reportTo || now.toISOString();
  const reportGroupBy = pickReportGroupBy(sp.reportGroupBy);
  const reportStatus = pickReportStatus(sp.reportStatus);
  const reportFilters: ImportsReportFilterValues = { from: reportFrom, to: reportTo, groupBy: reportGroupBy, status: reportStatus };

  let summary: ImportsSummary | undefined;
  let summaryError: { status: number; message: string; correlationId: string | undefined } | undefined;
  try {
    summary = await getImportsSummary({
      from: reportFrom,
      to: reportTo,
      groupBy: reportGroupBy,
      ...(reportStatus ? { status: reportStatus } : {}),
    });
  } catch (error) {
    summaryError = {
      status: isApiError(error) ? error.status : 0,
      message: httpErrorMessage(error),
      correlationId: isApiError(error) ? error.correlationId : undefined,
    };
  }

  const result = await listImportJobs({ page, pageSize: PAGE_SIZE, ...(status ? { status } : {}) });

  function buildHref(next: { page?: number; status?: string | null }): string {
    const params = new URLSearchParams();
    const nextStatus = next.status === undefined ? status : next.status || undefined;
    if (nextStatus) params.set('status', nextStatus);
    // Carry the report section's own params forward — paginating / filtering the list must not
    // silently reset the report back to its default period (mirrors /approvals, F18-05).
    if (sp.reportFrom) params.set('reportFrom', sp.reportFrom);
    if (sp.reportTo) params.set('reportTo', sp.reportTo);
    if (sp.reportGroupBy) params.set('reportGroupBy', sp.reportGroupBy);
    if (sp.reportStatus) params.set('reportStatus', sp.reportStatus);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/imports${params.toString() ? `?${params}` : ''}`;
  }

  const chip = (active: boolean) =>
    active
      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  return (
    <PageContainer>
      <PageHeader
        title="Imports"
        description="Bulk-onboard catalog and starting stock from an Excel file — upload, map columns, validate, review, then commit."
        actions={<ButtonLink href="/imports/new">New import</ButtonLink>}
      />

      <section aria-labelledby="report-heading" id="report" className="flex flex-col gap-3">
        <h2 id="report-heading" className="text-sm font-semibold text-slate-900">
          Imports report
        </h2>
        <ImportsReportFilters initial={reportFilters} />
        {summary ? (
          <ImportsReportSection summary={summary} />
        ) : (
          summaryError && (
            <ImportsReportError status={summaryError.status} message={summaryError.message} correlationId={summaryError.correlationId} />
          )
        )}
      </section>

      <hr className="border-slate-200" />

      <h2 className="text-sm font-semibold text-slate-900">Import history</h2>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={buildHref({ status: null })} aria-current={!status ? 'true' : undefined} className={chip(!status)}>
          All statuses
        </Link>
        {IMPORT_JOB_STATUSES.map((s) => (
          <Link
            key={s}
            href={buildHref({ status: s })}
            aria-current={status === s ? 'true' : undefined}
            className={chip(status === s)}
          >
            {IMPORT_JOB_STATUS_LABELS[s]}
          </Link>
        ))}
        <Link href="/imports/templates" className="ml-auto text-sm font-medium text-slate-500 hover:underline">
          Mapping templates
        </Link>
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={status ? 'No imports match this status' : 'No imports yet'}
          description={
            status
              ? 'Try a different status.'
              : 'Download the template, fill it in, then start an import to onboard products and stock.'
          }
          {...(!status ? { action: <ButtonLink href="/imports/new">New import</ButtonLink> } : {})}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>File</TH>
                <TH>Status</TH>
                <TH className="text-right">Rows</TH>
                <TH className="text-right">Valid</TH>
                <TH className="text-right">Warnings</TH>
                <TH className="text-right">Invalid</TH>
                <TH className="text-right">Imported</TH>
                <TH>Created</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((job) => (
                <TR key={job.id}>
                  <TD className="max-w-[16rem] truncate font-medium" title={job.originalFilename}>
                    {job.originalFilename}
                  </TD>
                  <TD>
                    <Badge tone={importJobStatusTone(job.status)}>
                      {IMPORT_JOB_STATUS_LABELS[job.status as ImportJobStatus] ?? job.status}
                    </Badge>
                  </TD>
                  <TD className="text-right text-slate-500">{job.totalRows ?? '—'}</TD>
                  <TD className="text-right text-slate-500">{job.validRows ?? '—'}</TD>
                  <TD className="text-right text-slate-500">{job.warningRows ?? '—'}</TD>
                  <TD className="text-right text-slate-500">{job.invalidRows ?? '—'}</TD>
                  <TD className="text-right text-slate-500">{job.importedRows ?? '—'}</TD>
                  <TD className="whitespace-nowrap text-slate-500">{new Date(job.createdAt).toLocaleDateString()}</TD>
                  <TD>
                    <Link
                      href={`/imports/${job.id}`}
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      View
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={result.meta.page}
            pageSize={result.meta.pageSize}
            total={result.meta.total}
            totalPages={result.meta.totalPages}
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
