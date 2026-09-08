'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  IMPORTS_SUMMARY_GROUP_BY,
  IMPORTS_SUMMARY_GROUP_BY_LABELS,
  type ImportsSummaryGroupBy,
} from '../../../lib/types/imports-reports';
import { IMPORT_JOB_STATUSES, IMPORT_JOB_STATUS_LABELS, type ImportJobStatus } from '../../../lib/types/imports';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface ImportsReportFilterValues {
  from: string;
  to: string;
  groupBy: ImportsSummaryGroupBy;
  status: string;
}

/**
 * F18-09 report filters — mirrors `ApprovalsReportFilters` (F18-05) exactly, including its distinct
 * URL param naming (`reportFrom`/`reportTo`/`reportGroupBy`/`reportStatus`) so the report section's
 * params never collide with the operational job-list `status` chip above it on `/imports`. Same
 * navigate-and-let-the-server-refetch pattern — no client-side data fetching of its own.
 *
 * `status` has no default (an "All statuses" option is offered) — the report's period grouping is
 * anchored on `completed_at`, so it already shows only terminal jobs and the outcome-mix view is
 * the primary one.
 */
export function ImportsReportFilters({ initial }: { initial: ImportsReportFilterValues }): React.JSX.Element {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));
  const [groupBy, setGroupBy] = useState<ImportsSummaryGroupBy>(initial.groupBy);
  const [status, setStatus] = useState(initial.status);

  /** [from, to) is exclusive at `to` — the picked "to" calendar date must map to the *start of the
   * next* UTC day, same reasoning `ApprovalsReportFilters` documents. */
  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: { from?: string; to?: string; groupBy?: ImportsSummaryGroupBy; status?: string }): void {
    const params = new URLSearchParams();
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextGroupBy = next.groupBy ?? groupBy;
    const nextStatus = next.status ?? status;
    if (nextFrom) params.set('reportFrom', `${nextFrom}T00:00:00.000Z`);
    if (nextTo) params.set('reportTo', nextDayStart(nextTo));
    params.set('reportGroupBy', nextGroupBy);
    if (nextStatus) params.set('reportStatus', nextStatus);
    router.push(`/imports?${params.toString()}#report`);
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
            const next = e.target.value as ImportsSummaryGroupBy;
            setGroupBy(next);
            apply({ groupBy: next });
          }}
        >
          {IMPORTS_SUMMARY_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {IMPORTS_SUMMARY_GROUP_BY_LABELS[g]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Status" hint="Completed jobs only">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            apply({ status: e.target.value });
          }}
        >
          <option value="">All statuses</option>
          {IMPORT_JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {IMPORT_JOB_STATUS_LABELS[s as ImportJobStatus] ?? s}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
