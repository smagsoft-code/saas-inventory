'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  INVENTORY_SUMMARY_GROUP_BY,
  INVENTORY_SUMMARY_GROUP_BY_LABELS,
  type InventorySummaryGroupBy,
} from '../../../lib/types/inventory-reports';
import type { Warehouse } from '../../../lib/types/inventory';
import type { Category } from '../../../lib/types/catalog';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/input';

export interface InventoryReportFilterValues {
  warehouseId?: string;
  categoryId?: string;
  groupBy: InventorySummaryGroupBy;
}

/**
 * F18-03 report filters. Distinct URL params (`reportWarehouseId`/`reportCategoryId`/
 * `reportGroupBy`) from the operational balances/movements filters elsewhere on `/inventory` — the
 * report section is independent. Same navigate-and-let-the-server-refetch pattern as
 * `SalesReportFilters` (F18-02): no client-side data fetching of its own.
 */
export function InventoryReportFilters({
  initial,
  warehouses,
  categories,
}: {
  initial: InventoryReportFilterValues;
  warehouses: Warehouse[];
  categories: Category[];
}): React.JSX.Element {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [groupBy, setGroupBy] = useState<InventorySummaryGroupBy>(initial.groupBy);

  function apply(next: { warehouseId?: string; categoryId?: string; groupBy?: InventorySummaryGroupBy }): void {
    const params = new URLSearchParams();
    const nextWarehouseId = next.warehouseId ?? warehouseId;
    const nextCategoryId = next.categoryId ?? categoryId;
    const nextGroupBy = next.groupBy ?? groupBy;
    if (nextWarehouseId) params.set('reportWarehouseId', nextWarehouseId);
    if (nextCategoryId) params.set('reportCategoryId', nextCategoryId);
    params.set('reportGroupBy', nextGroupBy);
    router.push(`/inventory?${params.toString()}#report`);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Warehouse">
        <Select
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            apply({ warehouseId: e.target.value });
          }}
        >
          <option value="">All warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Category">
        <Select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            apply({ categoryId: e.target.value });
          }}
        >
          <option value="">All categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Group by">
        <Select
          value={groupBy}
          onChange={(e) => {
            const next = e.target.value as InventorySummaryGroupBy;
            setGroupBy(next);
            apply({ groupBy: next });
          }}
        >
          {INVENTORY_SUMMARY_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {INVENTORY_SUMMARY_GROUP_BY_LABELS[g]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
