'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from '../../../../lib/types/inventory';

export interface MovementsFilterValues {
  occurredFrom?: string | undefined;
  occurredTo?: string | undefined;
  locationId?: string | undefined;
  movementType?: string | undefined;
}

export interface MovementsLocationOption {
  id: string;
  /** Warehouse-prefixed ("Sucursal Centro — General") — two locations can share a bare name across
   * warehouses, the same disambiguation `kardex-all-movements.tsx`'s Almacén column already uses. */
  label: string;
}

/**
 * Desde/Hasta + Almacén + Tipo, one row (owner feedback: the almacén/tipo pill lists took two extra
 * rows below the dates and looked disconnected — grouped into two dropdowns at the same height as
 * the date filters). Replaces the standalone `MovementsDateFilter` plus the page's own chip lists.
 * Same navigate-and-let-the-server-refetch pattern as every other filter on this page: no
 * client-side fetching. `productVariantId` (a drill-in filter, not exposed here) and any other
 * existing param are preserved via `useSearchParams`; changing a filter always resets `page`.
 */
export function MovementsFilters({
  initial,
  locations,
}: {
  initial: MovementsFilterValues;
  locations: MovementsLocationOption[];
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(initial.occurredFrom?.slice(0, 10) ?? '');
  const [to, setTo] = useState(initial.occurredTo?.slice(0, 10) ?? '');
  const [locationId, setLocationId] = useState(initial.locationId ?? '');
  const [movementType, setMovementType] = useState(initial.movementType ?? '');

  // The URL is the source of truth: removing a chip or navigating back re-syncs the controls.
  useEffect(() => {
    setFrom(initial.occurredFrom?.slice(0, 10) ?? '');
    setTo(initial.occurredTo?.slice(0, 10) ?? '');
    setLocationId(initial.locationId ?? '');
    setMovementType(initial.movementType ?? '');
  }, [initial.occurredFrom, initial.occurredTo, initial.locationId, initial.movementType]);

  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: {
    from?: string;
    to?: string;
    locationId?: string;
    movementType?: string;
  }): void {
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextLocationId = next.locationId ?? locationId;
    const nextMovementType = next.movementType ?? movementType;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    if (nextFrom) {
      params.set('occurredFrom', `${nextFrom}T00:00:00.000Z`);
    } else {
      params.delete('occurredFrom');
    }
    if (nextTo) {
      params.set('occurredTo', nextDayStart(nextTo));
    } else {
      params.delete('occurredTo');
    }
    if (nextLocationId) {
      params.set('locationId', nextLocationId);
    } else {
      params.delete('locationId');
    }
    if (nextMovementType) {
      params.set('movementType', nextMovementType);
    } else {
      params.delete('movementType');
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Phone: the filters fold behind a filter icon (collapsed by default); the badge counts the active ones.
  const activeCount = [
    initial.occurredFrom,
    initial.occurredTo,
    initial.locationId,
    initial.movementType,
  ].filter(Boolean).length;
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="movements-filters-panel"
        aria-label={open ? 'Ocultar filtros' : 'Mostrar filtros'}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 self-start text-sm font-bold text-slate-900 md:hidden"
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
      <div
        id="movements-filters-panel"
        className={`${open ? 'grid' : 'hidden md:grid'} gap-3 sm:grid-cols-2 lg:grid-cols-4`}
      >
        <Field label="Desde" help="Ocurrido en o después de">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              apply({ from: e.target.value });
            }}
          />
        </Field>
        <Field label="Hasta" help="Hasta e incluyendo">
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              apply({ to: e.target.value });
            }}
          />
        </Field>
        <Field label="Almacén">
          <Select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              apply({ locationId: e.target.value });
            }}
          >
            <option value="">Todos los almacenes</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo">
          <Select
            value={movementType}
            onChange={(e) => {
              setMovementType(e.target.value);
              apply({ movementType: e.target.value });
            }}
          >
            <option value="">Todos los tipos</option>
            {MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
