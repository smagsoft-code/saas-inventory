import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { TenantTransaction } from '../../database/tenant-context';
import type { PaymentSortColumn } from './dto/payments-report-query.dto';

export interface PaymentFilters {
  gte: Date;
  lt: Date;
  locationId?: string | undefined;
  locationIds?: string[] | undefined;
  warehouseId?: string | undefined;
  placedByUserId?: string | undefined;
  documentType?: string | undefined;
  paymentMethod?: string | undefined;
  orderNumber?: string | undefined;
  customerName?: string | undefined;
  sellerName?: string | undefined;
  amount?: string | undefined;
}

export type PaymentListRow = {
  id: string;
  paidAt: Date;
  orderId: string;
  orderNumber: string;
  customerName: string;
  paymentMethod: string;
  amount: string;
  sellerName: string | null;
  locationId: string;
  locationLabel: string | null;
  documentType: string;
  returnCount: string;
  returnNumbers: string[] | null;
  returnedValue: string;
};

export type MethodTotalRow = {
  paymentMethod: string;
  paymentCount: string;
  amount: string;
};

/** `LIKE` metacharacters escaped (default ESCAPE is a backslash). */
function contains(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function sortExpression(column: PaymentSortColumn): SQL {
  switch (column) {
    case 'createdAt':
      return sql`p.created_at`;
    case 'orderNumber':
      return sql`o.order_number`;
    case 'customer':
      return sql`lower(o.customer_name_snapshot)`;
    case 'seller':
      return sql`lower(coalesce(u.full_name, ''))`;
    case 'paymentMethod':
      return sql`p.payment_method`;
    case 'amount':
      return sql`p.amount`;
    case 'location':
      return sql`lower(coalesce(w.name || ' · ' || l.name, ''))`;
    case 'documentType':
      return sql`o.document_type`;
  }
}

/**
 * `reports/payments` read-side. One row per `order_payments` row (a split payment is several rows),
 * joined 1:1 to `orders` and — for display only — left-joined to seller / location / warehouse.
 * Never `OrderPaymentsRepository` (reporting stays a separate read-side). Table and column names
 * are literals so the fragments render identically in every sub-select; everything user-supplied is
 * a bound parameter, and every table is tenant-scoped.
 *
 * Returns are folded in with one correlated sub-select over the order (`sales_returns` whose status
 * is not `cancelled`, `sales_return_items` priced at the frozen `order_items.unit_price_snapshot`),
 * so a payment row never multiplies. Payments are not reversed by a return; the report only flags it.
 */
@Injectable()
export class PaymentsReportRepository {
  private conditions(tenantId: string, f: PaymentFilters): SQL[] {
    const c: SQL[] = [sql`p.tenant_id = ${tenantId}`, sql`p.created_at >= ${f.gte.toISOString()}::timestamptz`, sql`p.created_at < ${f.lt.toISOString()}::timestamptz`];
    if (f.locationId) c.push(sql`o.location_id = ${f.locationId}`);
    if (f.locationIds) {
      c.push(f.locationIds.length > 0 ? sql`o.location_id in (${sql.join(f.locationIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`);
    }
    if (f.warehouseId) {
      c.push(sql`o.location_id in (select l2.id from locations l2 where l2.tenant_id = ${tenantId} and l2.warehouse_id = ${f.warehouseId})`);
    }
    if (f.placedByUserId) c.push(sql`o.placed_by_user_id = ${f.placedByUserId}`);
    if (f.documentType) c.push(sql`o.document_type = ${f.documentType}`);
    if (f.paymentMethod) c.push(sql`p.payment_method = ${f.paymentMethod}`);
    if (f.orderNumber) c.push(sql`o.order_number ilike ${contains(f.orderNumber)}`);
    if (f.customerName) c.push(sql`o.customer_name_snapshot ilike ${contains(f.customerName)}`);
    if (f.sellerName) {
      c.push(sql`o.placed_by_user_id in (select u2.id from users u2 where u2.tenant_id = ${tenantId} and u2.full_name ilike ${contains(f.sellerName)})`);
    }
    if (f.amount) c.push(sql`p.amount::text ilike ${contains(f.amount)}`);
    return c;
  }

  private readonly from = sql`
    from order_payments p
    join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id
    left join users u on u.tenant_id = o.tenant_id and u.id = o.placed_by_user_id
    left join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id
    left join warehouses w on w.tenant_id = l.tenant_id and w.id = l.warehouse_id`;

  async list(
    tx: TenantTransaction,
    tenantId: string,
    filters: PaymentFilters,
    paging: { limit: number; offset: number; sort: PaymentSortColumn; dir: 'asc' | 'desc' },
  ): Promise<PaymentListRow[]> {
    const direction = paging.dir === 'asc' ? sql`asc` : sql`desc`;
    const rows = await tx.execute<PaymentListRow>(sql`
      select
        p.id as "id",
        p.created_at as "paidAt",
        o.id as "orderId",
        o.order_number as "orderNumber",
        o.customer_name_snapshot as "customerName",
        p.payment_method as "paymentMethod",
        p.amount::text as "amount",
        u.full_name as "sellerName",
        o.location_id as "locationId",
        (w.name || ' · ' || l.name) as "locationLabel",
        o.document_type as "documentType",
        (select count(*) from sales_returns sr
          where sr.tenant_id = o.tenant_id and sr.order_id = o.id and sr.status <> 'cancelled')::text as "returnCount",
        (select array_agg(sr.return_number order by sr.created_at) from sales_returns sr
          where sr.tenant_id = o.tenant_id and sr.order_id = o.id and sr.status <> 'cancelled') as "returnNumbers",
        (select coalesce(sum(sri.quantity_returned * oi.unit_price_snapshot), 0)::text
          from sales_returns sr
          join sales_return_items sri on sri.tenant_id = sr.tenant_id and sri.return_id = sr.id
          join order_items oi on oi.tenant_id = sri.tenant_id and oi.id = sri.order_item_id
          where sr.tenant_id = o.tenant_id and sr.order_id = o.id and sr.status <> 'cancelled') as "returnedValue"
      ${this.from}
      where ${sql.join(this.conditions(tenantId, filters), sql` and `)}
      order by ${sortExpression(paging.sort)} ${direction}, p.id ${direction}
      limit ${paging.limit} offset ${paging.offset}`);
    return [...rows];
  }

  async totalsByMethod(tx: TenantTransaction, tenantId: string, filters: PaymentFilters): Promise<MethodTotalRow[]> {
    const rows = await tx.execute<MethodTotalRow>(sql`
      select p.payment_method as "paymentMethod", count(*)::text as "paymentCount", coalesce(sum(p.amount), 0)::text as "amount"
      ${this.from}
      where ${sql.join(this.conditions(tenantId, filters), sql` and `)}
      group by p.payment_method
      order by p.payment_method`);
    return [...rows];
  }
}
