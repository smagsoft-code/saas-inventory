import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { orders, priceApprovals } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface PeriodBucketRow {
  key: string;
  requestCount: string;
  approvedCount: string;
  rejectedCount: string;
  cancelledCount: string;
  pendingCount: string;
  approvedDiscountValue: string;
}

export interface StatusBucketRow {
  key: string;
  requestCount: string;
  discountValue: string;
}

export type DateTruncUnit = 'day' | 'week' | 'month';

interface RangeParams {
  gte: Date;
  lt: Date;
  status?: string | undefined;
  /** The parent order's location (Almacén) — `price_approvals` has none of its own. */
  locationId?: string | undefined;
  locationIds?: string[] | undefined;
}

/**
 * `reports/approvals` read-side (F18-05, mirrors `reports/sales` F18-02 / `reports/returns` F18-04 —
 * see those repositories' header comments for the shared reasoning). Never
 * `PriceApprovalsRepository` (the transactional read/write-path repository) — modules.md's
 * "reporting is a separate read-side" rule.
 *
 * Every query reads `price_approvals` **alone** — no join. One row is one exceptional-discount
 * request for one order line; `discount_amount` is a per-row frozen column (computed at request
 * time against `max_price`, never `min_price` — `SalesPricingService`/`PriceApprovalsService`, so
 * `Σ discount_amount` never reveals the floor and this report needs no `pricing.floor.view`).
 * Because nothing is joined, `COUNT(*)` / `COUNT(*) FILTER` / `SUM(discount_amount)` /
 * `SUM(...) FILTER` are all exact — there is no fan-out to inflate a count or a sum, unlike the
 * sales / returns reports whose grain is multiplied by an `order_items` join.
 *
 * The driving row set is bounded by `tenant_id = ? AND requested_at >= ? AND requested_at < ?`.
 * No dedicated `(tenant_id, requested_at)` index exists today — `price_approvals` carries only the
 * partial `(tenant_id, status, requested_at) WHERE status = 'pending'` queue index and
 * `(tenant_id, order_id)`. This matches F18-04's already-accepted decision for `sales_returns`
 * (no index added): `price_approvals` is a naturally small table (one row per escalated below-base
 * line), and there is no evidence of a query path that needs the index at scale yet. If a
 * high-volume tenant emerges, `(tenant_id, requested_at)` is the additive index to add then — not
 * speculatively here (CLAUDE.md §7.7, prompt §18).
 */
@Injectable()
export class ApprovalsReportRepository {
  private baseConditions(tenantId: string, range: RangeParams): SQL[] {
    const conditions: SQL[] = [
      eq(priceApprovals.tenantId, tenantId),
      gte(priceApprovals.requestedAt, range.gte),
      lt(priceApprovals.requestedAt, range.lt),
    ];
    if (range.status) {
      conditions.push(eq(priceApprovals.status, range.status));
    }
    if (range.locationId) {
      // Semi-join on orders, never a real join — one row per approval stays one row, so every
      // COUNT/SUM keeps its exactness guarantee.
      conditions.push(
        sql`exists (select 1 from ${orders} where ${orders.tenantId} = ${priceApprovals.tenantId} and ${orders.id} = ${priceApprovals.orderId} and ${orders.locationId} = ${range.locationId})`,
      );
    }
    // Read scope of a restricted caller (ADR-0024/0035): only their assigned locations; none = nothing.
    if (range.locationIds) {
      conditions.push(
        range.locationIds.length > 0
          ? sql`exists (select 1 from ${orders} where ${orders.tenantId} = ${priceApprovals.tenantId} and ${orders.id} = ${priceApprovals.orderId} and ${inArray(orders.locationId, range.locationIds)})`
          : sql`false`,
      );
    }
    return conditions;
  }

  async summaryByPeriod(
    tx: TenantTransaction,
    tenantId: string,
    range: RangeParams & { unit: DateTruncUnit; timezone: string },
  ): Promise<PeriodBucketRow[]> {
    // Same alias-then-reference trick as SalesReportRepository/ReturnsReportRepository.summaryByPeriod
    // — Drizzle renders an identical `sql` fragment differently in SELECT vs GROUP BY/ORDER BY, which
    // Postgres then rejects as two different expressions. Bucket boundary is computed in the tenant's
    // own IANA zone, never UTC/server-local.
    const bucketKey = sql<string>`to_char(date_trunc(${range.unit}, ${priceApprovals.requestedAt} AT TIME ZONE ${range.timezone}), 'YYYY-MM-DD')`.as(
      'bucket_key',
    );

    const rows = await tx
      .select({
        key: bucketKey,
        requestCount: sql<string>`count(*)`,
        approvedCount: sql<string>`count(*) filter (where ${priceApprovals.status} = 'approved')`,
        rejectedCount: sql<string>`count(*) filter (where ${priceApprovals.status} = 'rejected')`,
        cancelledCount: sql<string>`count(*) filter (where ${priceApprovals.status} = 'cancelled')`,
        pendingCount: sql<string>`count(*) filter (where ${priceApprovals.status} = 'pending')`,
        approvedDiscountValue: sql<string>`coalesce(sum(${priceApprovals.discountAmount}) filter (where ${priceApprovals.status} = 'approved'), 0)`,
      })
      .from(priceApprovals)
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(sql`bucket_key`)
      .orderBy(sql`bucket_key`);

    return rows;
  }

  async summaryByStatus(tx: TenantTransaction, tenantId: string, range: RangeParams): Promise<StatusBucketRow[]> {
    const rows = await tx
      .select({
        key: sql<string>`${priceApprovals.status}`,
        requestCount: sql<string>`count(*)`,
        discountValue: sql<string>`coalesce(sum(${priceApprovals.discountAmount}), 0)`,
      })
      .from(priceApprovals)
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(priceApprovals.status)
      .orderBy(priceApprovals.status);

    return rows;
  }
}
