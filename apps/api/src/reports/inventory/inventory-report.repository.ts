import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '../../database/tenant-context';

/** A plain type alias (not `interface`) — `Database['execute']`'s generic bound requires
 * `Record<string, unknown>`, which only a type literal (not a named interface) is structurally
 * assignable to; same reason `load-effective-permissions.ts` inlines its row shape. */
export type InventoryWarehouseBucketRow = {
  key: string;
  name: string;
  availableQuantity: string;
  reservedQuantity: string;
  outOfStockCount: string;
};

export type InventoryCategoryBucketRow = {
  /** NULL for "no category" — mapped to the `'uncategorized'` sentinel in the service layer, never
   * an invented id. */
  key: string | null;
  name: string | null;
  availableQuantity: string;
  reservedQuantity: string;
  outOfStockCount: string;
};

export type InventoryTotalsRow = {
  availableQuantity: string;
  reservedQuantity: string;
  outOfStockCount: string;
  /** Σ (product_variants.cost × physical_sum) per variant — physical on-hand, so a pending order's
   * reservation does NOT reduce the value: stock only leaves the books when the sale is confirmed
   * (the SALE movement lowers quantity_physical). Previously multiplied available_sum (physical −
   * reserved − committed), which wrongly dropped the value as soon as an order was created. NULL cost treated as 0 — "current cost"
   * valuation, never FIFO/weighted-average (no costing method exists, GAP-COST). Always computed by
   * this query (the join is already there for nothing extra); the service layer decides whether to
   * put it on the response, gated on `pricing.cost.view` (ADR-0028's existing precedent). */
  totalCostValue: string;
  /** Distinct variants with physical_sum > 0 whose product_variants.cost is NULL — excluded from
   * `totalCostValue` above, so this count is the honest "how much of that total might be missing"
   * companion, never silently folded into the total as a false 0. */
  missingCostCount: string;
};

interface Filters {
  warehouseId?: string | undefined;
  locationId?: string | undefined;
  categoryId?: string | undefined;
}

/**
 * `reports/inventory` read-side (F18-03, mirrors `reports/sales`'s F18-02 precedent exactly) — a
 * dedicated read model over `inventory_balances`, joined (never written) to `locations`/
 * `product_variants`/`products`/`categories`/`warehouses` for grouping and name enrichment. Never
 * `InventoryBalancesRepository`/`InventoryMovementsRepository` (the transactional read/write-path
 * repositories) — modules.md's "reporting is a separate read-side" rule, same as SalesReportRepository.
 *
 * Every query aggregates in Postgres (`SUM`/`COUNT(*) FILTER`/`GROUP BY`) via a two-level CTE: the
 * inner level sums `quantity_available`/`quantity_reserved` **per (bucket, variant)** first, so a
 * variant stocked at several locations inside the same warehouse/category is never double-counted
 * toward `outOfStockCount` (`available_sum = 0` is evaluated per variant, not per balance row); the
 * outer level then sums variants into the bucket total and counts how many of them landed at zero.
 * Raw parameterized `sql` (never string-interpolated) — the same precedent as
 * `EventClaimRepository`'s claim query — because this shape (aggregate-of-an-aggregate, `FILTER`)
 * has no natural expression in the Drizzle query builder used elsewhere in this codebase.
 *
 * Tenant scope: **tenant-wide**, matching the real, current behaviour of `GET /inventory/balances`
 * and `GET /inventory/movements` — neither restricts its rows by `user_location_assignments`
 * (`LocationAuthorizationService` is only ever invoked on a *write* path: adjustments, transfer
 * prepare/dispatch/receive — never on a read). ADR-0024 itself frames the guard as "can this user do
 * a location-sensitive *action*", not a read filter. This report reuses that same, already-real
 * policy rather than inventing per-report location scoping — see this phase's final report for the
 * full reasoning trail.
 *
 * `warehouseId`/`locationId`/`categoryId` filters and both `groupBy` branches always join
 * `locations` AND `product_variants`/`products` regardless of which grouping was requested, so any
 * filter can apply no matter the `groupBy` value (e.g. "category breakdown for one warehouse") — a
 * constant, indexed join cost (`inventory_balances_tenant_location_idx` / `_tenant_variant_idx`),
 * not a per-row scan.
 */
@Injectable()
export class InventoryReportRepository {
  async summaryByWarehouse(tx: TenantTransaction, tenantId: string, filters: Filters): Promise<InventoryWarehouseBucketRow[]> {
    const rows = await tx.execute<InventoryWarehouseBucketRow>(sql`
      WITH per_variant AS (
        SELECT
          l.warehouse_id AS group_key,
          ib.product_variant_id AS variant_id,
          SUM(ib.quantity_available) AS available_sum,
          SUM(ib.quantity_reserved) AS reserved_sum
        FROM inventory_balances ib
        JOIN locations l ON l.tenant_id = ib.tenant_id AND l.id = ib.location_id
        JOIN product_variants pv ON pv.tenant_id = ib.tenant_id AND pv.id = ib.product_variant_id
        JOIN products p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
        WHERE ib.tenant_id = ${tenantId}
          ${filters.warehouseId ? sql`AND l.warehouse_id = ${filters.warehouseId}` : sql``}
          ${filters.locationId ? sql`AND ib.location_id = ${filters.locationId}` : sql``}
          ${filters.categoryId ? sql`AND p.category_id = ${filters.categoryId}` : sql``}
        GROUP BY l.warehouse_id, ib.product_variant_id
      ),
      agg AS (
        SELECT
          group_key,
          COALESCE(SUM(available_sum), 0) AS available_quantity,
          COALESCE(SUM(reserved_sum), 0) AS reserved_quantity,
          COUNT(*) FILTER (WHERE available_sum = 0) AS out_of_stock_count
        FROM per_variant
        GROUP BY group_key
      )
      SELECT agg.group_key AS key, w.name AS name, agg.available_quantity AS "availableQuantity",
             agg.reserved_quantity AS "reservedQuantity", agg.out_of_stock_count AS "outOfStockCount"
      FROM agg
      JOIN warehouses w ON w.tenant_id = ${tenantId} AND w.id = agg.group_key
      ORDER BY w.name
    `);
    return rows;
  }

  async summaryByCategory(tx: TenantTransaction, tenantId: string, filters: Filters): Promise<InventoryCategoryBucketRow[]> {
    const rows = await tx.execute<InventoryCategoryBucketRow>(sql`
      WITH per_variant AS (
        SELECT
          p.category_id AS group_key,
          ib.product_variant_id AS variant_id,
          SUM(ib.quantity_available) AS available_sum,
          SUM(ib.quantity_reserved) AS reserved_sum
        FROM inventory_balances ib
        JOIN locations l ON l.tenant_id = ib.tenant_id AND l.id = ib.location_id
        JOIN product_variants pv ON pv.tenant_id = ib.tenant_id AND pv.id = ib.product_variant_id
        JOIN products p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
        WHERE ib.tenant_id = ${tenantId}
          ${filters.warehouseId ? sql`AND l.warehouse_id = ${filters.warehouseId}` : sql``}
          ${filters.locationId ? sql`AND ib.location_id = ${filters.locationId}` : sql``}
          ${filters.categoryId ? sql`AND p.category_id = ${filters.categoryId}` : sql``}
        GROUP BY p.category_id, ib.product_variant_id
      ),
      agg AS (
        SELECT
          group_key,
          COALESCE(SUM(available_sum), 0) AS available_quantity,
          COALESCE(SUM(reserved_sum), 0) AS reserved_quantity,
          COUNT(*) FILTER (WHERE available_sum = 0) AS out_of_stock_count
        FROM per_variant
        GROUP BY group_key
      )
      SELECT agg.group_key AS key, c.name AS name, agg.available_quantity AS "availableQuantity",
             agg.reserved_quantity AS "reservedQuantity", agg.out_of_stock_count AS "outOfStockCount"
      FROM agg
      LEFT JOIN categories c ON c.tenant_id = ${tenantId} AND c.id = agg.group_key
      ORDER BY c.name NULLS LAST
    `);
    return rows;
  }

  /** Tenant-wide totals for the applied filter set, independent of `groupBy` — always joins the
   * same tables as the grouped queries above so `warehouseId`/`locationId`/`categoryId` behave
   * identically. `variant_cost` is `MAX(pv.cost)` — a variant's cost is constant across the
   * locations folded into `available_sum` here, so `MAX` over a single-valued group is exact, not
   * an approximation; it exists only so the aggregate can multiply it against `available_sum` in
   * one pass, one CTE, no second query. */
  async totals(tx: TenantTransaction, tenantId: string, filters: Filters): Promise<InventoryTotalsRow> {
    const rows = await tx.execute<InventoryTotalsRow>(sql`
      WITH per_variant AS (
        SELECT
          ib.product_variant_id AS variant_id,
          SUM(ib.quantity_available) AS available_sum,
          SUM(ib.quantity_reserved) AS reserved_sum,
          SUM(ib.quantity_physical) AS physical_sum,
          MAX(pv.cost) AS variant_cost
        FROM inventory_balances ib
        JOIN locations l ON l.tenant_id = ib.tenant_id AND l.id = ib.location_id
        JOIN product_variants pv ON pv.tenant_id = ib.tenant_id AND pv.id = ib.product_variant_id
        JOIN products p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
        WHERE ib.tenant_id = ${tenantId}
          ${filters.warehouseId ? sql`AND l.warehouse_id = ${filters.warehouseId}` : sql``}
          ${filters.locationId ? sql`AND ib.location_id = ${filters.locationId}` : sql``}
          ${filters.categoryId ? sql`AND p.category_id = ${filters.categoryId}` : sql``}
        GROUP BY ib.product_variant_id
      )
      SELECT
        COALESCE(SUM(available_sum), 0) AS "availableQuantity",
        COALESCE(SUM(reserved_sum), 0) AS "reservedQuantity",
        COUNT(*) FILTER (WHERE available_sum = 0) AS "outOfStockCount",
        COALESCE(SUM(COALESCE(variant_cost, 0) * physical_sum), 0) AS "totalCostValue",
        COUNT(*) FILTER (WHERE physical_sum > 0 AND variant_cost IS NULL) AS "missingCostCount"
      FROM per_variant
    `);
    return (
      rows[0] ?? {
        availableQuantity: '0',
        reservedQuantity: '0',
        outOfStockCount: '0',
        totalCostValue: '0',
        missingCostCount: '0',
      }
    );
  }
}
