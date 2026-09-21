# ADR-0034: Role-Permission-Edit Self-Escalation Prevention

## Status

Accepted.

## Context

The ROLES/PERMISSIONS block closes `GAP-ROLE-CRUD`: `roles`/`role_permissions` (tenant-owned,
schema-ready since migration `0002`) finally get application code beyond `GET /roles` — creating custom
roles, renaming/describing any role, replacing a role's permission set, and deleting a role. A new
permission code, `core.roles.manage`, gates all four (one flat code, not fragmented per action,
same precedent [ADR-0031](0031-role-assignment-escalation-prevention.md) already applied to
`core.roles.assign`).

[ADR-0031](0031-role-assignment-escalation-prevention.md) already closes the privilege-escalation
case for **role assignment**: a user can never change their own `user_roles` row, structurally,
independent of which permissions they hold. That ADR's threat model did not — could not — cover
**role-permission editing**, because no such capability existed yet. It introduces a distinct
attack shape ADR-0031's own block does nothing to stop: a caller holding `core.roles.manage` could
call `PUT /roles/:id/permissions` on the *very role they themselves currently hold* and add a
permission to it (e.g. `core.roles.assign`, or `core.roles.manage` itself if somehow not already
held) — instantly changing their own effective permission set without ever touching `user_roles`,
without ADR-0031's self-block ever triggering (it only looks at `dto.roleId`/`dto.status` on
`PATCH /users/:id`, a different endpoint entirely).

## Decision

**A caller can never replace the permission set of a role currently assigned to themselves —
checked live against `user_roles` on every `PUT /roles/:id/permissions` call, independent of
whether they hold `core.roles.manage`.** Concretely (`RolesService.setPermissions`,
`RolesRepository.roleIdsForUser`):

1. Before writing anything, the service loads the caller's own currently-assigned role ids
   (`SELECT role_id FROM user_roles WHERE tenant_id = ? AND user_id = <actorId>` — the same live,
   uncached read [ADR-0024](0024-location-scoped-authorization.md)'s
   `LocationAuthorizationService` already uses for its own authorization checks, never anything
   carried on the JWT). If the target `roleId` is among them, the call is rejected —
   `403 Forbidden`, `{ code: 'ROLE_SELF_PERMISSION_ESCALATION' }` (the exception filter's generic
   per-status `code` is not specific enough here — this is the one place in the codebase this ADR
   introduces an explicit override, see `apps/api/src/common/filters/http-exception.filter.ts`'s
   `extractCode`).
2. **Only the permission-replace endpoint is blocked.** `PATCH /roles/:id` (rename/describe) is
   unaffected — renaming or re-describing a role you hold cannot grant yourself anything, so
   blocking it would be exactly the kind of unneeded complexity ADR-0031 already warned against
   introducing without a real need.
3. **Editing other roles' permissions is unrestricted** beyond the route-level `core.roles.manage`
   gate — same flat-gate posture as `core.roles.assign` (ADR-0031 §3): whoever holds
   `core.roles.manage` (by default, only Administrador — `packages/shared`'s
   `DEFAULT_ROLE_TEMPLATES`) can freely change what any *other* role can do.
4. **No permission-subset comparison is introduced** (e.g. "you may only grant a permission you
   already hold yourself"). ADR-0031 explicitly rejected the equivalent complexity for role
   *assignment* ("adds meaningful complexity... for a case with no real use... simplest and most
   auditable as an unconditional block") and the same reasoning applies here: the one case that
   matters — a user acting on their own effective permissions with no second authorized actor
   involved — is fully covered by the unconditional self-block above.
5. **Deleting a role** (`DELETE /roles/:id`) needs no separate self-block: it is already rejected
   (`409`) whenever 1+ users hold the role, and a caller whose own role is the target is
   necessarily one of those users. `is_system_default` grants no special protection here either
   (unchanged from what `database.md#rbac-roles-permissions` already documents — "a label, not a
   protection mechanism"): a predefined role can be edited or deleted exactly like a custom one,
   subject only to this ADR's self-permission-edit block and the delete-in-use guard, neither of
   which inspects that flag.

## Alternatives considered

- **No special rule — rely on `core.roles.manage` being Administrador-only by convention.**
  Rejected: unlike `core.roles.assign` (ADR-0031, which only ever *reassigns* an existing role — a
  privileged actor granting a role from the fixed catalog to someone else), this new capability
  lets the actor redefine what a role's permissions *are*, including their own. Relying purely on
  "no other role gets this permission by default" is a template default, not an enforced invariant
  — a tenant's Administrator is free to grant `core.roles.manage` to another role later (roles are
  fully tenant-owned per ADR-0009), at which point an unblocked self-edit becomes exploitable with
  no code change on the attacker's part. A structural block costs nothing and closes this
  permanently, the same trade-off ADR-0031 already made for role assignment.
- **A permission-subset comparison** ("may add/remove a permission only if the actor already holds
  it"). Rejected for the reason ADR-0031 §"Alternatives considered" already gives for the
  equivalent role-hierarchy idea: real complexity (computing an effective-permission diff on every
  write) for a case the flat unconditional block already resolves.
- **Blocking self-edit at the route/guard layer instead of in `RolesService`.** Rejected, same
  reasoning as ADR-0031's Consequences: `PermissionsGuard` only ever expresses "does the caller
  hold permission X for this whole route" — it cannot express "except when the target role is one
  the caller holds." This lives in the service, alongside the live `user_roles` read it depends on.

## Consequences

- `RolesRepository.roleIdsForUser` is now load-bearing security logic, not just a read helper —
  any future change to how a user's roles are stored must keep this query correct (it reads
  `user_roles` directly, the same table ADR-0031's `core.roles.assign` check and
  `loadEffectivePermissions` both already depend on, not a new parallel source of truth).
- `apps/api/src/common/filters/http-exception.filter.ts` gained a narrow extension point
  (`extractCode`): an exception thrown as `new ForbiddenException({ code, message })` now surfaces
  that `code` in the `ApiErrorShape` response instead of the generic `FORBIDDEN`/`CONFLICT`/etc.
  Every existing plain-string `ForbiddenException('...')` call elsewhere in the codebase is
  unaffected (they never had an object body, so they keep the generic per-status code).
- This is the template for any future "you can act on this resource in general, but never on the
  instance of it that represents your own access" problem — it does not need to be redesigned per
  case, the same way ADR-0028's query-projection + allow-list-DTO pattern already isn't redesigned
  per sensitive field.
