# ADR-0024: Location-Scoped Authorization as an RBAC Extension

## Status

Accepted. **The default-semantics paragraph below ("a user with zero rows is unrestricted") is
superseded by [ADR-0035](0035-location-scope-deny-by-default.md)** — zero rows now denies, except
for the tenant's founding, system-default "Administrador" role. Everything else on this page (the
mechanism, the two-independent-checks model, the schema) is unchanged and still authoritative.

## Context

[ADR-0009](0009-rbac-permissions.md) established permission-based RBAC (`inventory.receive`,
`inventory.adjust`, etc.) — sufficient to answer "can this user perform this *kind* of action at all,"
but not "at *which specific location*." Prompt 02-A requires the latter: a user with `inventory.receive`
should not, purely by holding that permission, be able to confirm receipt of a transfer destined for
every location in the tenant — a Bodega Norte worker with receiving rights should not thereby also be
able to receive shipments at Almacén Sur.

## Decision

`user_location_assignments` (`user_id`, `location_id`, composite tenant-aware FKs to both) — a plain
join table, not a new permission dimension inside the existing RBAC tables. **Default semantics
(original, ROLES/ALCANCE-era; superseded by [ADR-0035](0035-location-scope-deny-by-default.md) — kept
here verbatim for history): a user with zero rows is unrestricted (all tenant locations); a user with
one or more rows is restricted to exactly those.** This is an explicit, documented convention (opt-in
restriction, not opt-in access) rather than an implicit one, so Prompt 03's guard implementation and
Prompt 07/08's provisioning flows don't have to infer it. Authorization for a location-sensitive action
is the conjunction of two
independent checks — the RBAC permission, and (if the user has any location-assignment rows) location
membership — neither substituting for the other. Full schema:
[database.md#location-scoped-authorization](../architecture/database.md#location-scoped-authorization).

## Alternatives considered

- **Extend `role_permissions`/`permissions` with a location-scoped permission variant** (e.g.
  `inventory.receive:location_id`). Rejected: the fixed permission catalog
  ([ADR-0009](0009-rbac-permissions.md)) is deliberately small, platform-controlled, and shared across
  every tenant's role configuration — parameterizing individual permission strings by an
  tenant-specific, per-location value would break that catalog's "fixed, enumerable set of checkable
  strings" property, and would need a permission row per location per tenant, which doesn't scale and
  isn't reviewable the way the current catalog is.
- **A `location_id` column directly on `users`** (one assigned location per user). Rejected: too rigid
  — a supervisor legitimately needs to operate across several locations, and a single-column design
  can't express "unrestricted" without a magic sentinel value (`NULL` meaning "all locations" is
  workable but a dedicated join table scales better to "assigned to exactly these three locations,"
  which a single column cannot represent at all).
- **Default to "restricted unless explicitly marked unrestricted"** (an `is_unrestricted` flag on
  `users`, rows in `user_location_assignments` only relevant when that flag is false). Rejected as
  unnecessary indirection: "zero rows = unrestricted" already expresses exactly this without a second
  column that could disagree with the row set it's supposed to gate.

## Consequences

- Every operational user (Bodega, Vendedor roles) is expected, by provisioning convention, to always
  receive explicit `user_location_assignments` rows — Administrator-role users are expected to never
  receive any, and stay unrestricted by that absence. This convention lives in application
  provisioning logic, not a schema constraint (a `CHECK` cannot enforce "this role always gets rows,"
  since role membership is data, not a fixed schema fact).
- The guard combining RBAC + location authorization is Prompt 07/08 implementation work, not built now
  — this ADR and its schema only fix the data model the guard will read.
- A location-authorization bug (an employee accessing another location of the *same* tenant) is a real
  but lower-severity class of bug than the cross-tenant leakage
  [ADR-0004](0004-tenant-isolation-strategy.md) treats as P0 — it never crosses a tenant boundary, and
  remains reviewable after the fact via `audit_log` regardless.
