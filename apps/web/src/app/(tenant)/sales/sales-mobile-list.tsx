'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';
import { Modal } from '../../../components/ui/modal';
import { PRODUCTS_MOBILE_THEMES, type ProductsMobileTheme } from '../products/products-mobile-theme';
import type { HeadOption } from './sales-table-head';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/** One order, already formatted server-side (names, dates, labels) — this component only lays it out. */
export interface MobileOrder {
  id: string;
  orderNumber: string;
  createdAtLabel: string;
  customerName: string;
  sellerName: string;
  documentLabel: string;
  locationLabel: string;
  statusLabel: string;
  statusTone: Tone;
  /** `null` when the order has no notification (nothing to show). */
  notificationLabel: string | null;
  notificationTone: Tone;
  totalLabel: string;
}

const SEARCH_DEBOUNCE_MS = 400;

const T = PRODUCTS_MOBILE_THEMES.light;

/** A status/notification badge in the same rectangular style as Productos' badges. */
function badgeClass(t: ProductsMobileTheme, tone: Tone): string {
  return { success: t.badgeStock, warning: t.badgeWarn, danger: t.badgeOut, neutral: t.badgeNeutral }[tone];
}

/** A tile of the expanded detail — the same label/value pair Productos uses. */
function DetailTile({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }): React.JSX.Element {
  return (
    <div className={cn(T.tile, wide && 'col-span-2')}>
      <p className={T.tileLabel}>{label}</p>
      <p className={T.tileValue}>{children}</p>
    </div>
  );
}

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'createdAt:desc', label: 'Más recientes' },
  { value: 'createdAt:asc', label: 'Más antiguos' },
  { value: 'total:desc', label: 'Total: mayor a menor' },
  { value: 'total:asc', label: 'Total: menor a mayor' },
  { value: 'customer:asc', label: 'Cliente A–Z' },
  { value: 'customer:desc', label: 'Cliente Z–A' },
];

/** Filters that appear as removable chips and that live in the "Filtros" panel (everything but the
 * dates, which stay in the page header, and `q` — the search box, which already matches pedido,
 * cliente and vendedor, so those three have no field here). The button's count is exactly the number
 * of chips. */
const PANEL_KEYS = ['total', 'documentType', 'locationId', 'status', 'notificationStatus'] as const;
type PanelKey = (typeof PANEL_KEYS)[number];

const CHIP_LABELS: Record<PanelKey, string> = {
  total: 'Total',
  documentType: 'Documento',
  locationId: 'Almacén',
  status: 'Estado',
  notificationStatus: 'Notificación',
};

/**
 * The phone layout of the sales history (shown below `md`; the table keeps `md` and up): a search
 * box + "Filtros" button (with the number of active filters) + sort, the active filters as removable
 * chips, the record count, and one tappable card per order that expands to show who sold it, the
 * document type and "Sucursal · Almacén". Same data, same filters and same URL params as the table
 * header — only the presentation differs. Light theme, built from the app's own tokens.
 */
export function SalesMobileList({
  orders,
  count,
  params,
  sort,
  dir,
  documentTypeOptions,
  locationOptions,
  statusOptions,
  notificationOptions,
}: {
  orders: MobileOrder[];
  /** Total rows matching the filters (all pages). */
  count: number;
  /** Every URL param (dates, filters, sort) a control must keep when it changes one of them. */
  params: Record<string, string>;
  sort: string;
  dir: 'asc' | 'desc';
  documentTypeOptions: HeadOption[];
  locationOptions: HeadOption[];
  statusOptions: HeadOption[];
  notificationOptions: HeadOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Record<PanelKey, string>>(() => readPanel(params));
  const [search, setSearch] = useState(params['q'] ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // What the search box last sent to the URL. The server answers a moment later; if the user has kept
  // typing meanwhile, that answer (the OLDER text) must not overwrite the box. It is only adopted when
  // the URL's q is something this box did not send (back button, a link).
  const committedQ = useRef(params['q'] ?? '');
  useEffect(() => {
    const fromUrl = params['q'] ?? '';
    if (fromUrl !== committedQ.current) {
      committedQ.current = fromUrl;
      setSearch(fromUrl);
    }
  }, [params['q']]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function navigate(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value && key !== 'page') next.set(key, value);
    }
    router.push(`/sales?${next}`, { scroll: false });
  }

  const optionsByKey: Partial<Record<PanelKey, HeadOption[]>> = {
    documentType: documentTypeOptions,
    locationId: locationOptions,
    status: statusOptions,
    notificationStatus: notificationOptions,
  };
  // "Estado: Todos" (status=all) is the absence of a filter, so it is no chip and not counted.
  const chips = PANEL_KEYS.filter((key) => params[key] && !(key === 'status' && params[key] === 'all')).map((key) => ({
    key,
    label: CHIP_LABELS[key],
    value: optionsByKey[key]?.find((o) => o.value === params[key])?.label ?? params[key]!,
  }));
  const activeCount = chips.length;

  const sortValue = `${sort}:${dir}`;

  function openPanel(): void {
    setDraft(readPanel(params));
    setPanelOpen(true);
  }

  function selectField(key: PanelKey, label: string, options: HeadOption[], allLabel: string): React.JSX.Element {
    return (
      <Field label={label}>
        <Select value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}>
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
        <Input value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} placeholder="Buscar…" />
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          aria-label="Buscar por pedido, cliente o vendedor"
          placeholder="Buscar por pedido, cliente o vendedor"
          value={search}
          onChange={(e) => {
            const next = e.target.value;
            setSearch(next);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              committedQ.current = next.trim();
              navigate({ q: next.trim() || undefined });
            }, SEARCH_DEBOUNCE_MS);
          }}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="secondary" onClick={openPanel} className="shrink-0">
          Filtros
          {activeCount > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1 text-xs font-semibold text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
        Ordenar
        <Select
          aria-label="Ordenar"
          value={SORT_OPTIONS.some((o) => o.value === sortValue) ? sortValue : ''}
          onChange={(e) => {
            const [column, direction] = e.target.value.split(':');
            navigate(column === 'createdAt' && direction === 'desc' ? { sort: undefined, dir: undefined } : { sort: column, dir: direction });
          }}
          className="h-9 flex-1 text-sm"
        >
          {!SORT_OPTIONS.some((o) => o.value === sortValue) && <option value="">Personalizado</option>}
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtros activos">
          <span className={T.chipsLabel}>Activos:</span>
          {chips.map((chip) => (
            <span key={chip.key} className={T.chipAccent}>
              {chip.label}: <span className="font-semibold">{chip.value}</span>
              <button
                type="button"
                aria-label={`Quitar filtro ${chip.label}`}
                // Removing the Estado chip means "Todos" (explicit), not the default coming back.
                onClick={() => navigate({ [chip.key]: chip.key === 'status' ? 'all' : undefined })}
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
        {orders.length > 0 && <span className={T.hint}>Toca un pedido para ver el detalle</span>}
      </p>

      {orders.length === 0 ? (
        <p className={cn(T.card, 'p-6 text-center text-sm text-slate-500')}>Ningún pedido coincide con estos filtros.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => {
            const open = expanded === order.id;
            const cancelled = order.statusTone === 'danger';
            return (
              <li key={order.id} className={cancelled ? T.cardOut : T.card}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : order.id)}
                  className="flex w-full flex-col gap-2 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cancelled ? T.codeOut : T.code}>{order.orderNumber}</span>
                      <span className={T.dot} aria-hidden="true">
                        •
                      </span>
                      <span className={T.stockLine}>{order.createdAtLabel}</span>
                    </span>
                    <span className={cn('shrink-0', cancelled ? T.priceOut : T.price)}>{order.totalLabel}</span>
                  </span>
                  <span className={T.title}>{order.customerName}</span>
                  <span className={cn('flex items-center justify-between gap-2 border-t pt-2', T.divider)}>
                    <span className="flex flex-wrap gap-2">
                      <span className={badgeClass(T, order.statusTone)}>{order.statusLabel}</span>
                      {order.notificationLabel && <span className={badgeClass(T, order.notificationTone)}>{order.notificationLabel}</span>}
                    </span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={cn('h-5 w-5 shrink-0 transition-transform', T.chevron, open && 'rotate-180')} aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {open && (
                  <div className={cn('flex flex-col gap-3 rounded-b-2xl p-4', T.detail)}>
                    <div className="grid grid-cols-2 gap-2">
                      <DetailTile label="Vendedor">{order.sellerName}</DetailTile>
                      <DetailTile label="Tipo de documento">{order.documentLabel}</DetailTile>
                      <DetailTile label="Sucursal y almacén" wide>
                        {order.locationLabel}
                      </DetailTile>
                    </div>
                    <Link href={`/sales/${order.id}`} className={T.primaryButton}>
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
                navigate(Object.fromEntries(PANEL_KEYS.map((key) => [key, draft[key].trim() || (key === 'status' ? 'all' : undefined)])));
              }}
            >
              Aplicar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {textField('total', 'Total')}
          {selectField('documentType', 'Documento', documentTypeOptions, 'Todos')}
          {selectField('locationId', 'Almacén', locationOptions, 'Todos')}
          {selectField('status', 'Estado', statusOptions, 'Todos')}
          {selectField('notificationStatus', 'Notificación', notificationOptions, 'Todas')}
        </div>
      </Modal>
    </div>
  );
}

function readPanel(params: Record<string, string>): Record<PanelKey, string> {
  // status=all is "Todos": the select shows its empty option.
  return Object.fromEntries(PANEL_KEYS.map((key) => [key, key === 'status' && params[key] === 'all' ? '' : (params[key] ?? '')])) as Record<PanelKey, string>;
}
