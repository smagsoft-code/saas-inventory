# ADR-0020: Multi-Location Inventory Transfers and In-Transit Representation

## Status

Accepted

## Context

Prompt 02's inventory model ([database.md](../architecture/database.md), as of that prompt) defined
`inventory_balances` and `inventory_movements` but did not model a transfer as its own business
operation — `TRANSFER_OUT`/`TRANSFER_IN` existed in the `movement_type` catalog, but nothing tied a
paired `TRANSFER_OUT`+`TRANSFER_IN` together as one auditable operation with a requester, an approver,
a status, and a record of what was requested vs. actually dispatched vs. actually received. Prompt 02-A
requires this explicitly, plus two harder constraints: transfers must work between **any** pair of
authorized locations (not a fixed "Bodega → Almacén" direction), and a transferred quantity must not
be sellable at the destination while it is physically in transit.

## Decision

`inventory_transfers` (header: `source_location_id`, `destination_location_id`, status, requester/
approver/dispatcher, timestamps) + `inventory_transfer_items` (requested/dispatched/received
quantities per product) + `inventory_transfer_receipts`/`inventory_transfer_receipt_items` (an
append-only ledger of receiving events, since receiving is genuinely repeatable — partial receipts
across multiple events). `source_location_id`/`destination_location_id` are both plain `location_id`
references with a `CHECK (source_location_id <> destination_location_id)` — no location-pair-type
distinction exists anywhere in the schema, so Bodega↔Almacén, Almacén↔Almacén, and Bodega↔Bodega are
identical operations. Full schema:
[database.md#inventory-transfers-and-in-transit-stock](../architecture/database.md#inventory-transfers-and-in-transit-stock).

**In-transit stock is derived, not stored.** No new bucket is added to `inventory_balances`. The
transfer lifecycle maps entirely onto `inventory_movements` types the Prompt 02 catalog already has
(`RESERVATION` at `PREPARING`, `RESERVATION_RELEASE`+`TRANSFER_OUT` at `DISPATCHED`, `TRANSFER_IN` per
receiving event) — source's `quantity_available` already drops correctly at dispatch and destination's
stays at zero until an actual `TRANSFER_IN` is written, so "in transit" is simply
`SUM(dispatched - received)` over open transfer items, queryable directly, never a second place that
needs to be kept in sync with the balance table.

## Alternatives considered

- **A `warehouse_id`/`store_id`-typed pair of columns, or separate `warehouse_to_store_transfers`/
  `store_to_warehouse_transfers` tables.** Rejected outright per this prompt's explicit instruction — a
  transfer is between any two `location`s, and `location` (already a type-agnostic hierarchy per the
  Prompt 02 design) is already the correct unit. Typing the transfer by location kind would need a new
  concept every time the tenant's physical layout doesn't fit "warehouse vs. store," and would need
  four times the code/tables for what is structurally one operation.
- **A `quantity_in_transit` column on `inventory_balances`, keyed by transfer or by a synthetic
  "in-transit location."** Considered and rejected: it would duplicate information already fully
  derivable from `inventory_transfer_items`, creating a second place that must be updated in lockstep
  with the transfer tables (a classic materialized-value staleness risk) for no query-performance
  benefit large enough to justify it at this stage — the derived query is a simple aggregate over an
  indexed, tenant-scoped table.
- **`quantity_received` as a value the receiving UI directly sets (overwrite), rather than an
  append-only receipt-event ledger.** Rejected: this prompt explicitly requires that a partial-receipt
  discrepancy (shipped 50, received 47) never be resolved by overwriting history — an append-only
  `inventory_transfer_receipts`/`inventory_transfer_receipt_items` ledger, with
  `inventory_transfer_items.quantity_received` as a materialized running total (the same
  balance-vs-ledger split used everywhere else in this schema), is the only design that preserves every
  individual receiving event's own record.

## Consequences

- No new `inventory_movements.movement_type` values were needed — `RESERVATION`,
  `RESERVATION_RELEASE`, `TRANSFER_OUT`, `TRANSFER_IN` (all already in the Prompt 02 catalog) cover the
  full transfer lifecycle, confirming the original catalog was already sized correctly for this.
- A transfer's dispatch reserves stock at the source starting at `PREPARING`, not merely at `APPROVED`
  — an approved-but-not-yet-picked transfer does not hold stock hostage from being sold.
- Cancellation is only schema-valid before `DISPATCHED` — reversing an already-dispatched transfer is a
  new, opposite-direction transfer, not a cancellation, avoiding an ambiguous "undo a physical shipment"
  state.
- Location-based receive authorization ([ADR-0024](0024-location-scoped-authorization.md)) checks
  against `destination_location_id` specifically, giving a concrete enforcement target for "this user
  can only receive transfers destined for their assigned location."
