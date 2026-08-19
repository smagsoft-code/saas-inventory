# ADR-0018: Tenant-Aware Referential Integrity (Composite Foreign Keys)

## Status

Accepted

## Context

[ADR-0004](0004-tenant-isolation-strategy.md) established tenant context resolution, guard-layer
enforcement, repository-layer filtering, and planned RLS. None of those layers, by themselves, stop a
structurally different failure mode: a foreign key whose *referenced row* belongs to a different
tenant than the *referencing row* — e.g. `order_items.product_variant_id` pointing at a
`product_variants` row owned by a different tenant. A plain `FOREIGN KEY (product_variant_id)
REFERENCES product_variants(id)` only guarantees the variant exists *somewhere*; it says nothing about
whose tenant it belongs to. If application code ever passes the wrong id — a bug, or a lookup that
forgot its own `tenant_id` filter — the database would accept
`orders(tenant A) → product_variants(tenant B)` without complaint. RLS's `WITH CHECK` clause
constrains the *row being written* to match the session's tenant; it does not, by itself, verify that
a *referenced* row (checked via a separate FK lookup, not through the RLS-filtered view in the same
way) belongs to that same tenant. This is exactly the shape of bug
[threat-model.md#cross-tenant-access](../security/threat-model.md#cross-tenant-access) rates P0, and
closing it structurally — not just procedurally — was identified as a gap while designing the
database schema in Prompt 02.

## Decision

Every tenant-owned table gets `UNIQUE (tenant_id, id)` in addition to its primary key. Every foreign
key between two tenant-owned tables is written as the composite form:

```sql
ALTER TABLE order_items
    ADD CONSTRAINT order_items_variant_fk
    FOREIGN KEY (tenant_id, product_variant_id)
    REFERENCES product_variants (tenant_id, id)
    ON DELETE RESTRICT;
```

This makes it impossible, at the database level, to insert a child row whose `tenant_id` doesn't
match its parent's `tenant_id` — there is no row in the parent table with that exact
`(tenant_id, id)` pair if the parent's real tenant differs. This holds even if the application layer,
RLS, and code review all failed simultaneously. Full detail and the complete list of tables this
applies to: [database.md#tenant-aware-referential-integrity](../architecture/database.md#tenant-aware-referential-integrity).

Two documented exceptions, not oversights:

- FKs from a tenant-owned table to a **platform-scoped** table (e.g.
  `role_permissions.permission_code → permissions.code`) stay a plain single-column FK — the target
  has no `tenant_id` to compose against, and that absence is exactly what stops a tenant from
  inventing a permission outside the fixed catalog.
- Polymorphic soft references (`inventory_movements.reference_id`, `audit_log.entity_id`,
  `qr_codes.target_id`, and similar) are not FK-constrained at all — Postgres cannot express a
  conditional FK across more than one possible target table — and are validated in the application
  layer instead, as is standard practice for ledger/audit-style polymorphic references.

## Alternatives considered

- **Rely on RLS alone.** Rejected as insufficient for this specific failure mode: RLS constrains which
  rows a query can see/write for the *table being queried*, but a composite FK is what verifies the
  relationship between two rows at write time regardless of which role or query path performed the
  write. The two are complementary, not substitutes — this is consistent with
  [ADR-0004](0004-tenant-isolation-strategy.md)'s existing "don't rely on RLS alone" position, applied
  to a specific mechanism RLS doesn't cover.
- **Trigger-based validation** (a `BEFORE INSERT`/`UPDATE` trigger comparing the child's `tenant_id`
  against a `SELECT` of the parent's `tenant_id`). Rejected: a hand-written trigger per relationship is
  more code to maintain and review than a declarative constraint, is easier to forget on a new table,
  and doesn't get query-planner benefits a real FK constraint gets. The composite-FK pattern achieves
  the identical guarantee declaratively.
- **Single-column FK, rely entirely on application/repository-layer tenant filtering.** This is the
  status quo `ADR-0004` already describes as insufficient alone — rejected for the same reason RLS
  was added as a backstop: a single code path that forgets the filter should not be sufficient to
  cause a cross-tenant link.

## Consequences

- Every tenant-owned table needs the extra `UNIQUE (tenant_id, id)` constraint — cheap (it's backed by
  an index that also serves as the natural tenant-scoped lookup index) but must be present on every
  such table without exception, checked the same way RLS coverage is checked
  ([database.md#testing-rls](../architecture/database.md#testing-rls)).
- Every FK migration between two tenant-owned tables must use the composite form — a plain
  single-column FK to a tenant-owned table going forward is a design mistake, not a valid shorthand,
  and is expected to be caught in schema review.
- Drizzle's schema DSL supports composite foreign keys via its `foreignKey()` helper; this is an
  implementation detail for Prompt 03, not a blocker to this decision.
