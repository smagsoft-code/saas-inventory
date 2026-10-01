import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listReturns } from '../../../lib/sales/returns';
import { getReturnsSummary } from '../../../lib/sales/returns-reports';
import { buildLocationIndex, shortId } from '../../../lib/inventory/location-index';
import { tenantStartOfDayUtc } from '../../../lib/home/tenant-day';
import {
  RETURN_STATUSES,
  RETURN_STATUS_LABELS,
  returnStatusTone,
  type ReturnStatus,
} from '../../../lib/types/sales';
import { RETURNS_SUMMARY_GROUP_BY, type ReturnsSummary, type ReturnsSummaryGroupBy } from '../../../lib/types/returns-reports';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { ReturnsReportFilters, type ReturnsReportFilterValues } from './returns-report-filters';
import { ReturnsReportError, ReturnsReportSection } from './returns-report-section';

export const metadata = { title: 'Devoluciones · SaaS Inventory' };

const PAGE_SIZE = 20;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function pickStatus(value: string | undefined): ReturnStatus | undefined {
  return (RETURN_STATUSES as readonly string[]).includes(value ?? '') ? (value as ReturnStatus) : undefined;
}

function pickGroupBy(value: string | undefined): ReturnsSummaryGroupBy {
  return (RETURNS_SUMMARY_GROUP_BY as readonly string[]).includes(value ?? '') ? (value as ReturnsSummaryGroupBy) : 'day';
}

/**
 * Sales returns list (`S-RET-LIST`) — `GET /api/v1/sales-returns` (`sales.returns.view`), offset
 * paginated. Real filters only: a single `status` (`GAP-MULTI-STATUS`) and `orderId` — no text
 * search, no sort, no date range. The DTO carries FK ids only; the location name comes from one
 * bounded `buildLocationIndex()` fetch, the return + order ids show as short codes
 * (`GAP-NAME-ENRICHMENT` — there is no return number and no `orderNumber` on the DTO). Visibility
 * is tenant-wide for a `sales.returns.view` holder.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    orderId?: string;
    reportFrom?: string;
    reportTo?: string;
    reportGroupBy?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.returns.view')) {
    return (
      <PageContainer>
        <PageHeader title="Devoluciones" />
        <NoAccess message="Necesitas el permiso de devoluciones para ver esta página." />
      </PageContainer>
    );
  }
  const canCreate = checker.can('sales.returns.create');
  const canViewOrders = checker.can('sales.orders.view');

  const sp = await searchParams;

  // F18-04 report period default: last 30 days, resolved in the tenant's own timezone
  // (session.timezone — F18-01), matching the /sales page's identical precedent so a normal visit
  // to /returns never has to hit the required-from/to 400 the endpoint itself enforces.
  const now = new Date();
  const reportFrom = sp.reportFrom || tenantStartOfDayUtc(session?.timezone ?? 'UTC', new Date(now.getTime() - THIRTY_DAYS_MS));
  const reportTo = sp.reportTo || now.toISOString();
  const reportGroupBy = pickGroupBy(sp.reportGroupBy);
  const reportFilters: ReturnsReportFilterValues = { from: reportFrom, to: reportTo, groupBy: reportGroupBy };

  let summary: ReturnsSummary | undefined;
  let summaryError: { status: number; message: string; correlationId: string | undefined } | undefined;
  try {
    summary = await getReturnsSummary({ from: reportFrom, to: reportTo, groupBy: reportGroupBy });
  } catch (error) {
    summaryError = {
      status: isApiError(error) ? error.status : 0,
      message: httpErrorMessage(error),
      correlationId: isApiError(error) ? error.correlationId : undefined,
    };
  }

  const page = Math.max(1, Number(sp.page) || 1);
  const status = pickStatus(sp.status);
  const orderId = sp.orderId || undefined;

  const [result, index] = await Promise.all([
    listReturns({ page, pageSize: PAGE_SIZE, ...(status ? { status } : {}), ...(orderId ? { orderId } : {}) }),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);

  function buildHref(next: { page?: number; status?: string | null; orderId?: string | null }): string {
    const params = new URLSearchParams();
    const nextStatus = next.status === undefined ? status : next.status || undefined;
    const nextOrderId = next.orderId === undefined ? orderId : next.orderId || undefined;
    if (nextStatus) params.set('status', nextStatus);
    if (nextOrderId) params.set('orderId', nextOrderId);
    // Carries the report section's own params forward too — the two filter sets are independent,
    // matching the /sales page's identical precedent (paginating/filtering the list should not
    // silently reset the report back to its default period).
    if (sp.reportFrom) params.set('reportFrom', sp.reportFrom);
    if (sp.reportTo) params.set('reportTo', sp.reportTo);
    if (sp.reportGroupBy) params.set('reportGroupBy', sp.reportGroupBy);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/returns${params.toString() ? `?${params}` : ''}`;
  }

  const chip = (active: boolean) =>
    active
      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  const hasFilter = Boolean(status || orderId);

  return (
    <PageContainer>
      <PageHeader
        title="Devoluciones"
        description="Reversos de ventas confirmadas — solicita, inspecciona y resuelve la disposición de la mercancía devuelta."
        actions={canCreate ? <ButtonLink href="/returns/new">Nueva devolución</ButtonLink> : undefined}
      />

      <section aria-labelledby="report-heading" id="report" className="flex flex-col gap-3">
        <h2 id="report-heading" className="text-sm font-semibold text-slate-900">
          Reporte de devoluciones
        </h2>
        <ReturnsReportFilters initial={reportFilters} />
        {summary ? (
          <ReturnsReportSection summary={summary} currency={summary.currency} />
        ) : (
          summaryError && (
            <ReturnsReportError status={summaryError.status} message={summaryError.message} correlationId={summaryError.correlationId} />
          )
        )}
      </section>

      <hr className="border-slate-200" />

      <h2 className="text-sm font-semibold text-slate-900">Historial de devoluciones</h2>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ status: null })} aria-current={!status ? 'true' : undefined} className={chip(!status)}>
            Todos los estados
          </Link>
          {RETURN_STATUSES.map((s) => (
            <Link
              key={s}
              href={buildHref({ status: s })}
              aria-current={status === s ? 'true' : undefined}
              className={chip(status === s)}
            >
              {RETURN_STATUS_LABELS[s]}
            </Link>
          ))}
        </div>

        {orderId && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            Filtrado a un pedido
            {canViewOrders ? (
              <Link href={`/sales/${orderId}`} className="font-medium text-slate-700 underline underline-offset-2">
                {shortId(orderId)}
              </Link>
            ) : (
              <code className="text-xs">{shortId(orderId)}</code>
            )}
            <Link href={buildHref({ orderId: null })} className="text-xs font-medium text-slate-500 hover:underline">
              Quitar
            </Link>
          </p>
        )}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'Ninguna devolución coincide con estos filtros' : 'Aún no hay devoluciones'}
          description={
            hasFilter ? 'Prueba con otro estado.' : 'Una devolución se presenta contra un pedido confirmado cuando regresa mercancía.'
          }
          {...(canCreate && !hasFilter ? { action: <ButtonLink href="/returns/new">Nueva devolución</ButtonLink> } : {})}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Devolución</TH>
                <TH>Pedido</TH>
                <TH>Recibido en</TH>
                <TH className="text-right">Líneas</TH>
                <TH>Estado</TH>
                <TH>Creado</TH>
                <TH className="w-0">
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((ret) => (
                <TR key={ret.id}>
                  <TD>
                    <code className="text-xs text-slate-500">{shortId(ret.id)}</code>
                  </TD>
                  <TD>
                    {canViewOrders ? (
                      <Link
                        href={`/sales/${ret.orderId}`}
                        className="font-medium text-slate-700 underline-offset-2 hover:underline"
                      >
                        {shortId(ret.orderId)}
                      </Link>
                    ) : (
                      <code className="text-xs text-slate-500">{shortId(ret.orderId)}</code>
                    )}
                  </TD>
                  <TD className="text-slate-500">{index.locationName(ret.locationId)}</TD>
                  <TD className="text-right text-slate-500">{ret.items.length}</TD>
                  <TD>
                    <Badge tone={returnStatusTone(ret.status)}>
                      {RETURN_STATUS_LABELS[ret.status as ReturnStatus] ?? ret.status}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-slate-500">{new Date(ret.createdAt).toLocaleDateString()}</TD>
                  <TD>
                    <Link
                      href={`/returns/${ret.id}`}
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      Ver
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
