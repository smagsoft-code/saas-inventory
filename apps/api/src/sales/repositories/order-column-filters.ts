import { sql, type SQL } from 'drizzle-orm';

/**
 * Per-column filters and sort expressions of the sales history table, shared by the orders list
 * (`OrdersRepository.listByTenant`) and the sales-summary report (`SalesReportRepository`) so the
 * cards above the table always count exactly the rows the table shows.
 *
 * Every fragment is plain SQL over the `orders` table's own (unaliased) name plus parameterised
 * values — never string-concatenated user input. Sub-selects use literal table/column names on
 * purpose: Drizzle renders a column object differently (qualified or not) depending on the query it
 * sits in, which is ambiguous inside a correlated sub-select (`status` exists on both `orders` and
 * `event_outbox`); literal identifiers render the same everywhere. All of them are tenant-scoped.
 */

export const NOTIFICATION_STATUS_FILTERS = ['none', 'pending', 'delivered', 'failed'] as const;
export type NotificationStatusFilter = (typeof NOTIFICATION_STATUS_FILTERS)[number];

export const ORDER_SORT_COLUMNS = [
  'orderNumber',
  'createdAt',
  'customer',
  'seller',
  'documentType',
  'location',
  'status',
  'total',
  'notification',
] as const;
export type OrderSortColumn = (typeof ORDER_SORT_COLUMNS)[number];

export interface OrderColumnFilters {
  /** One search box: order number OR customer name OR seller name (substring, case-insensitive). */
  q?: string | undefined;
  /** Substring match on `orders.order_number`. */
  orderNumber?: string | undefined;
  /** Substring match on the frozen `customer_name_snapshot`. */
  customerName?: string | undefined;
  /** Substring match on the full name of the user who placed the order. */
  sellerName?: string | undefined;
  /** Substring match on the order total as text (`205` finds `205.00` and `2050.00`). */
  total?: string | undefined;
  /** Rolled-up notification status — the same rule as `rollUpNotificationStatus`. */
  notificationStatus?: NotificationStatusFilter | undefined;
}

/** `%value%` with LIKE metacharacters escaped (default ESCAPE is a backslash). */
function contains(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Roll-up of an order's `event_outbox` rows: no rows → none; any dead_letter → failed; all
 * delivered → delivered; otherwise pending. Same rule as `rollUpNotificationStatus`, in SQL. */
const NOTIFICATION_ROLLUP = sql`(
  select case
    when count(*) = 0 then 'none'
    when bool_or(eo.status = 'dead_letter') then 'failed'
    when bool_and(eo.status = 'delivered') then 'delivered'
    else 'pending'
  end
  from event_outbox eo
  where eo.tenant_id = orders.tenant_id and eo.aggregate_type = 'order' and eo.aggregate_id = orders.id
)`;

export function orderColumnFilterConditions(tenantId: string, filters: OrderColumnFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.q) {
    const pattern = contains(filters.q);
    conditions.push(
      sql`(orders.order_number ilike ${pattern} or orders.customer_name_snapshot ilike ${pattern} or orders.placed_by_user_id in (select u.id from users u where u.tenant_id = ${tenantId} and u.full_name ilike ${pattern}))`,
    );
  }
  if (filters.orderNumber) {
    conditions.push(sql`orders.order_number ilike ${contains(filters.orderNumber)}`);
  }
  if (filters.customerName) {
    conditions.push(sql`orders.customer_name_snapshot ilike ${contains(filters.customerName)}`);
  }
  if (filters.sellerName) {
    conditions.push(
      sql`orders.placed_by_user_id in (select u.id from users u where u.tenant_id = ${tenantId} and u.full_name ilike ${contains(filters.sellerName)})`,
    );
  }
  if (filters.total) {
    conditions.push(sql`orders.total::text ilike ${contains(filters.total)}`);
  }
  if (filters.notificationStatus) {
    conditions.push(sql`${NOTIFICATION_ROLLUP} = ${filters.notificationStatus}`);
  }
  return conditions;
}

/** The ORDER BY expression of a sortable column (always followed by `orders.id` as a tiebreaker). */
export function orderSortExpression(column: OrderSortColumn): SQL {
  switch (column) {
    case 'orderNumber':
      return sql`orders.order_number`;
    case 'createdAt':
      return sql`orders.created_at`;
    case 'customer':
      return sql`lower(orders.customer_name_snapshot)`;
    case 'seller':
      return sql`lower(coalesce((select u.full_name from users u where u.id = orders.placed_by_user_id and u.tenant_id = orders.tenant_id), ''))`;
    case 'documentType':
      return sql`orders.document_type`;
    case 'location':
      return sql`lower(coalesce((select w.name || ' · ' || l.name from locations l join warehouses w on w.tenant_id = l.tenant_id and w.id = l.warehouse_id where l.tenant_id = orders.tenant_id and l.id = orders.location_id), ''))`;
    case 'status':
      return sql`orders.status`;
    case 'total':
      return sql`orders.total`;
    case 'notification':
      return NOTIFICATION_ROLLUP;
  }
}
