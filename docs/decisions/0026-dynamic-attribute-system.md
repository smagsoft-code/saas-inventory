# ADR-0026: Dynamic Attribute System (`attribute_definitions`, `category_attributes`)

## Status

Accepted

## Context

Prompt 02 committed `products.attributes`/`product_variants.attributes` to JSONB specifically so a new
attribute for a new category doesn't need a schema migration ([ADR-0017](0017-product-variant-attribute-model.md)).
An audit for Prompt 02-B found that decision correct but incomplete: nothing governed *which* JSONB keys
were legal, what type/unit each held, whether it was required, or (for closed sets like color) what
values were allowed. For a catalog spanning furniture, appliances, electronics, motorcycles, and
clothing in the same platform — Prompt 02-B's explicit premise — an ungoverned JSONB bag cannot support
real validation, a generated Excel template, or meaningful search, no matter how flexible it is.

## Decision

`attribute_definitions` (tenant-owned attribute metadata: code, name, data type, `product`/`variant`
scope, optional unit, default required-ness, optional numeric range) + `attribute_options` (the
controlled value catalog for `select`/`multi_select` types) + `category_attributes` (which attributes a
category requires, with a per-category override of the required-ness default) + `measurement_units` (a
small, platform-owned, fixed unit catalog, structurally identical to `permissions`). Full schema:
[database.md#dynamic-attributes-governance-for-the-catalog-jsonb](../architecture/database.md#dynamic-attributes-governance-for-the-catalog-jsonb).

**JSONB remains the sole storage mechanism.** No `attribute_values` row-per-value table is introduced —
that would be EAV, which [ADR-0017](0017-product-variant-attribute-model.md) already rejected with
reasoning (query/join cost, reporting complexity) that is unchanged by this decision. This ADR adds
*governing metadata*, not a second storage layer.

**Validation is primarily backend, not database**, for every rule requiring a cross-table lookup
(attribute exists, type matches, required-for-this-category, value in the closed set, within range) —
only structural JSONB well-formedness is database-enforced. One reason among several: the *same*
validation service is shared between the interactive product form and the Excel-import row validator
([ADR-0027](0027-staged-excel-import-pipeline.md)), which needs field-level, per-row error messages a
Postgres constraint/trigger error cannot produce.

## Alternatives considered

- **Fully normalized EAV** (`attribute_values`, one row per product per attribute). Rejected — this is
  the alternative [ADR-0017](0017-product-variant-attribute-model.md) already rejected; nothing about
  needing *governance* metadata changes the reasoning against using EAV for *storage*. The two are
  orthogonal: this ADR's tables describe the shape of legal JSONB, they don't replace the JSONB.
- **A fixed, platform-wide attribute catalog shared across all tenants** (so "Color" is one global
  row, not one per tenant). Rejected: would break tenant isolation's structural guarantee (a
  platform-shared row with no `tenant_id` is exactly the kind of table this platform reserves for truly
  global concerns like `permissions`, not tenant-configurable data) and would force every tenant into
  the same attribute vocabulary — directly contradicting this prompt's premise that different verticals
  need genuinely different attributes. Reuse is achieved *within* a tenant instead (define once per
  tenant, attach to many of that tenant's categories).
- **Category-tree attribute inheritance** (a child category automatically gets its parent's attributes).
  Evaluated and not built — see the detailed reasoning in
  [database.md#dynamic-attributes-governance-for-the-catalog-jsonb](../architecture/database.md#dynamic-attributes-governance-for-the-catalog-jsonb):
  the reuse goal is already met by attaching the same definition to multiple categories directly, and
  inheritance would meaningfully complicate "what does this category actually require" resolution for
  a savings that amounts to one join-table row per category. Revisitable if direct assignment proves
  insufficient.
- **A per-value unit** (each JSONB value carries its own unit alongside the magnitude) instead of a
  unit fixed on the attribute definition. Rejected: would let two rows for the same attribute disagree
  on unit, silently breaking numeric range queries/comparisons — fixing the unit once, at the
  definition, eliminates that failure mode structurally.
- **New DB-level types for `CURRENCY`/`URL`/`COLOR`/`MEASUREMENT`.** Evaluated individually and rejected
  — each is either already exactly representable by an existing type plus (for `MEASUREMENT`) the unit
  mechanism, or (for `COLOR`) is exactly what `SELECT` already is for a closed catalog. Adding them
  would be ceremony without a structural difference in storage or querying.

## Consequences

- Every tenant that wants attribute-driven categories must configure `attribute_definitions`/
  `attribute_options`/`category_attributes` for each category before entering products against it — a
  real onboarding step, mitigated by the demo tenant seeding a representative example
  ([database.md#seed-and-demo-tenant](../architecture/database.md#seed-and-demo-tenant)) and by the
  Excel import pipeline's dynamic template generation making the requirement visible up front rather
  than discovered mid-entry.
- A `GIN`/expression index on `attributes` is still deliberately not added until a real filter/search
  query pattern exists — this ADR does not change that stance, only makes the JSONB *content* trustworthy
  ahead of whichever index is added later.
- A retired `attribute_definitions`/`attribute_options` row is never hard-deleted (soft-delete /
  `status = 'inactive'` respectively) specifically so a historical product's JSONB value stays
  resolvable to a name/label even after the tenant stops offering it for new products.
