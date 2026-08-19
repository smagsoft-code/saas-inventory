# ADR-0021: Sales Returns and Disposition via Non-Sellable Locations

## Status

Accepted

## Context

Prompt 02 designed `orders`/`order_items` as a forward-only sale flow with no return path. Prompt 02-A
requires modeling returns linked to the original sale (so "quantity sold" vs. "quantity returned" is
always answerable precisely) and, critically, requires that returned stock is **not** automatically
sellable again — it must go through an inspection step that decides restock / quarantine / damaged /
scrap, and only `restock` should make the stock available for sale.

## Decision

`sales_returns` (header: linked `order_id`, receiving `location_id`, status) +
`sales_return_items` (linked to the specific `order_item_id` being returned — not just the order —
with a nullable `disposition` set at inspection time). No new `inventory_movements.movement_type` is
introduced: a disposition decision writes a `RETURN`-type movement (already in the Prompt 02 catalog)
at a `disposition_location_id`. Whether that stock becomes sellable again is controlled entirely by
whether that destination location is flagged `is_sellable` — a new boolean added to `locations`
([database.md#inventory-warehouses-locations-balance-ledger](../architecture/database.md#inventory-warehouses-locations-balance-ledger)).
`restock` points at a normal, sellable location; `quarantine`/`damaged`/`scrap` point at a
non-sellable one (lowercase, per the enum-value naming convention closed in Prompt 02-D). Full schema:
[database.md#sales-returns-and-disposition](../architecture/database.md#sales-returns-and-disposition).

## Alternatives considered

- **New `inventory_movements.movement_type` values per disposition** (`RETURN_RESTOCK`,
  `RETURN_QUARANTINE`, `RETURN_DAMAGED`, `RETURN_SCRAP`). Rejected: proliferates the movement-type
  vocabulary for information the `sales_return_items.disposition` column and its
  `reference_type = 'sales_return_item'` linkage already carry — a movement's disposition context is
  fully recoverable via that join without needing four new enum values that would then need their own
  handling everywhere `movement_type` is switched on.
- **A separate "quarantine stock" table/mechanism outside `inventory_balances`/`inventory_movements`.**
  Rejected: would create a second inventory-tracking mechanism alongside the one this schema already
  has, duplicating the balance/ledger machinery for no reason — a non-sellable *location* reuses 100%
  of the existing tables and gets full traceability (physical count, ledger, history) for free.
- **A `sales_return_item_dispositions` sub-table supporting split disposition** (part of one line's
  quantity restocked, part scrapped). Considered, not built: this prompt's requirements describe one
  inspection outcome per returned line, and adding split-disposition support now would be speculative
  complexity ahead of a concrete need — flagged as an explicit open item in
  [database.md#open-decisions-carried-forward](../architecture/database.md#open-decisions-carried-forward)
  rather than silently assumed away.
- **Recomputing a return's value from the product's current price.** Rejected outright per this
  prompt's explicit instruction — `sales_return_items.order_item_id` links to the original sale, whose
  `unit_price_snapshot` is already the frozen historical price ([database.md#orders](../architecture/database.md#orders-conceptual--sales-not-built-yet)); nothing about a return needs its own price field.

## Consequences

- `locations.is_sellable` is a small, reusable primitive — useful for returns disposition now, and
  general enough that any future "goods that exist but aren't for sale" scenario (e.g. display units,
  goods awaiting quality certification) can reuse it without a new mechanism.
- A return can reference the same `order_item_id` more than once over time (returns on separate
  occasions from the same purchase) — `SUM(quantity_returned) <= order_item.quantity` is an
  application-layer check, not a database constraint, consistent with how this schema already handles
  similar cross-row aggregate invariants (e.g. transfer quantities).
- No financial write-off/disposal accounting beyond "physically at a non-sellable location" is designed
  — if the business needs formal scrap accounting later, that's a distinct, not-yet-scoped concern.
