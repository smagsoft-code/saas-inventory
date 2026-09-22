# ADR-0036: Tenant Onboarding (No SuperAdmin-Set Password) and Tenant Support (Audited, Non-Impersonating Access)

## Status

Accepted. Closes [`GAP-SA-CREATE-TENANT`](../architecture/frontend/f17-gaps.md#gap-sa-create-tenant),
resolves `GAP-SA-IMPERSONATION` (see
[f17-super-admin.md](../architecture/frontend/f17-super-admin.md)) with a deliberately different
mechanism than literal impersonation, and partially resolves
[`GAP-SA-TENANT-ADMINS`](../architecture/frontend/f17-gaps.md#gap-sa-tenant-admins) — opening a new,
narrower [`GAP-SUPPORT-READ-SCOPE`](../architecture/frontend/f17-gaps.md#gap-support-read-scope) for
the curated surface's own future growth. Builds on
[ADR-0032](0032-platform-admin-authentication.md) (Platform Admin identity, `@PlatformOnly()`,
`TenantGuard`'s never-resolve-a-tenant branch) and
[ADR-0033](0033-global-identity-tenant-memberships.md) (`identities` / `tenant_memberships`,
including the `pending_credential` identity status this ADR is the first caller to actually reach).
Does not modify either ADR.

## Context

The owner requested two related SuperAdmin-side capabilities, with an explicit, non-negotiable
constraint set (paraphrased from the executing prompt):

1. **Tenant Onboarding** — a SuperAdmin creates a company and its founding admin, but never
   collects, sets, or sees that admin's password. The admin must set their own credential via an
   invitation.
2. **Tenant Support** — a SuperAdmin can temporarily act on a specific tenant for support purposes,
   with an explicit, auditable mode (read vs. write), while **never** creating a phantom/default
   tenant admin, a `support@tenant`-style account, or a shared password, and **never** having the
   SuperAdmin know, set, reset, or reuse the tenant admin's own credential. The actor must remain
   the Platform Admin throughout — never converted into, or disguised as, a tenant user.

A pre-implementation audit (this block's own §2, and two earlier read-only audit passes in this
session) confirmed:
- `POST /auth/register` and `POST /users` both always supply a real, immediately-usable password —
  neither path had ever exercised `identities.status = 'pending_credential'` before this ADR, even
  though ADR-0033 already defined that status.
- `TenantGuard`'s `@PlatformOnly()` branch makes it **structurally impossible** for a platform
  principal to resolve a tenant context today — there is no code path by which a Platform Admin
  request could accidentally acquire tenant RBAC.
- Zero impersonation code exists anywhere in the codebase.
- `app_platform` already holds `SELECT` grants on `users`/`roles`/`warehouses` (migrations 0002,
  0005) — the database role anticipated a read like this; only the endpoint layer was missing.
- Reusing `@RequirePermissions()` / tenant RBAC for support gating was explicitly ruled out by the
  prompt (§20): "No implementar el acceso de soporte mediante los permisos del Tenant."

## Decision

### Tenant Onboarding

`POST /platform/tenants` (`PlatformTenantOnboardingService.createTenant`, thin orchestration —
every step below reuses an existing service verbatim, no domain logic duplicated):

1. **`TenantProvisioningService.provision()`** creates the tenant + roles + user, exactly as it
   already does for self-registration — with a throwaway, structurally-valid-but-unusable
   `password_hash` (`unset:<32 random bytes>`, the same convention `database/seeds/demo-tenant.ts`
   already uses for its own placeholder admins). `users.password_hash` is NOT NULL but is never read
   by the login path (`identities.password_hash` is), so this satisfies the column without
   asserting a hashing algorithm this code path never runs.
2. **`IdentityProvisioningService.resolveOrCreatePendingIdentity(email, fullName)`** — a new method,
   split deliberately from membership creation so the three-way branch below can be decided first:
   - `active` — the email already has a working global identity (ADR-0033). **No invitation is
     issued.** The response says `identityReused: true`; the admin logs in immediately with their
     existing credential and is offered this tenant alongside whatever others they already belong
     to (ADR-0033's existing multi-tenant-membership UX, unchanged).
   - `pending_credential` (new or a pre-existing but never-activated identity) — an invitation is
     issued (below).
   - `disabled` — refused. The tenant and user just created in step 1 are compensated (see below)
     and a `409 Conflict` is returned. **Never** silently provision an admin who cannot ever log in.
3. **`IdentityProvisioningService.linkMembership()`** — only reached once the identity is known
   `active` or `pending_credential` — creates the `tenant_memberships` row.
4. **Invitation** (`pending_credential` branch only): a new `tenant_admin_invitations` table
   (platform-scoped, no RLS — this ADR's one schema addition alongside `platform_support_sessions`,
   migration 0033) stores `token_hash` (never the raw token), `expires_at`
   (`INVITATION_TOKEN_TTL_SECONDS`, default 7 days), and `status`
   (`pending → sent → accepted | expired | revoked`). The raw token is generated by a new
   `InvitationTokenService` — the exact same opaque-token-plus-HMAC-SHA256-pepper shape
   `RefreshTokenService` already uses (a deliberate second class, not a reuse of
   `RefreshTokenService` itself, because a refresh token and an invitation token have different
   lifetimes and different revocation semantics — but the same pepper, `JWT_REFRESH_SECRET`, so no
   new secret is introduced). The link (`buildInvitationUrl`, `${APP_URL}/accept-invitation/:token`)
   is returned to the SuperAdmin **exactly once**, in the creation response — never persisted,
   never re-derivable from a later read.
5. **Compensation.** Any failure after step 1 (the disabled-identity refusal, or any later
   exception) calls `compensate(tenantId, userId)`: marks the tenant `suspended`
   (`TenantsPlatformRepository.markSuspended`, the same mechanism `TenantProvisioningService` itself
   uses for its own rollback) and soft-deletes the orphaned user
   (`UsersRepository.softDelete`, the same mechanism `UsersService.create` uses). This combines two
   existing, separately-tested compensation patterns rather than inventing a third — and explicitly
   does **not** retroactively fix `/auth/register`'s own equivalent gap (out of scope; flagged, not
   silently carried over).

The invitee's own flow: `GET /auth/invitations/:token` (`@Public`, **always `200`** — validity is
carried in the response body as `{valid, reason?, tenantName?, email?}`, `reason` one of
`not_found | accepted | revoked | expired`, so a dead link renders a normal page, never a raw
404/410) followed by `POST /auth/accept-invitation` (`@Public`, `{token, password}`): hashes the
token, re-validates (not accepted, not revoked, not expired — a CAS on `identities.activateCredential`
guards the actual write against a second concurrent accept), sets the identity's real
`password_hash`, flips `identities.status → active`, marks the invitation `accepted`, and logs the
admin in immediately by reusing `AuthService`'s own private `issueTenantSession` helper — the exact
same session-cookie issuance `register()` already performs. No separate login step.

**Resend / revoke** (`GET/POST /platform/tenants/:tenantId/admin-invitation[/resend|/revoke]`):
resend invalidates the prior live token before issuing a new one (never two simultaneously-valid
tokens for the same admin — enforced by both a partial unique index,
`tenant_admin_invitations_user_live_key` on `user_id` WHERE `status IN ('pending','sent')`, and
application-level revoke-then-create sequencing); revoke is a CAS that only succeeds while the
invitation is still `pending`/`sent`.

### Tenant Support

A new `platform_support_sessions` table (platform-scoped, no RLS, migration 0033):
`platform_admin_id`, `tenant_id`, `mode` (`read | write`), `reason` (**NOT NULL** — every session,
read or write, carries a stated justification), `status` (`active | ended | expired`),
`started_at`, `expires_at` (`SUPPORT_SESSION_TTL_SECONDS`, default 1800s), `ended_at`. A partial
unique index (`platform_support_sessions_admin_active_key` on `platform_admin_id` WHERE
`status = 'active'`) enforces **one live session per admin at the database level**; starting a new
session on a different tenant gracefully **supersedes** the old one (ends it, then creates the new
one) rather than erroring — a UX choice layered on top of the hard DB constraint.

`POST /platform/tenants/:tenantId/support-sessions` (`{mode, reason}`) creates the row and writes a
`support_session.started` platform-audit entry (`PlatformAuditLogService`, `actor_type =
'platform_admin'` — the actor recorded is **always** the Platform Admin, never a tenant identity).
`POST /platform/support-sessions/current/end` ends it explicitly (also audited,
`support_session.ended`); `GET .../current` reads it (and lazily flips a stale `active` row to
`expired` on read, the same "derive rather than rely on a cron" posture the invitation-status DTO
uses).

**Enforcement is a new, additional guard, layered strictly beside `@PlatformOnly()` — never inside
tenant RBAC, per the prompt's explicit §20 instruction:**

```
JwtAuthGuard → TenantGuard(@PlatformOnly branch — unchanged from ADR-0032)
             → SupportSessionGuard(@RequireSupportSession(mode))
```

`SupportSessionGuard` reads `@RequireSupportSession('read'|'write')` metadata; if present, it
requires an already-established `request.platformPrincipal` (from `@PlatformOnly()`, checked first),
extracts `:tenantId` from the route, and does a **live** DB lookup
(`PlatformSupportSessionsRepository.findActiveForAdminAndTenant`) — never a JWT claim, never a
cache. No active session for that exact `(admin, tenant)` pair, or a `read` session hit against a
`@RequireSupportSession('write')` route, is `403`. This guard **never touches `users`, `roles`, or
any tenant-RBAC table** — a tenant Administrador role can no more grant support access than support
access can grant tenant RBAC; the two systems remain structurally disjoint, the same separation
ADR-0032 already established between Platform Admin auth and tenant auth generally.

The curated `PlatformSupportController` (`platform/tenants/:tenantId/support/*`, a **separate**
controller from every tenant-facing one) exposes exactly:
- `GET users` (`SUPPORT_READ`) — `id, email, fullName, status, roleNames, createdAt`, **explicit
  field list, never `passwordHash`** (mirrors the discipline ADR-0028 established for `cost`/
  `min_price`).
- `GET warehouses` (`SUPPORT_READ`) — `id, name, code, status`.
- `PATCH warehouses/:warehouseId/status` (`SUPPORT_WRITE`) — the one curated write action,
  deliberately narrow: the DTO accepts only `{status: 'active'|'inactive'}`, matching a **new
  column-level grant** (`GRANT UPDATE (status) ON warehouses TO app_platform`, migration 0033) —
  the database connection itself cannot write anything this DTO doesn't already allow. Every call,
  including a no-op status toggle, writes a `support.warehouse_status_changed` audit entry with
  `beforeState`/`afterState` that include the `supportSessionId` and the session's `reason`, so a
  later audit read can tie every write back to the session and stated justification that authorized
  it.

Nothing beyond these three routes is reachable **for a mutation** from a support session (see the
`SUPPORT_WRITE` extension note immediately below for why this sentence now says "for a mutation"
rather than "at all" — a later controlled correction found the original MVP boundary too narrow for
`SUPPORT_READ`'s own stated purpose and widened it, without touching `SUPPORT_WRITE` or any
enforcement mechanism above).

#### `SUPPORT_READ` extension: general tenant-API read-through (post-launch correction)

A later manual-QA pass (not the original implementation) found that the curated 3-endpoint surface
above did not actually satisfy this ADR's own stated goal for `SUPPORT_READ` — "navigate the Tenant
as an internal user would, for visualization purposes" (§1) — since a Platform Admin with an active
`read` session could not open Productos, Inventario, Ventas, or any other ordinary Tenant screen;
only the two curated `support/*` routes worked. This was a real implementation gap against this
ADR's own intent, not a change of architectural decision, so it was fixed by **extending**, not
replacing, the existing mechanism:

`TenantGuard` (`common/guards/tenant.guard.ts`) — the same guard every ordinary tenant route already
passes through — gained one additional branch: when a request carries no tenant JWT but does carry a
verified `platformPrincipal` (from `@PlatformOnly()`'s own JWT verification) **and the method is
`GET`**, it looks up that admin's own active `platform_support_sessions` row
(`PlatformSupportSessionsRepository.findActiveForAdmin` — the same repository this ADR's
`SupportSessionGuard` already uses, just called from a second place) and, if one exists for a still-
`active` tenant, resolves `request.tenantContext` from it — exactly as if a real tenant session had
resolved it, except every identity field (`userId`/`identityId`) is set to the platform admin's own
id (a sentinel, never a real `users`/`identities` row) and `permissions: []` (unused — see below).
Any non-`GET` method, or no active session, falls through to the guard's existing "no resolvable
tenant context" `403` — structurally identical to before this change for every write.

`PermissionsGuard` gained a matching short-circuit, checked first: a request carrying
`request.supportSession` (set only by the branch above) passes every `GET` unconditionally — never
evaluated against whichever `@RequirePermissions()` code the route happens to declare, per this
ADR's own §20 rule that support access is never gated by tenant RBAC — and **rejects every non-`GET`
outright**, regardless of the session's `mode`. This is the actual enforcement point that keeps
`SUPPORT_WRITE` from silently becoming "full tenant access to whatever the route declares": a
`write`-mode session gets zero additional route reach from this extension — its one write action
remains exactly `PATCH support/warehouses/:id/status`, unchanged, via the original curated
controller and its original `SupportSessionGuard`. `GET /auth/me` (`AuthService.meAsSupport`)
returns a synthetic session view carrying the full permission catalog so `checker.can(...)` UX gates
do not blank the screen — a display-only convenience, never the authorization boundary (CLAUDE.md
§7.6); the two guards above are what actually decide every request, server-side, regardless of what
that response contains.

**What did not change:** the actor is still always the Platform Admin (never a tenant identity —
`request.authPrincipal` is never set by this branch, so any route still keyed off `@CurrentUser()`
correctly `401`s for a support principal instead of silently using a fake user); no tenant JWT is
ever issued; `SUPPORT_WRITE`'s write surface is still exactly the one curated endpoint; tenant
cannot be changed by URL/query/header manipulation (`@CurrentTenant()` reads only
`request.tenantContext.tenantId`, never client input); every session still expires, still requires a
`reason`, and is still ended by the same `POST /platform/support-sessions/current/end` this ADR
already defined. **What changed:** `SUPPORT_READ`'s reachable surface, from 2 curated GET endpoints
to the ordinary Tenant API's GET routes generally — read visibility only, resolved through the
guard every tenant route already had, not a new bypass mechanism.

**Frontend:** a persistent, high-contrast "MODO SOPORTE" banner (never a tooltip) renders on every
`(superadmin)/` page while the caller's own session is `active` (`PlatformShell` composes it
unconditionally, reading `GET .../current` server-side on each layout render), showing the mode,
minutes remaining, and an explicit "Salir del modo soporte" action. The banner's own countdown is
informational only — the backend's live DB check is the actual authority on expiry, re-verified on
every request regardless of what the banner displays.

## Alternatives considered

- **A phantom/default "support" admin per tenant, or a SuperAdmin-known shared password.**
  Rejected outright — this is exactly what the prompt's §25 "NO HACER" list forbids, and it would
  mean a credential the SuperAdmin controls acting *as* a tenant user, indistinguishable in the
  tenant's own audit trail from a real admin action. The actor-identity requirement (§1/§20) rules
  this out categorically, not just as a design preference.
- **True impersonation — mint a tenant JWT for the SuperAdmin, "log in as" the tenant admin.**
  Rejected: `GAP-SA-IMPERSONATION` was explicitly framed as "not modelled; would be a significant
  security decision" and the prompt asks for the actor to **remain** the Platform Admin. A minted
  tenant session would make every downstream write attributable to the tenant admin's own user id,
  destroying the audit distinction between "the tenant admin did this" and "support did this on the
  tenant admin's behalf." The chosen design keeps the platform token as the sole auth transport
  throughout — no tenant JWT is ever issued for support.
- **Support access via a synthetic tenant role/permission the SuperAdmin is granted.** Rejected by
  the prompt's own §20/§15: reusing `@RequirePermissions()` would put support gating inside the
  tenant's own RBAC surface, which a tenant admin can edit (rename roles, change permission
  bundles) — an unacceptable coupling between a platform-security boundary and tenant-controlled
  data. `SupportSessionGuard` is deliberately its own, tenant-RBAC-blind mechanism.
- **A generic "the tenant admin resets their password, SuperAdmin relays it out of band."**
  Rejected: this still routes a live credential through the SuperAdmin, violating "no SuperAdmin
  using client credentials" even if only transiently, and has no clean audit story for who actually
  set it.
- **SUPPORT_WRITE = the Administrador role's full permission set.** Rejected per the prompt's own
  explicit rule (§25: "no SUPPORT_WRITE automatically equaling Admin"). The curated-endpoint
  approach (an allow-list of specific, deliberately chosen operations) was chosen over any
  permission-bundle equivalence so the write surface can only ever grow by an explicit, reviewed
  decision — never implicitly, by a tenant-side role change.
- **A full "browse any company's users" endpoint, ungated by a session.** Rejected: this would
  reopen `GAP-SA-TENANT-ADMINS` exactly as originally described — unconditional cross-tenant reads
  — which multi-tenancy.md requires to be an explicit, audited, narrowly-scoped path, not a general
  list. The session-gated curated read is the narrower alternative that was chosen instead; the gap
  is marked **partially** resolved, not closed, for this reason.

## Consequences

- **Two new tables, both platform-scoped (no RLS), migration 0033:** `tenant_admin_invitations`,
  `platform_support_sessions`. `app_platform` gets `SELECT/INSERT/UPDATE` on both plus the new
  narrow `UPDATE (status)` column grant on `warehouses`. No existing table's schema changes.
- **`identities.status = 'pending_credential'` is now a live, reachable state** — previously defined
  by ADR-0033 but never actually produced by any code path. Any future code touching identity status
  transitions must account for it (this ADR's `activateCredential` CAS is the only writer that moves
  a `pending_credential` identity to `active`).
- **A known, accepted, unfixed prior gap:** `/auth/register`'s own equivalent compensation gap (a
  failure partway through self-registration can leave an orphaned tenant/user) is **not** fixed by
  this ADR — only this new onboarding path gets the new `compensate()` logic. Flagged here so it is
  not mistaken for having been silently addressed.
- **`GAP-SUPPORT-READ-SCOPE` is now resolved for reads, and unchanged for writes.** The
  post-launch correction above gives an active `SUPPORT_READ` (or `SUPPORT_WRITE`) session GET-only
  visibility into the ordinary Tenant API generally — products, inventory, sales, customers, and
  every other tenant resource an internal user could view — via `TenantGuard`, not a new bypass
  mechanism. `SUPPORT_WRITE`'s actual write surface remains exactly the one curated
  `PATCH support/warehouses/:id/status` action; no mutation reaches any other route regardless of
  session mode (`PermissionsGuard`'s short-circuit rejects every non-`GET` for a support principal
  unconditionally). A future resource that needs its own **write** support action is still its own
  deliberate, one-at-a-time decision, exactly as originally scoped.
- **A tenant that renames or restructures its roles has no effect on support access** — `mode` is
  purely `read`/`write` on the session row, entirely independent of tenant RBAC content, by
  construction (this was a design goal, not an incidental property).
- Every integration test added for this block runs against an isolated, disposable
  `embedded-postgres` instance (port 55433, single-fork), never the developer's own persistent
  dev-server — consistent with this project's standing testing discipline.
