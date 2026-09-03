import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
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
@Injectable()
export class OrderNotificationsRepository {
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
