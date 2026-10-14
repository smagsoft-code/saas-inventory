import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listOrders } from '../../../lib/sales/orders';
import { getCustomer } from '../../../lib/sales/customers';
import { getSalesSummary } from '../../../lib/sales/reports';
import { resolveHistoryDates, tenantToday } from '../../../lib/sales/history-dates';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  NOTIFICATION_OVERALL_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  notificationOverallTone,
  orderStatusTone,
  type DocumentType,
  type OrderStatus,
} from '../../../lib/types/sales';
import type { SalesSummary } from '../../../lib/types/reports';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { resolveLocationFilter } from '../../../lib/sales/history-scope';
import { HistoryDateFilters, HistoryFilters, type HistoryFilterValues } from '../../../components/history-filters';
import { SalesReportError, SalesSummaryCards } from './sales-report-section';

export const metadata = { title: 'Historial de ventas · SaaS Inventory' };

const PAGE_SIZE = 20;

/** Which orders the four cards count, in the plural-adjective form the card caption uses. */
const STATUS_CAPTION: Record<OrderStatus, string> = {
  draft: 'en borrador',
  pending: 'pendientes',
  confirmed: 'confirmados',
  fulfilled: 'completados',
  cancelled: 'cancelados',
};

function pick<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : undefined;
}

/**
 * Sales history (`S-SALES-HISTORY`). ONE filter bar (Desde, Hasta, Estado, Tipo de documento,
 * Cliente) drives both the four summary cards (`GET /reports/sales-summary`) and the orders table
 * (`GET /orders`) — the same values, sent to both. Dates are tenant-timezone calendar days
 * (`dateFrom`/`dateTo`, default today); the backend resolves the half-open range, so the whole final
 * day is included. The cards count `confirmed` orders unless an Estado is chosen; the table shows
 * every status unless an Estado is chosen. Order visibility is tenant-wide for a `sales.orders.view`
 * holder (`GAP-ORDERS-LOCATION`).
 */
export default async function SalesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    documentType?: string;
    customerId?: string;
    locationId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.orders.view')) {
    return (
      <PageContainer>
        <PageHeader title="Historial de ventas" />
        <NoAccess message="Necesitas el permiso de pedidos para ver esta página." />
      </PageContainer>
    );
  }
  const canSearchCustomers = checker.can('sales.customers.view');

  const sp = await searchParams;
  const timezone = session?.timezone ?? 'UTC';
  const today = tenantToday(timezone);
  const { dateFrom, dateTo } = resolveHistoryDates(sp, timezone);
  const page = Math.max(1, Number(sp.page) || 1);
  const status = pick(ORDER_STATUSES, sp.status);
  const documentType = pick(DOCUMENT_TYPES, sp.documentType);
  const customerId = sp.customerId || undefined;

  // Almacén: only the locations in the caller's own scope (ADR-0024); see `resolveLocationFilter`.
  const location = await resolveLocationFilter(checker.can('warehouses.view'), sp.locationId);
  const { index } = location;
  const locationId = location.selectedId;

  const filters: HistoryFilterValues = { dateFrom, dateTo, status, documentType, customerId, locationId };
  // The exact same filter set feeds the cards and the table.
  const common = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    ...(status ? { status } : {}),
    ...(documentType ? { documentType } : {}),
    ...(customerId ? { customerId } : {}),
    ...(locationId ? { locationId } : {}),
  };

  type SummaryOutcome =
    | { summary: SalesSummary }
    | { error: { status: number; message: string; correlationId: string | undefined } };
  const summaryPromise: Promise<SummaryOutcome> = getSalesSummary({ ...common, groupBy: 'day' })
    .then((summary): SummaryOutcome => ({ summary }))
    .catch(
      (error: unknown): SummaryOutcome => ({
        error: {
          status: isApiError(error) ? error.status : 0,
          message: httpErrorMessage(error),
          correlationId: isApiError(error) ? error.correlationId : undefined,
        },
      }),
    );

  const [result, customerName, outcome] = await Promise.all([
    listOrders({ page, pageSize: PAGE_SIZE, ...common }),
    customerId && canSearchCustomers
      ? getCustomer(customerId)
          .then((c) => c.displayName)
          .catch(() => undefined)
      : Promise.resolve(undefined),
    summaryPromise,
  ]);

  const hasNarrowing = Boolean(status || documentType || customerId || dateTo || dateFrom !== today || locationId !== location.defaultId);
  const dateTimeFormat = (() => {
    try {
      return new Intl.DateTimeFormat('es', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return new Intl.DateTimeFormat('es', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' });
    }
  })();

  function buildHref(nextPage: number): string {
    const params = new URLSearchParams();
    params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (locationId) params.set('locationId', locationId);
    if (status) params.set('status', status);
    if (documentType) params.set('documentType', documentType);
    if (customerId) params.set('customerId', customerId);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/sales?${params}`;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Historial de ventas"
        description="Todos los pedidos de venta de la empresa."
        actions={<HistoryDateFilters basePath="/sales" initial={filters} today={today} />}
      />

      <HistoryFilters
        basePath="/sales"
        initial={filters}
        today={today}
        defaultLocationId={location.defaultId}
        locations={location.options}
        allowAllLocations={location.allowAll}
        statusOptions={ORDER_STATUSES.map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }))}
        documentTypeOptions={DOCUMENT_TYPES.map((value) => ({ value, label: DOCUMENT_TYPE_LABELS[value] }))}
        customerName={customerName}
        canSearchCustomers={canSearchCustomers}
      />

      <section aria-label="Resumen de ventas" id="resumen">
        {'summary' in outcome ? (
          <SalesSummaryCards summary={outcome.summary} statusLabel={STATUS_CAPTION[status ?? 'confirmed']} />
        ) : (
          <SalesReportError status={outcome.error.status} message={outcome.error.message} correlationId={outcome.error.correlationId} />
        )}
      </section>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasNarrowing ? 'Ningún pedido coincide con estos filtros' : 'Aún no hay pedidos hoy'}
          description={
            hasNarrowing
              ? 'Prueba con otro estado, cliente o rango de fechas.'
              : 'Los pedidos de hoy aparecen aquí una vez creados. Cambia el rango de fechas para ver días anteriores.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Pedido</TH>
                <TH>Creado</TH>
                <TH>Cliente</TH>
                <TH>Vendedor</TH>
                <TH>Documento</TH>
                <TH>Almacén</TH>
                <TH>Estado</TH>
                <TH>Notificación</TH>
                <TH className="whitespace-nowrap text-right">Total</TH>
                <TH className="w-0">
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((order) => (
                <TR key={order.id}>
                  <TD className="font-medium">{order.orderNumber}</TD>
                  <TD className="whitespace-nowrap text-slate-500">{dateTimeFormat.format(new Date(order.createdAt))}</TD>
                  <TD className="text-slate-700">
                    {order.customerId && canSearchCustomers ? (
                      <Link href={`/customers/${order.customerId}`} className="underline-offset-2 hover:underline">
                        {order.customer.name}
                      </Link>
                    ) : (
                      order.customer.name
                    )}
                  </TD>
                  <TD className="text-slate-700">{order.placedByName ?? '—'}</TD>
                  <TD className="text-slate-500">
                    {DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType}
                  </TD>
                  <TD className="text-slate-500">{index.locationName(order.locationId)}</TD>
                  <TD>
                    <Badge tone={orderStatusTone(order.status)}>
                      {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                    </Badge>
                  </TD>
                  <TD>
                    {order.notificationStatus && order.notificationStatus !== 'none' ? (
                      <Badge tone={notificationOverallTone(order.notificationStatus)}>
                        {NOTIFICATION_OVERALL_LABELS[order.notificationStatus]}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">{NOTIFICATION_OVERALL_LABELS.none}</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-right text-slate-900">
                    {order.total.toFixed(2)} {order.currency}
                  </TD>
                  <TD>
                    <Link
                      href={`/sales/${order.id}`}
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
            buildHref={buildHref}
          />
        </>
      )}
    </PageContainer>
  );
}
