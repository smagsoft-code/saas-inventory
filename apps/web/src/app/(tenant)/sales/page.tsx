import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listOrders } from '../../../lib/sales/orders';
import { getCustomer } from '../../../lib/sales/customers';
import { getSalesSummary } from '../../../lib/sales/reports';
import { buildLocationIndex } from '../../../lib/inventory/location-index';
import { tenantStartOfDayUtc } from '../../../lib/home/tenant-day';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  orderStatusTone,
  type DocumentType,
  type OrderStatus,
} from '../../../lib/types/sales';
import { SALES_SUMMARY_GROUP_BY, type SalesSummary, type SalesSummaryGroupBy } from '../../../lib/types/reports';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { SalesFilters, type SalesFilterValues } from './sales-filters';
import { SalesReportFilters, type SalesReportFilterValues } from './sales-report-filters';
import { SalesReportError, SalesReportSection } from './sales-report-section';

export const metadata = { title: 'Sales history · SaaS Inventory' };

const PAGE_SIZE = 20;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function pickGroupBy(value: string | undefined): SalesSummaryGroupBy {
  return (SALES_SUMMARY_GROUP_BY as readonly string[]).includes(value ?? '') ? (value as SalesSummaryGroupBy) : 'day';
}

function pick<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : undefined;
}

/**
 * Sales history (`S-SALES-HISTORY`) — `GET /api/v1/orders` (`sales.orders.view`), offset paginated.
 * Real filters only: `status`, `documentType`, `customerId`, `createdFrom`/`createdTo` — no text
 * search, no sort (`GAP-SEARCH` / `GAP-SORT`). Order visibility is **tenant-wide** for a
 * `sales.orders.view` holder — the endpoint does not location-scope it (`GAP-ORDERS-LOCATION`), so
 * the UI shows every tenant order and does not simulate a per-location view.
 */
export default async function SalesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    documentType?: string;
    customerId?: string;
    createdFrom?: string;
    createdTo?: string;
    reportFrom?: string;
    reportTo?: string;
    reportGroupBy?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.orders.view')) {
    return (
      <PageContainer>
        <PageHeader title="Sales history" />
        <NoAccess message="You need the orders permission to view this page." />
      </PageContainer>
    );
  }
  const canSearchCustomers = checker.can('sales.customers.view');

  const sp = await searchParams;

  // F18-02 report period default: last 30 days, resolved in the tenant's own timezone
  // (session.timezone — F18-01, GAP-TZ-VISIBILITY resolved) so a normal visit to /sales never has
  // to hit the required-from/to 400 the endpoint itself enforces.
  const now = new Date();
  const reportFrom = sp.reportFrom || tenantStartOfDayUtc(session?.timezone ?? 'UTC', new Date(now.getTime() - THIRTY_DAYS_MS));
  const reportTo = sp.reportTo || now.toISOString();
  const reportGroupBy = pickGroupBy(sp.reportGroupBy);
  const reportFilters: SalesReportFilterValues = { from: reportFrom, to: reportTo, groupBy: reportGroupBy };

  let summary: SalesSummary | undefined;
  let summaryError: { status: number; message: string; correlationId: string | undefined } | undefined;
  try {
    summary = await getSalesSummary({ from: reportFrom, to: reportTo, groupBy: reportGroupBy });
  } catch (error) {
    summaryError = {
      status: isApiError(error) ? error.status : 0,
      message: httpErrorMessage(error),
      correlationId: isApiError(error) ? error.correlationId : undefined,
    };
  }
  const page = Math.max(1, Number(sp.page) || 1);
  const status = pick(ORDER_STATUSES, sp.status);
  const documentType = pick(DOCUMENT_TYPES, sp.documentType);
  const customerId = sp.customerId || undefined;
  const createdFrom = sp.createdFrom || undefined;
  const createdTo = sp.createdTo || undefined;

  const filters: SalesFilterValues = { status, documentType, customerId, createdFrom, createdTo };

  const [result, index, customerName] = await Promise.all([
    listOrders({
      page,
      pageSize: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(documentType ? { documentType } : {}),
      ...(customerId ? { customerId } : {}),
      ...(createdFrom ? { createdFrom } : {}),
      ...(createdTo ? { createdTo } : {}),
    }),
    buildLocationIndex(checker.can('warehouses.view')),
    customerId && canSearchCustomers
      ? getCustomer(customerId)
          .then((c) => c.displayName)
          .catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const hasFilter = Boolean(status || documentType || customerId || createdFrom || createdTo);

  function buildHref(nextPage: number): string {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (documentType) params.set('documentType', documentType);
    if (customerId) params.set('customerId', customerId);
    if (createdFrom) params.set('createdFrom', createdFrom);
    if (createdTo) params.set('createdTo', createdTo);
    // Carries the report section's own params forward too — the two filter sets are independent,
    // but paginating the order-history table should not silently reset the report back to its
    // default period.
    if (sp.reportFrom) params.set('reportFrom', sp.reportFrom);
    if (sp.reportTo) params.set('reportTo', sp.reportTo);
    if (sp.reportGroupBy) params.set('reportGroupBy', sp.reportGroupBy);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/sales${params.toString() ? `?${params}` : ''}`;
  }

  return (
    <PageContainer>
      <PageHeader title="Sales history" description="Every sales order in the company." />

      <section aria-labelledby="report-heading" id="report" className="flex flex-col gap-3">
        <h2 id="report-heading" className="text-sm font-semibold text-slate-900">
          Sales report
        </h2>
        <SalesReportFilters initial={reportFilters} />
        {summary ? (
          <SalesReportSection summary={summary} currency={summary.currency} />
        ) : (
          summaryError && (
            <SalesReportError status={summaryError.status} message={summaryError.message} correlationId={summaryError.correlationId} />
          )
        )}
      </section>

      <hr className="border-slate-200" />

      <h2 className="text-sm font-semibold text-slate-900">Order history</h2>

      <SalesFilters initial={filters} customerName={customerName} canSearchCustomers={canSearchCustomers} />

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No orders match these filters' : 'No orders yet'}
          description={
            hasFilter ? 'Try a different status, customer or date range.' : 'Orders appear here once a sale is completed.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Created</TH>
                <TH>Customer</TH>
                <TH>Document</TH>
                <TH>Location</TH>
                <TH>Status</TH>
                <TH className="text-right">Total</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((order) => (
                <TR key={order.id}>
                  <TD className="font-medium">{order.orderNumber}</TD>
                  <TD className="whitespace-nowrap text-slate-500">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </TD>
                  <TD className="text-slate-700">
                    {order.customerId && canSearchCustomers ? (
                      <Link
                        href={`/customers/${order.customerId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {order.customer.name}
                      </Link>
                    ) : (
                      order.customer.name
                    )}
                  </TD>
                  <TD className="text-slate-500">
                    {DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType}
                  </TD>
                  <TD className="text-slate-500">{index.locationName(order.locationId)}</TD>
                  <TD>
                    <Badge tone={orderStatusTone(order.status)}>
                      {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                    </Badge>
                  </TD>
                  <TD className="text-right text-slate-900">
                    {order.total.toFixed(2)} {order.currency}
                  </TD>
                  <TD>
                    <Link
                      href={`/sales/${order.id}`}
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
            buildHref={buildHref}
          />
        </>
      )}
    </PageContainer>
  );
}
