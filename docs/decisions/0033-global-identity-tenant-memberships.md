# ADR-0033: Global Identity + Tenant Memberships (database layer)

## Status

Accepted. Implemented by **016-B** (database layer only — see [database.md#global-identity-and-tenant-memberships](../architecture/database.md#global-identity-and-tenant-memberships)). The
authentication flow this schema enables (email+password login, tenant selection, `switch-tenant`,
JWT changes) is **not** implemented by this ADR/prompt — it is a separate, later prompt.

This ADR **partially supersedes** [ADR-0030](0030-authentication-foundation.md)'s "Login requires
a tenant slug" section: that requirement is expected to be removed once the auth-flow prompt lands,
but the login endpoint itself is unchanged by 016-B and still requires `tenantSlug` today.

## Context

[ADR-0030](0030-authentication-foundation.md) models `users` as tenant-scoped: `users.tenant_id NOT
NULL`, `email` unique per tenant (not globally), one `password_hash` per `users` row. Login
therefore requires `{ tenantSlug, email, password }` — `tenantSlug` plays the role a username does,
because the same email can legitimately exist as unrelated rows in different tenants. ADR-0030
explicitly considered and deferred the alternative ("a separate workspace-lookup step... enter
email, see which tenants match, pick one") because it would require a cross-tenant email lookup
(via `app_platform`, bypassing RLS) on every login attempt, widening that connection's exposure on
the highest-traffic unauthenticated endpoint in the system.

A dedicated audit (016-AUDIT) and architectural design (016-A) confirmed: a user today belongs to
**exactly one** tenant; the same email in two tenants is two independent accounts with independent
credentials; there is no membership concept. The product objective is: log in with email+password
only, let one person belong to several companies, and select/activate exactly one tenant per
session — without weakening tenant isolation.

## Decision

**Introduce two platform-scoped tables — `identities` (the person, globally, with one
authentication credential) and `tenant_memberships` (the bridge from an identity to a tenant, and
to that tenant's existing `users` profile row) — and change nothing else.**

1. **`identities`** — global email (case-insensitive unique), a single `password_hash`, a `status`
   (`active` / `pending_credential` / `disabled`). This is the future single source of truth for
   authentication; nothing reads it yet.
2. **`tenant_memberships`** — `identity_id` + `tenant_id` + `user_id`, `UNIQUE(identity_id,
   tenant_id)`, `UNIQUE(user_id)`, and a **composite** FK `(tenant_id, user_id) -> users(tenant_id,
   id)` (the [ADR-0018](0018-tenant-aware-referential-integrity.md) shape) so a membership can
   never point at a `users` row from a different tenant than the membership's own `tenant_id`.
3. **`users` is unchanged.** It remains the tenant-scoped profile every existing relation is keyed
   by: `user_roles`, `user_location_assignments`, `auth_refresh_tokens`, `audit_log.actor_id`, and
   every business FK (`carts.user_id`, `order_items.placed_by`, `assigned_by`, ...). A person
   belonging to two tenants has two `users` rows (unchanged from today) plus two
   `tenant_memberships` rows linking them to one `identities` row.
4. **Both new tables are platform-scoped: no RLS, no `app_tenant` GRANT** — the identical
   access-control-by-GRANT-only posture as `tenants` / `platform_admins` /
   `platform_admin_refresh_tokens`. Only `app_platform` (and `app_migrator` for schema/backfill)
   can touch them. A tenant-scoped connection can never enumerate identities or memberships.
5. **A deterministic, idempotent backfill migration (`0029`)** consolidates every existing `users`
   row into this new shape, grouped by normalized email, **never** by tenant, and **never** picking
   a password arbitrarily when a normalized email maps to more than one distinct
   `users.password_hash` — see [database.md](../architecture/database.md#global-identity-and-tenant-memberships)
   for the exact case table.
6. **`users.password_hash` and the current login are untouched.** The `tenantSlug`-based login
   (ADR-0030) keeps reading `users.password_hash` exactly as before; it does not read `identities`
   at all. This ADR only prepares the data.

## Architecture

```
identities (platform-scoped, no RLS)
    │ 1
    │ N
tenant_memberships (platform-scoped, no RLS; tenant_id is a FK, never an RLS key)
    │ 1 (user_id)
  ─ ┼ ─────────────────────────────────  tenant / RLS boundary  ─────────────────────────────
    │ 1
users  (tenant-scoped, RLS — UNCHANGED)
    ├── user_roles / role_permissions / roles           (UNCHANGED)
    ├── user_location_assignments                        (UNCHANGED)
    ├── auth_refresh_tokens                               (UNCHANGED)
    └── every business FK (audit_log.actor_id, carts.user_id, order_items.placed_by, ...) (UNCHANGED)
```

## Flujo de autenticación

**Not built by this ADR.** For the record, the flow this schema is designed to support (a later,
separate prompt implements it): `email+password` → resolve `identities` by email → validate the
one credential → enumerate active `tenant_memberships` (joined to `tenants.status='active'`) → one
membership auto-selects, several return a list for the user to pick from (only after the password
has already been validated) → the chosen membership's `tenant_id`/`user_id` becomes the session's
tenant context exactly as today (`AuthPrincipal`, `TenantGuard`, `withTenantTransaction`,
RLS) — none of which changes.

## Modelo de datos

See [database.md#global-identity-and-tenant-memberships](../architecture/database.md#global-identity-and-tenant-memberships)
for the full column list, constraints, and the backfill's case table (A/B/C/D-E). Migrations:
`0028` (schema), `0029` (backfill).

## Seguridad

- Both new tables are unreachable from `app_tenant` — no new cross-tenant read/write surface is
  introduced for tenant-scoped requests.
- The backfill never guesses a password: divergent hashes for one email produce
  `pending_credential` with a NULL credential, never a pick between the candidates (enforced at the
  schema level by `identities_credential_check`).
- The backfill is read-then-insert only against `users`; it never updates, deletes, or otherwise
  mutates any existing row. `users.password_hash` keeps working for the current login unchanged —
  this migration is fully reversible by dropping the two new tables.
- `users` briefly has `FORCE ROW LEVEL SECURITY` toggled off, inside the single transaction the
  migration runs in (see `database/migrations/0029_backfill_identities.sql`'s own comment) so that
  `app_migrator` (the table owner, but not matched by the `app_tenant`-only policy) can read every
  tenant's rows for the one-time consolidation; it is unconditionally restored before commit and
  verified by `test/database/migrations.integration.test.ts`.
- No new attack surface on the *current* authentication endpoints — none of them read or write the
  new tables.

## Alternativas consideradas

- **Keep `tenantSlug`, do nothing.** Rejected — does not meet the product objective (email+password
  login, multi-company users).
- **Membership without `user_id`; rewire `user_roles`/`user_location_assignments`/
  `auth_refresh_tokens`/business FKs to `identity_id`.** Rejected in 016-A — enormous blast radius
  across RLS-protected, already-shipped tenant data for no additional capability; `user_id` on the
  membership gives the same result with zero changes to any existing tenant-owned table.
- **Merge `users` into `identities` (one global `users`, `tenant_id` movable).** Rejected — the
  existing `prevent_tenant_id_change` trigger and per-tenant `email` uniqueness are load-bearing
  invariants elsewhere in the schema; moving a profile between tenants was never a requirement.
- **Pick a password on hash conflict (most recent login, most common tenant, etc.).** Rejected,
  explicitly, per the 016-B brief — silently choosing between two different credentials for the
  same email is a real account-takeover risk (whoever set the *other* tenant's password would gain
  access under an identity they don't otherwise control).

## Consecuencias

- Two new tables (migration `0028`), fully additive.
- A backfill migration (`0029`) that runs automatically as part of `db:migrate`, safe by
  construction (idempotent, deterministic, never destructive) — no manual step is required for
  correctness, though `database/scripts/report-identity-backfill.sql` is provided for operator
  review of any `pending_credential` consolidations or excluded rows after migrating a real
  environment with existing data.
- No change to `auth.service.ts`, `TenantGuard`, `JwtAuthGuard`, the JWT payload, RLS policies on
  any existing table, RBAC, location authorization, or the frontend. The current login continues
  to work unmodified.
- A later, separate prompt is required to actually use `identities`/`tenant_memberships` for
  authentication (login rewrite, tenant-selection endpoint, `switch-tenant`, JWT `identityId`
  claim, `TenantGuard` membership-status check) and to eventually retire `users.password_hash`.
- ADR-0030's `tenantSlug`-login requirement is superseded **in intent**, not yet **in code** — it
  remains the accurate description of the current, unmodified login endpoint until that later
  prompt ships.

## Migración

See [database.md#global-identity-and-tenant-memberships](../architecture/database.md#global-identity-and-tenant-memberships)
("Backfill (migration 0029)") for the full case table and the RLS-toggle mechanism. Summary: group
non-soft-deleted `users` rows by `lower(trim(email))`; one shared hash per group → one `active`
identity; divergent hashes → one `pending_credential` identity with a NULL credential; every
qualifying `users` row gets exactly one membership; empty/invalid emails and soft-deleted rows are
excluded and left untouched.

## Compatibilidad con arquitectura existente

| Documento | Estado |
| --- | --- |
| ADR-0003 (single-DB multi-tenant) | Compatible — no change. |
| ADR-0004 (aislamiento / RLS) | Compatible — RLS mechanism, keys, and policies are untouched. |
| ADR-0009 (RBAC) | Compatible — roles stay tenant-scoped, keyed by `users.id`. |
| ADR-0018 (FKs tenant-aware) | Compatible — `tenant_memberships`'s user FK follows the same composite shape. |
| ADR-0024 (location authorization) | Compatible — `user_location_assignments` untouched. |
| ADR-0030 (authentication foundation) | Partially superseded in intent (see Status) — code unchanged by 016-B. |
| ADR-0031 (self-escalation prevention) | Compatible — role-assignment rules, keyed by `users.id`, untouched. |
| ADR-0032 (platform-admin authentication) | Compatible — structurally separate; `identities`/`tenant_memberships` follow the same platform-scoped-table precedent this ADR set. |
| database.md / multi-tenancy.md / security.md / threat-model.md | Updated where this ADR's scope touches them (database.md); the auth-flow prompt updates the rest when it lands. |
