# ADR-0039: MVP Scope — Serialized and Lot-Tracked Variants Are Not Sellable

## Status

Accepted (2026-10-26)

## Context

The schema supports serialized and lot-tracked variants (`product_serials`, `product_lots`,
`product_variants.is_serialized`/`is_lot_tracked`), and the import pipeline can register them
(ADR-0027). The sales side has never had an approved model linking an `order_item` to a specific
serial or lot, and `inventory_movements` has no serial/lot column, so stock leaving through a sale
cannot be traced to a unit or lot. FASE 12 therefore rejected such variants (`422`) and documented the
deferral as "no phase assigned".

## Decision

For the MVP this is a **scope decision, not a defect**:

1. Variants without serial/lot tracking are sold through the current flow, unchanged.
2. Variants with `is_serialized` or `is_lot_tracked` are rejected with **HTTP 422 Unprocessable
   Entity** at every sales entry point: adding to a cart (`POST /cart/items`) and checkout
   (`POST /orders`, which also covers a variant reclassified after it was carted).
3. A rejection must have **no side effect**: no cart item, no order or order item, no reservation
   (movement or balance), no idempotency record consumed, no audit row and no `event_outbox` row, hence
   no notification. A rejected checkout leaves the cart open and its `Idempotency-Key` reusable.
4. No future phase is assigned. The capability is evaluated only if the owner explicitly widens the
   scope; that would need its own ADR (order-item ↔ serial/lot link, movement traceability, schema).

## Consequences

- Selling serial-numbered appliances or lot-tracked goods is not possible in the MVP; tenants that
  need it must wait for an explicit scope change. This was a stated owner choice, accepted knowingly.
- Behaviour change in this decision: the cart endpoint previously answered `409` for these variants;
  it now answers `422`, consistent with checkout. An inactive variant is still `409`.
- Integration tests (`sales-serialized-lot-rejection.integration.test.ts`) assert the "no side
  effects" property directly against the database.
