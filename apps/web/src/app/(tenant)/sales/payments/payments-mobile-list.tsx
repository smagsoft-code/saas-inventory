'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '../../../../lib/cn';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { Modal } from '../../../../components/ui/modal';
import { PRODUCTS_MOBILE_THEMES } from '../../products/products-mobile-theme';

/** One payment, already formatted server-side (names, dates, labels) — this component only lays it out. */
export interface MobilePayment {
  id: string;
  orderId: string;
  orderNumber: string;
  paidAtLabel: string;
  customerName: string;
  paymentMethodLabel: string;
  amountLabel: string;
  sellerName: string;
  locationLabel: string;
  documentLabel: string;
  /** Set when the order has a return — the amount is then shown on red with this note. */
  returnNote: string | null;
}

export interface PaymentOption {
  value: string;
  label: string;
}

const T = PRODUCTS_MOBILE_THEMES.light;

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'createdAt:desc', label: 'Más recientes' },
  { value: 'createdAt:asc', label: 'Más antiguos' },
  { value: 'amount:desc', label: 'Monto: mayor a menor' },
  { value: 'amount:asc', label: 'Monto: menor a mayor' },
  { value: 'customer:asc', label: 'Cliente A–Z' },
  { value: 'customer:desc', label: 'Cliente Z–A' },
];

/** The column filters of the report that live in the "Filtros" panel and show as removable chips
 * (the dates stay in the page header). The button's count is exactly the number of chips. */
const PANEL_KEYS = [
  'orderNumber',
  'customerName',
  'sellerName',
  'amount',
  'paymentMethod',
  'documentType',
  'locationId',
] as const;
type PanelKey = (typeof PANEL_KEYS)[number];

const CHIP_LABELS: Record<PanelKey, string> = {
  orderNumber: 'N.º de orden',
  customerName: 'Cliente',
  sellerName: 'Vendedor',
  amount: 'Monto',
  paymentMethod: 'Forma de pago',
  documentType: 'Documento',
  locationId: 'Almacén',
};

function DetailTile({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <div className={cn(T.tile, wide && 'col-span-2')}>
      <p className={T.tileLabel}>{label}</p>
      <p className={T.tileValue}>{children}</p>
    </div>
  );
}

function readPanel(params: Record<string, string>): Record<PanelKey, string> {
  return Object.fromEntries(PANEL_KEYS.map((key) => [key, params[key] ?? ''])) as Record<
    PanelKey,
    string
  >;
}

/**
 * Phone layout of "Formas de pago" (shown below `md`; the table keeps `md` and up) — the same format
 * as the sales history: a "Filtros" button (with the number of active filters) + sort, the active
 * filters as removable chips, the record count, and one tappable card per payment that expands to
 * show who sold it, the document type and "Sucursal · Almacén". The report's own data and filters
 * only (the date range and the export links stay at the top of the page); same URL params as the
 * table header.
 */
export function PaymentsMobileList({
  payments,
  empty,
  count,
  params,
  sort,
  dir,
  paymentMethodOptions,
  documentTypeOptions,
  locationOptions,
}: {
  payments: MobilePayment[];
  empty: string;
  /** Total rows matching the filters (all pages). */
  count: number;
  /** Every URL param (dates, filters, sort) a control must keep when it changes one of them. */
  params: Record<string, string>;
  sort: string;
  dir: 'asc' | 'desc';
  paymentMethodOptions: PaymentOption[];
  documentTypeOptions: PaymentOption[];
  locationOptions: PaymentOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Record<PanelKey, string>>(() => readPanel(params));

  function navigate(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value && key !== 'page') next.set(key, value);
    }
    router.push(`/sales/payments?${next}`, { scroll: false });
  }

  const optionsByKey: Partial<Record<PanelKey, PaymentOption[]>> = {
    paymentMethod: paymentMethodOptions,
    documentType: documentTypeOptions,
    locationId: locationOptions,
  };
  const chips = PANEL_KEYS.filter((key) => params[key]).map((key) => ({
    key,
    label: CHIP_LABELS[key],
    value: optionsByKey[key]?.find((o) => o.value === params[key])?.label ?? params[key]!,
  }));
  const sortValue = `${sort}:${dir}`;

  function selectField(
    key: PanelKey,
    label: string,
    options: PaymentOption[],
    allLabel: string,
  ): React.JSX.Element {
    return (
      <Field label={label}>
        <Select
          value={draft[key]}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        >
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  function textField(key: PanelKey, label: string): React.JSX.Element {
    return (
      <Field label={label}>
        <Input
          value={draft[key]}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          placeholder="Buscar…"
        />
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-slate-500">
          Ordenar
          <Select
            aria-label="Ordenar"
            value={SORT_OPTIONS.some((o) => o.value === sortValue) ? sortValue : ''}
            onChange={(e) => {
              const [column, direction] = e.target.value.split(':');
              navigate(
                column === 'createdAt' && direction === 'desc'
                  ? { sort: undefined, dir: undefined }
                  : { sort: column, dir: direction },
              );
            }}
            className="h-9 flex-1 text-sm"
          >
            {!SORT_OPTIONS.some((o) => o.value === sortValue) && (
              <option value="">Personalizado</option>
            )}
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setDraft(readPanel(params));
            setPanelOpen(true);
          }}
          className="shrink-0"
        >
          Filtros
          {chips.length > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1 text-xs font-semibold text-white">
              {chips.length}
            </span>
          )}
        </Button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtros activos">
          <span className={T.chipsLabel}>Activos:</span>
          {chips.map((chip) => (
            <span key={chip.key} className={T.chipAccent}>
              {chip.label}: <span className="font-semibold">{chip.value}</span>
              <button
                type="button"
                aria-label={`Quitar filtro ${chip.label}`}
                onClick={() => navigate({ [chip.key]: undefined })}
                className="ml-0.5 rounded px-1 hover:bg-emerald-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="flex items-baseline justify-between gap-2">
        <span className={T.count}>
          {count} registro{count === 1 ? '' : 's'} encontrado{count === 1 ? '' : 's'}
        </span>
        {payments.length > 0 && <span className={T.hint}>Toca un pago para ver el detalle</span>}
      </p>

      {payments.length === 0 ? (
        <p className={cn(T.card, 'p-6 text-center text-sm text-slate-500')}>{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {payments.map((p) => {
            const open = expanded === p.id;
            return (
              <li key={p.id} className={T.card}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : p.id)}
                  className="flex w-full flex-col gap-2 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={T.code}>{p.orderNumber}</span>
                      <span className={T.dot} aria-hidden="true">
                        •
                      </span>
                      <span className={T.stockLine}>{p.paidAtLabel}</span>
                    </span>
                    <span
                      title={p.returnNote ?? undefined}
                      className={cn(
                        'shrink-0',
                        T.price,
                        p.returnNote && 'rounded bg-red-600 px-1.5 py-0.5 !text-white',
                      )}
                    >
                      {p.amountLabel}
                    </span>
                  </span>
                  <span className={T.title}>{p.customerName}</span>
                  <span
                    className={cn(
                      'flex items-center justify-between gap-2 border-t pt-2',
                      T.divider,
                    )}
                  >
                    <span className={T.badgeNeutral}>{p.paymentMethodLabel}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      className={cn(
                        'h-5 w-5 shrink-0 transition-transform',
                        T.chevron,
                        open && 'rotate-180',
                      )}
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {open && (
                  <div className={cn('flex flex-col gap-3 rounded-b-2xl p-4', T.detail)}>
                    <div className="grid grid-cols-2 gap-2">
                      <DetailTile label="Vendedor">{p.sellerName}</DetailTile>
                      <DetailTile label="Tipo de documento">{p.documentLabel}</DetailTile>
                      <DetailTile label="Sucursal y almacén" wide>
                        {p.locationLabel}
                      </DetailTile>
                    </div>
                    {p.returnNote && (
                      <p className="text-xs font-medium text-red-700">{p.returnNote}</p>
                    )}
                    <Link href={`/sales/${p.orderId}`} className={T.primaryButton}>
                      Ver pedido
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="Filtros"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPanelOpen(false);
                navigate(Object.fromEntries(PANEL_KEYS.map((key) => [key, undefined])));
              }}
            >
              Limpiar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPanelOpen(false);
                navigate(
                  Object.fromEntries(
                    PANEL_KEYS.map((key) => [key, draft[key].trim() || undefined]),
                  ),
                );
              }}
            >
              Aplicar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {textField('orderNumber', 'N.º de orden')}
          {textField('customerName', 'Cliente')}
          {selectField('paymentMethod', 'Forma de pago', paymentMethodOptions, 'Todas')}
          {textField('amount', 'Monto')}
          {textField('sellerName', 'Vendedor')}
          {selectField('locationId', 'Almacén', locationOptions, 'Todos')}
          {selectField('documentType', 'Documento', documentTypeOptions, 'Todos')}
        </div>
      </Modal>
    </div>
  );
}
