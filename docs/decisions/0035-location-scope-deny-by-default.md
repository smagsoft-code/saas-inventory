# ADR-0035: Location-Scoped Authorization Defaults to Deny, with a Founding-Administrador Exception

## Status

Accepted. **Supersedes** the default-semantics paragraph of
[ADR-0024](0024-location-scoped-authorization.md) ("a user with zero rows... is unrestricted").
Everything else in ADR-0024 (the mechanism itself, the two-independent-checks model, the
`user_location_assignments` schema) is unchanged.

## Context

ADR-0024 established: a user with **zero** `user_location_assignments` rows is **unrestricted**
(may operate on any location); one or more rows restricts them to exactly those. This was a
deliberate, documented default, not an oversight — and the ROLES/ALCANCE block's own audit (this
prompt's prior turns) verified it working correctly end to end across sales, inventory adjustments,
and transfers, with real integration tests passing.

The owner explicitly revisited this default while validating the ROLES/ALCANCE block's UX and
decided the opposite is the correct behavior going forward: **an operational user with no explicit
location assignment should not be able to touch inventory anywhere**, rather than everywhere. A
first attempt at this ("zero rows = deny, no exceptions") was checked against the full system
before implementing and found to create a genuine bootstrap deadlock: a freshly registered tenant
has **zero warehouses and zero locations** (both are created later, by the admin, via
`POST /warehouses`) — so the founding Administrador, who is never given any
`user_location_assignments` row at provisioning (`tenant-provisioning.service.ts`), could never
receive the tenant's first stock: there is no location to assign them to until after a
location-scoped write has already succeeded once, and no such write can succeed under a strict
deny-by-default with no assignment. The owner resolved this by requesting a narrow, explicit
exception for the one role that structurally needs to bootstrap the tenant.

## Decision

**`LocationAuthorizationService.assertAccess` now allows a location only if it is explicitly in
the caller's `user_location_assignments` — with one exception: a caller currently holding the
tenant's founding, system-default "Administrador" role is always allowed, unconditionally.**

Concretely (`apps/api/src/inventory/location-authorization.service.ts`):

1. **Deny-by-default is now unconditional for every role except one.** Zero rows no longer means
   unrestricted — it means denied, for Supervisor, Vendedor, Bodega, and any custom role a tenant
   creates. An operational user must be explicitly assigned at least one location before they can
   adjust stock, sell, or touch a transfer at it.
2. **The one exception is keyed to `roles.name = 'Administrador' AND roles.is_system_default =
   true`** — the exact same fixed literal `tenant-provisioning.service.ts`'s `ADMIN_ROLE_NAME`
   constant already uses for "the role a fresh tenant's founding user gets." This is checked live,
   the same way every other `LocationAuthorizationService` check is (`SELECT ... FROM user_roles
   JOIN roles ...`), never cached. It is **not** a permission check and **not** a role-content
   check (an Administrador-equivalent custom role with the same permission bundle does **not**
   get this exception) — it is narrowly an identity check against the one specific row
   provisioning creates.
3. **Consequence, explicitly accepted, not hidden:** because `PATCH /roles/:id` (ROLES/PERMISSIONS
   block) allows renaming any role including this one, a tenant that renames its "Administrador"
   role away from that literal string loses the bootstrap exception for whoever holds it — the
   renamed role becomes subject to the same deny-by-default as every other role, including its
   own holders being unable to operate inventory without an explicit assignment. This is a real,
   deliberately accepted fragility of keying the exception to a mutable `name` field rather than
   an immutable identity — flagged here so a future maintainer does not treat it as a bug. A tenant
   that renames its Administrador role must assign that role's holders a location explicitly, same
   as any other role.
4. **No new column, no new table.** The exception is computed, never stored — `is_system_default`
   and `roles.name` already exist; this ADR adds a read of both, not a schema change.

## Alternatives considered

- **Alternative A: keep ADR-0024 unchanged (zero rows = unrestricted for everyone).** This is what
  the system had, fully implemented and tested, before this ADR. Rejected per explicit owner
  decision: an operational user with no explicit assignment should not default to full access.
- **B + auto-assignment on warehouse/location creation** (whoever creates a warehouse/location gets
  auto-assigned to it). Rejected by the owner: a materially larger change (a new provisioning-like
  mechanism touching `warehouses.manage`/`locations.manage` for every tenant, not just this block),
  needing its own design and ADR, versus the narrower exception this ADR takes.
- **A role-hierarchy flag** (a generic "this role bypasses location scope" boolean on `roles`,
  settable by a tenant admin for any role). Rejected: broader than the one bootstrap problem this
  ADR needs to solve, and it reintroduces exactly the kind of role-ranking concept
  [ADR-0031](0031-role-assignment-escalation-prevention.md) already deliberately avoided for a
  different problem (self-escalation) — extending that avoidance here rather than contradicting it
  elsewhere.

## Consequences

- Every existing integration test that relied on a **non-Administrador** actor (Bodega, Vendedor,
  Supervisor) operating inventory with zero location assignments now fails until either (a) the
  test explicitly assigns that actor a location first, or (b) the test's expectation is updated to
  `403`, whichever the test is actually trying to demonstrate. Tests using the tenant's own founding
  `admin` session for setup/seeding (the overwhelming majority, since `admin` holds the
  system-default Administrador role) are unaffected by this ADR — this is exactly why the
  exception exists.
- A tenant's Administrador role, if never renamed, is permanently unrestricted for inventory
  operations regardless of `user_location_assignments` content — assigning it locations via
  `PUT /users/:id/locations` has no operational effect (still allowed correctly, just redundant).
  The UI (ROLES/ALCANCE block) should communicate this so an admin does not assume assigning
  themselves a location narrows their own access — it never does, for this one role, by design.
- Any future role that needs the same "must always be able to bootstrap the tenant" property
  follows this same narrow, name-keyed exception pattern rather than reopening
  `LocationAuthorizationService`'s general rule — this is the template, the same way ADR-0028's
  query-projection pattern is the template for future sensitive-field problems.
