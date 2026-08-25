# ADR-0032: Platform-Admin (SuperAdmin) Authentication

## Status

Accepted.

## Context

[multi-tenancy.md#superadmin-vs-tenant](../architecture/multi-tenancy.md#superadmin-vs-tenant) and
[modules.md#administration](../architecture/modules.md#administration) already establish that a
SuperAdmin is a structurally separate identity (`platform_admins`, not a role inside `users`) and
that ADMINISTRATION owns "system-level configuration that only a SuperAdmin can change." Prompt 04
(ADR-0030) built the full tenant-user authentication stack — JWT access tokens, opaque
server-tracked refresh tokens with rotation/reuse-detection, CSRF double-submit — but deliberately
left `platform_admins` unauthenticated: `auth_refresh_tokens.tenant_id`/`user_id` are `NOT NULL`,
and that schema file's own header comment says "platform_admins have no login endpoint yet (not
requested)... a future platform_admin auth pass adds its own table/migration rather than
retrofitting nullability onto this one."

FASE 11 (roadmap.md) is the first phase whose scope actually requires a SuperAdmin to authenticate
— system-level tenant-lifecycle management (list/suspend/activate a company) needs an actor to act
as. This is that "future pass." No ADR previously specified the mechanism, and the roadmap's
FASE 11 prompt explicitly requires proposing one rather than inventing it silently (§13/§56 of that
prompt).

## Decision

**Platform-admin authentication is a second, structurally independent instance of the exact same
session pattern ADR-0030 established for tenant users — never a shared code path, and never gated
by tenant RBAC.**

1. **Distinct JWT payload shape, one shared secret.** A tenant access token carries `tenantId`/
   `tenantSlug`; a platform access token carries `context: 'global'` and never a `tenantId` —
   `common/tokens/access-token-payload.ts`'s `AccessTokenPayload` union. Both are verified by the
   same `JwtAuthGuard` call (one JWT secret, `AUTH_CONFIG.jwtSecret`) — the separation is the
   payload's own shape, not a second secret, matching multi-tenancy.md's "distinct token
   type/claim" language literally. `JwtAuthGuard` sets `request.platformPrincipal` (never
   `request.authPrincipal`) when it verifies a platform-shaped payload.
2. **`platform_admin_refresh_tokens`, not `auth_refresh_tokens`.** A new, platform-scoped table
   (migration `0022`, no `tenant_id`, no RLS — same access-by-`GRANT`-only posture as
   `platform_admins` itself) stores the opaque refresh token, so a platform-admin session can be
   revoked (logout, reuse-detection) exactly like a tenant session, without touching the
   `NOT NULL` tenant columns ADR-0030 fixed on `auth_refresh_tokens`.
3. **Distinct cookies, distinct path scope.** `platform_access_token`/`platform_refresh_token`/
   `platform_csrf_token` (never `access_token`/`refresh_token`/`csrf_token`) — a browser holding
   both a tenant session and a platform-admin session (an operator testing locally) can never have
   one silently overwrite or get sent alongside the other. The refresh cookie is scoped to
   `/api/v1/platform/auth` (mirroring `auth-cookies.util.ts`'s own `/api/v1/auth` scoping for the
   tenant cookie).
4. **`TenantGuard` routes `@PlatformOnly()` routes to a third path, not `PermissionsGuard`.** A
   route marked `@PlatformOnly()` requires `request.platformPrincipal` and returns immediately —
   it never resolves `tenantContext`, never calls `loadEffectivePermissions`, and is never gated by
   `@RequirePermissions()` (there is no tenant permission catalog entry for a platform route, by
   design). This is the literal mechanism behind rule 13's "never protect platform operations with
   the tenant PermissionsGuard": there is nothing for that guard to check on these requests, by
   construction, not by convention alone.
5. **No self-service platform-admin registration.** `PlatformAdminsRepository` has no `create`
   method and `PlatformAuthController` has no `register` route — multi-tenancy.md's "narrow,
   explicit... not 'log in as any tenant user' by default" posture applied to the admin's own
   identity: a public endpoint that could mint a SuperAdmin account would itself be the P0
   privilege-escalation risk threat-model.md already names. The first platform admin is provisioned
   out-of-band — a bootstrap seed script (`database/seeds/platform-admin.ts`, opt-in via
   `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` env vars, never run as part of the default demo
   seed) or a direct database insert.
6. **Auditing platform actions required a real, narrow grant addition.** `app_platform` had
   `SELECT`-only on `audit_log` (migration `0002`) because no platform-level write path existed
   before this phase. Migration `0022` adds `GRANT INSERT ON audit_log TO app_platform`, and
   `PlatformAuditLogService` (parallel to the existing tenant-scoped `AuditLogService`) is the first
   code to use it — writing `actor_type = 'platform_admin'`, `tenant_id` set only when the action
   targets one tenant.

## Alternatives considered

- **Model a SuperAdmin as a `users` row with a special role/flag.** Rejected outright — this is
  exactly what ADR-0004/multi-tenancy.md already rejected for the identity table itself; doing it
  only at the session layer while `platform_admins` stays a separate table would reintroduce the
  same confusable-shape risk one level up (a tenant session token structurally indistinguishable
  from a platform one).
- **A second JWT signing secret for platform tokens.** Rejected as unnecessary complexity: the
  payload shape (`context: 'global'`, no `tenantId`) is already how multi-tenancy.md describes the
  distinction ("distinct token type/claim"), and every consumer of the token (`JwtAuthGuard`,
  `TenantGuard`) inspects the payload's shape, never the secret it was signed with. A second secret
  would add an env var and a rotation surface without closing a gap the payload shape doesn't
  already close.
- **Gate `@PlatformOnly()` routes with a "platform" pseudo-permission checked by the existing
  `PermissionsGuard`.** Rejected — this is precisely the anti-pattern rule 13 warns against: it
  would put a tenant-RBAC-shaped permission code inside the same catalog `core.roles.assign` can
  grant, creating a path (however indirect) from tenant role configuration toward platform access.
  Structural separation (a different guard branch, reading a different request field populated by a
  different token shape) cannot be bridged by editing `role_permissions`.
- **Reuse `auth_refresh_tokens` with a nullable `tenant_id`/`user_id`.** Rejected per `12-auth.ts`'s
  own header comment anticipating exactly this decision: retrofitting nullability onto an already-
  applied, RLS-`NOT NULL`-tenant-scoped table for a fundamentally different actor type is worse than
  a new, purpose-shaped table with no RLS to begin with.

## Consequences

- `common/tokens/access-token-payload.ts`'s `AccessTokenPayload` is a discriminated union; any
  future code reading a verified payload must narrow it (`isPlatformAccessTokenPayload`) before
  assuming tenant fields exist.
- Every future SuperAdmin-only capability (platform metrics, global configuration/plans — none
  built this phase) reuses this exact mechanism: `@PlatformOnly()` + `CurrentPlatformAdmin()` +
  `PlatformAuditLogService`, never a bespoke authorization path.
- "Impersonate a tenant for support" remains the explicit, separate, `PENDING DECISION` item
  multi-tenancy.md already flagged — this phase's platform-admin identity has no mechanism to
  assume a tenant user's session, by construction (a platform token never carries a `tenantId`, and
  `TenantGuard` never resolves one from it).
