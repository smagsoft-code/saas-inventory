# Database Architecture (Conceptual)

No tables are created in this phase. This document defines the conventions every table will follow
once schema design starts (Prompt 02), so that design work has a consistent foundation instead of
re-deciding these questions per table. Related: [ADR-0002](../decisions/0002-postgresql.md),
[ADR-0003](../decisions/0003-single-database-multi-tenant.md),
[ADR-0004](../decisions/0004-tenant-isolation-strategy.md),
[ADR-0008](../decisions/0008-drizzle-orm.md).

## Conventions

**Primary keys.** UUIDs, not auto-increment integers — auto-increment IDs leak row counts/growth
rate across tenants and are easy to enumerate. Exact UUID generation strategy (random UUIDv4 vs.
time-ordered UUIDv7 for index locality) is a `PENDING DECISION` for Prompt 02; the constraint is
"UUID, generated so it does not leak sequential/temporal information more than necessary."

**Timestamps.** Every table gets `created_at` and `updated_at` (`timestamptz`, not `timestamp`,
so values are unambiguous across environments). Tables representing tenant business data that can
be "deleted" by a user additionally get `deleted_at` for soft delete (see below); pure lookup/audit
tables generally do not need soft delete.

**Soft delete vs hard delete.** Per [CLAUDE.md §7.7](../../CLAUDE.md#77-database), historical data
is never deleted without an explicit, documented decision. The default for tenant business data
(products, inventory records, orders once they exist) is soft delete via `deleted_at`, with all
read queries filtering `deleted_at IS NULL` by default. Pure reference/audit data
(`InventoryMovement`, `AuditLog`) is never deleted at all — it's an append-only ledger. Which
specific tables get hard-delete instead of soft-delete (if any) is decided per-table during schema
design, not assumed here.

**`tenant_id`.** Every tenant-owned table has a `tenant_id uuid NOT NULL REFERENCES tenants(id)`.
Composite indexes lead with `tenant_id` (e.g. `(tenant_id, sku)`, `(tenant_id, created_at)`) since
essentially every query is tenant-scoped — see [multi-tenancy.md](multi-tenancy.md). Global tables
(`tenants`, `platform_admins`, system settings) have no `tenant_id`.

**Foreign keys and constraints.** Referential integrity is enforced by the database, not only by
application code — `FOREIGN KEY` constraints with an explicit `ON DELETE` behavior chosen per
relationship (`RESTRICT` by default for anything that would silently orphan business data;
`CASCADE` only where that is genuinely the intended behavior, e.g. deleting a draft cart cascades
its cart lines). `NOT NULL` and `CHECK` constraints enforce invariants that matter (e.g. a quantity
column cannot be negative) rather than leaving them to application-layer validation alone.

**Unique constraints are tenant-scoped.** A uniqueness rule like "SKU is unique" is
`UNIQUE (tenant_id, sku)`, not `UNIQUE (sku)` — two different tenants are allowed to use the same
SKU; the platform does not leak that fact by rejecting it as a global collision.

**Indexes are deliberate.** Added for known query patterns (tenant-scoped lookups, foreign keys
used in joins, columns used in `WHERE`/`ORDER BY` on hot paths), not speculatively on every column.
Each index added during implementation is expected to be justified by an actual query, per
[CLAUDE.md §7.7](../../CLAUDE.md#77-database).

**Migrations.** Drizzle Kit, one versioned migration file per schema change, never edited after
being applied — see [ADR-0008](../decisions/0008-drizzle-orm.md) and
[database/migrations/README.md](../../database/migrations/README.md).

## Row-Level Security

RLS is planned as an additional, database-enforced layer of tenant isolation on top of the
application-level guard/repository enforcement described in
[multi-tenancy.md](multi-tenancy.md#enforcement-layers-defense-in-depth) — not a replacement for
it. The intended shape:

```sql
-- Illustrative only — not applied yet.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON products
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

The API's connection/transaction would set `app.tenant_id` (via `SET LOCAL`) from the same
verified tenant context described in multi-tenancy.md, at the start of each request's transaction.
A connection with no `app.tenant_id` set — e.g. an admin/SuperAdmin connection — would see no rows
under RLS unless a separate, explicitly-scoped policy or role grants it broader access.

**`PENDING DECISION`:** whether RLS is turned on for all tenant tables from the first migration
onward, or introduced as a hardening pass after the core schema stabilizes (FASE 15 — Security
Hardening in the [roadmap](../roadmap/roadmap.md)). Turning it on late is safe (it only adds
restrictions) but doing it early gives defense-in-depth sooner at the cost of needing every
connection/transaction path (including seed scripts, migrations, and any admin tooling) to
correctly set or deliberately bypass `app.tenant_id`. This is decided in Prompt 02.

## Product model (conceptual)

The product model must stay generic — usable for line blanca/furniture/appliances today and any
category later — rather than hard-coding fields specific to the initial vertical. Conceptually,
a product needs to support:

- Identity: SKU, barcode, and (via the QR module) a QR code.
- Classification: category, brand.
- Flexible attributes that vary by category (e.g. "color" and "capacity" for a refrigerator,
  "dimensions" and "material" for a furniture piece) without a schema migration per category.
- Variants (e.g. same product in different colors/sizes) as related-but-distinct sellable items.
- Media: images.
- Commercial data: price, cost, status (active/discontinued/...).
- Optional serialization (unique serial number per physical unit) and lot/batch tracking, for
  products where that level of traceability matters.
- Optional warranty terms.

How this becomes tables — one `products` table with a JSONB `attributes` column plus a normalized
`product_variants` table, versus a more fully normalized EAV (entity-attribute-value) model, versus
a hybrid — is a database-design decision for Prompt 02, not this document.
**`PENDING DECISION`.** The constraint this architecture phase does commit to: whatever shape is
chosen must not require a schema migration to add a new attribute to a new product category, and
must not assume every product is "a physical unit with a fixed set of columns" (serialized and
lot-tracked products need different identity semantics than a generic SKU-and-quantity product).

## QR model (conceptual)

A QR code encodes an opaque identifier, not a raw database ID — see
[ADR/](../decisions) and the QR module in [modules.md](modules.md). Scanning it hits a public
resolver endpoint (see [api.md](api.md)) that looks up what the code points to (a product or a
location) and returns only what is appropriate for the requester's context (see
[security.md](security.md) for public-vs-private data exposure). The QR-to-entity mapping is a
table of its own (`qr_codes` or similar: opaque code, target type, target id, tenant_id, status,
optional expiry) rather than embedding a QR value as a column on `products`/`locations` directly —
this keeps QR generation/rotation/expiry independent of the entity it points to. Exact schema is a
Prompt 02 decision.

## Audit log (conceptual)

See [modules.md#audit](modules.md#audit) for what gets audited and
[ADR-0015](../decisions/0015-audit-log.md) for the decision record. Conceptually one
append-only table: actor (user or platform admin id + type), tenant_id (nullable for global
actions), action code, entity type, entity id, before-state, after-state (both as JSONB), 
correlation id, timestamp. Never updated or deleted after being written.
