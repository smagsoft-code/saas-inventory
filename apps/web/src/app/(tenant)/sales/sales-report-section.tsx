import { EmptyState } from '../../../components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import {
  isCustomerBucket,
  isProductBucket,
  type SalesSummary,
  type SalesSummaryBucket,
} from '../../../lib/types/reports';

/** A small, honest error surface local to the report section — never a full-page failure, never a
 * redirect to login for a 403 (F18-02 §18). Server-renderable (no client fetch/state of its own —
 * the section's data comes from the Server Component that renders it); "Try again" is a plain link
 * reload rather than a client component, since the whole page already re-fetches on any navigation. */
export function SalesReportError({
  status,
  message,
  correlationId,
}: {
  status: number;
  message: string;
  correlationId?: string | undefined;
}): React.JSX.Element {
  const title = status === 403 ? 'Access denied' : status >= 500 ? 'Something went wrong on our end' : 'Could not load the report';
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
        {correlationId && <p className="mt-1 text-xs text-red-600/80">Reference: {correlationId}</p>}
      </div>
      <a href="#report" className="text-sm font-medium text-red-800 underline-offset-2 hover:underline">
        Try again
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

/** Order-level buckets (day/week/month/customer) can be summed safely — every order appears in
 * exactly one such bucket. Product buckets cannot: a multi-line order appears once per product it
 * contains, so summing "orders" across product buckets would double-count — the product KPI strip
 * deliberately shows different tiles (no "Orders", no "Avg ticket"). */
function OrderLevelKpis({ buckets, currency }: { buckets: SalesSummaryBucket[]; currency: string }): React.JSX.Element {
  const orderCount = buckets.reduce((n, b) => n + (b as { orderCount: number }).orderCount, 0);
  const subtotal = buckets.reduce((n, b) => n + (b as { subtotal: number }).subtotal, 0);
  const discountTotal = buckets.reduce((n, b) => n + (b as { discountTotal: number }).discountTotal, 0);
  const total = buckets.reduce((n, b) => n + (b as { total: number }).total, 0);
  const avgTicket = orderCount > 0 ? total / orderCount : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiTile label="Revenue" value={money(total, currency)} />
      <KpiTile label="Orders" value={String(orderCount)} />
      <KpiTile label="Avg ticket" value={money(avgTicket, currency)} />
      <KpiTile label="Discounts" value={money(discountTotal, currency)} />
      <KpiTile label="Subtotal" value={money(subtotal, currency)} />
    </div>
  );
}

function ProductLevelKpis({ buckets, currency }: { buckets: SalesSummaryBucket[]; currency: string }): React.JSX.Element {
  const quantity = buckets.reduce((n, b) => n + (b as { quantity: number }).quantity, 0);
  const discountTotal = buckets.reduce((n, b) => n + (b as { discountTotal: number }).discountTotal, 0);
  const total = buckets.reduce((n, b) => n + (b as { total: number }).total, 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <KpiTile label="Revenue" value={money(total, currency)} />
      <KpiTile label="Units sold" value={String(quantity)} />
      <KpiTile label="Discounts" value={money(discountTotal, currency)} />
      <KpiTile label="Products" value={String(buckets.length)} />
    </div>
  );
}

function PeriodRow({ bucket, currency }: { bucket: SalesSummaryBucket; currency: string }): React.JSX.Element {
  const b = bucket as { key: string; orderCount: number; total: number; avgTicket: number; discountTotal: number };
  return (
    <TR>
      <TD className="font-medium">{b.key}</TD>
      <TD className="text-right">{b.orderCount}</TD>
      <TD className="text-right">{money(b.total, currency)}</TD>
      <TD className="text-right">{money(b.avgTicket, currency)}</TD>
      <TD className="text-right text-slate-500">{money(b.discountTotal, currency)}</TD>
    </TR>
  );
}

function CustomerRow({ bucket, currency }: { bucket: SalesSummaryBucket; currency: string }): React.JSX.Element {
  if (!isCustomerBucket(bucket)) return <></>;
  return (
    <TR>
      <TD className="font-medium">{bucket.customerName}</TD>
      <TD className="text-right">{bucket.orderCount}</TD>
      <TD className="text-right">{money(bucket.total, currency)}</TD>
      <TD className="text-right">{money(bucket.avgTicket, currency)}</TD>
    </TR>
  );
}

function ProductRow({ bucket, currency }: { bucket: SalesSummaryBucket; currency: string }): React.JSX.Element {
  if (!isProductBucket(bucket)) return <></>;
  return (
    <TR>
      <TD className="font-medium">{bucket.productName}</TD>
      <TD className="text-slate-500">{bucket.sku}</TD>
      <TD className="text-right">{bucket.quantity}</TD>
      <TD className="text-right">{money(bucket.total, currency)}</TD>
      <TD className="text-right text-slate-500">{money(bucket.discountTotal, currency)}</TD>
    </TR>
  );
}

/** The F18-02 report — success rendering only (loading/error/no-access are the caller's job, per
 * the existing `/sales` page pattern of pre-checking permission and letting real failures surface
 * as a local `SalesReportError`, never a redirect). One horizontally-scrolling table only, never
 * the whole page (§26 responsive — mobile gets an inner `overflow-x-auto`, not a page-wide one). */
export function SalesReportSection({ summary, currency }: { summary: SalesSummary; currency: string }): React.JSX.Element {
  if (summary.buckets.length === 0) {
    return (
      <EmptyState
        title={summary.exceptional === 'only' ? 'No exceptional-discount sales in this period' : 'No sales in this period'}
        description={
          summary.exceptional === 'only'
            ? 'Try a wider date range, a different status, or set the exceptional-discount filter back to "All sales".'
            : 'Try a wider date range, or a different status.'
        }
      />
    );
  }

  const isProduct = summary.groupBy === 'product';
  const isCustomer = summary.groupBy === 'customer';

  return (
    <div className="flex flex-col gap-3">
      {isProduct ? (
        <ProductLevelKpis buckets={summary.buckets} currency={currency} />
      ) : (
        <OrderLevelKpis buckets={summary.buckets} currency={currency} />
      )}

      <Table>
        <THead>
          {isProduct ? (
            <TR>
              <TH>Product</TH>
              <TH>SKU</TH>
              <TH className="text-right">Quantity</TH>
              <TH className="text-right">Revenue</TH>
              <TH className="text-right">Discounts</TH>
            </TR>
          ) : isCustomer ? (
            <TR>
              <TH>Customer</TH>
              <TH className="text-right">Orders</TH>
              <TH className="text-right">Revenue</TH>
              <TH className="text-right">Avg ticket</TH>
            </TR>
          ) : (
            <TR>
              <TH>Period</TH>
              <TH className="text-right">Orders</TH>
              <TH className="text-right">Revenue</TH>
              <TH className="text-right">Avg ticket</TH>
              <TH className="text-right">Discounts</TH>
            </TR>
          )}
        </THead>
        <TBody>
          {summary.buckets.map((bucket) =>
            isProduct ? (
              <ProductRow key={bucket.key} bucket={bucket} currency={currency} />
            ) : isCustomer ? (
              <CustomerRow key={bucket.key} bucket={bucket} currency={currency} />
            ) : (
              <PeriodRow key={bucket.key} bucket={bucket} currency={currency} />
            ),
          )}
        </TBody>
      </Table>
    </div>
  );
}
