'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '../../../lib/cn';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/input';
import { Modal } from '../../../components/ui/modal';
import { mobileBadgeClass, PRODUCTS_MOBILE_THEMES } from '../products/products-mobile-theme';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/** One approval request, already formatted server-side (names, dates, labels) — this component only lays it out. */
export interface MobileApproval {
  id: string;
  orderId: string;
  orderNumber: string;
  requestedAtLabel: string;
  productName: string | null;
  locationLabel: string;
  requestedPriceLabel: string;
  discountLabel: string;
  reason: string;
  statusLabel: string;
  statusTone: Tone;
}

export interface ApprovalOption {
  value: string;
  label: string;
}

const T = PRODUCTS_MOBILE_THEMES.light;

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

/**
 * Phone layout of the approvals queue (shown below `md`; the table keeps `md` and up) — the same
 * format as the sales history: a "Filtros" button (with the number of active filters), the active
 * filters as removable chips, the record count, and one tappable card per request that expands to
 * show the almacén, the requested price, the discount and the reason, with the links to the request
 * and to its order. The date range stays in the page header (as in the history); the queue's own
 * filters are the almacén and the estado, with the same URL params as the filter bar.
 */
export function ApprovalsMobileList({
  approvals,
  count,
  params,
  statusOptions,
  locationOptions,
  allowAllLocations,
  defaultLocationId,
  empty,
}: {
  approvals: MobileApproval[];
  /** Total rows matching the filters (all pages). */
  count: number;
  /** Every URL param (dates, filters) a control must keep when it changes one of them. */
  params: Record<string, string>;
  statusOptions: ApprovalOption[];
  locationOptions: ApprovalOption[];
  /** An unrestricted user may leave Almacén on "Todos"; a restricted one always has one selected. */
  allowAllLocations: boolean;
  defaultLocationId: string | undefined;
  empty: string;
}): React.JSX.Element {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState({
    status: params['status'] ?? '',
    locationId: params['locationId'] ?? '',
  });

  function navigate(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value && key !== 'page') next.set(key, value);
    }
    router.push(`/approvals?${next}`, { scroll: false });
  }

  // The almacén the user is scoped to by default is not a filter they chose — no chip for it.
  const locationIsFilter =
    Boolean(params['locationId']) && params['locationId'] !== defaultLocationId;
  const chips = [
    ...(params['status']
      ? [
          {
            key: 'status',
            label: 'Estado',
            value:
              statusOptions.find((o) => o.value === params['status'])?.label ?? params['status'],
          },
        ]
      : []),
    ...(locationIsFilter
      ? [
          {
            key: 'locationId',
            label: 'Almacén',
            value:
              locationOptions.find((o) => o.value === params['locationId'])?.label ??
              params['locationId']!,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setDraft({ status: params['status'] ?? '', locationId: params['locationId'] ?? '' });
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
                onClick={() =>
                  navigate({
                    [chip.key]: chip.key === 'locationId' ? defaultLocationId : undefined,
                  })
                }
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
        {approvals.length > 0 && (
          <span className={T.hint}>Toca una solicitud para ver el detalle</span>
        )}
      </p>

      {approvals.length === 0 ? (
        <p className={cn(T.card, 'p-6 text-center text-sm text-slate-500')}>{empty}</p>
      ) : (
        <ul className="grid grid-cols-2 items-start gap-3">
          {approvals.map((a) => {
            const open = expanded === a.id;
            const rejected = a.statusTone === 'danger';
            return (
              <li key={a.id} className={cn(rejected ? T.cardOut : T.card, open && 'col-span-2')}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : a.id)}
                  className="flex w-full flex-col gap-2 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={rejected ? T.codeOut : T.code}>{a.orderNumber}</span>
                      <span className={T.stockLine}>{a.requestedAtLabel}</span>
                    </span>
                    <span className={cn('shrink-0', rejected ? T.priceOut : T.price)}>
                      {a.requestedPriceLabel}
                    </span>
                  </span>
                  <span className={T.title}>{a.productName ?? '—'}</span>
                  <span className="text-xs leading-snug text-slate-500">{a.reason}</span>
                  <span
                    className={cn(
                      'flex items-center justify-between gap-2 border-t pt-2',
                      T.divider,
                    )}
                  >
                    <span className={mobileBadgeClass(T, a.statusTone)}>{a.statusLabel}</span>
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
                      <DetailTile label="P. solicitado">{a.requestedPriceLabel}</DetailTile>
                      <DetailTile label="Descuento">{a.discountLabel}</DetailTile>
                      <DetailTile label="Almacén" wide>
                        {a.locationLabel}
                      </DetailTile>
                    </div>
                    <Link href={`/approvals/${a.id}`} className={T.primaryButton}>
                      Ver solicitud
                    </Link>
                    <Link
                      href={`/sales/${a.orderId}`}
                      className="text-center text-sm font-medium text-slate-600 underline underline-offset-2"
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
                navigate({ status: undefined, locationId: defaultLocationId });
              }}
            >
              Limpiar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPanelOpen(false);
                navigate({
                  status: draft.status || undefined,
                  locationId: draft.locationId || undefined,
                });
              }}
            >
              Aplicar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Estado">
            <Select
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
            >
              <option value="">Todos</option>
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Almacén">
            <Select
              value={draft.locationId}
              onChange={(e) => setDraft((d) => ({ ...d, locationId: e.target.value }))}
            >
              {allowAllLocations && <option value="">Todos los almacenes</option>}
              {locationOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
