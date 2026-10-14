'use client';

import { useRouter } from 'next/navigation';
import { PRICE_APPROVAL_STATUSES, PRICE_APPROVAL_STATUS_LABELS } from '../../../lib/types/sales';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/input';

/**
 * The queue's own status filter — a single "Estado" `<Select>` replacing what used to be a row of
 * five separate chip links (Todos los estados / Pendiente / Aprobada / Rechazada / Cancelada),
 * same "one control instead of several buttons" consolidation `ImportsFilters` already applied to
 * the imports Historial list. Independent of `ApprovalsReportFilters`' own "Estado" select below —
 * that one drives the report period's `reportStatus`, this one drives the queue's own `status`;
 * they stay two controls because a Vendedor (no `pricing.discount.approve`) never sees the report
 * at all but still needs to filter the queue.
 */
export function ApprovalsQueueStatusFilter({
  status,
  orderId,
  reportParams,
}: {
  status?: string;
  orderId?: string;
  /** The report section's own params, carried forward unchanged — same precedent the page's old
   * `buildHref` already established (paginating/filtering the queue must not reset the report). */
  reportParams: { reportFrom?: string; reportTo?: string; reportGroupBy?: string; reportStatus?: string };
}): React.JSX.Element {
  const router = useRouter();

  function go(nextStatus: string): void {
    const params = new URLSearchParams();
    if (nextStatus) params.set('status', nextStatus);
    if (orderId) params.set('orderId', orderId);
    if (reportParams.reportFrom) params.set('reportFrom', reportParams.reportFrom);
    if (reportParams.reportTo) params.set('reportTo', reportParams.reportTo);
    if (reportParams.reportGroupBy) params.set('reportGroupBy', reportParams.reportGroupBy);
    if (reportParams.reportStatus) params.set('reportStatus', reportParams.reportStatus);
    router.push(`/approvals${params.toString() ? `?${params}` : ''}`);
  }

  return (
    <Field label="Estado" className="max-w-xs">
      <Select value={status ?? ''} onChange={(e) => go(e.target.value)}>
        <option value="">Todos los estados</option>
        {PRICE_APPROVAL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PRICE_APPROVAL_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
    </Field>
  );
}
