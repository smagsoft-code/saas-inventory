# ADR-0017: Product Model — Hybrid Relational + JSONB, Product/Variant Split

## Status

Accepted

## Context

The Prompt 01 architecture left the product attribute/variant model as an explicit
`PENDING DECISION` for Prompt 02 (see the Prompt 01 version of
[database.md](../architecture/database.md), superseded by this rewrite; git history at commit
`8f93f6c`), with one binding constraint carried forward regardless of the choice: the model must not
require a schema
migration to add a new attribute for a new product category, and must not assume every product is "a
physical unit with a fixed set of columns."

## Decision

A hybrid model: one `products` row per sellable *concept* (name, description, category, brand,
status, a JSONB `attributes` bag for descriptive fields), and one or more `product_variants` rows per
actually-stocked, actually-priced, actually-sellable unit (SKU, barcode, price, cost, status, its own
JSONB `attributes` bag for differentiating fields like color/capacity/size). Every product has at
least one variant, even a product with no real variation, so INVENTORY and SALES always reference
exactly one kind of thing (`product_variant_id`), never a polymorphic "sometimes product, sometimes
variant." Full detail: [database.md#catalog-products-variants-attributes](../architecture/database.md#catalog-products-variants-attributes).

## Alternatives considered

- **Pure JSONB, no variants table.** Rejected: INVENTORY and SALES need a single, precise,
  independently-priced, independently-stocked row to join against, index, and row-lock (see
  [database.md#concurrency-strategy](../architecture/database.md#concurrency-strategy)) — folding
  that into a JSONB array on `products` gives up SKU-uniqueness enforcement, an indexable
  price/status column, and a stable FK target for `inventory_balances`.
- **Pure EAV (entity-attribute-value).** Rejected: every attribute read/write becomes an extra join or
  key-value scan, and reporting/filtering across attributes is materially slower and more awkward in
  Postgres than a handful of real columns plus a JSONB bag — EAV's flexibility isn't needed for the
  fields that actually require indexing (SKU, price, status, category), and actively hurts everywhere
  else.
- **Fully normalized relational attributes** (a `product_attributes`/`product_attribute_values`
  table pair, one row per attribute per product). Rejected for the same reason as EAV — it's a
  specific case of EAV — plus it reintroduces exactly the "new attribute needs a schema change"
  problem if attribute *types* (not just values) end up needing their own columns later.

## Consequences

- Fields every vertical needs to filter/sort/join on (SKU, barcode, price, cost, status, category,
  brand) are real typed columns with real constraints and indexes.
- Fields that vary per category (color, capacity, dimensions, material, ...) live in JSONB
  `attributes` — adding a new one is a data change, not a migration, closing the constraint carried
  forward from Prompt 01.
- A `GIN` index on `attributes` is deliberately not added in the initial migration (no query pattern
  needs it yet) but the column is shaped to support one cheaply the moment CATALOG implements
  attribute-based filtering.
- Optional serialization (`product_serials`) and lot tracking (`product_lots`) are modeled as
  separate tables hanging off `product_variants`, kept intentionally light in this phase — their
  linkage into inventory movements is elaborated when FASE 8/9 actually builds that traceability, not
  fully pinned now.
