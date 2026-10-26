import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import { mobileBadgeClass, PRODUCTS_MOBILE_THEMES } from '../../products/products-mobile-theme';

/**
 * The order detail layout — the approved phone mock-up, used at every width: header (number ·
 * estado · document and almacén), the amber reservation notice, a customer card and the lines card
 * with its totals. The payment card and the confirm / cancel buttons are `OrderActions`, styled to
 * match. Only data the web already shows — pure presentation, the page resolves names, links and
 * dates.
 */
export interface MobileOrderDetail {
  orderNumber: string;
  statusLabel: string;
  statusTone: 'neutral' | 'success' | 'warning' | 'danger';
  /** "Nota de venta · General" */
  subtitle: string;
  /** The web's own pending-order notice (reservation / approval), when it shows one. */
  notice?: string | undefined;
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
const CARD = cn(T.card, 'flex flex-col gap-3 p-4');
const HEAD = 'flex items-center gap-3';
const HEAD_ICON =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700';
const HEAD_TITLE = 'min-w-0 flex-1 text-xs font-bold uppercase tracking-wider text-slate-700';

function Icon({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Contact({ icon, children }: { icon: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
      <span className="text-slate-400">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono tabular-nums text-slate-700">{value}</dd>
    </div>
  );
}

export function OrderDetailMobile({
  detail,
  actions,
}: {
  detail: MobileOrderDetail;
  actions?: ReactNode;
}): React.JSX.Element {
  const { customer, totals } = detail;
  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-slate-900">{detail.orderNumber}</h1>
          <span className={mobileBadgeClass(T, detail.statusTone)}>{detail.statusLabel}</span>
          <span className="font-mono text-xs text-slate-500">{detail.subtitle}</span>
        </div>
        {actions}
      </header>

      {detail.notice && (
        <section
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"
          role="status"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Icon>
              <path d="M12 3 2.5 20h19L12 3Z" />
              <path d="M12 10v4M12 17.2v.1" />
            </Icon>
          </span>
          <p className="text-sm leading-snug text-amber-900">{detail.notice}</p>
        </section>
      )}

      <section className={CARD} aria-label="Cliente">
        <div className={HEAD}>
          <span className={HEAD_ICON}>
            <Icon>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="11" r="2" />
              <path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h4M14.5 13.5h3" />
            </Icon>
          </span>
          <h2 className={HEAD_TITLE}>Cliente</h2>
          <span className="shrink-0 text-right font-mono text-xs leading-snug text-slate-500">
            {customer.createdLabel}
          </span>
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            {customer.href ? (
              <Link
                href={customer.href}
                className="text-lg font-bold text-slate-900 underline underline-offset-2"
              >
                {customer.name}
              </Link>
            ) : (
              <p className="text-lg font-bold text-slate-900">{customer.name}</p>
            )}
            {customer.taxId && (
              <span className="shrink-0 font-mono text-xs font-bold text-blue-700">
                ID: {customer.taxId}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {customer.phone && (
              <Contact
                icon={
                  <Icon>
                    <path d="M5 4h4l1.5 4-2 1.2a11 11 0 0 0 5.3 5.3L15 12.5l4 1.5v4a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2Z" />
                  </Icon>
                }
              >
                {customer.phone}
              </Contact>
            )}
            {customer.email && (
              <Contact
                icon={
                  <Icon>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3.5 7 8.5 6 8.5-6" />
                  </Icon>
                }
              >
                {customer.email}
              </Contact>
            )}
            {customer.address && (
              <Contact
                icon={
                  <Icon>
                    <path d="M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11Z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </Icon>
                }
              >
                {customer.address}
              </Contact>
            )}
            {customer.invoiceStatus && (
              <Contact
                icon={
                  <Icon>
                    <path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3Z" />
                    <path d="M10 8h4M10 12h4" />
                  </Icon>
                }
              >
                {customer.invoiceStatus}
              </Contact>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Almacén:{' '}
            <span className="font-semibold text-slate-700">
              {customer.location} · {customer.warehouse}
            </span>
          </p>
        </div>
      </section>

      <section className={CARD} aria-label="Líneas">
        <div className={HEAD}>
          <span className={HEAD_ICON}>
            <Icon>
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11h14V8M10 12h4" />
            </Icon>
          </span>
          <h2 className={HEAD_TITLE}>Líneas</h2>
          <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
            {detail.items.length} {detail.items.length === 1 ? 'artículo' : 'artículos'}
          </span>
        </div>
        <ul className="flex flex-col gap-3">
          {detail.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs font-bold text-blue-800">
                      {item.sku}
                    </span>
                    {item.belowMinimum && <span className={T.badgeWarn}>bajo el mínimo</span>}
                  </div>
                  <p className="text-lg font-bold uppercase leading-tight text-slate-900">
                    {item.productName}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-lg font-bold tabular-nums text-slate-900">
                    {item.lineTotal}
                  </p>
                  <p className="font-mono text-xs text-slate-500">{totals.currency}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                <dl className="flex gap-6">
                  <div>
                    <dt className="text-xs text-slate-500">Cant.</dt>
                    <dd className="font-mono text-base font-semibold text-slate-900">
                      {item.quantity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Precio unitario</dt>
                    <dd className="font-mono text-base font-semibold text-slate-900">
                      {item.unitPrice}
                    </dd>
                  </div>
                </dl>
                {item.movementsHref && (
                  <Link
                    href={item.movementsHref}
                    className="flex items-center gap-1.5 text-sm font-semibold text-blue-700"
                  >
                    <Icon>
                      <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2" />
                    </Icon>
                    movimientos
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-2">
          <Line label="Subtotal" value={totals.subtotal} />
          <Line label="Descuento (informativo)" value={totals.discount} />
          <Line label="Impuesto" value={totals.tax} />
        </dl>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Total</span>
          <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">
            {totals.total}{' '}
            <span className="text-sm font-semibold text-slate-500">{totals.currency}</span>
          </span>
        </div>
      </section>
    </div>
  );
}
