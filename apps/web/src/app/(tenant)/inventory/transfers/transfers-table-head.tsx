'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { THead, TH, TR } from '../../../../components/ui/table';

export interface TransfersHeadOption {
  value: string;
  label: string;
}

/** Compact, like the other column filters (sales history): small height, 11px text, `min-w-0`. */
const HEAD_INPUT =
  'h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] font-normal normal-case tracking-normal text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';
const PHONE_INPUT =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900';

/** Column widths (sum 100%) — the table is `table-fixed`, so it always fits its container. */
const COLUMN_WIDTHS = [
  'w-[16%]',
  'w-[13%]',
  'w-[17%]',
  'w-[17%]',
  'w-[8%]',
  'w-[11%]',
  'w-[11%]',
  'w-[7%]',
] as const;

export interface TransfersFilterProps {
  /** Every search param in the URL that must survive a change (`all`, filters). */
  params: Record<string, string>;
  statusOptions: TransfersHeadOption[];
  locationOptions: TransfersHeadOption[];
}

/** Changing a filter navigates at once (no "Aplicar"); the page param is dropped → back to page 1. */
function useNavigate(
  params: Record<string, string>,
): (patch: Record<string, string | undefined>) => void {
  const router = useRouter();
  return (patch) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value && key !== 'page') next.set(key, value);
    }
    router.push(`/inventory/transfers${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };
}

function SelectFilter({
  label,
  value,
  options,
  allLabel,
  className,
  onChange,
}: {
  label: string;
  value: string;
  options: TransfersHeadOption[];
  allLabel: string;
  className: string;
  onChange: (next: string) => void;
}): React.JSX.Element {
  return (
    <select
      aria-label={`Filtrar por ${label}`}
      className={className}
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
 * The header of the transfers table: a titles row and, right below, a filter row — Estado, Origen
 * and Destino are the only filters the endpoint supports, so only those columns carry a control.
 * Replaces the form + "Aplicar" button that used to sit above the table.
 */
export function TransfersTableHead({
  params,
  statusOptions,
  locationOptions,
}: TransfersFilterProps): React.JSX.Element {
  const navigate = useNavigate(params);
  const titles = [
    'Transferencia',
    'Estado',
    'Origen',
    'Destino',
    'Productos',
    'En tránsito',
    'Creada',
  ];
  const numeric = new Set(['Productos', 'En tránsito']);
  return (
    <THead>
      <TR className="hover:bg-transparent">
        {titles.map((title, i) => (
          <TH
            key={title}
            className={`!whitespace-normal !px-2 !text-[11px] ${COLUMN_WIDTHS[i]} ${numeric.has(title) ? 'text-right' : ''}`}
          >
            {title}
          </TH>
        ))}
        <TH className={COLUMN_WIDTHS[7]}>
          <span className="sr-only">Acciones</span>
        </TH>
      </TR>
      <TR className="hover:bg-transparent">
        <TH className="!px-2 pb-2">{null}</TH>
        <TH className="!px-2 pb-2">
          <SelectFilter
            label="estado"
            value={params['status'] ?? ''}
            options={statusOptions}
            allLabel="Todos"
            className={HEAD_INPUT}
            onChange={(v) => navigate({ status: v || undefined })}
          />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter
            label="origen"
            value={params['sourceLocationId'] ?? ''}
            options={locationOptions}
            allLabel="Todos"
            className={HEAD_INPUT}
            onChange={(v) => navigate({ sourceLocationId: v || undefined })}
          />
        </TH>
        <TH className="!px-2 pb-2">
          <SelectFilter
            label="destino"
            value={params['destinationLocationId'] ?? ''}
            options={locationOptions}
            allLabel="Todos"
            className={HEAD_INPUT}
            onChange={(v) => navigate({ destinationLocationId: v || undefined })}
          />
        </TH>
        <TH className="!px-2 pb-2">{null}</TH>
        <TH className="!px-2 pb-2">{null}</TH>
        <TH className="!px-2 pb-2">{null}</TH>
        <TH className="!px-2 pb-2">{null}</TH>
      </TR>
    </THead>
  );
}

/**
 * The phone layout's filter card (the column headers are not shown there): the same three filters
 * as the table head, with the export icons () in the card's header, like the other phone
 * screens. Applies on change.
 */
export function TransfersMobileFilters({
  params,
  statusOptions,
  locationOptions,
  actions,
}: TransfersFilterProps & { actions?: React.ReactNode }): React.JSX.Element {
  const navigate = useNavigate(params);
  // Collapsed by default so the list is reachable at once; the badge counts the filters in the URL.
  const [open, setOpen] = useState(false);
  const activeCount = [
    'status',
    'sourceLocationId',
    'destinationLocationId',
    'createdFrom',
    'createdTo',
  ].filter((key) => Boolean(params[key])).length;
  const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500';
  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-label="Filtros"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="transfers-filters-panel"
          aria-label={open ? 'Ocultar filtros' : 'Mostrar filtros'}
          onClick={() => setOpen((current) => !current)}
          className="flex items-center gap-2 text-sm font-bold text-slate-900"
        >
          <span className="relative flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" />
            </svg>
            {activeCount > 0 && (
              <span
                className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white"
                aria-label={`${activeCount} filtros activos`}
              >
                {activeCount}
              </span>
            )}
          </span>
          Filtros
          <span
            aria-hidden="true"
            className={`text-xs text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
        {actions}
      </div>
      {open && (
        <div id="transfers-filters-panel" className="flex flex-col gap-3">
          <label className="block">
            <span className={label}>Estado</span>
            <SelectFilter
              label="estado"
              value={params['status'] ?? ''}
              options={statusOptions}
              allLabel="Todos los estados"
              className={PHONE_INPUT}
              onChange={(v) => navigate({ status: v || undefined })}
            />
          </label>
          <TransfersDateFilters params={params} />
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className={label}>Origen</span>
              <SelectFilter
                label="almacén de origen"
                value={params['sourceLocationId'] ?? ''}
                options={locationOptions}
                allLabel="Cualquiera"
                className={PHONE_INPUT}
                onChange={(v) => navigate({ sourceLocationId: v || undefined })}
              />
            </label>
            <label className="block min-w-0">
              <span className={label}>Destino</span>
              <SelectFilter
                label="almacén de destino"
                value={params['destinationLocationId'] ?? ''}
                options={locationOptions}
                allLabel="Cualquiera"
                className={PHONE_INPUT}
                onChange={(v) => navigate({ destinationLocationId: v || undefined })}
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}

function nextDayStart(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/**
 * Desde / Hasta — the same date filter as Movimientos: calendar days sent as the half-open range
 * [createdFrom, createdTo) on the transfer's creation date (`Hasta` includes its whole day).
 * Applies on change; the URL is the source of truth, so the inputs re-sync when it changes.
 */
export function TransfersDateFilters({
  params,
  className,
  inline = false,
}: {
  params: Record<string, string>;
  className?: string;
  inline?: boolean;
}): React.JSX.Element {
  const navigate = useNavigate(params);
  const urlFrom = params['createdFrom']?.slice(0, 10) ?? '';
  // createdTo is stored as the exclusive next-day start; show the inclusive day the user picked.
  const urlTo = params['createdTo']
    ? new Date(new Date(params['createdTo']).getTime() - 86_400_000).toISOString().slice(0, 10)
    : '';
  const [from, setFrom] = useState(urlFrom);
  const [to, setTo] = useState(urlTo);
  useEffect(() => {
    setFrom(urlFrom);
    setTo(urlTo);
  }, [urlFrom, urlTo]);
  // Same look as the Movimientos date filter: label above, standard field with the calendar icon.
  return (
    <div
      className={`${inline ? 'flex items-end gap-3' : 'grid grid-cols-2 gap-2'} ${className ?? ''}`}
    >
      <Field label="Desde">
        <Input
          type="date"
          value={from}
          max={to || undefined}
          className={inline ? 'w-44' : undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            navigate({
              createdFrom: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined,
            });
          }}
        />
      </Field>
      <Field label="Hasta">
        <Input
          type="date"
          value={to}
          min={from || undefined}
          className={inline ? 'w-44' : undefined}
          onChange={(e) => {
            setTo(e.target.value);
            navigate({ createdTo: e.target.value ? nextDayStart(e.target.value) : undefined });
          }}
        />
      </Field>
    </div>
  );
}
