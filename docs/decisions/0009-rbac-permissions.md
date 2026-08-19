# ADR-0009: RBAC with Granular, Toggleable Permissions

## Status

Accepted

## Context

The initial roles (SuperAdmin, Administrador, Bodega, Vendedor, Supervisor) are a starting point,
not a ceiling — a tenant's Administrator needs to be able to adjust what each role can do (e.g.
restrict which vendors can cancel a sale) without engineering involvement, and the permission set
needs to be fine-grained enough to be useful for that (`products.view` vs. a single blanket
`products` permission).

## Decision

Two-level model: a fixed, system-defined catalog of granular permission strings (e.g.
`products.view`, `products.create`, `inventory.adjust`), and roles that are named bundles of
permissions from that catalog. A tenant's Administrator can toggle which permissions a role grants
(the "checklist" UI described in the Prompt 01 brief), but cannot invent new permission strings —
new permissions are added to the system catalog by the platform as new capabilities are built, not
defined ad hoc per tenant. See [security.md#authorization-rbac--permissions](../architecture/security.md#authorization-rbac--permissions)
and [modules.md#core](../architecture/modules.md#core).

## Alternatives considered

- **Fixed roles only, no per-permission toggling.** Simpler, but does not meet the stated
  requirement that tenants customize role capabilities, and would likely be worked around later by
  proliferating near-duplicate roles per tenant need.
- **Fully tenant-defined permission strings (ABAC-like, arbitrary attributes/policies).** More
  flexible in theory, but every permission string has to correspond to an actual guard check
  somewhere in the code — letting tenants invent arbitrary permission strings would create
  permissions that don't correspond to any enforced check, which is worse than no flexibility at
  all. If attribute-based rules genuinely become necessary later (e.g. "can only adjust inventory
  in warehouses they're assigned to"), that is layered on top of RBAC as scoped/contextual checks,
  not a wholesale replacement of the permission-catalog model.
- **Permissions per-user instead of per-role.** Rejected as the default: harder for an
  Administrator to reason about ("what can this person do") than "what can this role do," and does
  not match the explicit checklist-per-role UI described in the brief. Not ruled out as a future
  addition for genuine exceptions (a named permission override on top of a user's role), but not
  designed now.

## Consequences

- Every guarded endpoint declares its required permission(s) from the fixed catalog — adding an
  endpoint without a corresponding permission check is a gap the [Definition of
  Done](../../CLAUDE.md#79-definition-of-done) review is expected to catch.
- The permission catalog is versioned alongside the code (it grows as modules are built), while
  role → permission assignments are tenant data, editable without a deployment.
- SuperAdmin is not "a role with every permission" — it is the structurally separate identity
  described in [ADR-0004](0004-tenant-isolation-strategy.md), outside this tenant-scoped
  role/permission model entirely.
