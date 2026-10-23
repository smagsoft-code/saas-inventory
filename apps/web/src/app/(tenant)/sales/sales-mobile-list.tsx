'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';
import { Modal } from '../../../components/ui/modal';
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

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'createdAt:desc', label: 'Más recientes' },
  { value: 'createdAt:asc', label: 'Más antiguos' },
  { value: 'total:desc', label: 'Total: mayor a menor' },
  { value: 'total:asc', label: 'Total: menor a mayor' },
  { value: 'customer:asc', label: 'Cliente A–Z' },
  { value: 'customer:desc', label: 'Cliente Z–A' },
];

/** Filters that appear as removable chips and that live in the "Filtros" panel (everything but the
 * dates, which stay in the page header, and `q`, which is the search box). */
const PANEL_KEYS = ['orderNumber', 'customerName', 'sellerName', 'total', 'documentType', 'locationId', 'status', 'notificationStatus'] as const;
type PanelKey = (typeof PANEL_KEYS)[number];

const CHIP_LABELS: Record<PanelKey, string> = {
  orderNumber: 'Pedido',
  customerName: 'Cliente',
  sellerName: 'Vendedor',
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

  useEffect(() => setSearch(params['q'] ?? ''), [params]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function navigate(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value && key !== 'page') next.set(key, value);
    }
    router.push(`/sales?${next}`);
  }

  const optionsByKey: Partial<Record<PanelKey, HeadOption[]>> = {
    documentType: documentTypeOptions,
    locationId: locationOptions,
    status: statusOptions,
    notificationStatus: notificationOptions,
  };
  const chips = PANEL_KEYS.filter((key) => params[key]).map((key) => ({
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
            timer.current = setTimeout(() => navigate({ q: next.trim() || undefined }), SEARCH_DEBOUNCE_MS);
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
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activos</span>
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700">
              {chip.label}: <span className="font-medium">{chip.value}</span>
              <button
                type="button"
                aria-label={`Quitar filtro ${chip.label}`}
                onClick={() => navigate({ [chip.key]: undefined })}
                className="ml-0.5 rounded-full px-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-slate-700">
          {count} registro{count === 1 ? '' : 's'} encontrado{count === 1 ? '' : 's'}
        </span>
        {orders.length > 0 && <span className="text-slate-400">Toca un pedido para ver el detalle</span>}
      </p>

      {orders.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Ningún pedido coincide con estos filtros.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => {
            const open = expanded === order.id;
            return (
              <li key={order.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : order.id)}
                  className="flex w-full flex-col gap-2 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{order.orderNumber}</span>
                      <span className="block text-xs text-slate-500">{order.createdAtLabel}</span>
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-slate-900">{order.totalLabel}</span>
                  </span>
                  <span className="flex items-end justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-700">{order.customerName}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={order.statusTone}>{order.statusLabel}</Badge>
                      {order.notificationLabel && <Badge tone={order.notificationTone}>{order.notificationLabel}</Badge>}
                      <span aria-hidden="true" className="text-slate-400">
                        {open ? '▴' : '▾'}
                      </span>
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-4">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Vendedor</dt>
                        <dd className="text-slate-900">{order.sellerName}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Tipo de documento</dt>
                        <dd className="text-slate-900">{order.documentLabel}</dd>
                      </div>
                      <div className="col-span-2 border-t border-slate-200 pt-3">
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Sucursal y almacén</dt>
                        <dd className="text-slate-900">{order.locationLabel}</dd>
                      </div>
                    </dl>
                    <Link
                      href={`/sales/${order.id}`}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                    >
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
                navigate(Object.fromEntries(PANEL_KEYS.map((key) => [key, draft[key].trim() || undefined])));
              }}
            >
              Aplicar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {textField('orderNumber', 'Pedido')}
          {textField('customerName', 'Cliente')}
          {textField('sellerName', 'Vendedor')}
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
  return Object.fromEntries(PANEL_KEYS.map((key) => [key, params[key] ?? ''])) as Record<PanelKey, string>;
}
