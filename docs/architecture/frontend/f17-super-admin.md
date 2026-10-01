# F17 — Super-Admin / Platform Admin Experience

> A **structurally separate** experience from the Tenant Admin. Audited against
> `platform_admins`, `platform_auth.controller.ts`, `platform-tenants.controller.ts`,
> `@PlatformOnly()`, ADR-0032, multi-tenancy.md#superadmin-vs-tenant. **Nothing invented** — this
> file states exactly what the backend supports, what is a **GAP BACKEND**, and what is a later
> phase.

## 1. Structural separation (already enforced by the backend)

| Dimension | Tenant users | Platform Admin |
| --- | --- | --- |
| Identity store | `identities` + `tenant_memberships` + per-tenant `users` | `platform_admins` (separate table, no `tenant_id`) |
| Auth endpoint | `POST /api/v1/auth/login` (+ `/select-tenant`) | `POST /api/v1/platform/auth/login` |
| Session cookies | `access_token` / `refresh_token` / `csrf_token` | `platform_access_token` / `platform_refresh_token` / `platform_csrf_token` (distinct names) |
| Token claim | `{ sub: users.id, identityId, tenantId, tenantSlug, jti }` | `{ sub, context: 'global', jti }` — **no `tenantId`** (ADR-0032) |
| Refresh store | `auth_refresh_tokens` (tenant-owned, RLS) | `platform_admin_refresh_tokens` (platform-scoped, no RLS) |
| Guard path | `JwtAuthGuard → TenantGuard(resolve tenant) → PermissionsGuard(tenant RBAC)` | `JwtAuthGuard → TenantGuard(@PlatformOnly branch: require platform principal, **never** resolve a tenant, **never** reach tenant RBAC)` |
| Route group (frontend) | `(tenant)/` | `(superadmin)/` — **new**, own layout + platform-session guard, **never** a role check inside the tenant layout |
| "me" | `GET /api/v1/auth/me` | `GET /api/v1/platform/auth/me` |

**A Platform Admin must never receive the tenant sidebar or a tenant `getSession()`.** The
`(superadmin)/` layout calls `GET /platform/auth/me`; a tenant session there is not a platform
principal → redirect to platform login.

**BUILT — F17-13 (2026-09).** `S-SA-LOGIN` and the `(superadmin)` shell shipped in FASE 16;
F17-13 adds the two company screens under `/platform/*` (so `middleware.ts` and the login redirect
keep working):
- `S-SA-TENANTS` — `apps/web/src/app/(superadmin)/platform/tenants/page.tsx` (server read of
  `GET /platform/tenants`) + `platform-tenants-table.tsx` (client: status / type / name-slug search
  + sort, **all over the fetched array — zero extra requests**, no server params invented).
- `S-SA-TENANT-DETAIL` — `.../tenants/[id]/page.tsx` (the 6 DTO fields, `notFound()` on 404) +
  `tenant-lifecycle-actions.tsx` (client: `POST …/suspend` behind a confirm step, `POST …/activate`;
  `apiFetch` attaches the `platform_csrf_token` double-submit header; audit implication stated in
  the copy, managed server-side).
- Nav: `PLATFORM_NAVIGATION` gains "Companies" (`/platform/tenants`). The `(superadmin)/platform`
  home links to it (no metrics — `GAP-PLATFORM-AGGREGATE`).
- Reads use the shared `serverApiFetch` (forwards the `platform_*` cookies) — no parallel client.
  One known minor limitation: a browser 401 during a suspend/activate goes through the shared
  client's tenant-oriented `/auth/refresh` path and, since the platform shell mounts no
  `SessionExpiryListener`, surfaces as a "session expired" alert rather than an auto-redirect to
  `/platform/login` — the admin reloads and the layout redirects. Tracked as `GAP-SA-PLATFORM-401`
  (additive, non-blocking).

**BUILT — [ADR-0036](../../decisions/0036-tenant-onboarding-and-support.md) (2026-09).** Tenant
Onboarding + Tenant Support, closing `GAP-SA-CREATE-TENANT`, resolving `GAP-SA-IMPERSONATION` (with
a deliberately different design — see below, not literal impersonation), and partially resolving
`GAP-SA-TENANT-ADMINS`:
- `S-SA-TENANT-NEW` — `/platform/tenants/new`, `POST /platform/tenants`. No password field: the
  SuperAdmin supplies `companyName`/`adminFullName`/`adminEmail` only. The admin's email resolves
  against the global `identities` table (ADR-0033) — an already-`active` identity is reused with no
  invitation (shown as such); otherwise a one-time invitation link is shown **exactly once** to
  copy/send, backed by `identities.status = 'pending_credential'` (no new credential state
  invented). An email tied to a `disabled` identity is refused (409) and the tenant/user created in
  step 1 is compensated (suspended/soft-deleted) — never a silently unreachable admin.
- Invitation lifecycle on `S-SA-TENANT-DETAIL`'s new "Administrador del Tenant" panel:
  `GET/POST …/admin-invitation[/resend|/revoke]` — status, sent/expires/accepted/revoked dates,
  state-gated Reenviar/Revocar buttons.
- `/accept-invitation/:token` (`(public)/`, unauthenticated) — `GET /auth/invitations/:token`
  (always 200, validity in the body) renders the tenant name + email and a password field;
  `POST /auth/accept-invitation` activates the identity's credential and logs the admin in
  immediately, the same session-cookie flow as `/register`.
- **Tenant Support** (resolves `GAP-SA-IMPERSONATION` — explicitly **not** by logging in as a
  tenant user): a "Acceder como soporte" action on `S-SA-TENANT-DETAIL` starts a
  `platform_support_sessions` row scoped to `(platform_admin_id, tenant_id)`, mode `read` or
  `write`, with a required reason. The actor is never anything but the Platform Admin — no tenant
  session, no tenant JWT, no phantom/shared-credential admin is ever created; `SupportSessionGuard`
  (never tenant RBAC) re-checks the live row on every call. `S-SA-SUPPORT` (`/platform/tenants/:id/
  support`) is the curated read panel (users, warehouses) plus the one `SUPPORT_WRITE` action
  (warehouse status toggle) — see `GAP-SUPPORT-READ-SCOPE` for the deliberately narrow surface. A
  persistent amber "MODO SOPORTE" banner (never a tooltip) renders on every `(superadmin)/` page
  while the session is `active`, with an explicit "Salir del modo soporte" exit; the session also
  expires on its own (`SUPPORT_SESSION_TTL_SECONDS`, default 1800s).

## 2. What the Super-Admin can do TODAY (supported — build in F17)

| Capability | Endpoint | Response | Notes |
| --- | --- | --- | --- |
| Sign in / session / sign out | `POST /platform/auth/login`, `/refresh`, `/logout` | platform session cookies | No self-registration; the first admin is seeded out-of-band (`pnpm --filter @saas-inventory/database seed:platform-admin`, opt-in, never in the demo seed). |
| Read own platform session | `GET /platform/auth/me` (`@PlatformOnly`) | the platform principal | |
| **List all companies** | `GET /platform/tenants` (`@PlatformOnly`) | `PlatformTenantResponseDto[]` — `{ id, name, slug, status, isDemo, createdAt }` — **whole array, NOT paginated, no server filter/sort** | Client-side filter (status / isDemo) + sort + group over the array. |
| **View one company** | `GET /platform/tenants/:tenantId` | `PlatformTenantResponseDto` | `:tenantId` is a real path param here — the one place in the API where that is correct (the caller has no tenant of its own). |
| **Suspend a company** | `POST /platform/tenants/:tenantId/suspend` (`@PlatformOnly`, audited) | updated tenant | Live-enforced: 011-A makes `TenantGuard` reject a suspended tenant on every request (access token not revoked — reactivation is instant). |
| **Activate a company** | `POST /platform/tenants/:tenantId/activate` | updated tenant | |
| **Platform metrics** (F18-10) | `GET /platform/summary` (`@PlatformOnly`) | `{ generatedAt, totalCount, byStatus: {active,suspended,archived}, demoCount, period }` — **numeric counts over the `tenants` table alone**, never an individual tenant's fields, never tenant-scoped data | `from`/`to` optional but both-or-neither — a half-open `[from,to)` window on `created_at` (UTC; no tenant timezone at platform scope). A KPI-tile row on `(superadmin)/platform`. |
| **Create a company + founding admin** (ADR-0036) | `POST /platform/tenants` | onboarding result (tenant, admin, `identityReused`, one-time `invitationUrl?`) | No password field — ever. |
| **Invitation lifecycle** (ADR-0036) | `GET/POST /platform/tenants/:tenantId/admin-invitation[/resend\|/revoke]` | invitation status | Never the token, never a password. |
| **Start/end a Tenant Support session** (ADR-0036) | `POST /platform/tenants/:tenantId/support-sessions`, `GET/POST /platform/support-sessions/current[/end]` | support session | One live session per admin (DB-unique); starting a new one supersedes an old one on a different tenant. |
| **Support-scoped read/write** (ADR-0036) | `GET .../support/users`, `GET .../support/warehouses`, `PATCH .../support/warehouses/:id/status` | curated tenant data | Requires a live session for that exact tenant, `SupportSessionGuard`-gated, never tenant RBAC. See `GAP-SUPPORT-READ-SCOPE`. |

### Super-Admin screens (F17)

- `S-SA-LOGIN` — platform sign in (`(public)`, dedicated).
- `S-SA-TENANTS` — company list (`(superadmin)/tenants`): name, slug, status badge
  (`active`/`suspended`/`archived`), isDemo, createdAt; client-side filter/sort; row → detail.
- `S-SA-TENANT-DETAIL` — company detail (`(superadmin)/tenants/[id]`): the 6 fields + **Suspend /
  Activate** actions (with a confirm dialog and the audit implications noted), plus (ADR-0036) the
  "Administrador del Tenant" invitation panel and the "Acceder como soporte" trigger.
- `S-SA-TENANT-NEW` (ADR-0036) — create a company (`(superadmin)/tenants/new`): no password field;
  shows the one-time invitation link or an "identity reused" notice on success.
- `S-SA-SUPPORT` (ADR-0036) — the curated support panel (`(superadmin)/tenants/[id]/support`):
  users + warehouses read, one write action (warehouse status), requires a live session.

`status = 'archived'` exists in the DB CHECK but **no endpoint sets it** → the UI does not offer
"archive".

## 3. What requires backend that does NOT exist — **GAP BACKEND**

These are common Super-Admin expectations. **None are implemented in the frontend.** Each is a
backend design decision first.

| # | Expectation | Why it is a GAP | Recommended phase |
| --- | --- | --- | --- |
| `GAP-SA-CREATE-TENANT` | Provision a company from the platform side | ~~The only way to create a tenant is the tenant's own `POST /auth/register` (self-service). No `POST /platform/tenants`.~~ **RESOLVED — ADR-0036.** | closed |
| `GAP-SA-TENANT-ADMINS` | See / manage the administrators (or all users) of a company | ~~No cross-tenant read.~~ **PARTIALLY RESOLVED — ADR-0036**: a curated, audited read (`support/users`) exists, but only inside a live, tenant-scoped, reason-required support session — never an unconditional browse. | future (unconditional browsing) |
| `GAP-SA-ADMIN-CRUD` | List / create / disable other Platform Admins | `platform_admins` has no CRUD endpoint — only the seed script. | future — needs an ADR (bootstrap vs UI, MFA, etc.) |
| `GAP-PLATFORM-AGGREGATE` | A platform dashboard with per-tenant metrics (users per tenant, activity, storage, last-activity) | **Company counts are done — F18-10** (`GET /platform/summary`, `tenants` table only). What is still missing: any aggregate over a **tenant-scoped** table (`users`, `orders`, …) across tenants — `app_platform` has the grants but "the endpoints do not exist and building them naively would breach the isolation model"; multi-tenancy.md#administrative--cross-tenant-queries requires a dedicated **audited** aggregate path, designed as such. No ADR yet. | future / platform-ops (own ADR) |
| `GAP-SA-BILLING` | Plans, subscriptions, MRR, invoicing | No billing model anywhere in the schema. | future — a bounded context of its own, ADR first |
| `GAP-SA-AUDIT` | Platform action audit view (who suspended what, when) | `audit_log` records platform actions (`actor_type='platform_admin'`, `tenant_id IS NULL`) but has **no read endpoint**. | future (with `GAP-AUDIT-READ`) |
| `GAP-SA-IMPERSONATION` | "Log in as this tenant for support" | ~~Not modelled; would be a significant security decision.~~ **RESOLVED — ADR-0036, deliberately NOT as impersonation.** No tenant login, no tenant JWT, no phantom/shared-credential admin ever exists. Instead: an audited, tenant-scoped, time-boxed `platform_support_sessions` row; the actor stays the Platform Admin throughout, gated by `SupportSessionGuard` over a deliberately narrow curated surface (`GAP-SUPPORT-READ-SCOPE`), never tenant RBAC. | closed |

## 4. Access-to-tenant-data limits (must hold in F17 and forever)

- A Platform Admin sees **only the `tenants` table fields** listed in §2, or **numeric aggregates
  of that table** (`GET /platform/summary`, F18-10 — counts only, never a row's fields), **or**
  (ADR-0036) the curated `support/users` / `support/warehouses` surface — and only for exactly one
  tenant, and only while a `platform_support_sessions` row for that tenant is `active`. Outside that
  session, still never a tenant's products, inventory, orders, customers, users, or configuration.
- `@PlatformOnly()` routes never resolve a tenant context and never reach tenant RBAC — there is
  no tenant permission that grants platform access, by design (a Tenant Admin role can never be
  configured into it). This still holds for the support surface: `SupportSessionGuard` is a
  separate, additional gate, never a substitute for `@PlatformOnly()`, and never implemented via
  `@RequirePermissions()`/tenant RBAC (ADR-0036 §20).
- The `(superadmin)/` frontend must not call any `(tenant)/` API path — the support surface lives
  under its own `platform/tenants/:tenantId/support/*` controller, never the tenant API. Any support
  need beyond the curated surface (`GAP-SUPPORT-READ-SCOPE`) is a deliberate, one-at-a-time backend
  decision, not a frontend workaround.

## 5. Differentiation summary for F17-00

| Layer | Tenant Admin (F17) | Super-Admin (F17) |
| --- | --- | --- |
| Can do | Full tenant operation + tenant administration (users, roles view, location access, settings) per RBAC | List companies, view a company, suspend / activate, create a company + founding admin, manage its invitation, start an audited support session for curated read/write |
| Cannot do | Anything platform-level; cross-tenant | Anything tenant-scoped outside a live, reason-required support session's narrow curated surface; manage other platform admins; metrics beyond counts; billing |
| Backend gaps | none blocking F17 (see [f17-gaps.md](f17-gaps.md)) | `GAP-SA-ADMIN-CRUD`, `GAP-PLATFORM-AGGREGATE`, `GAP-SA-BILLING`, `GAP-SA-AUDIT`, `GAP-SUPPORT-READ-SCOPE` (curated surface, not a full browse) |
| Future phase | F17 modules | a dedicated platform-operations phase (post-F18) |
