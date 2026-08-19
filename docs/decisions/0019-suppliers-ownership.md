# ADR-0019: Suppliers as a CATALOG-Owned Reference Entity

## Status

Accepted

## Context

This prompt's scope requires designing a `suppliers` entity (customers and suppliers are both listed
as required tenant-scoped entities). Auditing the existing architecture before designing it
surfaced a gap: [modules.md](../architecture/modules.md) defines the full module map — CORE, CATALOG,
INVENTORY, QR, SALES (future), NOTIFICATIONS, REPORTS (future), ADMINISTRATION, DEMO — and SALES is
explicitly documented as owning `customers, cart, orders`. **`suppliers` is not mentioned anywhere in
the accepted architecture**, and there is no PURCHASING bounded context in the module map at all. Per
the mandatory process (do not invent functional requirements not backed by the architecture; do not
silently overwrite a prior decision), this needed an explicit resolution rather than being placed
into an existing module by assumption.

## Decision

`suppliers` is placed under **CATALOG**, as a passive reference/attribution entity — analogous to
`brands` — not as the start of a purchasing workflow. Concretely: a `suppliers` table (tenant-scoped,
same shape as `customers`: display name, tax id, contact info, status) and a nullable
`products.supplier_id` FK ("who this product is sourced from"). No purchase orders, receiving,
supplier invoices, or any transactional purchasing flow are designed — none of that is backed by the
current architecture, and inventing it here would be exactly the kind of unrequested functional scope
this prompt's process explicitly prohibits. Full table shape:
[database.md#customers-and-suppliers](../architecture/database.md#customers-and-suppliers).
[modules.md](../architecture/modules.md) is updated to list `suppliers` under CATALOG's
responsibility, alongside `brands`.

## Alternatives considered

- **Place it under SALES, alongside `customers`.** Rejected: SALES's documented responsibility is "a
  customer builds a cart, which becomes an order, which consumes inventory" — a supplier is the
  opposite direction of the same relationship (goods coming in, not going out) and doesn't fit SALES's
  stated scope. Grouping it there purely because "customers and suppliers sound similar" would blur a
  module boundary that's supposed to reflect actual data flow.
- **Invent a lightweight PURCHASING module now**, even without designing its workflow. Rejected: a
  module in [modules.md](../architecture/modules.md)'s dependency graph is a real architectural
  commitment (dependency direction, what it exposes to other modules) — creating one to hold a single
  reference table, with no purchasing workflow behind it, would be architecture theater. If/when a
  real purchasing workflow (POs, receiving, supplier invoices) is scoped, that is the point to
  introduce PURCHASING properly, as its own module with its own dependency edges — not retrofitted
  onto a table that was placed under CATALOG for expediency.
- **Leave `suppliers` out of this design entirely, defer to a future prompt.** Rejected: this prompt's
  explicit scope requires designing customers *and* suppliers; deferring it would leave the schema
  incomplete against the prompt's own acceptance criteria without a documented reason tied to the
  architecture (unlike, say, the order-status-workflow detail, which is genuinely SALES domain logic
  not needed for the schema).

## Consequences

- `suppliers` ships in the same CATALOG migration as `categories`/`brands`
  ([database.md#migration-strategy](../architecture/database.md#migration-strategy)), not a later
  SALES/PURCHASING migration.
- If a real purchasing workflow is scoped later, `suppliers` likely moves conceptually "up" into a new
  PURCHASING module's ownership (module *ownership* of a table can change without changing the
  table's schema) — this is flagged here so that future work doesn't need to rediscover the gap this
  ADR documents.
- No purchase-order, receiving, or supplier-invoice schema exists — any future request for that
  functionality needs its own architecture/design pass, not an assumption that it's already covered
  by this table.
