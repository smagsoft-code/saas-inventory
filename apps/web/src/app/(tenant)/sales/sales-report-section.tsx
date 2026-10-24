import { HelpTip } from '../../../components/ui/help-tip';
import { isCustomerBucket, isProductBucket, type SalesSummary } from '../../../lib/types/reports';

/** A small, honest error surface local to the summary cards — never a full-page failure, never a
 * redirect to login for a 403 (F18-02 §18). Server-renderable: the data comes from the Server
 * Component that renders it; "Reintentar" is a plain link since any navigation re-fetches the page. */
export function SalesReportError({
  status,
  message,
  correlationId,
}: {
  status: number;
  message: string;
  correlationId?: string | undefined;
}): React.JSX.Element {
  const title = status === 403 ? 'Acceso denegado' : status >= 500 ? 'Algo salió mal de nuestro lado' : 'No se pudo cargar el resumen';
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
        {correlationId && <p className="mt-1 text-xs text-red-600/80">Referencia: {correlationId}</p>}
      </div>
      <a href="#resumen" className="text-sm font-medium text-red-800 underline-offset-2 hover:underline">
        Reintentar
      </a>
    </div>
  );
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The four figures of the sales-history cards, from the day buckets of `GET /reports/sales-summary`
 * (an order appears in exactly one day bucket, so summing them is exact).
 *
 * - Ventas sin descuento = Σ (subtotal + discountTotal) — `orders.subtotal` is already net of
 *   discount and `discount_total` is measured against `max_price`, so adding it back gives the sale
 *   at list (max) price.
 * - Descuentos = Σ discountTotal.
 * - Ventas netas = Σ total (= subtotal while `tax_total` is always 0).
 * - Cantidad de pedidos = Σ orderCount. */
export function summarizeSales(summary: SalesSummary): {
  withoutDiscount: number;
  discounts: number;
  net: number;
  orderCount: number;
} {
  let subtotal = 0;
  let discounts = 0;
  let net = 0;
  let orderCount = 0;
  for (const bucket of summary.buckets) {
    if (isProductBucket(bucket) || isCustomerBucket(bucket)) continue;
    subtotal += bucket.subtotal;
    discounts += bucket.discountTotal;
    net += bucket.total;
    orderCount += bucket.orderCount;
  }
  return {
    withoutDiscount: round2(subtotal + discounts),
    discounts: round2(discounts),
    net: round2(net),
    orderCount,
  };
}

// Phone: the same card and type as the Inicio / Productos tiles; from md up the original look.
function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:rounded-lg md:p-4 md:shadow-none">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:text-xs md:font-medium md:tracking-wide">{label}</p>
      <p className="mt-1 break-words text-xl font-bold tabular-nums text-slate-900 md:mt-2 md:text-2xl md:font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** The four cards. Success rendering only — loading is the route's `loading.tsx`, errors are
 * `SalesReportError`. With no matching orders the cards show real zeros (an empty period is a valid
 * answer, not a missing one). `statusLabel` names which order status the figures count. */
export function SalesSummaryCards({
  summary,
  statusLabel,
}: {
  summary: SalesSummary;
  statusLabel: string;
}): React.JSX.Element {
  const { withoutDiscount, discounts, net, orderCount } = summarizeSales(summary);
  const currency = summary.currency;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Ventas sin descuento" value={money(withoutDiscount, currency)} />
        <KpiTile label="Descuentos" value={money(discounts, currency)} />
        <KpiTile label="Ventas netas" value={money(net, currency)} />
        <KpiTile label="Cantidad de pedidos" value={String(orderCount)} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        Cómo se calculan las tarjetas
        <HelpTip>
          Las tarjetas cuentan pedidos {statusLabel} con los filtros activos. No restan devoluciones ni reflejan dinero cobrado.
        </HelpTip>
      </p>
    </div>
  );
}
