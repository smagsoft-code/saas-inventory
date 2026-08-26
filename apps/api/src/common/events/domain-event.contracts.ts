import type { KnownEventType } from './event-types';

/**
 * Typed domain-event contracts (§19-§23). The **envelope** is the self-describing, stable,
 * versioned, JSON-serialisable object stored verbatim in `event_outbox.payload` and delivered
 * unchanged to a downstream consumer once FASE 15 exists. The outbox row's own columns
 * (`event_type`, `aggregate_type`, `aggregate_id`, `correlation_id`, `tenant_id`, `created_at`) are
 * denormalised copies of envelope fields, kept for claiming/indexing — the envelope is the source
 * of truth for delivery.
 */

export type AggregateType = 'order' | 'price_approval' | 'sales_return';

/** Who caused the fact, captured at the moment it happened (§78) — never resolved later from
 * `users` by the Event Processor. `system` + `id: null` is reserved for future non-user producers. */
export interface EventActor {
  type: 'user' | 'system';
  id: string | null;
}

export interface DomainEventEnvelope<TData = unknown> {
  /** Stable, unique, generated once when the event is written and never regenerated on retry
   * (§21). Equal to `event_outbox.id`. A downstream consumer dedupes on this (at-least-once). */
  eventId: string;
  eventType: KnownEventType;
  eventVersion: number;
  /** When the business fact occurred (ISO-8601 UTC). ~= the row's `created_at` (same transaction),
   * but semantically distinct (§75). */
  occurredAt: string;
  /** Present for every tenant-scoped fact; `null` only for a platform-global event (none in FASE 14). */
  tenantId: string | null;
  aggregateType: AggregateType;
  aggregateId: string;
  /** The originating request's correlation id (api.md#correlation-id), UUID-validated — `null` if
   * the request carried a non-UUID `Correlation-Id` header, same rule as AuditLogService. */
  correlationId: string | null;
  actor: EventActor;
  data: TData;
}

/** What a producer service passes to `DomainEventPublisher.append()`. `eventId`/`occurredAt` are
 * filled by the publisher; `eventVersion` defaults to the current contract version for the type. */
export interface DomainEventInput<TData = unknown> {
  eventType: KnownEventType;
  eventVersion?: number;
  tenantId: string | null;
  aggregateType: AggregateType;
  aggregateId: string;
  correlationId?: string | null | undefined;
  actor: EventActor;
  data: TData;
}

// ---------------------------------------------------------------------------------------------------
// Per-event `data` payloads. Data minimisation per ADR-0028 / §31 / §32: no `unit_cost` / `min_price`
// / `base_price` / `max_price` snapshots, no secrets/tokens/hashes, no binary blobs.
// ---------------------------------------------------------------------------------------------------

export interface OrderConfirmedLine {
  productVariantId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
}

export interface OrderConfirmedData {
  orderId: string;
  orderNumber: string;
  documentType: string;
  invoiceStatus: string | null;
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  locationId: string;
  placedByUserId: string | null;
  /** Whether any line used a below-min_price exceptional discount (an approved request gated the
   * confirm). The floor/approval detail is not in the payload — ADR-0028. */
  hasExceptionalDiscount: boolean;
  /** Frozen buyer snapshot from the order (PII — the minimum a notification consumer needs). */
  customer: {
    name: string;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    address: Record<string, unknown> | null;
  };
  lines: OrderConfirmedLine[];
}

export interface OrderCancelledData {
  orderId: string;
  orderNumber: string;
  documentType: string;
}

export interface PriceApprovalRequestedData {
  approvalId: string;
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  productVariantId: string;
  sku: string;
  productName: string;
  quantity: number;
  requestedPrice: number;
  /** Computed against `max_price` (the list ceiling), never `min_price` — a consumer cannot back
   * out the floor from this (ADR-0028, §32). `minPriceAtRequest` is deliberately NOT in the
   * payload; an approver sees the floor in-app via their own `pricing.floor.view`. */
  maxPriceAtRequest: number;
  discountAmount: number;
  reason: string;
  requestedByUserId: string;
}

export interface PriceApprovalResolvedData {
  approvalId: string;
  orderId: string;
  orderItemId: string;
  status: 'approved' | 'rejected';
  resolvedByUserId: string;
  requestedByUserId: string;
}

export interface SalesReturnLine {
  orderItemId: string;
  productVariantId: string;
  sku: string;
  quantityReturned: number;
}

export interface SalesReturnRequestedData {
  returnId: string;
  orderId: string;
  orderNumber: string;
  locationId: string;
  reason: string;
  requestedByUserId: string;
  lines: SalesReturnLine[];
}

/** No `sku` — the `sales.return.requested` event already carried it per `orderItemId`; a consumer
 * correlates on `returnId` + `orderItemId`. */
export interface SalesReturnResolvedLine {
  orderItemId: string;
  productVariantId: string;
  quantityReturned: number;
  disposition: string | null;
  dispositionLocationId: string | null;
}

export interface SalesReturnResolvedData {
  returnId: string;
  orderId: string;
  locationId: string;
  lines: SalesReturnResolvedLine[];
}

export interface SalesReturnCancelledData {
  returnId: string;
  orderId: string;
  status: 'cancelled';
}
