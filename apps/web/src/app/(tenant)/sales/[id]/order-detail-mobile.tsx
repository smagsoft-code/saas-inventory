import Link from 'next/link';
import { cn } from '../../../../lib/cn';
import { mobileBadgeClass, PRODUCTS_MOBILE_THEMES } from '../../products/products-mobile-theme';

/**
 * The phone layout of one order (`md:hidden` on the page; the desktop cards keep `md` and up): a
 * header with the number, estado and document · almacén, a customer card, and the lines card with
 * its totals. Exactly the data the desktop detail shows — nothing else. The lifecycle controls
 * (`OrderActions`) stay below, restyled for phones in their own component. Pure presentation: the
 * page resolves names, links and dates.
 */
export interface MobileOrderDetail {
  orderNumber: string;
  statusLabel: string;
  statusTone: 'neutral' | 'success' | 'warning' | 'danger';
  /** "Nota de venta · General" */
  subtitle: string;
  customer: {
    name: string;
    href?: string | undefined;
    taxId?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
    address?: string | undefined;
    location: string;
    warehouse: string;
    invoiceStatus?: string | undefined;
    createdLabel: string;
  };
  items: {
    id: string;
    sku: string;
    productName: string;
    belowMinimum: boolean;
    movementsHref?: string | undefined;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }[];
  totals: { subtotal: string; discount: string; tax: string; total: string; currency: string };
}

const T = PRODUCTS_MOBILE_THEMES.light;
const SECTION = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500';

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-right font-medium text-slate-900',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function OrderDetailMobile({ detail }: { detail: MobileOrderDetail }): React.JSX.Element {
  const { customer, totals } = detail;
  return (
    <div className="flex flex-col gap-3 md:hidden">
      <section className={cn(T.card, 'flex flex-col gap-3 p-4')} aria-label="Cliente">
        <h2 className={SECTION}>Cliente</h2>
        <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
          {customer.href ? (
            <Link href={customer.href} className={cn(T.title, 'underline underline-offset-2')}>
              {customer.name}
            </Link>
          ) : (
            <p className={T.title}>{customer.name}</p>
          )}
          <dl className="flex flex-col gap-1.5">
            {customer.taxId && <Row label="Identificación" value={customer.taxId} mono />}
            {customer.email && <Row label="Correo" value={customer.email} />}
            {customer.phone && <Row label="Teléfono" value={customer.phone} mono />}
            {customer.address && <Row label="Dirección" value={customer.address} />}
            <Row label="Almacén" value={`${customer.location} · ${customer.warehouse}`} />
            {customer.invoiceStatus && (
              <Row label="Estado de la factura" value={customer.invoiceStatus} />
            )}
            <Row label="Realizado" value={customer.createdLabel} mono />
          </dl>
        </div>
      </section>

      <section className={cn(T.card, 'flex flex-col gap-3 p-4')} aria-label="Líneas">
        <div className="flex items-center justify-between gap-2">
          <h2 className={SECTION}>Líneas</h2>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {detail.items.length} {detail.items.length === 1 ? 'artículo' : 'artículos'}
          </span>
        </div>
        <ul className="flex flex-col gap-3">
          {detail.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={cn(T.code, 'rounded bg-blue-50 px-1.5 py-0.5')}>{item.sku}</span>
                  {item.belowMinimum && <span className={T.badgeWarn}>bajo el mínimo</span>}
                </div>
                <span className="shrink-0 font-mono text-base font-bold tabular-nums text-slate-900">
                  {item.lineTotal}
                </span>
              </div>
              <p className="text-base font-bold uppercase text-slate-900">{item.productName}</p>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                <dl className="flex gap-5">
                  <div>
                    <dt className={T.tileLabel}>Cant.</dt>
                    <dd className="font-mono text-sm font-semibold text-slate-900">
                      {item.quantity}
                    </dd>
                  </div>
                  <div>
                    <dt className={T.tileLabel}>Precio unitario</dt>
                    <dd className="font-mono text-sm font-semibold text-slate-900">
                      {item.unitPrice}
                    </dd>
                  </div>
                </dl>
                {item.movementsHref && (
                  <Link href={item.movementsHref} className="text-sm font-semibold text-blue-700">
                    movimientos
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
        <dl className={cn('flex flex-col gap-1.5 border-t pt-3', T.divider)}>
          <Row label="Subtotal" value={totals.subtotal} mono />
          <Row label="Descuento (informativo)" value={totals.discount} mono />
          <Row label="Impuesto" value={totals.tax} mono />
        </dl>
        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-slate-50 p-3">
          <span className="text-sm font-semibold text-slate-900">Total</span>
          <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">
            {totals.total}{' '}
            <span className="text-sm font-semibold text-slate-500">{totals.currency}</span>
          </span>
        </div>
      </section>
    </div>
  );
}

/** The estado badge used in the phone header. */
export function OrderStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: MobileOrderDetail['statusTone'];
}): React.JSX.Element {
  return <span className={mobileBadgeClass(T, tone)}>{label}</span>;
}
