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

### Super-Admin screens (F17)

- `S-SA-LOGIN` — platform sign in (`(public)`, dedicated).
- `S-SA-TENANTS` — company list (`(superadmin)/tenants`): name, slug, status badge
  (`active`/`suspended`/`archived`), isDemo, createdAt; client-side filter/sort; row → detail.
- `S-SA-TENANT-DETAIL` — company detail (`(superadmin)/tenants/[id]`): the 6 fields + **Suspend /
  Activate** actions (with a confirm dialog and the audit implications noted).

`status = 'archived'` exists in the DB CHECK but **no endpoint sets it** → the UI does not offer
"archive".

## 3. What requires backend that does NOT exist — **GAP BACKEND**

These are common Super-Admin expectations. **None are implemented in the frontend.** Each is a
backend design decision first.

| # | Expectation | Why it is a GAP | Recommended phase |
| --- | --- | --- | --- |
| `GAP-SA-CREATE-TENANT` | Provision a company from the platform side | The only way to create a tenant is the tenant's own `POST /auth/register` (self-service). No `POST /platform/tenants`. | future (platform-ops phase) — needs an ADR: who becomes the first admin, invite flow, etc. |
| `GAP-SA-TENANT-ADMINS` | See / manage the administrators (or all users) of a company | No cross-tenant read. A Platform Admin **must not** read tenant-scoped data (`users`, `identities`, `tenant_memberships`) — `app_platform` has BYPASSRLS but the endpoints do not exist and building them naively would breach the isolation model. multi-tenancy.md requires an **explicit, audited, SuperAdmin-scoped aggregate path**. | future — needs an ADR + a dedicated read path |
| `GAP-SA-ADMIN-CRUD` | List / create / disable other Platform Admins | `platform_admins` has no CRUD endpoint — only the seed script. | future — needs an ADR (bootstrap vs UI, MFA, etc.) |
| `GAP-PLATFORM-AGGREGATE` | A platform dashboard with per-tenant metrics (users per tenant, activity, storage, last-activity) | **Company counts are done — F18-10** (`GET /platform/summary`, `tenants` table only). What is still missing: any aggregate over a **tenant-scoped** table (`users`, `orders`, …) across tenants — `app_platform` has the grants but "the endpoints do not exist and building them naively would breach the isolation model"; multi-tenancy.md#administrative--cross-tenant-queries requires a dedicated **audited** aggregate path, designed as such. No ADR yet. | future / platform-ops (own ADR) |
| `GAP-SA-BILLING` | Plans, subscriptions, MRR, invoicing | No billing model anywhere in the schema. | future — a bounded context of its own, ADR first |
| `GAP-SA-AUDIT` | Platform action audit view (who suspended what, when) | `audit_log` records platform actions (`actor_type='platform_admin'`, `tenant_id IS NULL`) but has **no read endpoint**. | future (with `GAP-AUDIT-READ`) |
| `GAP-SA-IMPERSONATION` | "Log in as this tenant for support" | Not modelled; would be a significant security decision. | future — ADR required; not assumed |

## 4. Access-to-tenant-data limits (must hold in F17 and forever)

- A Platform Admin sees **only the `tenants` table fields** listed in §2, or **numeric aggregates
  of that table** (`GET /platform/summary`, F18-10 — counts only, never a row's fields). Never a
  tenant's products, inventory, orders, customers, users, or configuration.
- `@PlatformOnly()` routes never resolve a tenant context and never reach tenant RBAC — there is
  no tenant permission that grants platform access, by design (a Tenant Admin role can never be
  configured into it).
- The `(superadmin)/` frontend must not call any `(tenant)/` API path. If a support need arises
  that requires tenant data, that is `GAP-SA-TENANT-ADMINS` / `GAP-SA-IMPERSONATION` — a backend
  decision, not a frontend workaround.

## 5. Differentiation summary for F17-00

| Layer | Tenant Admin (F17) | Super-Admin (F17) |
| --- | --- | --- |
| Can do | Full tenant operation + tenant administration (users, roles view, location access, settings) per RBAC | List companies, view a company, suspend / activate |
| Cannot do | Anything platform-level; cross-tenant | Anything tenant-scoped; create tenants; manage admins; see users; metrics; billing |
| Backend gaps | none blocking F17 (see [f17-gaps.md](f17-gaps.md)) | `GAP-SA-CREATE-TENANT`, `GAP-SA-TENANT-ADMINS`, `GAP-SA-ADMIN-CRUD`, `GAP-PLATFORM-AGGREGATE`, `GAP-SA-BILLING`, `GAP-SA-AUDIT` |
| Future phase | F17 modules | a dedicated platform-operations phase (post-F18) |
