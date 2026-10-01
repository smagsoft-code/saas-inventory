import { EmptyState } from '../../../components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { DISPOSITION_LABELS, type Disposition } from '../../../lib/types/sales';
import {
  isReturnsCustomerBucket,
  isReturnsDispositionBucket,
  isReturnsProductBucket,
  type ReturnsSummary,
  type ReturnsSummaryBucket,
} from '../../../lib/types/returns-reports';

/** Mirrors `SalesReportError` (F18-02) exactly — a small, honest error surface local to the report
 * section, never a full-page failure, never a redirect to login for a 403. */
export function ReturnsReportError({
  status,
  message,
  correlationId,
}: {
  status: number;
  message: string;
  correlationId?: string | undefined;
}): React.JSX.Element {
  const title = status === 403 ? 'Acceso denegado' : status >= 500 ? 'Algo salió mal de nuestro lado' : 'No se pudo cargar el reporte';
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
        {correlationId && <p className="mt-1 text-xs text-red-600/80">Referencia: {correlationId}</p>}
      </div>
      <a href="#report" className="text-sm font-medium text-red-800 underline-offset-2 hover:underline">
        Reintentar
      </a>
    </div>
  );
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function KpiTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/** Return-level buckets (day/week/month/customer) can be summed safely — every return appears in
 * exactly one such bucket. */
function ReturnLevelKpis({ buckets, currency }: { buckets: ReturnsSummaryBucket[]; currency: string }): React.JSX.Element {
  const returnCount = buckets.reduce((n, b) => n + (b as { returnCount: number }).returnCount, 0);
  const quantity = buckets.reduce((n, b) => n + (b as { quantity: number }).quantity, 0);
  const returnedValue = buckets.reduce((n, b) => n + (b as { returnedValue: number }).returnedValue, 0);
  const avgReturnValue = returnCount > 0 ? returnedValue / returnCount : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiTile label="Devoluciones" value={String(returnCount)} />
      <KpiTile label="Unidades devueltas" value={String(quantity)} />
      <KpiTile label="Valor devuelto" value={money(returnedValue, currency)} />
      <KpiTile label="Promedio por devolución" value={money(avgReturnValue, currency)} />
    </div>
  );
}

/** A multi-product return appears once per product it contains, so summing "returns" across product
 * buckets would double-count — this KPI strip deliberately omits it, matching
 * `SalesReportSection.ProductLevelKpis`'s precedent. */
function ProductLevelKpis({ buckets, currency }: { buckets: ReturnsSummaryBucket[]; currency: string }): React.JSX.Element {
  const quantity = buckets.reduce((n, b) => n + (b as { quantity: number }).quantity, 0);
  const returnedValue = buckets.reduce((n, b) => n + (b as { returnedValue: number }).returnedValue, 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <KpiTile label="Unidades devueltas" value={String(quantity)} />
      <KpiTile label="Valor devuelto" value={money(returnedValue, currency)} />
      <KpiTile label="Productos" value={String(buckets.length)} />
    </div>
  );
}

/** A return with lines in more than one disposition appears in more than one bucket, so there is no
 * "Returns" KPI here at all (the DTO itself never carries `returnCount` for this grouping) —
 * `lineCount`/`quantity`/`returnedValue` stay safe to sum (each line has exactly one disposition). */
function DispositionLevelKpis({ buckets, currency }: { buckets: ReturnsSummaryBucket[]; currency: string }): React.JSX.Element {
  const lineCount = buckets.reduce((n, b) => n + (b as { lineCount: number }).lineCount, 0);
  const quantity = buckets.reduce((n, b) => n + (b as { quantity: number }).quantity, 0);
  const returnedValue = buckets.reduce((n, b) => n + (b as { returnedValue: number }).returnedValue, 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <KpiTile label="Líneas" value={String(lineCount)} />
      <KpiTile label="Unidades devueltas" value={String(quantity)} />
      <KpiTile label="Valor devuelto" value={money(returnedValue, currency)} />
    </div>
  );
}

function PeriodRow({ bucket, currency }: { bucket: ReturnsSummaryBucket; currency: string }): React.JSX.Element {
  const b = bucket as { key: string; returnCount: number; orderCount: number; quantity: number; returnedValue: number; avgReturnValue: number };
  return (
    <TR>
      <TD className="font-medium">{b.key}</TD>
      <TD className="text-right">{b.returnCount}</TD>
      <TD className="text-right">{b.quantity}</TD>
      <TD className="text-right">{money(b.returnedValue, currency)}</TD>
      <TD className="text-right text-slate-500">{money(b.avgReturnValue, currency)}</TD>
    </TR>
  );
}

function CustomerRow({ bucket, currency }: { bucket: ReturnsSummaryBucket; currency: string }): React.JSX.Element {
  if (!isReturnsCustomerBucket(bucket)) return <></>;
  return (
    <TR>
      <TD className="font-medium">{bucket.customerName}</TD>
      <TD className="text-right">{bucket.returnCount}</TD>
      <TD className="text-right">{bucket.quantity}</TD>
      <TD className="text-right">{money(bucket.returnedValue, currency)}</TD>
    </TR>
  );
}

function ProductRow({ bucket, currency }: { bucket: ReturnsSummaryBucket; currency: string }): React.JSX.Element {
  if (!isReturnsProductBucket(bucket)) return <></>;
  return (
    <TR>
      <TD className="font-medium">{bucket.productName}</TD>
      <TD className="text-slate-500">{bucket.sku}</TD>
      <TD className="text-right">{bucket.quantity}</TD>
      <TD className="text-right">{money(bucket.returnedValue, currency)}</TD>
    </TR>
  );
}

function DispositionRow({ bucket, currency }: { bucket: ReturnsSummaryBucket; currency: string }): React.JSX.Element {
  if (!isReturnsDispositionBucket(bucket)) return <></>;
  return (
    <TR>
      <TD className="font-medium">{DISPOSITION_LABELS[bucket.key as Disposition] ?? bucket.key}</TD>
      <TD className="text-right">{bucket.lineCount}</TD>
      <TD className="text-right">{bucket.quantity}</TD>
      <TD className="text-right">{money(bucket.returnedValue, currency)}</TD>
    </TR>
  );
}

/** The F18-04 report — success rendering only (loading/error/no-access are the caller's job, same
 * `/returns` page pattern `SalesReportSection` established: pre-check permission, let a real
 * failure surface as a local `ReturnsReportError`, never a redirect). One horizontally-scrolling
 * table only, never the whole page. */
export function ReturnsReportSection({ summary, currency }: { summary: ReturnsSummary; currency: string }): React.JSX.Element {
  if (summary.buckets.length === 0) {
    return <EmptyState title="Sin devoluciones en este período" description="Prueba con un rango de fechas más amplio, o un estado distinto." />;
  }

  const isProduct = summary.groupBy === 'product';
  const isCustomer = summary.groupBy === 'customer';
  const isDisposition = summary.groupBy === 'disposition';

  return (
    <div className="flex flex-col gap-3">
      {isProduct ? (
        <ProductLevelKpis buckets={summary.buckets} currency={currency} />
      ) : isDisposition ? (
        <DispositionLevelKpis buckets={summary.buckets} currency={currency} />
      ) : (
        <ReturnLevelKpis buckets={summary.buckets} currency={currency} />
      )}

      <Table>
        <THead>
          {isProduct ? (
            <TR>
              <TH>Producto</TH>
              <TH>Código</TH>
              <TH className="text-right">Cantidad</TH>
              <TH className="text-right">Valor devuelto</TH>
            </TR>
          ) : isCustomer ? (
            <TR>
              <TH>Cliente</TH>
              <TH className="text-right">Devoluciones</TH>
              <TH className="text-right">Cantidad</TH>
              <TH className="text-right">Valor devuelto</TH>
            </TR>
          ) : isDisposition ? (
            <TR>
              <TH>Disposición</TH>
              <TH className="text-right">Líneas</TH>
              <TH className="text-right">Cantidad</TH>
              <TH className="text-right">Valor devuelto</TH>
            </TR>
          ) : (
            <TR>
              <TH>Período</TH>
              <TH className="text-right">Devoluciones</TH>
              <TH className="text-right">Cantidad</TH>
              <TH className="text-right">Valor devuelto</TH>
              <TH className="text-right">Prom. / devolución</TH>
            </TR>
          )}
        </THead>
        <TBody>
          {summary.buckets.map((bucket) =>
            isProduct ? (
              <ProductRow key={bucket.key} bucket={bucket} currency={currency} />
            ) : isCustomer ? (
              <CustomerRow key={bucket.key} bucket={bucket} currency={currency} />
            ) : isDisposition ? (
              <DispositionRow key={bucket.key} bucket={bucket} currency={currency} />
            ) : (
              <PeriodRow key={bucket.key} bucket={bucket} currency={currency} />
            ),
          )}
        </TBody>
      </Table>
    </div>
  );
}
