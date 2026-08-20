# ADR-0031: Role-Assignment Authorization and Self-Escalation Prevention

## Status

Accepted.

## Context

Prompt 05-A builds tenant/user/role administration on top of the RBAC mechanism
[ADR-0009](0009-rbac-permissions.md) already fixed. Assigning a role to a user is itself a
privileged action that needs its own authorization rule — RBAC's threat model
([threat-model.md#privilege-escalation](../security/threat-model.md#privilege-escalation)) already
names "a user obtains permissions their role doesn't grant" as P0, and role assignment is the one
operation that can grant permissions outright rather than merely using them. Two things this schema
does **not** have: a role hierarchy (roles are named permission bundles, not ranked —
[database.md#rbac-roles-permissions](../architecture/database.md#rbac-roles-permissions)), and a
concept of "who assigned this role is more privileged than the assignee" beyond the soft
`user_roles.assigned_by` audit reference. A rule was needed that doesn't invent either of those.

## Decision

**A single new permission, `core.roles.assign`, gates every role change — and holding it is never
sufficient to change the caller's own role.** Concretely:

1. Changing any user's `user_roles` assignment (at creation or via `PATCH /users/:id`) requires the
   caller to hold `core.roles.assign`, checked in `UsersService` in addition to the route-level
   `core.users.create`/`core.users.update` guard (the same two-layer pattern
   [ADR-0028](0028-field-level-price-authorization.md) established for field-level authorization —
   a route-level permission plus a stricter service-level check for one specific field).
2. **A user can never change their own `status` or role, structurally — independent of which
   permissions they hold.** This is checked before anything else in `UsersService.update` and
   cannot be satisfied by any permission grant. It directly closes the self-escalation case
   (`USER → ADMIN` on oneself) and the indirect chain in the brief's example (`A modifies B → B
   becomes admin → B modifies A`): the chain's first step requires `A` to already hold
   `core.roles.assign`, which is by definition an authorized admin action, not a bypass — RBAC
   systems that let one admin's authorized grant enable another user's later authorized action are
   working as intended, not escalating. What the self-block prevents is the one case that isn't
   backed by any second authorized actor: a user acting on themselves.
3. No role hierarchy is introduced. `core.roles.assign` is a single flat gate — whoever holds it can
   assign any tenant role to any other user. This is the documented minimum, not an oversight: this
   schema has no ranked-role concept to check a hierarchy against, and inventing one (e.g. "role X
   outranks role Y") would be exactly the kind of arbitrary, undocumented rule the brief instructs
   against introducing without a real need.

## Alternatives considered

- **A ranked role hierarchy** (numeric level per role, "cannot manage a user with an equal-or-higher
  level"). Rejected: no such ranking exists anywhere in the current schema or ADR-0009's model, and
  adding one is a schema change well beyond this phase's scope for a property the flat
  `core.roles.assign` gate already achieves for the one case that matters (self-escalation).
- **Per-role assignment permissions** (a separate permission per role, e.g.
  `core.roles.assign.administrador`). Rejected for the same reason ADR-0009 rejected fragmenting the
  base permission catalog: it would multiply catalog entries per tenant role without a demonstrated
  need, and every default-template role is already fully controlled by whoever holds the one
  `core.roles.assign` grant (typically Administrador only, per `packages/shared`'s
  `DEFAULT_ROLE_TEMPLATES`).
- **Allow self-role-change when the caller already holds the target role's permissions (a no-op
  check).** Rejected: it adds meaningful complexity (computing whether a role change is a strict
  subset of current permissions) for a case with no real use — a user never needs to reassign their
  own already-held role, and the rule is simplest and most auditable as an unconditional block.

## Consequences

- `UsersService` contains this authorization logic directly, not `PermissionsGuard` — the guard
  only ever expresses "does the caller hold permission X for this whole route," which cannot express
  "except when the target is the caller" or "this one field needs a stricter permission than the
  rest of the body." Any future field with the same shape of requirement follows this same pattern
  rather than growing the guard's vocabulary.
- If a genuine multi-admin, ranked-privilege model becomes necessary later (e.g. distinguishing
  "can manage Vendedores" from "can manage Administradores"), it is layered on top of this as an
  explicit new decision, not retrofitted silently into `core.roles.assign`'s current flat meaning.
