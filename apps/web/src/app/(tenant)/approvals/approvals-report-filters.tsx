'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  APPROVALS_SUMMARY_GROUP_BY,
  APPROVALS_SUMMARY_GROUP_BY_LABELS,
  APPROVALS_SUMMARY_STATUSES,
  type ApprovalsSummaryGroupBy,
} from '../../../lib/types/approvals-reports';
import { PRICE_APPROVAL_STATUS_LABELS, type PriceApprovalStatus } from '../../../lib/types/sales';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface ApprovalsReportFilterValues {
  from: string;
  to: string;
  groupBy: ApprovalsSummaryGroupBy;
  status: string;
}

/**
 * F18-05 report filters — mirrors `ReturnsReportFilters` (F18-04) exactly, including its distinct
 * URL param naming (`reportFrom`/`reportTo`/`reportGroupBy`/`reportStatus`) so the report section's
 * params never collide with the approval-list filters (`status`/`orderId`) above it on the same
 * page. Same navigate-and-let-the-server-refetch pattern — no client-side data fetching of its own.
 *
 * Unlike the returns report, `status` has no default and an "All statuses" option is offered — the
 * approvals report's point is the outcome mix, so the unfiltered view is the primary one.
 */
export function ApprovalsReportFilters({ initial }: { initial: ApprovalsReportFilterValues }): React.JSX.Element {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));
  const [groupBy, setGroupBy] = useState<ApprovalsSummaryGroupBy>(initial.groupBy);
  const [status, setStatus] = useState(initial.status);

  /** [from, to) is exclusive at `to` — the picked "to" calendar date must map to the *start of the
   * next* UTC day, same reasoning `ReturnsReportFilters` documents. */
  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: { from?: string; to?: string; groupBy?: ApprovalsSummaryGroupBy; status?: string }): void {
    const params = new URLSearchParams();
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextGroupBy = next.groupBy ?? groupBy;
    const nextStatus = next.status ?? status;
    if (nextFrom) params.set('reportFrom', `${nextFrom}T00:00:00.000Z`);
    if (nextTo) params.set('reportTo', nextDayStart(nextTo));
    params.set('reportGroupBy', nextGroupBy);
    if (nextStatus) params.set('reportStatus', nextStatus);
    router.push(`/approvals?${params.toString()}#report`);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Desde" hint="Inicio de día en la zona horaria del tenant">
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
            const next = e.target.value as ApprovalsSummaryGroupBy;
            setGroupBy(next);
            apply({ groupBy: next });
          }}
        >
          {APPROVALS_SUMMARY_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {APPROVALS_SUMMARY_GROUP_BY_LABELS[g]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Estado">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            apply({ status: e.target.value });
          }}
        >
          <option value="">Todos los estados</option>
          {APPROVALS_SUMMARY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRICE_APPROVAL_STATUS_LABELS[s as PriceApprovalStatus] ?? s}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
