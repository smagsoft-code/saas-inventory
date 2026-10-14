import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { eventOutbox } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface OrderNotificationRow {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  createdAt: Date;
  processedAt: Date | null;
}

/**
 * Read-only view of `event_outbox` for one order's domain events (F17-10 — closing
 * `GAP-NOTIF-STATUS`). `OutboxRepository` in `common/events` is still the **single writer**; this
 * only ever `SELECT`s, which `app_tenant` has been granted since migration 0010 (with
 * `event_outbox_tenant_isolation` RLS). Tenant scope is enforced by RLS **and** an explicit
 * `tenant_id` predicate (defense in depth, matching every other tenant repository here).
 *
 * `aggregate_type = 'order'` / `aggregate_id = orderId` selects exactly the order's own events
 * (`sales.order.confirmed` / `sales.order.cancelled`) — price-approval and return events carry
 * their own aggregate id and are surfaced on their own screens.
 */
/** Same roll-up rule as `GET /orders/:id/notifications`: any dead_letter → failed; all delivered →
 * delivered; otherwise pending; no events at all → none. */
export function rollUpNotificationStatus(statuses: string[]): 'none' | 'pending' | 'delivered' | 'failed' {
  if (statuses.length === 0) return 'none';
  if (statuses.includes('dead_letter')) return 'failed';
  if (statuses.every((status) => status === 'delivered')) return 'delivered';
  return 'pending';
}

@Injectable()
export class OrderNotificationsRepository {
  /** One query for a whole page of orders (no N+1): order id → rolled-up status. Orders with no
   * event are absent from the map (caller treats absent as `none`). */
  async rollUpByOrders(
    tx: TenantTransaction,
    tenantId: string,
    orderIds: string[],
  ): Promise<Map<string, 'none' | 'pending' | 'delivered' | 'failed'>> {
    const result = new Map<string, 'none' | 'pending' | 'delivered' | 'failed'>();
    if (orderIds.length === 0) return result;
    const rows = await tx
      .select({ aggregateId: eventOutbox.aggregateId, status: eventOutbox.status })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.tenantId, tenantId),
          eq(eventOutbox.aggregateType, 'order'),
          inArray(eventOutbox.aggregateId, orderIds),
        ),
      );
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const list = grouped.get(row.aggregateId) ?? [];
      list.push(row.status);
      grouped.set(row.aggregateId, list);
    }
    for (const [orderId, statuses] of grouped) {
      result.set(orderId, rollUpNotificationStatus(statuses));
    }
    return result;
  }

  async listByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<OrderNotificationRow[]> {
    const rows = await tx
      .select({
        id: eventOutbox.id,
        eventType: eventOutbox.eventType,
        status: eventOutbox.status,
        attempts: eventOutbox.attempts,
        createdAt: eventOutbox.createdAt,
        processedAt: eventOutbox.processedAt,
      })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.tenantId, tenantId),
          eq(eventOutbox.aggregateType, 'order'),
          eq(eventOutbox.aggregateId, orderId),
        ),
      )
      .orderBy(asc(eventOutbox.createdAt));
    return rows.map((row) => ({ ...row, attempts: Number(row.attempts) }));
  }
}
