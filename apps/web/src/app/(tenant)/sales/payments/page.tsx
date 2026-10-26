import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import {
  buildPaymentsExportHref,
  getPaymentsReport,
  type PaymentsReportQuery,
} from '../../../../lib/sales/payments-report';
import { resolveHistoryDates, tenantToday } from '../../../../lib/sales/history-dates';
import { resolveLocationFilter } from '../../../../lib/sales/history-scope';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type DocumentType,
  type PaymentMethod,
} from '../../../../lib/types/sales';
import {
  PAYMENT_RETURN_NOTE,
  PAYMENT_SORT_COLUMNS,
  type PaymentSortColumn,
} from '../../../../lib/types/payments-report';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { Pagination } from '../../../../components/ui/pagination';
import { Table, TBody, TD, TR } from '../../../../components/ui/table';
import { ExportLinks } from '../../../../components/export-icons';
import {
  HistoryDateFilters,
  type HistoryFilterValues,
} from '../../../../components/history-filters';
import Link from 'next/link';
import { PaymentsTableHead } from './payments-table-head';
import { PaymentsMobileList, type MobilePayment } from './payments-mobile-list';

export const metadata = { title: 'Formas de pago · SaaS Inventory' };

const PAGE_SIZE = 20;

function pick<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : undefined;
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function returnNote(
  row: { returns?: { numbers: string[]; returnedValue: number } },
  currency: string,
): string | null {
  if (!row.returns) return null;
  return `${PAYMENT_RETURN_NOTE} Devolución ${row.returns.numbers.join(', ')} · valor devuelto ${money(row.returns.returnedValue, currency)}.`;
}

/**
 * Formas de pago — the payment-method detail report. Same layout as the sales history: Desde/Hasta
 * in the header, summary cards, a table whose own header carries the sort toggles and filters. One
 * row per recorded payment (a split payment is several rows), dated by when the payment was
 * recorded (order confirmation). Payments are not reversed by a return, so an order with a return
 * has its amount flagged on red with a note. Excel/PDF export carries exactly the filters on screen.
 */
export default async function PaymentsReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    dateFrom?: string;
    dateTo?: string;
    locationId?: string;
    documentType?: string;
    paymentMethod?: string;
    orderNumber?: string;
    customerName?: string;
    sellerName?: string;
    amount?: string;
    sort?: string;
    dir?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.orders.view')) {
    return (
      <PageContainer>
        <PageHeader title="Formas de pago" />
        <NoAccess message="Necesitas el permiso de pedidos para ver esta página." />
      </PageContainer>
    );
  }

  const sp = await searchParams;
  const timezone = session?.timezone ?? 'UTC';
  const today = tenantToday(timezone);
  const { dateFrom, dateTo } = resolveHistoryDates(sp, timezone);
  const page = Math.max(1, Number(sp.page) || 1);
  const documentType = pick(DOCUMENT_TYPES, sp.documentType);
  const paymentMethod = pick(PAYMENT_METHODS, sp.paymentMethod);
  const orderNumber = sp.orderNumber?.trim() || undefined;
  const customerName = sp.customerName?.trim() || undefined;
  const sellerName = sp.sellerName?.trim() || undefined;
  const amount = sp.amount?.trim() || undefined;
  const sort = pick(PAYMENT_SORT_COLUMNS, sp.sort);
  const dir = sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : undefined;
  const activeSort: PaymentSortColumn = sort ?? 'createdAt';
  const activeDir: 'asc' | 'desc' = dir ?? 'desc';

  const location = await resolveLocationFilter(checker.can('warehouses.view'), sp.locationId);
  const locationId = location.options.some((o) => o.id === sp.locationId)
    ? sp.locationId
    : undefined;
  const locationOptions = location.options.map((o) => {
    const warehouse = location.index.warehouseName(o.id);
    return { value: o.id, label: warehouse !== '—' ? `${warehouse} · ${o.name}` : o.name };
  });

  const filters: HistoryFilterValues = { dateFrom, dateTo, documentType, locationId };
  const columnFilters = {
    ...(orderNumber ? { orderNumber } : {}),
    ...(customerName ? { customerName } : {}),
    ...(sellerName ? { sellerName } : {}),
    ...(amount ? { amount } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
  };
  const query: PaymentsReportQuery = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    ...(documentType ? { documentType } : {}),
    ...(locationId ? { locationId } : {}),
    ...columnFilters,
    ...(sort ? { sort } : {}),
    ...(dir ? { dir } : {}),
  };
  // Every param (besides the page) a header control must keep when it changes one of them.
  const carried: Record<string, string> = {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    ...(documentType ? { documentType } : {}),
    ...(locationId ? { locationId } : {}),
    ...columnFilters,
    ...(sort ? { sort } : {}),
    ...(dir ? { dir } : {}),
  };

  const report = await getPaymentsReport({ ...query, page, pageSize: PAGE_SIZE });
  const { currency, totals } = report;
  const hasNarrowing = Boolean(
    documentType ||
    locationId ||
    Object.keys(columnFilters).length > 0 ||
    dateTo ||
    dateFrom !== today,
  );
  const empty = hasNarrowing
    ? 'Ningún pago coincide con estos filtros. Prueba con otros valores o un rango de fechas más amplio.'
    : 'Aún no hay pagos hoy. Los pagos de hoy aparecen aquí una vez confirmados los pedidos; cambia el rango de fechas para ver días anteriores.';

  const dateTimeFormat = (() => {
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
  const methodLabel = (value: string): string =>
    PAYMENT_METHOD_LABELS[value as PaymentMethod] ?? value;
  const documentLabel = (value: string): string =>
    DOCUMENT_TYPE_LABELS[value as DocumentType] ?? value;

  const mobilePayments: MobilePayment[] = report.data.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    paidAtLabel: dateTimeFormat.format(new Date(row.paidAt)),
    customerName: row.customerName,
    paymentMethodLabel: methodLabel(row.paymentMethod),
    amountLabel: money(row.amount, currency),
    sellerName: row.sellerName ?? '—',
    locationLabel: row.locationLabel,
    documentLabel: documentLabel(row.documentType),
    returnNote: returnNote(row, currency),
  }));

  function buildHref(nextPage: number): string {
    const params = new URLSearchParams(carried);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/sales/payments?${params}`;
  }

  const hasReturns = report.data.some((row) => row.returns);

  return (
    <PageContainer>
      <PageHeader
        title="Formas de pago"
        help="Detalle de cada pago registrado en los pedidos confirmados. Usa las casillas bajo cada título para filtrar y las flechas para ordenar."
        actions={
          <HistoryDateFilters
            basePath="/sales/payments"
            initial={filters}
            today={today}
            preserve={{ ...columnFilters, ...(sort ? { sort } : {}), ...(dir ? { dir } : {}) }}
          />
        }
      />

      {/* Compact tiles: the total + the four methods fit one row from `md` up (2 columns on a phone). */}
      <section aria-label="Resumen de pagos" className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Total cobrado
          </p>
          <p className="mt-1 break-words text-base font-semibold tabular-nums text-slate-900">
            {money(totals.amount, currency)}
          </p>
          <p className="text-[11px] text-slate-500">{totals.paymentCount} pago(s)</p>
        </div>
        {PAYMENT_METHODS.map((method) => {
          const row = totals.byMethod.find((m) => m.paymentMethod === method);
          return (
            <div
              key={method}
              className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {PAYMENT_METHOD_LABELS[method]}
              </p>
              <p className="mt-1 break-words text-base font-semibold tabular-nums text-slate-900">
                {money(row?.amount ?? 0, currency)}
              </p>
              <p className="text-[11px] text-slate-500">{row?.paymentCount ?? 0} pago(s)</p>
            </div>
          );
        })}
      </section>

      <div className="flex justify-end">
        <ExportLinks
          excelHref={buildPaymentsExportHref(query, 'xlsx')}
          pdfHref={buildPaymentsExportHref(query, 'pdf')}
        />
      </div>

      <div className="hidden md:block">
        <Table className="table-fixed text-xs">
          <PaymentsTableHead
            params={carried}
            sort={activeSort}
            dir={activeDir}
            paymentMethodOptions={PAYMENT_METHODS.map((value) => ({
              value,
              label: PAYMENT_METHOD_LABELS[value],
            }))}
            documentTypeOptions={DOCUMENT_TYPES.map((value) => ({
              value,
              label: DOCUMENT_TYPE_LABELS[value],
            }))}
            locationOptions={locationOptions}
          />
          <TBody>
            {report.data.length === 0 && (
              <TR>
                <TD colSpan={8} className="py-10 text-center text-sm text-slate-500">
                  {empty}
                </TD>
              </TR>
            )}
            {report.data.map((row) => (
              <TR key={row.id}>
                <TD className="!px-2 text-slate-500">
                  {dateTimeFormat.format(new Date(row.paidAt))}
                </TD>
                <TD className="break-words !px-2 font-medium">
                  <Link
                    href={`/sales/${row.orderId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {row.orderNumber}
                  </Link>
                </TD>
                <TD className="break-words !px-2 text-slate-700">{row.customerName}</TD>
                <TD className="break-words !px-2 text-slate-700">
                  {methodLabel(row.paymentMethod)}
                </TD>
                <TD className="!px-2 text-right">
                  {row.returns ? (
                    <span
                      title={returnNote(row, currency) ?? undefined}
                      data-return-flag="true"
                      className="inline-block rounded bg-red-600 px-1.5 py-0.5 font-semibold tabular-nums text-white"
                    >
                      {money(row.amount, currency)}
                    </span>
                  ) : (
                    <span className="tabular-nums text-slate-900">
                      {money(row.amount, currency)}
                    </span>
                  )}
                </TD>
                <TD className="break-words !px-2 text-slate-700">{row.sellerName ?? '—'}</TD>
                <TD className="break-words !px-2 text-slate-500">{row.locationLabel}</TD>
                <TD className="break-words !px-2 text-slate-500">
                  {documentLabel(row.documentType)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <div className="md:hidden">
        <PaymentsMobileList
          payments={mobilePayments}
          empty={empty}
          count={report.meta.total}
          params={carried}
          sort={activeSort}
          dir={activeDir}
          paymentMethodOptions={PAYMENT_METHODS.map((value) => ({
            value,
            label: PAYMENT_METHOD_LABELS[value],
          }))}
          documentTypeOptions={DOCUMENT_TYPES.map((value) => ({
            value,
            label: DOCUMENT_TYPE_LABELS[value],
          }))}
          locationOptions={locationOptions}
        />
      </div>

      {hasReturns && (
        <p role="note" className="flex items-start gap-2 text-xs text-slate-600">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm bg-red-600"
          />
          <span>{PAYMENT_RETURN_NOTE} Pasa el cursor sobre el monto para ver la devolución.</span>
        </p>
      )}

      {report.data.length > 0 && (
        <Pagination
          page={report.meta.page}
          pageSize={report.meta.pageSize}
          total={report.meta.total}
          totalPages={report.meta.totalPages}
          buildHref={buildHref}
        />
      )}
    </PageContainer>
  );
}
