import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listPriceApprovals } from '../../../lib/sales/price-approvals';
import { getApprovalsSummary } from '../../../lib/sales/approvals-reports';
import { shortId } from '../../../lib/inventory/location-index';
import { tenantStartOfDayUtc } from '../../../lib/home/tenant-day';
import {
  PRICE_APPROVAL_STATUSES,
  PRICE_APPROVAL_STATUS_LABELS,
  priceApprovalStatusTone,
  type PriceApprovalStatus,
} from '../../../lib/types/sales';
import {
  APPROVALS_SUMMARY_GROUP_BY,
  APPROVALS_SUMMARY_STATUSES,
  type ApprovalsSummary,
  type ApprovalsSummaryGroupBy,
} from '../../../lib/types/approvals-reports';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { ApprovalsReportFilters, type ApprovalsReportFilterValues } from './approvals-report-filters';
import { ApprovalsReportError, ApprovalsReportSection } from './approvals-report-section';

export const metadata = { title: 'Approvals · SaaS Inventory' };

const PAGE_SIZE = 20;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function pickStatus(value: string | undefined): PriceApprovalStatus | undefined {
  return (PRICE_APPROVAL_STATUSES as readonly string[]).includes(value ?? '') ? (value as PriceApprovalStatus) : undefined;
}

function pickGroupBy(value: string | undefined): ApprovalsSummaryGroupBy {
  return (APPROVALS_SUMMARY_GROUP_BY as readonly string[]).includes(value ?? '') ? (value as ApprovalsSummaryGroupBy) : 'day';
}

function pickReportStatus(value: string | undefined): string {
  return (APPROVALS_SUMMARY_STATUSES as readonly string[]).includes(value ?? '') ? (value as string) : '';
}

/**
 * Price-approval queue (`S-APPROVALS-LIST`) — `GET /api/v1/price-approvals` (requires
 * `pricing.discount.request` **or** `pricing.discount.approve` — `@RequireAnyPermission`, F17-09).
 * Real filters only: `status`, `orderId` (offset paginated) — no text search, no sort, no date
 * filter. Resolving a request (`approve` / `reject`) is done from the detail page and needs
 * `pricing.discount.approve`.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    orderId?: string;
    reportFrom?: string;
    reportTo?: string;
    reportGroupBy?: string;
    reportStatus?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.canAny(['pricing.discount.request', 'pricing.discount.approve'])) {
    return (
      <PageContainer>
        <PageHeader title="Approvals" />
        <NoAccess message="You need a pricing-discount permission to view the approval queue." />
      </PageContainer>
    );
  }
  // The F18-05 governance report reuses the endpoint's own gate — `pricing.discount.approve`
  // (Administrador / Supervisor), narrower than the queue's request-OR-approve gate. A Vendedor
  // sees the queue below but not the tenant-wide approval-rate report.
  const canViewReport = checker.can('pricing.discount.approve');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = pickStatus(sp.status);
  const orderId = sp.orderId || undefined;

  // F18-05 report period default: last 30 days, resolved in the tenant's own timezone
  // (session.timezone — F18-01), matching the /returns and /sales pages' identical precedent so a
  // normal visit never hits the required-from/to 400 the endpoint enforces.
  const now = new Date();
  const reportFrom = sp.reportFrom || tenantStartOfDayUtc(session?.timezone ?? 'UTC', new Date(now.getTime() - THIRTY_DAYS_MS));
  const reportTo = sp.reportTo || now.toISOString();
  const reportGroupBy = pickGroupBy(sp.reportGroupBy);
  const reportStatus = pickReportStatus(sp.reportStatus);
  const reportFilters: ApprovalsReportFilterValues = { from: reportFrom, to: reportTo, groupBy: reportGroupBy, status: reportStatus };

  let summary: ApprovalsSummary | undefined;
  let summaryError: { status: number; message: string; correlationId: string | undefined } | undefined;
  if (canViewReport) {
    try {
      summary = await getApprovalsSummary({
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
  }

  const result = await listPriceApprovals({
    page,
    pageSize: PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
  });

  function buildHref(next: { page?: number; status?: string | null; orderId?: string | null }): string {
    const params = new URLSearchParams();
    const nextStatus = next.status === undefined ? status : next.status || undefined;
    const nextOrderId = next.orderId === undefined ? orderId : next.orderId || undefined;
    if (nextStatus) params.set('status', nextStatus);
    if (nextOrderId) params.set('orderId', nextOrderId);
    // Carries the report section's own params forward too — the two filter sets are independent,
    // matching the /returns page's identical precedent (paginating/filtering the queue should not
    // silently reset the report back to its default period).
    if (sp.reportFrom) params.set('reportFrom', sp.reportFrom);
    if (sp.reportTo) params.set('reportTo', sp.reportTo);
    if (sp.reportGroupBy) params.set('reportGroupBy', sp.reportGroupBy);
    if (sp.reportStatus) params.set('reportStatus', sp.reportStatus);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/approvals${params.toString() ? `?${params}` : ''}`;
  }

  const chip = (active: boolean) =>
    active
      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  const hasFilter = Boolean(status || orderId);

  return (
    <PageContainer>
      <PageHeader
        title="Approvals"
        description="Exceptional-discount requests: below-minimum prices awaiting a decision."
      />

      {canViewReport && (
        <>
          <section aria-labelledby="report-heading" id="report" className="flex flex-col gap-3">
            <h2 id="report-heading" className="text-sm font-semibold text-slate-900">
              Approvals report
            </h2>
            <ApprovalsReportFilters initial={reportFilters} />
            {summary ? (
              <ApprovalsReportSection summary={summary} currency={summary.currency} />
            ) : (
              summaryError && (
                <ApprovalsReportError
                  status={summaryError.status}
                  message={summaryError.message}
                  correlationId={summaryError.correlationId}
                />
              )
            )}
          </section>

          <hr className="border-slate-200" />

          <h2 className="text-sm font-semibold text-slate-900">Approval queue</h2>
        </>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ status: null })} aria-current={!status ? 'true' : undefined} className={chip(!status)}>
            All statuses
          </Link>
          {PRICE_APPROVAL_STATUSES.map((s) => (
            <Link
              key={s}
              href={buildHref({ status: s })}
              aria-current={status === s ? 'true' : undefined}
              className={chip(status === s)}
            >
              {PRICE_APPROVAL_STATUS_LABELS[s]}
            </Link>
          ))}
        </div>

        {orderId && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            Filtered to one order
            <Link href={`/sales/${orderId}`} className="font-medium text-slate-700 underline underline-offset-2">
              {shortId(orderId)}
            </Link>
            <Link href={buildHref({ orderId: null })} className="text-xs font-medium text-slate-500 hover:underline">
              Clear
            </Link>
          </p>
        )}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No requests match these filters' : 'No exceptional-discount requests'}
          description={
            hasFilter
              ? 'Try a different status.'
              : 'A request appears here when a vendor sells a line below its minimum price.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH className="text-right">Requested price</TH>
                <TH className="text-right">Discount</TH>
                <TH>Reason</TH>
                <TH>Requested</TH>
                <TH>Status</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((approval) => (
                <TR key={approval.id}>
                  <TD>
                    <Link
                      href={`/sales/${approval.orderId}`}
                      className="font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      {shortId(approval.orderId)}
                    </Link>
                  </TD>
                  <TD className="text-right text-slate-700">{approval.requestedPrice.toFixed(2)}</TD>
                  <TD className="text-right text-slate-500">{approval.discountAmount.toFixed(2)}</TD>
                  <TD className="max-w-xs truncate text-slate-500" title={approval.reason}>
                    {approval.reason}
                  </TD>
                  <TD className="whitespace-nowrap text-slate-500">
                    {new Date(approval.requestedAt).toLocaleDateString()}
                  </TD>
                  <TD>
                    <Badge tone={priceApprovalStatusTone(approval.status)}>
                      {PRICE_APPROVAL_STATUS_LABELS[approval.status as PriceApprovalStatus] ?? approval.status}
                    </Badge>
                  </TD>
                  <TD>
                    <Link
                      href={`/approvals/${approval.id}`}
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
