'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RETURNS_SUMMARY_GROUP_BY, RETURNS_SUMMARY_GROUP_BY_LABELS, type ReturnsSummaryGroupBy } from '../../../lib/types/returns-reports';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface ReturnsReportFilterValues {
  from: string;
  to: string;
  groupBy: ReturnsSummaryGroupBy;
}

/**
 * F18-04 report filters — mirrors `SalesReportFilters` (F18-02) exactly, including its distinct
 * URL param naming (`reportFrom`/`reportTo`/`reportGroupBy`) so the report section's params never
 * collide with the returns-list filters (`status`/`orderId`) above it on the same page. Same
 * navigate-and-let-the-server-refetch pattern — no client-side data fetching of its own.
 */
export function ReturnsReportFilters({ initial }: { initial: ReturnsReportFilterValues }): React.JSX.Element {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));
  const [groupBy, setGroupBy] = useState<ReturnsSummaryGroupBy>(initial.groupBy);

  /** [from, to) is exclusive at `to` — the picked "to" calendar date must map to the *start of the
   * next* UTC day, same reasoning `SalesReportFilters` documents. */
  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: { from?: string; to?: string; groupBy?: ReturnsSummaryGroupBy }): void {
    const params = new URLSearchParams();
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextGroupBy = next.groupBy ?? groupBy;
    if (nextFrom) params.set('reportFrom', `${nextFrom}T00:00:00.000Z`);
    if (nextTo) params.set('reportTo', nextDayStart(nextTo));
    params.set('reportGroupBy', nextGroupBy);
    router.push(`/returns?${params.toString()}#report`);
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
            const next = e.target.value as ReturnsSummaryGroupBy;
            setGroupBy(next);
            apply({ groupBy: next });
          }}
        >
          {RETURNS_SUMMARY_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {RETURNS_SUMMARY_GROUP_BY_LABELS[g]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
