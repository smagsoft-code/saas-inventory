import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listPriceApprovals } from '../../../lib/sales/price-approvals';
import { getApprovalsSummary } from '../../../lib/sales/approvals-reports';
import { resolveHistoryDates, tenantToday } from '../../../lib/sales/history-dates';
import { resolveLocationFilter } from '../../../lib/sales/history-scope';
import { shortId } from '../../../lib/inventory/location-index';
import {
  PRICE_APPROVAL_STATUSES,
  PRICE_APPROVAL_STATUS_LABELS,
  priceApprovalStatusTone,
  type PriceApprovalStatus,
} from '../../../lib/types/sales';
import type { ApprovalsSummary } from '../../../lib/types/approvals-reports';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { HistoryFilters, type HistoryFilterValues } from '../../../components/history-filters';
import { ApprovalsReportError, ApprovalsSummaryCards } from './approvals-report-section';

export const metadata = { title: 'Aprobaciones · SaaS Inventory' };

const PAGE_SIZE = 20;

function pickStatus(value: string | undefined): PriceApprovalStatus | undefined {
  return (PRICE_APPROVAL_STATUSES as readonly string[]).includes(value ?? '') ? (value as PriceApprovalStatus) : undefined;
}

/**
 * Price-approval queue (`S-APPROVALS-LIST`) — `GET /api/v1/price-approvals` (requires
 * `pricing.discount.request` **or** `pricing.discount.approve` — `@RequireAnyPermission`, F17-09).
 * ONE filter bar (Desde, Hasta, Almacén, Estado) drives both the four cards
 * (`GET /reports/approvals-summary`, only for `pricing.discount.approve`) and the queue — the same
 * values are sent to both. Dates are tenant-timezone calendar days on `requested_at` (default
 * today); Almacén is the parent order's location, limited to the caller's own scope. Resolving a
 * request (`approve` / `reject`) is done from the detail page and needs `pricing.discount.approve`.
 */
export default async function ApprovalsPage({
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
  if (!checker.canAny(['pricing.discount.request', 'pricing.discount.approve'])) {
    return (
      <PageContainer>
        <PageHeader title="Aprobaciones" />
        <NoAccess message="Necesitas un permiso de descuentos de precio para ver la cola de aprobaciones." />
      </PageContainer>
    );
  }
  // The governance cards reuse the endpoint's own gate — `pricing.discount.approve`
  // (Administrador / Supervisor), narrower than the queue's request-OR-approve gate. A Vendedor
  // sees the queue but not the tenant-wide approval-rate cards.
  const canViewReport = checker.can('pricing.discount.approve');

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
  // The exact same filter set feeds the cards and the queue.
  const common = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    ...(status ? { status } : {}),
    ...(locationId ? { locationId } : {}),
  };

  type SummaryOutcome =
    | { summary: ApprovalsSummary }
    | { error: { status: number; message: string; correlationId: string | undefined } }
    | null;
  const summaryPromise: Promise<SummaryOutcome> = canViewReport
    ? getApprovalsSummary({ ...common, groupBy: 'day' })
        .then((summary): SummaryOutcome => ({ summary }))
        .catch(
          (error: unknown): SummaryOutcome => ({
            error: {
              status: isApiError(error) ? error.status : 0,
              message: httpErrorMessage(error),
              correlationId: isApiError(error) ? error.correlationId : undefined,
            },
          }),
        )
    : Promise.resolve(null);

  const [result, outcome] = await Promise.all([
    listPriceApprovals({ page, pageSize: PAGE_SIZE, ...common, ...(orderId ? { orderId } : {}) }),
    summaryPromise,
  ]);

  const hasNarrowing = Boolean(status || orderId || dateTo || dateFrom !== today || locationId !== location.defaultId);
  const dateFormat = (() => {
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
    if (orderId) params.set('orderId', orderId);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/approvals?${params}`;
  }

  const preserve = orderId ? { orderId } : undefined;
  const withoutOrderHref = (() => {
    const params = new URLSearchParams();
    params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (locationId) params.set('locationId', locationId);
    if (status) params.set('status', status);
    return `/approvals?${params}`;
  })();

  return (
    <PageContainer>
      <PageHeader
        title="Aprobaciones"
        help="Solicitudes de descuento excepcional: precios bajo el mínimo a la espera de una decisión."
      />

      <HistoryFilters
        basePath="/approvals"
        initial={filters}
        today={today}
        defaultLocationId={location.defaultId}
        locations={location.options}
        allowAllLocations={location.allowAll}
        statusOptions={PRICE_APPROVAL_STATUSES.map((value) => ({ value, label: PRICE_APPROVAL_STATUS_LABELS[value] }))}
        preserve={preserve}
        includeDates
      />

      {outcome && (
        <section aria-label="Resumen de aprobaciones" id="report">
          {'summary' in outcome ? (
            <ApprovalsSummaryCards summary={outcome.summary} />
          ) : (
            <ApprovalsReportError status={outcome.error.status} message={outcome.error.message} correlationId={outcome.error.correlationId} />
          )}
        </section>
      )}

      <h2 className="text-sm font-semibold text-slate-900">Cola de aprobaciones</h2>

      {orderId && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          Filtrado a un pedido
          <Link href={`/sales/${orderId}`} className="font-medium text-slate-700 underline underline-offset-2">
            {shortId(orderId)}
          </Link>
          <Link href={withoutOrderHref} className="text-xs font-medium text-slate-500 hover:underline">
            Quitar
          </Link>
        </p>
      )}

      {result.data.length === 0 ? (
        <EmptyState
          title={hasNarrowing ? 'Ninguna solicitud coincide con estos filtros' : 'No hay solicitudes de descuento excepcional hoy'}
          description={
            hasNarrowing
              ? 'Prueba con otro estado, almacén o rango de fechas.'
              : 'Una solicitud aparece aquí cuando un vendedor vende una línea bajo su precio mínimo. Cambia el rango de fechas para ver días anteriores.'
          }
        />
      ) : (
        <>
          <Table className="table-fixed">
            <THead>
              <TR>
                <TH className="w-[12%]">Pedido</TH>
                <TH className="w-[16%]">Producto</TH>
                <TH className="w-[12%]">Almacén</TH>
                <TH className="w-[10%] text-right" title="Precio solicitado">
                  P. solicitado
                </TH>
                <TH className="w-[10%] text-right">Descuento</TH>
                <TH className="w-[16%]">Motivo</TH>
                <TH className="w-[11%]">Solicitado</TH>
                <TH className="w-[9%]">Estado</TH>
                <TH className="w-[4%]">
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((approval) => (
                <TR key={approval.id}>
                  <TD className="break-words">
                    <Link
                      href={`/sales/${approval.orderId}`}
                      className="font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      {approval.orderNumber}
                    </Link>
                  </TD>
                  <TD className="text-slate-700">
                    {approval.productName ? (
                      <span className="block truncate" title={approval.sku ? `${approval.sku} · ${approval.productName}` : approval.productName}>
                        {approval.productName}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD className="break-words text-slate-500">{location.index.locationName(approval.locationId)}</TD>
                  <TD className="text-right text-slate-700">{approval.requestedPrice.toFixed(2)}</TD>
                  <TD className="text-right text-slate-500">{approval.discountAmount.toFixed(2)}</TD>
                  <TD className="text-xs leading-snug text-slate-500">
                    <span className="line-clamp-2" title={approval.reason}>
                      {approval.reason}
                    </span>
                  </TD>
                  <TD className="text-slate-500">{dateFormat.format(new Date(approval.requestedAt))}</TD>
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
