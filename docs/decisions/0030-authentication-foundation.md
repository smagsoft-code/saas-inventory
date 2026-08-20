# ADR-0030: Authentication Foundation — Session Transport, Token Model, and Login/Registration Contract

## Status

Accepted.

## Context

Prompt 04 is the first phase to actually build authentication. Three things were left as
documented `PENDING DECISION`s specifically until this point:

1. **Web session transport** — httpOnly cookie vs. bearer-in-memory
   ([frontend.md#authentication-and-route-protection](../architecture/frontend.md#authentication-and-route-protection)).
2. **Refresh-token revocation storage** — Redis vs. a Postgres table
   ([security.md#authentication](../architecture/security.md#authentication)).
3. Two things the existing design implied but never made explicit, discovered while implementing:
   `users.email` is unique per `(tenant_id, email)`, not globally
   ([database.md](../architecture/database.md)), so a login request needs a second identifier
   besides email; and self-service registration necessarily provisions a brand-new tenant (there
   is no tenant-invitation/membership flow yet — that's FASE 5, out of this phase's scope), which
   requires writing to the platform-scoped `tenants` table from a public, unauthenticated endpoint.

## Decision

### Session transport: httpOnly cookies + double-submit CSRF

The web app uses **httpOnly, `Secure` (outside local dev), `SameSite=Lax` cookies** for the access
token (`access_token`, path `/`) and refresh token (`refresh_token`, path restricted to
`/api/v1/auth`). A third, **non-httpOnly** cookie (`csrf_token`) is issued alongside them,
readable by frontend JS and echoed back as an `X-CSRF-Token` header on every state-changing
request — the standard double-submit pattern, since `SameSite` alone is explicitly not treated as
sufficient per [security.md#csrf](../architecture/security.md#csrf)'s own warning. This closes
off XSS token theft (the tokens themselves are never JS-readable) at the cost of needing explicit
CSRF handling, which is implemented (`common/guards/csrf.guard.ts`).

This is per-transport, not global: [mobile.md](../architecture/mobile.md#auth-on-mobile) already
independently decided bearer-in-secure-storage for Flutter, and nothing here reopens that. The API
accepts *either* an `Authorization: Bearer` header or the cookie — whichever a given client uses —
so the same guard chain and token-issuance rules serve both without a transport-specific code path
per endpoint.

### Token model

- **Access token:** short-lived JWT (default 15 minutes, `ACCESS_TOKEN_TTL_SECONDS`), signed with
  `JWT_SECRET`, claims `{ sub, tenantId, tenantSlug, jti }`. Stateless — verified, never looked up.
- **Refresh token:** opaque, high-entropy (256 bits), **not** a JWT. Tracked server-side in a new
  tenant-owned, RLS-enabled table, `auth_refresh_tokens` (migration `0013`) — resolving the
  `PENDING DECISION` on storage in favor of Postgres over Redis, since the rest of this schema's
  isolation/audit guarantees (RLS, tenant-aware FKs) apply directly to a Postgres table and no
  Redis dependency exists yet in the running API. Rotated on every use (the old row is marked
  `revoked_at`, a new row is inserted with `rotated_from_id` pointing at it); a revoked token being
  presented again is treated as a compromise signal and revokes every active token for that user
  (`RefreshTokensRepository.revokeAllForUser`), per
  [threat-model.md#stolen--replayed-jwt](../security/threat-model.md#stolen--replayed-jwt). Only
  the token's hash (HMAC-SHA256, keyed by `JWT_REFRESH_SECRET`) is stored — never the raw token.

### Login requires a tenant slug

`POST /auth/login` takes `{ tenantSlug, email, password }`, not just `{ email, password }`,
because `users.email` is unique only within a tenant (`users_tenant_id_email_key`), not globally —
the same email can legitimately exist in multiple tenants. This does not reopen
[multi-tenancy.md](../architecture/multi-tenancy.md)'s "tenant is never trusted from the client"
rule: that rule governs *authenticated* requests, where the tenant is read only from the verified
token. At login, before any session exists, the client necessarily supplies enough to identify
which credentials to check — `tenantSlug` here plays exactly the role a username does; the actual
authorization decision (does the password match) still requires the real credential, and a wrong
`tenantSlug`/email/password/disabled-account all fail identically
(`AuthService`'s `invalidCredentials()`, security.md §6).

### Self-service registration provisions a tenant

`POST /auth/register` creates a new tenant plus its first (`Administrador`) user in one call — the
`DEFAULT_ROLE_TEMPLATES` role set (moved to `packages/shared` so both this path and
`database/seeds/demo-tenant.ts` share one source of truth) is copied into the new tenant exactly as
`database.md#rbac-roles-permissions` already specified for "provisioning time". This is a
deliberately minimal provisioning flow — no invitation system, no email verification, no
multi-admin approval — matching FASE 4's scope; a fuller tenant-lifecycle/invitation system is
FASE 5.

Creating the `tenants` row itself cannot go through the normal `app_tenant` / RLS path — `app_tenant`
has no `GRANT` on `tenants` at all (migration `0001`, by design: "a tenant connection never lists
other tenants"). The running API now also holds an **`app_platform`** connection
(`APP_PLATFORM_DATABASE_URL`, `apps/api/src/database/platform-client.ts`) for exactly this narrow,
explicit, already-anticipated case (`bootstrap-dev-roles.ts` already had an optional
`APP_PLATFORM_PASSWORD` slot for it) — used only for: creating a `tenants` row at registration, and
resolving which tenant an opaque refresh token belongs to by its globally-unique hash before the
tenant-scoped mutation path can run. Every other read/write goes through the ordinary `app_tenant` /
`withTenantTransaction()` path, unchanged.

## Alternatives considered

- **Bearer token in memory for web too.** Rejected for this phase: cookies remove XSS token theft
  as a risk entirely (the stated tradeoff security.md already weighed), and the CSRF mitigation
  this requires is a bounded, well-understood mechanism to implement once.
- **A separate `workspaces` lookup step (enter email, see which tenants match, pick one)** instead
  of an explicit `tenantSlug` field. More convenient UX, but requires a cross-tenant email lookup
  on every login attempt (via `app_platform`, bypassing RLS) even for the unauthenticated case,
  widening that connection's exposure on the highest-traffic unauthenticated endpoint in the
  system. Deferred — `tenantSlug` is simple, cheap, and matches common B2B SaaS practice
  (a workspace/company identifier at login).
- **Full tenant-invitation flow instead of self-service registration.** Correct long-term shape,
  but is FASE 5 (Tenant Administration) scope — building it now would be implementing
  functionality not requested for this phase, and self-service registration is the minimum needed
  for `POST /auth/register` to do something coherent with the current schema.

## Consequences

- A new migration (`0013_auth_refresh_tokens.sql`) and a new Postgres connection role usage
  (`app_platform`, previously wired for RLS but not yet given an application-level connection) —
  both purely additive to the Prompt 03 schema/role design, no existing migration or policy
  changed.
- `docker-compose.dev.yml` and `.env.example` now require `APP_PLATFORM_DATABASE_URL` /
  `APP_PLATFORM_PASSWORD` / `JWT_SECRET` / `JWT_REFRESH_SECRET` for the API to boot at all — a
  breaking change for any existing local `.env` that predates this phase, documented in both files.
- `docs/architecture/frontend.md` and `docs/architecture/security.md` are updated to reflect the
  transport decision as resolved rather than pending.
- Platform-admin (SuperAdmin) login is explicitly out of scope here. The current access-token
  payload (`{ sub, tenantId, tenantSlug, jti }`) and guard chain assume a tenant-scoped principal
  throughout; a future platform-admin auth pass adds its own token shape/claim (e.g. `context:
  'global'`) and guard handling rather than retrofitting this one, per
  [multi-tenancy.md#superadmin-vs-tenant](../architecture/multi-tenancy.md#superadmin-vs-tenant)'s
  structurally-separate-identity requirement.
