'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { THead, TH, TR } from '../../../components/ui/table';

export interface HeadOption {
  value: string;
  label: string;
}

export type SalesSortColumn =
  | 'orderNumber'
  | 'createdAt'
  | 'customer'
  | 'seller'
  | 'documentType'
  | 'location'
  | 'status'
  | 'total'
  | 'notification';

const TEXT_DEBOUNCE_MS = 400;

/** Compact on purpose: small height, 11px text, `min-w-0` so a long option ("Sucursal · Almacén") can never widen its column. */
const HEAD_INPUT =
  'h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] font-normal normal-case tracking-normal text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

/** Column widths (sum 100%) — the table is `table-fixed`, so it always fits its container. */
const COLUMN_WIDTHS = ['w-[9%]', 'w-[9%]', 'w-[13%]', 'w-[12%]', 'w-[10%]', 'w-[14%]', 'w-[9%]', 'w-[11%]', 'w-[9%]', 'w-[4%]'] as const;

/** A text filter cell: keeps what is typed locally and navigates once typing pauses (the server
 * re-render must never overwrite a half-typed value — same lesson as `DraftDateInput`). */
function TextFilter({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The stored value changed from outside (reset, other navigation): the draft follows it.
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      type="search"
      aria-label={`Filtrar por ${label}`}
      placeholder="Buscar…"
      className={HEAD_INPUT}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(next.trim()), TEXT_DEBOUNCE_MS);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          clearTimeout(timer.current);
          onCommit((e.target as HTMLInputElement).value.trim());
        }
      }}
    />
  );
}

function SelectFilter({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: HeadOption[];
  allLabel: string;
  onChange: (next: string) => void;
}): React.JSX.Element {
  return (
    <select
      aria-label={`Filtrar por ${label}`}
      className={HEAD_INPUT}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The header of the sales-history table: a titles row — each sortable title carries the ↑/↓ toggle
 * (same control as the Kardex "Fecha del movimiento" column) — and, right below, a filter row with
 * one cell per column: free-text search for Pedido / Cliente / Vendedor / Total, a drop-down for
 * Documento / Almacén / Estado / Notificación. These replace the filter bar that used to sit above
 * the table; only Desde/Hasta stay up there. Every control navigates with new search params (page
 * dropped, so a change returns to page 1) and the server component re-fetches.
 */
export function SalesTableHead({
  params,
  sort,
  dir,
  documentTypeOptions,
  locationOptions,
  statusOptions,
  notificationOptions,
}: {
  /** Every search param currently in the URL that must survive a change (dates, filters, sort). */
  params: Record<string, string>;
  sort: SalesSortColumn;
  dir: 'asc' | 'desc';
  documentTypeOptions: HeadOption[];
  locationOptions: HeadOption[];
  statusOptions: HeadOption[];
  notificationOptions: HeadOption[];
}): React.JSX.Element {
  const router = useRouter();

  function navigate(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value && key !== 'page') next.set(key, value);
    }
    router.push(`/sales?${next}`);
  }

  function toggleSort(column: SalesSortColumn): void {
    const nextDir = sort === column ? (dir === 'asc' ? 'desc' : 'asc') : 'asc';
    // The default order (newest first) is not written to the URL.
    navigate(column === 'createdAt' && nextDir === 'desc' ? { sort: undefined, dir: undefined } : { sort: column, dir: nextDir });
  }

  function Title({ column, children, className }: { column: SalesSortColumn; children: string; className?: string }): React.JSX.Element {
    const active = sort === column;
    return (
      <TH className={`!whitespace-normal !px-2 !text-[11px] ${className ?? ''}`}>
        <span className="flex items-center gap-1">
          {children}
          <button
            type="button"
            onClick={() => toggleSort(column)}
            title={active ? (dir === 'asc' ? 'Orden ascendente — clic para invertir' : 'Orden descendente — clic para invertir') : 'Ordenar'}
            aria-label={`Ordenar por ${children}`}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded normal-case hover:bg-white/20 ${active ? 'text-white' : 'text-white/40'}`}
          >
            {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
          </button>
        </span>
      </TH>
    );
  }

  const text = (key: string): string => params[key] ?? '';

  return (
    <THead>
      <TR className="hover:bg-transparent">
        <Title column="orderNumber" className={COLUMN_WIDTHS[0]}>Pedido</Title>
        <Title column="createdAt" className={COLUMN_WIDTHS[1]}>Fecha</Title>
        <Title column="customer" className={COLUMN_WIDTHS[2]}>Cliente</Title>
        <Title column="seller" className={COLUMN_WIDTHS[3]}>Vendedor</Title>
        <Title column="documentType" className={COLUMN_WIDTHS[4]}>Documento</Title>
        <Title column="location" className={COLUMN_WIDTHS[5]}>Almacén</Title>
        <Title column="status" className={COLUMN_WIDTHS[6]}>Estado</Title>
        <Title column="notification" className={COLUMN_WIDTHS[7]}>Notificación</Title>
        <Title column="total" className={COLUMN_WIDTHS[8]}>Total</Title>
        <TH className={COLUMN_WIDTHS[9]}>
          <span className="sr-only">Acciones</span>
        </TH>
      </TR>
      <TR className="hover:bg-transparent">
        <TH className="!px-2 pb-2">
          <TextFilter label="pedido" value={text('orderNumber')} onCommit={(v) => navigate({ orderNumber: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">{null}</TH>
        <TH className="!px-2 pb-2">
          <TextFilter label="cliente" value={text('customerName')} onCommit={(v) => navigate({ customerName: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <TextFilter label="vendedor" value={text('sellerName')} onCommit={(v) => navigate({ sellerName: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter label="documento" value={text('documentType')} options={documentTypeOptions} allLabel="Todos" onChange={(v) => navigate({ documentType: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter label="almacén" value={text('locationId')} options={locationOptions} allLabel="Todos" onChange={(v) => navigate({ locationId: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter label="estado" value={text('status')} options={statusOptions} allLabel="Todos" onChange={(v) => navigate({ status: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter label="notificación" value={text('notificationStatus')} options={notificationOptions} allLabel="Todas" onChange={(v) => navigate({ notificationStatus: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <TextFilter label="total" value={text('total')} onCommit={(v) => navigate({ total: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">{null}</TH>
      </TR>
    </THead>
  );
}
