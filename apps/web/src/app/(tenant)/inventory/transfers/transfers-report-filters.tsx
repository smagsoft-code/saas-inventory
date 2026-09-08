'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  TRANSFERS_SUMMARY_GROUP_BY,
  TRANSFERS_SUMMARY_GROUP_BY_LABELS,
  type TransfersSummaryGroupBy,
} from '../../../../lib/types/inventory-reports';
import { Field } from '../../../../components/ui/field';
import { Select } from '../../../../components/ui/input';

/**
 * F18-08 report filters. The report has a single dimension knob — `groupBy` (`status` /
 * `destination` / `variant`) — under its own `reportGroupBy` URL param, distinct from the
 * operational transfer-list filters (`status` / `sourceLocationId` / `destinationLocationId`) on the
 * same page. No date range: this report is a live snapshot, not a period query. Same
 * navigate-and-let-the-server-refetch pattern as `InventoryReportFilters` (F18-03).
 */
export function TransfersReportFilters({ initial }: { initial: { groupBy: TransfersSummaryGroupBy } }): React.JSX.Element {
  const router = useRouter();
  const [groupBy, setGroupBy] = useState<TransfersSummaryGroupBy>(initial.groupBy);

  function apply(next: TransfersSummaryGroupBy): void {
    const params = new URLSearchParams();
    params.set('reportGroupBy', next);
    router.push(`/inventory/transfers?${params.toString()}#report`);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Group by">
        <Select
          value={groupBy}
          onChange={(e) => {
            const next = e.target.value as TransfersSummaryGroupBy;
            setGroupBy(next);
            apply(next);
          }}
        >
          {TRANSFERS_SUMMARY_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {TRANSFERS_SUMMARY_GROUP_BY_LABELS[g]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
