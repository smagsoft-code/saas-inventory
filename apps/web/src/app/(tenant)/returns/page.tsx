import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listReturns } from '../../../lib/sales/returns';
import { getReturnsSummary } from '../../../lib/sales/returns-reports';
import { resolveHistoryDates, tenantToday } from '../../../lib/sales/history-dates';
import { resolveLocationFilter } from '../../../lib/sales/history-scope';
import { shortId } from '../../../lib/inventory/location-index';
import {
  RETURN_STATUSES,
  RETURN_STATUS_LABELS,
  returnStatusTone,
  type ReturnStatus,
} from '../../../lib/types/sales';
import type { ReturnsSummary } from '../../../lib/types/returns-reports';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import {
  HistoryDateFilters,
  HistoryFilters,
  type HistoryFilterValues,
} from '../../../components/history-filters';
import { ReturnsMobileList, type MobileReturn } from './returns-mobile-list';
import { ReturnsReportError, ReturnsSummaryCards } from './returns-report-section';

export const metadata = { title: 'Devoluciones · SaaS Inventory' };

const PAGE_SIZE = 20;
const MAX_PRODUCTS_SHOWN = 2;

/** Which return status the four cards count, in the plural-adjective form the card caption uses. */
const STATUS_CAPTION: Record<ReturnStatus, string> = {
  requested: 'solicitadas',
  inspecting: 'en inspección',
  resolved: 'resueltas',
  cancelled: 'canceladas',
};

function pickStatus(value: string | undefined): ReturnStatus | undefined {
  return (RETURN_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ReturnStatus)
    : undefined;
}

/**
 * Sales returns list (`S-RET-LIST`) — `GET /api/v1/sales-returns` (`sales.returns.view`), offset
 * paginated. ONE filter bar (Desde, Hasta, Almacén = "Recibido en", Estado) drives both the four
 * cards (`GET /reports/returns-summary`) and the table — the same values are sent to both. Dates are
 * tenant-timezone calendar days on `created_at` (default today). The cards count `resolved` returns
 * unless an Estado is chosen; the table shows every status unless an Estado is chosen. The API
 * resolves the return number (DEV-001), order number, product names and user names. Visibility is
 * tenant-wide for a `sales.returns.view` holder (Almacén limits what the screen offers, not what the
 * backend allows).
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    orderId?: string;
    locationId?: string;
    dateFrom?: string;
    dateTo?: string;
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
  const timezone = session?.timezone ?? 'UTC';
  const today = tenantToday(timezone);
  const { dateFrom, dateTo } = resolveHistoryDates(sp, timezone);
  const page = Math.max(1, Number(sp.page) || 1);
  const status = pickStatus(sp.status);
  const orderId = sp.orderId || undefined;
  const location = await resolveLocationFilter(checker.can('warehouses.view'), sp.locationId);
  const locationId = location.selectedId;

  const filters: HistoryFilterValues = { dateFrom, dateTo, status, locationId };
  // The exact same filter set feeds the cards and the table.
  const common = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    ...(status ? { status } : {}),
    ...(locationId ? { locationId } : {}),
  };

  type SummaryOutcome =
    | { summary: ReturnsSummary }
    | { error: { status: number; message: string; correlationId: string | undefined } };
  const summaryPromise: Promise<SummaryOutcome> = getReturnsSummary({ ...common, groupBy: 'day' })
    .then((summary): SummaryOutcome => ({ summary }))
    .catch((error: unknown): SummaryOutcome => ({
      error: {
        status: isApiError(error) ? error.status : 0,
        message: httpErrorMessage(error),
        correlationId: isApiError(error) ? error.correlationId : undefined,
      },
    }));

  const [result, outcome] = await Promise.all([
    listReturns({ page, pageSize: PAGE_SIZE, ...common, ...(orderId ? { orderId } : {}) }),
    summaryPromise,
  ]);

  const hasNarrowing = Boolean(
    status || orderId || dateTo || dateFrom !== today || locationId !== location.defaultId,
  );
  const dateFormat = (() => {
    try {
      return new Intl.DateTimeFormat('es', {
        timeZone: timezone,
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return new Intl.DateTimeFormat('es', {
        timeZone: 'UTC',
        dateStyle: 'short',
        timeStyle: 'short',
      });
    }
  })();

  const locationLabelOf = (id: string): string => {
    const warehouse = location.index.warehouseName(id);
    const name = location.index.locationName(id);
    return warehouse !== '—' ? `${warehouse} · ${name}` : name;
  };
  const mobileReturns: MobileReturn[] = result.data.map((ret) => ({
    id: ret.id,
    returnNumber: ret.returnNumber,
    createdAtLabel: dateFormat.format(new Date(ret.createdAt)),
    orderId: ret.orderId,
    orderLabel: ret.orderNumber ?? shortId(ret.orderId),
    locationLabel: locationLabelOf(ret.locationId),
    userName: ret.receivedByName ?? ret.requestedByName ?? null,
    requested: !ret.receivedByName,
    products: ret.items.map((item) => ({
      id: item.id,
      label: item.productName ?? shortId(item.productVariantId),
      quantity: item.quantityReturned,
    })),
    reason: ret.reason,
    statusLabel: RETURN_STATUS_LABELS[ret.status as ReturnStatus] ?? ret.status,
    statusTone: returnStatusTone(ret.status),
  }));
  // Every param (besides the page) a phone control must keep when it changes one of them.
  const carried: Record<string, string> = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    ...(locationId ? { locationId } : {}),
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
  };
  const emptyText = hasNarrowing
    ? 'Ninguna devolución coincide con estos filtros. Prueba con otro estado, almacén o rango de fechas.'
    : 'Aún no hay devoluciones hoy. Cambia el rango de fechas para ver días anteriores.';

  function buildHref(nextPage: number): string {
    const params = new URLSearchParams();
    params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (locationId) params.set('locationId', locationId);
    if (status) params.set('status', status);
    if (orderId) params.set('orderId', orderId);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/returns?${params}`;
  }

  const preserve = orderId ? { orderId } : undefined;
  const withoutOrderHref = (() => {
    const params = new URLSearchParams();
    params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (locationId) params.set('locationId', locationId);
    if (status) params.set('status', status);
    return `/returns?${params}`;
  })();

  return (
    <PageContainer>
      <PageHeader
        title="Devoluciones"
        help="Reversos de ventas confirmadas — solicita, inspecciona y resuelve la disposición de la mercancía devuelta."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <div className="md:hidden">
              <HistoryDateFilters
                basePath="/returns"
                initial={filters}
                today={today}
                preserve={{
                  ...(status ? { status } : {}),
                  ...(locationId ? { locationId } : {}),
                  ...(orderId ? { orderId } : {}),
                }}
              />
            </div>
            {canCreate && <ButtonLink href="/returns/new">Nueva devolución</ButtonLink>}
          </div>
        }
      />

      <div className="hidden md:block">
        <HistoryFilters
          basePath="/returns"
          initial={filters}
          today={today}
          defaultLocationId={location.defaultId}
          locations={location.options}
          allowAllLocations={location.allowAll}
          statusOptions={RETURN_STATUSES.map((value) => ({
            value,
            label: RETURN_STATUS_LABELS[value],
          }))}
          preserve={preserve}
          includeDates
        />
      </div>

      <section aria-label="Resumen de devoluciones" id="report">
        {'summary' in outcome ? (
          <ReturnsSummaryCards
            summary={outcome.summary}
            statusLabel={STATUS_CAPTION[status ?? 'resolved']}
          />
        ) : (
          <ReturnsReportError
            status={outcome.error.status}
            message={outcome.error.message}
            correlationId={outcome.error.correlationId}
          />
        )}
      </section>

      <h2 className="hidden text-sm font-semibold text-slate-900 md:block">
        Historial de devoluciones
      </h2>

      {orderId && (
        <div className="hidden md:block">
          <p className="flex items-center gap-2 text-sm text-slate-600">
            Filtrado a un pedido
            {canViewOrders ? (
              <Link
                href={`/sales/${orderId}`}
                className="font-medium text-slate-700 underline underline-offset-2"
              >
                {shortId(orderId)}
              </Link>
            ) : (
              <code className="text-xs">{shortId(orderId)}</code>
            )}
            <Link
              href={withoutOrderHref}
              className="text-xs font-medium text-slate-500 hover:underline"
            >
              Quitar
            </Link>
          </p>
        </div>
      )}

      <div className="md:hidden">
        <ReturnsMobileList
          returns={mobileReturns}
          count={result.meta.total}
          params={carried}
          statusOptions={RETURN_STATUSES.map((value) => ({
            value,
            label: RETURN_STATUS_LABELS[value],
          }))}
          locationOptions={location.options.map((o) => ({
            value: o.id,
            label: locationLabelOf(o.id),
          }))}
          allowAllLocations={location.allowAll}
          defaultLocationId={location.defaultId}
          canViewOrders={canViewOrders}
          empty={emptyText}
          notice={
            orderId ? (
              <p className="flex items-center gap-2 text-sm text-slate-600">
                Filtrado a un pedido
                {canViewOrders ? (
                  <Link
                    href={`/sales/${orderId}`}
                    className="font-medium text-slate-700 underline underline-offset-2"
                  >
                    {shortId(orderId)}
                  </Link>
                ) : (
                  <code className="text-xs">{shortId(orderId)}</code>
                )}
                <Link
                  href={withoutOrderHref}
                  className="text-xs font-medium text-slate-500 hover:underline"
                >
                  Quitar
                </Link>
              </p>
            ) : null
          }
        />
        {result.data.length > 0 && (
          <div className="mt-3">
            <Pagination
              page={result.meta.page}
              pageSize={result.meta.pageSize}
              total={result.meta.total}
              totalPages={result.meta.totalPages}
              buildHref={buildHref}
            />
          </div>
        )}
      </div>

      <div className="hidden md:contents">
        {result.data.length === 0 ? (
          <EmptyState
            title={
              hasNarrowing
                ? 'Ninguna devolución coincide con estos filtros'
                : 'Aún no hay devoluciones hoy'
            }
            description={
              hasNarrowing
                ? 'Prueba con otro estado, almacén o rango de fechas.'
                : 'Una devolución se presenta contra un pedido confirmado cuando regresa mercancía. Cambia el rango de fechas para ver días anteriores.'
            }
            {...(canCreate && !hasNarrowing
              ? { action: <ButtonLink href="/returns/new">Nueva devolución</ButtonLink> }
              : {})}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Devolución</TH>
                  <TH>Pedido</TH>
                  <TH>Recibido en</TH>
                  <TH>Usuario</TH>
                  <TH>Producto</TH>
                  <TH>Motivo</TH>
                  <TH>Estado</TH>
                  <TH>Creado</TH>
                  <TH className="w-0">
                    <span className="sr-only">Acciones</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {result.data.map((ret) => {
                  const orderLabel = ret.orderNumber ?? shortId(ret.orderId);
                  const received = Boolean(ret.receivedByName);
                  const userName = ret.receivedByName ?? ret.requestedByName;
                  const shown = ret.items.slice(0, MAX_PRODUCTS_SHOWN);
                  const extra = ret.items.length - shown.length;
                  return (
                    <TR key={ret.id}>
                      <TD className="whitespace-nowrap font-medium text-slate-900">
                        {ret.returnNumber}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {canViewOrders ? (
                          <Link
                            href={`/sales/${ret.orderId}`}
                            className="font-medium text-slate-700 underline-offset-2 hover:underline"
                          >
                            {orderLabel}
                          </Link>
                        ) : (
                          <span className="text-slate-500">{orderLabel}</span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-slate-500">
                        {location.index.locationName(ret.locationId)}
                      </TD>
                      <TD className="text-slate-700">
                        {userName ? (
                          <>
                            {userName}
                            {!received && (
                              <span className="block text-xs text-slate-400">solicitó</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="max-w-[12rem] text-slate-700">
                        {shown.length === 0 ? (
                          '—'
                        ) : (
                          <ul className="flex flex-col">
                            {shown.map((item) => (
                              <li
                                key={item.id}
                                className="truncate"
                                title={
                                  item.sku ? `${item.sku} · ${item.productName ?? ''}` : undefined
                                }
                              >
                                {item.productName ?? shortId(item.productVariantId)}
                                <span className="text-slate-400"> ×{item.quantityReturned}</span>
                              </li>
                            ))}
                            {extra > 0 && <li className="text-xs text-slate-400">+{extra} más</li>}
                          </ul>
                        )}
                      </TD>
                      <TD className="w-48 min-w-[10rem] max-w-[12rem] text-xs leading-snug text-slate-500">
                        <span className="line-clamp-2" title={ret.reason}>
                          {ret.reason}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={returnStatusTone(ret.status)}>
                          {RETURN_STATUS_LABELS[ret.status as ReturnStatus] ?? ret.status}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-slate-500">
                        {dateFormat.format(new Date(ret.createdAt))}
                      </TD>
                      <TD>
                        <Link
                          href={`/returns/${ret.id}`}
                          className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                        >
                          Ver
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
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
      </div>
    </PageContainer>
  );
}
