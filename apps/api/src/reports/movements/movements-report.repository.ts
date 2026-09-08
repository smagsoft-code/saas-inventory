import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { inventoryMovements } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface MovementsBucketRow {
  key: string;
  movementCount: string;
  totalQuantity: string;
}

export type DateTruncUnit = 'day' | 'week' | 'month';

interface RangeParams {
  gte: Date;
  lt: Date;
  movementType?: string | undefined;
  locationId?: string | undefined;
  productVariantId?: string | undefined;
}

/**
 * `reports/movements` read-side (F18-07, mirrors `reports/approvals` F18-05 — see that repository's
 * header for the shared reasoning). Never `InventoryMovementsRepository` (the transactional
 * read/write-path repository) — modules.md's "reporting is a separate read-side" rule.
 *
 * Every query reads `inventory_movements` **alone** — no join. One row is one ledger movement;
 * `quantity` is a per-row frozen, signed column. Because nothing is joined, `COUNT(*)` and
 * `SUM(quantity)` are exact — there is no fan-out to inflate a count or a sum.
 *
 * The driving row set is bounded by `tenant_id = ? AND occurred_at >= ? AND occurred_at < ?`,
 * backed by `inventory_movements_tenant_occurred_idx (tenant_id, occurred_at)` — the index F18-03
 * added (migration `0030`) for the operational `occurredFrom`/`occurredTo` filter; this report
 * reuses it, no new index. `movement_type` / `location_id` / `product_variant_id` are further
 * equality filters (`KPI-INV-MOVEMENTS`'s "type, location, variant") applied on top.
 */
@Injectable()
export class MovementsReportRepository {
  private baseConditions(tenantId: string, range: RangeParams): SQL[] {
    const conditions: SQL[] = [
      eq(inventoryMovements.tenantId, tenantId),
      gte(inventoryMovements.occurredAt, range.gte),
      lt(inventoryMovements.occurredAt, range.lt),
    ];
    if (range.movementType) {
      conditions.push(eq(inventoryMovements.movementType, range.movementType));
    }
    if (range.locationId) {
      conditions.push(eq(inventoryMovements.locationId, range.locationId));
    }
    if (range.productVariantId) {
      conditions.push(eq(inventoryMovements.productVariantId, range.productVariantId));
    }
    return conditions;
  }

  async summaryByPeriod(
    tx: TenantTransaction,
    tenantId: string,
    range: RangeParams & { unit: DateTruncUnit; timezone: string },
  ): Promise<MovementsBucketRow[]> {
    // Same alias-then-reference trick the other FASE 18 period repositories use — Drizzle renders an
    // identical `sql` fragment differently in SELECT vs GROUP BY/ORDER BY, which Postgres rejects as
    // two expressions. Bucket boundary is computed in the tenant's own IANA zone, never UTC.
    const bucketKey = sql<string>`to_char(date_trunc(${range.unit}, ${inventoryMovements.occurredAt} AT TIME ZONE ${range.timezone}), 'YYYY-MM-DD')`.as(
      'bucket_key',
    );

    const rows = await tx
      .select({
        key: bucketKey,
        movementCount: sql<string>`count(*)`,
        totalQuantity: sql<string>`coalesce(sum(${inventoryMovements.quantity}), 0)`,
      })
      .from(inventoryMovements)
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(sql`bucket_key`)
      .orderBy(sql`bucket_key`);

    return rows;
  }

  async summaryByType(tx: TenantTransaction, tenantId: string, range: RangeParams): Promise<MovementsBucketRow[]> {
    const rows = await tx
      .select({
        key: sql<string>`${inventoryMovements.movementType}`,
        movementCount: sql<string>`count(*)`,
        totalQuantity: sql<string>`coalesce(sum(${inventoryMovements.quantity}), 0)`,
      })
      .from(inventoryMovements)
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(inventoryMovements.movementType)
      .orderBy(inventoryMovements.movementType);

    return rows;
  }
}
