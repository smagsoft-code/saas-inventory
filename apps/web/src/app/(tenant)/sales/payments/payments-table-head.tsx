'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { THead, TH, TR } from '../../../../components/ui/table';
import type { PaymentSortColumn } from '../../../../lib/types/payments-report';

export interface PaymentHeadOption {
  value: string;
  label: string;
}

const TEXT_DEBOUNCE_MS = 400;

const HEAD_INPUT =
  'h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] font-normal normal-case tracking-normal text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

/** Column widths (sum 100%) — the table is `table-fixed`, so it always fits its container. */
const COLUMN_WIDTHS = ['w-[11%]', 'w-[9%]', 'w-[15%]', 'w-[11%]', 'w-[10%]', 'w-[14%]', 'w-[18%]', 'w-[12%]'] as const;

function TextFilter({ label, value, onCommit }: { label: string; value: string; onCommit: (next: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // What this box last sent. The server answers later; if typing continued meanwhile, that older
  // value must not overwrite the box — only a value this box did not send (reset, back button) does.
  const sent = useRef(value);
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setDraft(value);
    }
  }, [value]);
  function commit(next: string): void {
    sent.current = next;
    onCommit(next);
  }
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
        timer.current = setTimeout(() => commit(next.trim()), TEXT_DEBOUNCE_MS);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          clearTimeout(timer.current);
          commit((e.target as HTMLInputElement).value.trim());
        }
      }}
    />
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PaymentHeadOption[];
  onChange: (next: string) => void;
}): React.JSX.Element {
  return (
    <select aria-label={`Filtrar por ${label}`} className={HEAD_INPUT} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Todos</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Header of the payment-method report table — the same two-row pattern as the sales history
 * (`SalesTableHead`): sortable titles (↑/↓ toggle) and, right below, one filter cell per column.
 * Every control navigates with new search params (page dropped) and the server component re-fetches.
 */
export function PaymentsTableHead({
  params,
  sort,
  dir,
  paymentMethodOptions,
  documentTypeOptions,
  locationOptions,
}: {
  /** Every search param currently in the URL that must survive a change (dates, filters, sort). */
  params: Record<string, string>;
  sort: PaymentSortColumn;
  dir: 'asc' | 'desc';
  paymentMethodOptions: PaymentHeadOption[];
  documentTypeOptions: PaymentHeadOption[];
  locationOptions: PaymentHeadOption[];
}): React.JSX.Element {
  const router = useRouter();

  function navigate(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value && key !== 'page') next.set(key, value);
    }
    router.push(`/sales/payments?${next}`, { scroll: false });
  }

  function toggleSort(column: PaymentSortColumn): void {
    const nextDir = sort === column ? (dir === 'asc' ? 'desc' : 'asc') : 'asc';
    // The default order (newest payment first) is not written to the URL.
    navigate(column === 'createdAt' && nextDir === 'desc' ? { sort: undefined, dir: undefined } : { sort: column, dir: nextDir });
  }

  function Title({ column, children, className }: { column: PaymentSortColumn; children: string; className?: string }): React.JSX.Element {
    const active = sort === column;
    return (
      <TH className={`!whitespace-normal !px-2 !text-[11px] ${className ?? ''}`}>
        <span className="flex items-center gap-1">
          <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
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
        <Title column="createdAt" className={COLUMN_WIDTHS[0]}>Fecha de pago</Title>
        <Title column="orderNumber" className={COLUMN_WIDTHS[1]}>N.º de orden</Title>
        <Title column="customer" className={COLUMN_WIDTHS[2]}>Cliente</Title>
        <Title column="paymentMethod" className={COLUMN_WIDTHS[3]}>Forma de pago</Title>
        <Title column="amount" className={`${COLUMN_WIDTHS[4]} text-right`}>Monto</Title>
        <Title column="seller" className={COLUMN_WIDTHS[5]}>Vendedor</Title>
        <Title column="location" className={COLUMN_WIDTHS[6]}>Almacén</Title>
        <Title column="documentType" className={COLUMN_WIDTHS[7]}>Documento</Title>
      </TR>
      <TR className="hover:bg-transparent">
        <TH className="!px-2 pb-2">{null}</TH>
        <TH className="!px-2 pb-2">
          <TextFilter label="n.º de orden" value={text('orderNumber')} onCommit={(v) => navigate({ orderNumber: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <TextFilter label="cliente" value={text('customerName')} onCommit={(v) => navigate({ customerName: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter label="forma de pago" value={text('paymentMethod')} options={paymentMethodOptions} onChange={(v) => navigate({ paymentMethod: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <TextFilter label="monto" value={text('amount')} onCommit={(v) => navigate({ amount: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <TextFilter label="vendedor" value={text('sellerName')} onCommit={(v) => navigate({ sellerName: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter label="almacén" value={text('locationId')} options={locationOptions} onChange={(v) => navigate({ locationId: v || undefined })} />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter label="documento" value={text('documentType')} options={documentTypeOptions} onChange={(v) => navigate({ documentType: v || undefined })} />
        </TH>
      </TR>
    </THead>
  );
}
