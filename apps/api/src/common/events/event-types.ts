/**
 * The domain-event catalog (events.md#event-catalog), FASE 14. Every event is a business fact that
 * ALREADY HAPPENED — never a command. Names are `module.aggregate.action` in the past tense; every
 * contract carries an explicit `eventVersion` (see CURRENT_EVENT_VERSIONS) so a payload shape can
 * never change silently under the same version.
 *
 * FASE 14 publishes only the SALES facts downstream integration (FASE 15) is known to need. No
 * INVENTORY/CORE events are emitted yet — they get added to this catalog by the phase that has a
 * real consumer for them (events.md, §14).
 */
export const EVENT_TYPES = {
  /** order pending -> confirmed (the physical sale commit — RESERVATION_RELEASE + SALE). */
  ORDER_CONFIRMED: 'sales.order.confirmed',
  /** order draft/pending -> cancelled (a still-pending reservation released). */
  ORDER_CANCELLED: 'sales.order.cancelled',
  /** a below-base_price order line's exceptional-discount request was filed (new `pending` row). */
  PRICE_APPROVAL_REQUESTED: 'sales.price_approval.requested',
  /** price_approvals pending -> approved (the CAS transition won). */
  PRICE_APPROVAL_APPROVED: 'sales.price_approval.approved',
  /** price_approvals pending -> rejected (the CAS transition won). */
  PRICE_APPROVAL_REJECTED: 'sales.price_approval.rejected',
  /** a sales return was opened against a confirmed order (new -> `requested`). */
  SALES_RETURN_REQUESTED: 'sales.return.requested',
  /** sales_returns inspecting -> resolved (one RETURN inventory movement per line written). */
  SALES_RETURN_RESOLVED: 'sales.return.resolved',
  /** sales_returns requested/inspecting -> cancelled (no inventory effect). */
  SALES_RETURN_CANCELLED: 'sales.return.cancelled',
} as const;

export type KnownEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/**
 * The current contract version per event type. Bumping a payload's shape MUST bump this AND add a
 * matching handler branch downstream (event-dispatcher.service.ts) — a consumer that receives a
 * version it does not understand dead-letters the event rather than mis-processing it (§20, §157).
 */
export const CURRENT_EVENT_VERSIONS: Record<KnownEventType, number> = {
  [EVENT_TYPES.ORDER_CONFIRMED]: 1,
  [EVENT_TYPES.ORDER_CANCELLED]: 1,
  [EVENT_TYPES.PRICE_APPROVAL_REQUESTED]: 1,
  [EVENT_TYPES.PRICE_APPROVAL_APPROVED]: 1,
  [EVENT_TYPES.PRICE_APPROVAL_REJECTED]: 1,
  [EVENT_TYPES.SALES_RETURN_REQUESTED]: 1,
  [EVENT_TYPES.SALES_RETURN_RESOLVED]: 1,
  [EVENT_TYPES.SALES_RETURN_CANCELLED]: 1,
};

export const ALL_KNOWN_EVENT_TYPES: readonly KnownEventType[] = Object.values(EVENT_TYPES);

export function isKnownEventType(value: string): value is KnownEventType {
  return (ALL_KNOWN_EVENT_TYPES as readonly string[]).includes(value);
}
