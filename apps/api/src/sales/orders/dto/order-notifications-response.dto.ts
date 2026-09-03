import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Read-only projection of the `event_outbox` rows for one order's domain events (F17-10, closing
 * `GAP-NOTIF-STATUS`). `app_tenant` has held `SELECT` on `event_outbox` since migration 0010 (plus
 * tenant-isolation RLS) — this endpoint is the first application code to read it back; **no schema
 * or grant change**. Gated by `sales.orders.view` (the same permission that reads the order).
 *
 * Deliberately delivery **metadata only** — never `payload` (carries the buyer PII snapshot) and
 * never `last_error` (worker-internal, §14/§26). Retrying a failed delivery is **not** exposed:
 * `app_tenant` has no `UPDATE` grant on `event_outbox` and re-queuing is the Event Processor's job —
 * see `GAP-NOTIF-RETRY-BACKEND`.
 */
export class OrderNotificationEventDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'The stable event id consumers dedupe on (event_outbox.id).' })
  eventId!: string;

  @ApiProperty({ type: String, description: 'e.g. "sales.order.confirmed" / "sales.order.cancelled".' })
  eventType!: string;

  @ApiProperty({
    enum: ['pending', 'processing', 'delivered', 'dead_letter'],
    description:
      'event_outbox delivery status. "pending" also covers a deployment with outbound notifications disabled (nothing claims the row).',
  })
  status!: string;

  @ApiProperty({ type: Number, description: 'Delivery attempts so far.' })
  attempts!: number;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the event was recorded (event_outbox.created_at).' })
  occurredAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'When it reached a terminal "delivered" (event_outbox.processed_at).' })
  processedAt?: string;
}

export class OrderNotificationsResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    enum: ['none', 'pending', 'delivered', 'failed'],
    description:
      'Rollup for a status badge: "none" (no events yet), "failed" (any dead_letter), "delivered" (every event delivered), else "pending".',
  })
  overallStatus!: string;

  @ApiProperty({ type: [OrderNotificationEventDto] })
  events!: OrderNotificationEventDto[];
}
