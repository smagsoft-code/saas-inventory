'use client';

import { useRouter } from 'next/navigation';
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
    'Líneas',
    'En tránsito',
    'Creada',
  ];
  const numeric = new Set(['Líneas', 'En tránsito']);
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

/** The same three filters for the phone layout (the column headers are not shown there). */
export function TransfersMobileFilters({
  params,
  statusOptions,
  locationOptions,
}: TransfersFilterProps): React.JSX.Element {
  const navigate = useNavigate(params);
  return (
    <div className="grid grid-cols-1 gap-2">
      <SelectFilter
        label="estado"
        value={params['status'] ?? ''}
        options={statusOptions}
        allLabel="Todos los estados"
        className={PHONE_INPUT}
        onChange={(v) => navigate({ status: v || undefined })}
      />
      <SelectFilter
        label="almacén de origen"
        value={params['sourceLocationId'] ?? ''}
        options={locationOptions}
        allLabel="Origen: cualquiera"
        className={PHONE_INPUT}
        onChange={(v) => navigate({ sourceLocationId: v || undefined })}
      />
      <SelectFilter
        label="almacén de destino"
        value={params['destinationLocationId'] ?? ''}
        options={locationOptions}
        allLabel="Destino: cualquiera"
        className={PHONE_INPUT}
        onChange={(v) => navigate({ destinationLocationId: v || undefined })}
      />
    </div>
  );
}
