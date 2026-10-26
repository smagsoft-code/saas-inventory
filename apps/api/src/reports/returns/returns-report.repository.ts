import { Injectable } from '@nestjs/common';
import { and, inArray, eq, desc, gte, lt, sql, type SQL } from 'drizzle-orm';
import { orderItems, orders, salesReturnItems, salesReturns } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface PeriodBucketRow {
  key: string;
  returnCount: string;
  orderCount: string;
  lineCount: string;
  quantity: string;
  returnedValue: string;
}

export interface CustomerBucketRow {
  key: string;
  customerName: string;
  returnCount: string;
  orderCount: string;
  lineCount: string;
  quantity: string;
  returnedValue: string;
}

export interface ProductBucketRow {
  key: string;
  sku: string;
  productName: string;
  returnCount: string;
  orderCount: string;
  lineCount: string;
  quantity: string;
  returnedValue: string;
}

export interface DispositionBucketRow {
  key: string;
  lineCount: string;
  quantity: string;
  returnedValue: string;
}

export type DateTruncUnit = 'day' | 'week' | 'month';

/**
 * `reports/returns` read-side (F18-04, mirrors `reports/sales`'s F18-02 precedent exactly — see
 * that repository's own header comment for the shared reasoning). Never
 * `SalesReturnsRepository`/`SalesReturnItemsRepository` (the transactional read/write-path
 * repositories) — modules.md's "reporting is a separate read-side" rule.
 *
 * Every query joins `sales_returns` → `sales_return_items` → `order_items` — a strict many-to-one
 * chain (one return has many lines; each line references exactly one `order_item`), so summing
 * `quantity_returned` / `quantity_returned × unit_price_snapshot` at that join granularity never
 * inflates a real quantity or value (no fan-out risk, unlike a join that would multiply rows). What
 * *would* double-count if done naively is `returnCount`/`orderCount` — a return with three lines
 * appears three times after the joins — so every grouped query uses `COUNT(DISTINCT ...)` on
 * `sales_returns.id` / `sales_returns.order_id`, never a bare `COUNT(*)`, per this phase's explicit
 * cardinality rule.
 *
 * `groupBy=day|week|month` and `groupBy=customer` additionally join `orders` (for
 * `customer_id`/`customer_name_snapshot` on the customer grouping only — the period grouping does
 * not need it, `sales_returns.created_at` is the bucket key). `groupBy=product` reads
 * `order_items.sku_snapshot`/`product_name_snapshot` (frozen at the moment of the original sale,
 * never `products`/`product_variants`' current name) — the same "no extra lookup per bucket"
 * property `SalesReportRepository` already established.
 *
 * `sales_return_items` has no index on `(tenant_id, return_id)` today (confirmed against
 * `09-sales.ts` — only `(tenant_id, order_item_id)` exists) — the exact same, already-accepted
 * F18-02 performance risk documented for `order_items(tenant_id, order_id)`: the query relies on
 * `sales_returns_tenant_status_created_idx (tenant_id, status, created_at)` bounding the driving
 * `sales_returns` row set first. No migration is added for it here (no evidence of a real access
 * pattern at scale yet — see this phase's final report, §Performance).
 */
@Injectable()
export class ReturnsReportRepository {
  private baseConditions(tenantId: string, range: { gte: Date; lt: Date; status: string; locationId?: string | undefined; locationIds?: string[] | undefined; placedByUserId?: string | undefined }): SQL[] {
    const conditions = [
      eq(salesReturns.tenantId, tenantId),
      eq(salesReturns.status, range.status),
      gte(salesReturns.createdAt, range.gte),
      lt(salesReturns.createdAt, range.lt),
    ];
    // Recibido en — plain equality on the receiving location, never a grouping dimension.
    if (range.locationId) {
      conditions.push(eq(salesReturns.locationId, range.locationId));
    }
    // Read scope of a restricted caller (ADR-0024/0035): only their assigned locations; none = nothing.
    if (range.locationIds) {
      conditions.push(range.locationIds.length > 0 ? inArray(salesReturns.locationId, range.locationIds) : sql`false`);
    }
    // Seller scope of the read (same rule as `GET /sales-returns`): only returns of orders placed by this user.
    if (range.placedByUserId) {
      conditions.push(
        sql`exists (select 1 from ${orders} where ${orders.tenantId} = ${salesReturns.tenantId} and ${orders.id} = ${salesReturns.orderId} and ${orders.placedByUserId} = ${range.placedByUserId})`,
      );
    }
    return conditions;
  }

  async summaryByPeriod(
    tx: TenantTransaction,
    tenantId: string,
    range: { gte: Date; lt: Date; status: string; locationId?: string | undefined; locationIds?: string[] | undefined; placedByUserId?: string | undefined; unit: DateTruncUnit; timezone: string },
  ): Promise<PeriodBucketRow[]> {
    // Same alias-then-reference trick as SalesReportRepository.summaryByPeriod — Drizzle renders an
    // identical `sql` fragment differently in SELECT vs GROUP BY/ORDER BY, which Postgres then
    // rejects as two different expressions.
    const bucketKey = sql<string>`to_char(date_trunc(${range.unit}, ${salesReturns.createdAt} AT TIME ZONE ${range.timezone}), 'YYYY-MM-DD')`.as(
      'bucket_key',
    );

    const rows = await tx
      .select({
        key: bucketKey,
        returnCount: sql<string>`count(distinct ${salesReturns.id})`,
        orderCount: sql<string>`count(distinct ${salesReturns.orderId})`,
        lineCount: sql<string>`count(${salesReturnItems.id})`,
        quantity: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned}), 0)`,
        returnedValue: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned} * ${orderItems.unitPriceSnapshot}), 0)`,
      })
      .from(salesReturns)
      .innerJoin(salesReturnItems, and(eq(salesReturnItems.tenantId, salesReturns.tenantId), eq(salesReturnItems.returnId, salesReturns.id)))
      .innerJoin(orderItems, and(eq(orderItems.tenantId, salesReturnItems.tenantId), eq(orderItems.id, salesReturnItems.orderItemId)))
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(sql`bucket_key`)
      .orderBy(sql`bucket_key`);

    return rows;
  }

  async summaryByCustomer(
    tx: TenantTransaction,
    tenantId: string,
    range: { gte: Date; lt: Date; status: string; locationId?: string | undefined; locationIds?: string[] | undefined; placedByUserId?: string | undefined },
  ): Promise<CustomerBucketRow[]> {
    const rows = await tx
      .select({
        key: sql<string>`${orders.customerId}`,
        customerName: sql<string>`max(${orders.customerNameSnapshot})`,
        returnCount: sql<string>`count(distinct ${salesReturns.id})`,
        orderCount: sql<string>`count(distinct ${salesReturns.orderId})`,
        lineCount: sql<string>`count(${salesReturnItems.id})`,
        quantity: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned}), 0)`,
        returnedValue: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned} * ${orderItems.unitPriceSnapshot}), 0)`,
      })
      .from(salesReturns)
      .innerJoin(salesReturnItems, and(eq(salesReturnItems.tenantId, salesReturns.tenantId), eq(salesReturnItems.returnId, salesReturns.id)))
      .innerJoin(orderItems, and(eq(orderItems.tenantId, salesReturnItems.tenantId), eq(orderItems.id, salesReturnItems.orderItemId)))
      .innerJoin(orders, and(eq(orders.tenantId, salesReturns.tenantId), eq(orders.id, salesReturns.orderId)))
      .where(
        and(
          ...this.baseConditions(tenantId, range),
          // A customer-less order has no meaningful bucket to join; excluded rather than invented
          // into a synthetic "unknown customer" row — same rule SalesReportRepository applies.
          sql`${orders.customerId} IS NOT NULL`,
        ),
      )
      .groupBy(orders.customerId)
      .orderBy(desc(sql`sum(${salesReturnItems.quantityReturned} * ${orderItems.unitPriceSnapshot})`));

    return rows;
  }

  async summaryByProduct(
    tx: TenantTransaction,
    tenantId: string,
    range: { gte: Date; lt: Date; status: string; locationId?: string | undefined; locationIds?: string[] | undefined; placedByUserId?: string | undefined },
  ): Promise<ProductBucketRow[]> {
    const rows = await tx
      .select({
        key: sql<string>`${orderItems.productVariantId}`,
        sku: sql<string>`max(${orderItems.skuSnapshot})`,
        productName: sql<string>`max(${orderItems.productNameSnapshot})`,
        returnCount: sql<string>`count(distinct ${salesReturns.id})`,
        orderCount: sql<string>`count(distinct ${salesReturns.orderId})`,
        lineCount: sql<string>`count(${salesReturnItems.id})`,
        quantity: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned}), 0)`,
        returnedValue: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned} * ${orderItems.unitPriceSnapshot}), 0)`,
      })
      .from(salesReturns)
      .innerJoin(salesReturnItems, and(eq(salesReturnItems.tenantId, salesReturns.tenantId), eq(salesReturnItems.returnId, salesReturns.id)))
      .innerJoin(orderItems, and(eq(orderItems.tenantId, salesReturnItems.tenantId), eq(orderItems.id, salesReturnItems.orderItemId)))
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(orderItems.productVariantId)
      .orderBy(desc(sql`sum(${salesReturnItems.quantityReturned} * ${orderItems.unitPriceSnapshot})`));

    return rows;
  }

  /** Only lines that have actually been inspected (`disposition IS NOT NULL`) can be bucketed by
   * disposition — a `NULL` disposition has not been decided yet and is never mapped to an invented
   * "pending" bucket (see this phase's final report, §Grouping). */
  async summaryByDisposition(
    tx: TenantTransaction,
    tenantId: string,
    range: { gte: Date; lt: Date; status: string; locationId?: string | undefined; locationIds?: string[] | undefined; placedByUserId?: string | undefined },
  ): Promise<DispositionBucketRow[]> {
    const rows = await tx
      .select({
        key: sql<string>`${salesReturnItems.disposition}`,
        lineCount: sql<string>`count(${salesReturnItems.id})`,
        quantity: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned}), 0)`,
        returnedValue: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned} * ${orderItems.unitPriceSnapshot}), 0)`,
      })
      .from(salesReturns)
      .innerJoin(salesReturnItems, and(eq(salesReturnItems.tenantId, salesReturns.tenantId), eq(salesReturnItems.returnId, salesReturns.id)))
      .innerJoin(orderItems, and(eq(orderItems.tenantId, salesReturnItems.tenantId), eq(orderItems.id, salesReturnItems.orderItemId)))
      .where(and(...this.baseConditions(tenantId, range), sql`${salesReturnItems.disposition} IS NOT NULL`))
      .groupBy(salesReturnItems.disposition)
      .orderBy(salesReturnItems.disposition);

    return rows;
  }
}
