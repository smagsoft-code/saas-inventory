'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  MOVEMENTS_SUMMARY_GROUP_BY,
  MOVEMENTS_SUMMARY_GROUP_BY_LABELS,
  type MovementsSummaryGroupBy,
} from '../../../../lib/types/inventory-reports';
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS, type MovementType } from '../../../../lib/types/inventory';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';

export interface MovementsReportFilterValues {
  from: string;
  to: string;
  groupBy: MovementsSummaryGroupBy;
  movementType?: MovementType | undefined;
}

/**
 * F18-07 report filters. Distinct URL params (`reportFrom`/`reportTo`/`reportGroupBy`/
 * `reportMovementType`) from the operational movement-list filters on the same page
 * (`occurredFrom`/`occurredTo`/`movementType`/`locationId`) — the report section is independent.
 * Same navigate-and-let-the-server-refetch pattern as `SalesReportFilters` (F18-02): no
 * client-side data fetching of its own.
 */
export function MovementsReportFilters({ initial }: { initial: MovementsReportFilterValues }): React.JSX.Element {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));
  const [groupBy, setGroupBy] = useState<MovementsSummaryGroupBy>(initial.groupBy);
  const [movementType, setMovementType] = useState<string>(initial.movementType ?? '');

  /** The picked "to" calendar date maps to the start of the *next* UTC day — `[from, to)` is
   * exclusive at `to`, so including the whole picked day means the boundary sits just past its end
   * (same as `SalesReportFilters`). */
  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: {
    from?: string;
    to?: string;
    groupBy?: MovementsSummaryGroupBy;
    movementType?: string;
  }): void {
    const params = new URLSearchParams();
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextGroupBy = next.groupBy ?? groupBy;
    const nextType = next.movementType ?? movementType;
    if (nextFrom) params.set('reportFrom', `${nextFrom}T00:00:00.000Z`);
    if (nextTo) params.set('reportTo', nextDayStart(nextTo));
    params.set('reportGroupBy', nextGroupBy);
    if (nextType) params.set('reportMovementType', nextType);
    router.push(`/inventory/movements?${params.toString()}#report`);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="From" hint="Tenant-local day start">
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

      <Field label="To" hint="Exclusive — up to, not including">
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

      <Field label="Group by">
        <Select
          value={groupBy}
          onChange={(e) => {
            const nextGroupBy = e.target.value as MovementsSummaryGroupBy;
            setGroupBy(nextGroupBy);
            apply({ groupBy: nextGroupBy });
          }}
        >
          {MOVEMENTS_SUMMARY_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {MOVEMENTS_SUMMARY_GROUP_BY_LABELS[g]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Movement type" hint="All types when blank">
        <Select
          value={movementType}
          onChange={(e) => {
            setMovementType(e.target.value);
            apply({ movementType: e.target.value });
          }}
        >
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
