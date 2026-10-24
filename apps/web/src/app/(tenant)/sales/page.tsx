import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { buildOrdersExportHref, listOrders } from '../../../lib/sales/orders';
import { fetchAllPages } from '../../../lib/fetch-all';
import { ListViewControls } from '../../../components/list-view-controls';
import { getSalesSummary } from '../../../lib/sales/reports';
import { resolveHistoryDates, tenantToday } from '../../../lib/sales/history-dates';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  NOTIFICATION_OVERALL_LABELS,
  NOTIFICATION_OVERALL_STATUSES,
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
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TR } from '../../../components/ui/table';
import { resolveLocationFilter } from '../../../lib/sales/history-scope';
import { HistoryDateFilters, type HistoryFilterValues } from '../../../components/history-filters';
import { SalesTableHead, type SalesSortColumn } from './sales-table-head';
import { SalesMobileList, type MobileOrder } from './sales-mobile-list';
import { SalesReportError, SalesSummaryCards } from './sales-report-section';

export const metadata = { title: 'Historial de ventas · SaaS Inventory' };

const PAGE_SIZE = 20;

/** Estado options of the history: borrador and completado are not offered here. */
const HISTORY_STATUSES = ['pending', 'confirmed', 'cancelled'] as const satisfies readonly OrderStatus[];

const SORT_COLUMNS = ['orderNumber', 'createdAt', 'customer', 'seller', 'documentType', 'location', 'status', 'total', 'notification'] as const satisfies readonly SalesSortColumn[];

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
 * Sales history (`S-SALES-HISTORY`). Only Desde/Hasta live above the table; every other filter is a
 * cell of the table's own header, right under the column title (free-text search for Pedido /
 * Cliente / Vendedor / Total, a drop-down for Documento / Almacén / Estado / Notificación), and each
 * title carries a ↑/↓ sort toggle. The same values drive the four summary cards
 * (`GET /reports/sales-summary`) and the orders table (`GET /orders`). Dates are tenant-timezone
 * calendar days (`dateFrom`/`dateTo`, default today); the backend resolves the half-open range, so the
 * whole final day is included. The cards count `confirmed` orders unless an Estado is chosen; the table
 * shows every status unless an Estado is chosen. Without `sales.orders.view_all` a seller only ever
 * gets their own orders (the backend enforces it).
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
    q?: string;
    orderNumber?: string;
    customerName?: string;
    sellerName?: string;
    total?: string;
    notificationStatus?: string;
    sort?: string;
    dir?: string;
    dateFrom?: string;
    dateTo?: string;
    all?: string;
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
  // Estado defaults to Confirmado. "Todos" is the explicit `status=all` (a bare absence of the
  // param can only mean "never touched" = the default), so choosing Todos survives every navigation.
  const statusParam: OrderStatus | 'all' = sp.status === 'all' ? 'all' : (pick(HISTORY_STATUSES, sp.status) ?? 'confirmed');
  const status: OrderStatus | undefined = statusParam === 'all' ? undefined : statusParam;
  const documentType = pick(DOCUMENT_TYPES, sp.documentType);
  const notificationStatus = pick(NOTIFICATION_OVERALL_STATUSES, sp.notificationStatus);
  const customerId = sp.customerId || undefined;
  const q = sp.q?.trim() || undefined;
  const orderNumber = sp.orderNumber?.trim() || undefined;
  const customerName = sp.customerName?.trim() || undefined;
  const sellerName = sp.sellerName?.trim() || undefined;
  const total = sp.total?.trim() || undefined;
  const sort = pick(SORT_COLUMNS, sp.sort);
  const dir: 'asc' | 'desc' | undefined = sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : undefined;
  // "Ver todos": every matching order on screen instead of one page.
  const showAll = sp.all === '1';
  // Default order: newest first.
  const activeSort: SalesSortColumn = sort ?? 'createdAt';
  const activeDir: 'asc' | 'desc' = dir ?? 'desc';

  // Almacén drop-down: the locations in the caller's own scope (ADR-0024), labelled
  // "Sucursal · Almacén"; "Todos" (no locationId) is always offered — the backend narrows a restricted
  // caller to their own locations by itself.
  const location = await resolveLocationFilter(checker.can('warehouses.view'), sp.locationId);
  const { index } = location;
  const locationId = location.options.some((o) => o.id === sp.locationId) ? sp.locationId : undefined;
  const locationOptions = location.options.map((o) => {
    const warehouse = index.warehouseName(o.id);
    return { value: o.id, label: warehouse !== '—' ? `${warehouse} · ${o.name}` : o.name };
  });
  const locationLabel = (id: string): string => {
    const warehouse = index.warehouseName(id);
    return warehouse !== '—' ? `${warehouse} · ${index.locationName(id)}` : index.locationName(id);
  };

  const filters: HistoryFilterValues = { dateFrom, dateTo, status: statusParam, documentType, customerId, locationId };
  // The exact same filter set feeds the cards and the table.
  const columnFilters = {
    ...(q ? { q } : {}),
    ...(orderNumber ? { orderNumber } : {}),
    ...(customerName ? { customerName } : {}),
    ...(sellerName ? { sellerName } : {}),
    ...(total ? { total } : {}),
    ...(notificationStatus ? { notificationStatus } : {}),
  };
  const common = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    ...(status ? { status } : {}),
    ...(documentType ? { documentType } : {}),
    ...(customerId ? { customerId } : {}),
    ...(locationId ? { locationId } : {}),
    ...columnFilters,
  };
  // Every param (besides the page) that a header control must keep when it changes one of them.
  const carriedBase: Record<string, string> = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    status: statusParam,
    ...(documentType ? { documentType } : {}),
    ...(customerId ? { customerId } : {}),
    ...(locationId ? { locationId } : {}),
    ...columnFilters,
    ...(sort ? { sort } : {}),
    ...(dir ? { dir } : {}),
  };
  // The "Ver todos" view survives a filter/sort change (header controls copy every carried param).
  const carried: Record<string, string> = { ...carriedBase, ...(showAll ? { all: '1' } : {}) };

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

  const orderQuery = { ...common, ...(sort ? { sort } : {}), ...(dir ? { dir } : {}) };
  const [result, outcome] = await Promise.all([
    showAll
      ? fetchAllPages((p, size) => listOrders({ ...orderQuery, page: p, pageSize: size })).then((all) => ({
          data: all.data,
          meta: { page: 1, pageSize: Math.max(all.data.length, PAGE_SIZE), total: all.total, totalPages: 1 },
          truncated: all.truncated,
        }))
      : listOrders({ ...orderQuery, page, pageSize: PAGE_SIZE }).then((paged) => ({ ...paged, truncated: false })),
    summaryPromise,
  ]);

  // Confirmado is the default view, not a filter the user chose.
  const hasColumnFilters = Boolean((status && status !== 'confirmed') || documentType || customerId || locationId || Object.keys(columnFilters).length > 0);
  const hasNarrowing = Boolean(hasColumnFilters || dateTo || dateFrom !== today);
  const dateTimeFormat = (() => {
    try {
      return new Intl.DateTimeFormat('es', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return new Intl.DateTimeFormat('es', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' });
    }
  })();

  const mobileOrders: MobileOrder[] = result.data.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    createdAtLabel: dateTimeFormat.format(new Date(order.createdAt)),
    customerName: order.customer.name,
    sellerName: order.placedByName ?? '—',
    documentLabel: DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType,
    locationLabel: locationLabel(order.locationId),
    statusLabel: ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status,
    statusTone: orderStatusTone(order.status),
    notificationLabel:
      order.notificationStatus && order.notificationStatus !== 'none' ? NOTIFICATION_OVERALL_LABELS[order.notificationStatus] : null,
    notificationTone: notificationOverallTone(order.notificationStatus ?? 'none'),
    totalLabel: `${order.total.toFixed(2)} ${order.currency}`,
  }));
  const documentTypeOptions = DOCUMENT_TYPES.map((value) => ({ value, label: DOCUMENT_TYPE_LABELS[value] }));
  const statusOptions = HISTORY_STATUSES.map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));
  const notificationOptions = NOTIFICATION_OVERALL_STATUSES.map((value) => ({ value, label: NOTIFICATION_OVERALL_LABELS[value] }));

  function buildHref(nextPage: number): string {
    const params = new URLSearchParams(carried);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/sales?${params}`;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Historial de ventas"
        help="Todos los pedidos de venta de la empresa. Usa las casillas bajo cada título para filtrar y las flechas para ordenar."
        actions={
          <HistoryDateFilters
            basePath="/sales"
            initial={filters}
            today={today}
            preserve={{
              ...columnFilters,
              ...(sort ? { sort } : {}),
              ...(dir ? { dir } : {}),
              ...(showAll ? { all: '1' } : {}),
            }}
          />
        }
      />

      <section aria-label="Resumen de ventas" id="resumen">
        {'summary' in outcome ? (
          <SalesSummaryCards summary={outcome.summary} statusLabel={STATUS_CAPTION[status ?? 'confirmed']} />
        ) : (
          <SalesReportError status={outcome.error.status} message={outcome.error.message} correlationId={outcome.error.correlationId} />
        )}
      </section>

      <ListViewControls
        showingAll={showAll}
        allHref={`/sales?${new URLSearchParams({ ...carriedBase, all: '1' })}`}
        pagedHref={`/sales?${new URLSearchParams(carriedBase)}`}
        shown={result.data.length}
        total={result.meta.total}
        truncated={result.truncated}
        canToggle={result.meta.total > PAGE_SIZE}
        excelHref={buildOrdersExportHref(orderQuery, 'xlsx')}
        pdfHref={buildOrdersExportHref(orderQuery, 'pdf')}
      />

      <div className="hidden md:block">
      <Table className="table-fixed text-xs">
        <SalesTableHead
          params={carried}
          sort={activeSort}
          dir={activeDir}
          documentTypeOptions={documentTypeOptions}
          locationOptions={locationOptions}
          statusOptions={statusOptions}
          notificationOptions={notificationOptions}
        />
        <TBody>
          {result.data.length === 0 && (
            <TR>
              <TD colSpan={10} className="py-10 text-center text-sm text-slate-500">
                {hasNarrowing
                  ? 'Ningún pedido coincide con estos filtros. Prueba con otros valores o un rango de fechas más amplio.'
                  : 'Aún no hay pedidos hoy. Los pedidos de hoy aparecen aquí una vez creados; cambia el rango de fechas para ver días anteriores.'}
              </TD>
            </TR>
          )}
              {result.data.map((order) => (
                <TR key={order.id}>
                  <TD className="break-words !px-2 font-medium">{order.orderNumber}</TD>
                  <TD className="!px-2 text-slate-500">{dateTimeFormat.format(new Date(order.createdAt))}</TD>
                  <TD className="break-words !px-2 text-slate-700">
                    {order.customerId && canSearchCustomers ? (
                      <Link href={`/customers/${order.customerId}`} className="underline-offset-2 hover:underline">
                        {order.customer.name}
                      </Link>
                    ) : (
                      order.customer.name
                    )}
                  </TD>
                  <TD className="break-words !px-2 text-slate-700">{order.placedByName ?? '—'}</TD>
                  <TD className="break-words !px-2 text-slate-500">
                    {DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType}
                  </TD>
                  <TD className="break-words !px-2 text-slate-500">{locationLabel(order.locationId)}</TD>
                  <TD className="!px-2">
                    <Badge tone={orderStatusTone(order.status)}>
                      {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                    </Badge>
                  </TD>
                  <TD className="!px-2">
                    {order.notificationStatus && order.notificationStatus !== 'none' ? (
                      <Badge tone={notificationOverallTone(order.notificationStatus)}>
                        {NOTIFICATION_OVERALL_LABELS[order.notificationStatus]}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">{NOTIFICATION_OVERALL_LABELS.none}</span>
                    )}
                  </TD>
                  <TD className="!px-2 text-right text-slate-900">
                    {order.total.toFixed(2)} {order.currency}
                  </TD>
                  <TD className="!px-2">
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
      </div>

      <div className="md:hidden">
        <SalesMobileList
          orders={mobileOrders}
          count={result.meta.total}
          params={carried}
          sort={activeSort}
          dir={activeDir}
          documentTypeOptions={documentTypeOptions}
          locationOptions={locationOptions}
          statusOptions={statusOptions}
          notificationOptions={notificationOptions}
        />
      </div>
      {result.data.length > 0 && (
        <Pagination
          page={result.meta.page}
          pageSize={result.meta.pageSize}
          total={result.meta.total}
          totalPages={result.meta.totalPages}
          buildHref={buildHref}
        />
      )}
    </PageContainer>
  );
}
