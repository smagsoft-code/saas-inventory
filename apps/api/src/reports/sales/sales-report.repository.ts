import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { orderItems, orders } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface PeriodBucketRow {
  key: string;
  orderCount: number;
  subtotal: string;
  discountTotal: string;
  total: string;
}

export interface CustomerBucketRow {
  key: string;
  customerName: string;
  orderCount: number;
  subtotal: string;
  discountTotal: string;
  total: string;
}

export interface ProductBucketRow {
  key: string;
  sku: string;
  productName: string;
  orderCount: string;
  quantity: string;
  discountTotal: string;
  total: string;
}

export type DateTruncUnit = 'day' | 'week' | 'month';

/**
 * `reports/sales` read-side (F18-02, modules.md "REPORTS -> Sales" — an explicitly allowed
 * dependency edge; this never touches `OrdersRepository`/`OrderItemsRepository`, per the
 * architectural rule that reporting is a separate read-side, not a repurposed transactional
 * repository). Every method aggregates in PostgreSQL (`SUM`/`COUNT`/`GROUP BY`) — no row is ever
 * paged into the application to be summed in JavaScript.
 *
 * `groupBy=day|week|month` and `groupBy=customer` read `orders` alone (no join — `subtotal`/
 * `discount_total`/`total` are already order-level columns), backed by the existing
 * `orders_tenant_status_created_idx (tenant_id, status, created_at)`. `groupBy=product` reads
 * `order_items` joined to `orders` (only `orders` carries `status`/`created_at`); `order_items` has
 * no index on `(tenant_id, order_id)` today (confirmed against `09-sales.ts` — no migration/index
 * change is in scope for F18-02), so this join relies on `orders_tenant_status_created_idx`
 * bounding the `orders` side first and Postgres hash-joining from there — a real, documented
 * performance risk at large scale, not a silent one (see this phase's final report, §Performance).
 *
 * Every `*_snapshot` column used here (customer_name_snapshot, sku_snapshot,
 * product_name_snapshot) is already frozen on `orders`/`order_items` — grouping never joins to
 * `customers`/`products`/`product_variants` for a name, so there is no extra lookup per bucket.
 */
@Injectable()
export class SalesReportRepository {
  private dateRangeConditions(
    tenantId: string,
    range: { gte: Date; lt: Date; status: string },
  ): SQL[] {
    return [
      eq(orders.tenantId, tenantId),
      eq(orders.status, range.status),
      gte(orders.createdAt, range.gte),
      lt(orders.createdAt, range.lt),
    ];
  }

  async summaryByPeriod(
    tx: TenantTransaction,
    tenantId: string,
    range: { gte: Date; lt: Date; status: string; unit: DateTruncUnit; timezone: string },
  ): Promise<PeriodBucketRow[]> {
    // Bucket boundary is computed in the tenant's own IANA zone (never UTC/server-local), then
    // formatted back to a plain calendar date — the response never leaks a second, ambiguous
    // timestamp representation for the same bucket. Aliased and referenced by that alias in
    // GROUP BY/ORDER BY (`sql`bucket_key`` — a bare identifier, standard Postgres "group/order by
    // output-column alias") rather than repeating the expression: Drizzle renders the identical
    // `sql` fragment differently depending on where it appears (an unqualified "created_at" in the
    // SELECT list vs a table-qualified "orders"."created_at" in GROUP BY), which Postgres then
    // rejects as two different expressions ("column orders.created_at must appear in the GROUP BY
    // clause" — found running this against real PostgreSQL, not a hypothetical). Referencing one
    // alias sidesteps the mismatch entirely.
    const bucketKey = sql<string>`to_char(date_trunc(${range.unit}, ${orders.createdAt} AT TIME ZONE ${range.timezone}), 'YYYY-MM-DD')`.as(
      'bucket_key',
    );

    const rows = await tx
      .select({
        key: bucketKey,
        orderCount: count(),
        subtotal: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
        discountTotal: sql<string>`coalesce(sum(${orders.discountTotal}), 0)`,
        total: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(and(...this.dateRangeConditions(tenantId, range)))
      .groupBy(sql`bucket_key`)
      .orderBy(sql`bucket_key`);

    return rows;
  }

  async summaryByCustomer(
    tx: TenantTransaction,
    tenantId: string,
    range: { gte: Date; lt: Date; status: string },
  ): Promise<CustomerBucketRow[]> {
    const rows = await tx
      .select({
        key: sql<string>`${orders.customerId}`,
        // MAX picks a deterministic single name when the snapshot ever differs across a customer's
        // orders (it shouldn't in practice — customers.display_name changes don't rewrite history —
        // but GROUP BY requires every selected column to be aggregated or grouped).
        customerName: sql<string>`max(${orders.customerNameSnapshot})`,
        orderCount: count(),
        subtotal: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
        discountTotal: sql<string>`coalesce(sum(${orders.discountTotal}), 0)`,
        total: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(
        and(
          ...this.dateRangeConditions(tenantId, range),
          // A customer-less order (customer_id nullable at the schema level, though checkout
          // always resolves one today — FASE 12) has no meaningful bucket to join; excluded here
          // rather than invented into a synthetic "unknown customer" row.
          sql`${orders.customerId} IS NOT NULL`,
        ),
      )
      .groupBy(orders.customerId)
      .orderBy(desc(sql`sum(${orders.total})`));

    return rows.map((row) => ({ ...row, key: row.key }));
  }

  async summaryByProduct(
    tx: TenantTransaction,
    tenantId: string,
    range: { gte: Date; lt: Date; status: string },
  ): Promise<ProductBucketRow[]> {
    const rows = await tx
      .select({
        key: sql<string>`${orderItems.productVariantId}`,
        sku: sql<string>`max(${orderItems.skuSnapshot})`,
        productName: sql<string>`max(${orderItems.productNameSnapshot})`,
        orderCount: sql<string>`count(distinct ${orderItems.orderId})`,
        quantity: sql<string>`coalesce(sum(${orderItems.quantity}), 0)`,
        discountTotal: sql<string>`coalesce(sum(${orderItems.discountAmount}), 0)`,
        total: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, and(eq(orders.tenantId, orderItems.tenantId), eq(orders.id, orderItems.orderId)))
      .where(and(...this.dateRangeConditions(tenantId, range), eq(orderItems.tenantId, tenantId)))
      .groupBy(orderItems.productVariantId)
      .orderBy(desc(sql`sum(${orderItems.lineTotal})`));

    return rows;
  }
}
