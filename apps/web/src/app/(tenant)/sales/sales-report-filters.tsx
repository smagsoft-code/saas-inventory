'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  SALES_SUMMARY_EXCEPTIONAL,
  SALES_SUMMARY_EXCEPTIONAL_LABELS,
  SALES_SUMMARY_GROUP_BY,
  SALES_SUMMARY_GROUP_BY_LABELS,
  type SalesSummaryExceptional,
  type SalesSummaryGroupBy,
} from '../../../lib/types/reports';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface SalesReportFilterValues {
  from: string;
  to: string;
  groupBy: SalesSummaryGroupBy;
  exceptional: SalesSummaryExceptional;
}

/**
 * F18-02 report filters. Distinct URL params (`reportFrom`/`reportTo`/`reportGroupBy`) from the
 * order-history filters above it on the same page (`createdFrom`/`createdTo`/`status`) — the two
 * sections are independent. Same navigate-and-let-the-server-refetch pattern as `SalesFilters`
 * (F17-09): no client-side data fetching, no loading spinner of its own — Next's route-level
 * `loading.tsx` covers the whole-page navigation.
 */
export function SalesReportFilters({ initial }: { initial: SalesReportFilterValues }): React.JSX.Element {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));
  const [groupBy, setGroupBy] = useState<SalesSummaryGroupBy>(initial.groupBy);
  const [exceptional, setExceptional] = useState<SalesSummaryExceptional>(initial.exceptional);

  /** The picked "to" calendar date must map to the *start of the next* UTC day — [from, to) is
   * exclusive at `to`, so including the whole day the user picked means the boundary sits just
   * past its end, not at its start (unlike the operational Sales History filter above, which uses
   * an inclusive-both-bounds endpoint and so sends `T23:59:59.999Z` instead). */
  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: {
    from?: string;
    to?: string;
    groupBy?: SalesSummaryGroupBy;
    exceptional?: SalesSummaryExceptional;
  }): void {
    const params = new URLSearchParams();
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextGroupBy = next.groupBy ?? groupBy;
    const nextExceptional = next.exceptional ?? exceptional;
    if (nextFrom) params.set('reportFrom', `${nextFrom}T00:00:00.000Z`);
    if (nextTo) params.set('reportTo', nextDayStart(nextTo));
    params.set('reportGroupBy', nextGroupBy);
    // `all` is the default — keep it out of the URL so a plain /sales visit stays clean.
    if (nextExceptional !== 'all') params.set('reportExceptional', nextExceptional);
    router.push(`/sales?${params.toString()}#report`);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
      <Field label="Desde" hint="Inicio del día local del tenant">
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

      <Field label="Hasta" hint="Exclusivo — hasta, sin incluir">
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

      <Field label="Agrupar por">
        <Select
          value={groupBy}
          onChange={(e) => {
            const next = e.target.value as SalesSummaryGroupBy;
            setGroupBy(next);
            apply({ groupBy: next });
          }}
        >
          {SALES_SUMMARY_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {SALES_SUMMARY_GROUP_BY_LABELS[g]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Descuento excepcional" hint="Líneas de venta bajo el piso">
        <Select
          value={exceptional}
          onChange={(e) => {
            const next = e.target.value as SalesSummaryExceptional;
            setExceptional(next);
            apply({ exceptional: next });
          }}
        >
          {SALES_SUMMARY_EXCEPTIONAL.map((x) => (
            <option key={x} value={x}>
              {SALES_SUMMARY_EXCEPTIONAL_LABELS[x]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
