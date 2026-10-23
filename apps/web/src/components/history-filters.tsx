'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CustomerSearchSelect } from './customer-search-select';
import { Field } from './ui/field';
import { Input, Select } from './ui/input';

/**
 * Shared filter bar of the history screens (Historial de ventas, Aprobaciones, Devoluciones): the
 * same Desde/Hasta behaviour everywhere and the same order of the rest — Almacén, Tipo de documento
 * (only where it applies), Estado, Cliente (only where it applies). One set of values drives both
 * the summary cards and the table of a screen; each control navigates with new search params (the
 * page param is dropped, so a filter change returns to page 1) and the server component re-fetches.
 *
 * Dates are calendar days in the tenant's timezone, sent as `dateFrom`/`dateTo` (`YYYY-MM-DD`). An
 * empty "Hasta" means "the same day as Desde"; "Desde" cannot be empty — clearing it returns to today.
 *
 * Almacén lists only the locations in the user's own scope (ADR-0024): an unrestricted user also
 * gets "Todos los almacenes"; a restricted user has no "all" option — with one location it is the
 * default, with several the first is.
 */
export interface HistoryFilterValues {
  /** Always set — the page resolves the default (today in the tenant timezone). */
  dateFrom: string;
  dateTo?: string | undefined;
  locationId?: string | undefined;
  /** Sucursal (warehouse) — narrows to every Almacén of it when no Almacén is chosen. */
  warehouseId?: string | undefined;
  status?: string | undefined;
  documentType?: string | undefined;
  customerId?: string | undefined;
  /** Historial de ventas only: the seller (user who placed the order). */
  placedByUserId?: string | undefined;
}

export interface FilterOption {
  value: string;
  label: string;
}

function useApply(basePath: string, preserve: Record<string, string> | undefined): (next: HistoryFilterValues) => void {
  const router = useRouter();
  return (next) => {
    const params = new URLSearchParams();
    params.set('dateFrom', next.dateFrom);
    if (next.dateTo && next.dateTo > next.dateFrom) params.set('dateTo', next.dateTo);
    if (next.warehouseId) params.set('warehouseId', next.warehouseId);
    if (next.locationId) params.set('locationId', next.locationId);
    if (next.status) params.set('status', next.status);
    if (next.documentType) params.set('documentType', next.documentType);
    if (next.customerId) params.set('customerId', next.customerId);
    if (next.placedByUserId) params.set('placedByUserId', next.placedByUserId);
    for (const [key, value] of Object.entries(preserve ?? {})) {
      if (value) params.set(key, value);
    }
    router.push(`${basePath}?${params}`);
  };
}

const CONTROL_HEIGHT = 'h-10';

const DATE_COMMIT_DELAY_MS = 700;

/** A complete, plausible calendar date — what a half-typed value (`0002-10-13` while the year is
 * still being typed) is not. */
function isCommittableDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * A date input that can be typed into. The old version navigated on every change event, and the
 * server re-render then reset the field to the stored value — so typing "13" wiped what you had
 * typed or kept only the last digit. This keeps what the user types in local state and only
 * commits (navigates) when it is safe: a complete valid date after a short pause, or whatever is
 * there when the field loses focus / Enter is pressed. Picking from the calendar commits the same way.
 * An empty value commits only on blur/Enter, never mid-typing.
 */
function DraftDateInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: string;
  min?: string | undefined;
  max?: string | undefined;
  onCommit: (next: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The stored value changed (navigation, reset): the draft follows it.
  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function commit(next: string): void {
    clearTimeout(timer.current);
    if (next === value) return;
    if (next === '' || isCommittableDate(next)) onCommit(next);
    else setDraft(value); // an unfinished/invalid date on blur: go back to the last good value
  }

  return (
    <Field label={label}>
      <Input
        type="date"
        className={CONTROL_HEIGHT}
        value={draft}
        min={min}
        max={max}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          clearTimeout(timer.current);
          if (isCommittableDate(next)) {
            timer.current = setTimeout(() => commit(next), DATE_COMMIT_DELAY_MS);
          }
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
    </Field>
  );
}

/** The Desde / Hasta inputs themselves (no wrapper), so they can sit either in the page header or
 * inside the filter grid. */
function DateFields({
  initial,
  today,
  apply,
}: {
  initial: HistoryFilterValues;
  today: string;
  apply: (next: HistoryFilterValues) => void;
}): React.JSX.Element {
  return (
    <>
      <DraftDateInput
        label="Desde"
        value={initial.dateFrom}
        max={initial.dateTo || undefined}
        onCommit={(next) => apply({ ...initial, dateFrom: next || today })}
      />
      <DraftDateInput
        label="Hasta"
        value={initial.dateTo ?? ''}
        min={initial.dateFrom}
        onCommit={(next) => apply({ ...initial, dateTo: next || undefined })}
      />
    </>
  );
}

/** Desde / Hasta rendered in the page header (top right) — used by Historial de ventas. */
export function HistoryDateFilters({
  basePath,
  initial,
  today,
  preserve,
}: {
  basePath: string;
  initial: HistoryFilterValues;
  today: string;
  preserve?: Record<string, string> | undefined;
}): React.JSX.Element {
  const apply = useApply(basePath, preserve);
  return (
    <div className="flex items-end gap-3">
      <DateFields initial={initial} today={today} apply={apply} />
    </div>
  );
}

/**
 * Sucursal + Almacén, rendered in the page header next to Desde/Hasta (Historial de ventas). Choosing
 * a Sucursal narrows the Almacén list to its own; an unrestricted user can leave Almacén on "Todos los
 * almacenes" (= every Almacén of that Sucursal), a restricted user is moved to the first Almacén of the
 * Sucursal. The Almacén list never offers a location outside the user's own scope.
 */
export function HistoryLocationFilters({
  basePath,
  initial,
  warehouses,
  locations,
  allowAll,
  preserve,
}: {
  basePath: string;
  initial: HistoryFilterValues;
  warehouses: { id: string; name: string }[];
  locations: { id: string; name: string; warehouseId: string }[];
  allowAll: boolean;
  preserve?: Record<string, string> | undefined;
}): React.JSX.Element {
  const apply = useApply(basePath, preserve);
  const visibleLocations = initial.warehouseId ? locations.filter((l) => l.warehouseId === initial.warehouseId) : locations;
  return (
    <div className="flex items-end gap-3">
      <Field label="Sucursal">
        <Select
          className={CONTROL_HEIGHT}
          value={initial.warehouseId ?? ''}
          onChange={(e) => {
            const warehouseId = e.target.value || undefined;
            const firstLocation = locations.find((l) => !warehouseId || l.warehouseId === warehouseId);
            apply({ ...initial, warehouseId, locationId: allowAll ? undefined : firstLocation?.id });
          }}
        >
          {allowAll && <option value="">Todas las sucursales</option>}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Almacén">
        <Select
          className={CONTROL_HEIGHT}
          value={initial.locationId ?? ''}
          onChange={(e) => {
            const locationId = e.target.value || undefined;
            apply({ ...initial, locationId, warehouseId: locations.find((l) => l.id === locationId)?.warehouseId ?? initial.warehouseId });
          }}
        >
          {allowAll && <option value="">Todos los almacenes</option>}
          {visibleLocations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function HistoryFilters({
  basePath,
  initial,
  today,
  defaultLocationId,
  defaultWarehouseId,
  hideLocation = false,
  locations,
  allowAllLocations,
  statusOptions,
  documentTypeOptions,
  canSearchCustomers = false,
  customerName,
  sellerOptions,
  preserve,
  includeDates = false,
}: {
  basePath: string;
  initial: HistoryFilterValues;
  /** Today in the tenant timezone — what "Desde" resets to. */
  today: string;
  /** The Almacén the page selects when none is chosen (undefined = "Todos"). */
  defaultLocationId: string | undefined;
  /** The Sucursal the page selects when none is chosen (only meaningful with `HistoryLocationFilters`). */
  defaultWarehouseId?: string | undefined;
  /** The Almacén select lives elsewhere (`HistoryLocationFilters` in the page header). */
  hideLocation?: boolean;
  locations: { id: string; name: string }[];
  allowAllLocations: boolean;
  statusOptions: FilterOption[];
  /** Omit on screens where the document type does not apply. */
  documentTypeOptions?: FilterOption[] | undefined;
  /** Shows the customer picker (Historial de ventas only). */
  canSearchCustomers?: boolean;
  customerName?: string | undefined;
  /** Shows the Vendedor picker (Historial de ventas, only for callers who may see every seller's sales). */
  sellerOptions?: FilterOption[] | undefined;
  preserve?: Record<string, string> | undefined;
  /** Put Desde/Hasta inside this bar (same row, after Estado) instead of in the page header. */
  includeDates?: boolean;
}): React.JSX.Element {
  const apply = useApply(basePath, preserve);
  const [customerLabel, setCustomerLabel] = useState(customerName ?? '');

  const isDefault =
    initial.dateFrom === today &&
    !initial.dateTo &&
    !initial.status &&
    !initial.documentType &&
    !initial.customerId &&
    !initial.placedByUserId &&
    initial.warehouseId === defaultWarehouseId &&
    initial.locationId === defaultLocationId;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!hideLocation && (
          <Field label="Almacén">
            <Select
              className={CONTROL_HEIGHT}
              value={initial.locationId ?? ''}
              onChange={(e) => apply({ ...initial, locationId: e.target.value || undefined })}
            >
              {allowAllLocations && <option value="">Todos los almacenes</option>}
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {documentTypeOptions && (
          <Field label="Tipo de documento">
            <Select
              className={CONTROL_HEIGHT}
              value={initial.documentType ?? ''}
              onChange={(e) => apply({ ...initial, documentType: e.target.value || undefined })}
            >
              <option value="">Cualquier documento</option>
              {documentTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Estado">
          <Select
            className={CONTROL_HEIGHT}
            value={initial.status ?? ''}
            onChange={(e) => apply({ ...initial, status: e.target.value || undefined })}
          >
            <option value="">Cualquier estado</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {includeDates && <DateFields initial={initial} today={today} apply={apply} />}

        {sellerOptions && (
          <Field label="Vendedor">
            <Select
              className={CONTROL_HEIGHT}
              value={initial.placedByUserId ?? ''}
              onChange={(e) => apply({ ...initial, placedByUserId: e.target.value || undefined })}
            >
              <option value="">Todos los vendedores</option>
              {sellerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {canSearchCustomers && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Cliente</span>
            <CustomerSearchSelect
              selected={
                initial.customerId
                  ? { id: initial.customerId, label: customerLabel || customerName || initial.customerId.slice(0, 8) }
                  : null
              }
              onSelect={(customer) => {
                setCustomerLabel(customer.displayName);
                apply({ ...initial, customerId: customer.id });
              }}
              onClear={() => {
                setCustomerLabel('');
                apply({ ...initial, customerId: undefined });
              }}
            />
          </div>
        )}
      </div>

      {!isDefault && (
        <div>
          <button
            type="button"
            onClick={() => {
              setCustomerLabel('');
              apply({ dateFrom: today, locationId: defaultLocationId, warehouseId: defaultWarehouseId });
            }}
            className="text-xs font-medium text-slate-500 hover:underline"
          >
            Restablecer filtros (hoy)
          </button>
        </div>
      )}
    </div>
  );
}
