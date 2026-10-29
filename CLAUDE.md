# CLAUDE.md

This file is the technical contract for any work Claude Code performs in this repository.
It takes precedence over convenience or speed. If a request conflicts with this file, flag the
conflict and propose an ADR (see [docs/decisions/](docs/decisions/)) instead of silently deviating.

## 7.1 Objective

SaaS Inventory is a multi-tenant inventory management platform. It is initially aimed at
businesses selling white goods, furniture, appliances, and similar physical products, but the
architecture must stay generic enough to support any product/category later — no design should
hard-code assumptions specific to the initial verticals.

## 7.2 Architecture

```text
Next.js (Web) / future Mobile
        ↓
     REST API
        ↓
     NestJS
        ↓
 Domain / Application layer
        ↓
    Drizzle ORM
        ↓
   PostgreSQL
```

Web and mobile clients never access PostgreSQL directly. All business operations go through the
REST API. The backend is the only component with database credentials.

Detailed design lives in [docs/architecture/](docs/architecture/) (start at
[system-overview.md](docs/architecture/system-overview.md)), with the reasoning behind each major
choice recorded in [docs/decisions/](docs/decisions/). This section (§7.2–§7.9) states the binding
rules; those documents explain the *why* and the parts still open (`PENDING DECISION`).

## 7.3 Multi-tenancy

- All data belonging to a company must be isolated by tenant.
- A client can never freely choose which tenant it operates on — the tenant is derived from the
  authenticated context (never from a client-supplied header/body/query param taken at face value).
- Authorization is checked in the backend, not the frontend.
- The data-access layer must enforce tenant isolation, not just the service layer.
- PostgreSQL Row-Level Security (RLS) is implemented and active from the first migration
  (Prompt 03) — see [docs/architecture/database.md#row-level-security](docs/architecture/database.md#row-level-security).
  It is a defense-in-depth backstop, not a replacement for the guard/repository-layer checks
  above.

## 7.4 Security

- Never store secrets in the frontend.
- Never send database credentials to the frontend.
- Never access PostgreSQL directly from the frontend.
- Never commit secrets to Git.
- Never trust data coming from the client — validate everything server-side.
- Validate all inputs (DTOs + validation pipes).
- Validate authorization in the backend for every request.
- Actively guard against cross-tenant access (a valid session for tenant A must never read/write
  tenant B's data).
- Use database transactions for operations that require atomicity.
- Never log secrets or credentials.
- Never use real data in tests.
- Never use real credentials in the DEMO environment.
- The backend never talks to Telegram directly and never stores a Telegram bot token — that
  integration is owned entirely by n8n (`Backend → Outbox/Webhook → n8n → Telegram`).

## 7.5 Backend

- Controllers stay thin — they parse/validate input and delegate, no business logic inline.
- Business logic lives in services, not controllers.
- Services are decoupled from transport concerns (HTTP-specific types stay out of services).
- All inputs use DTOs with class-validator decorators.
- Repository/data-access is a separate layer from services when the domain warrants it.
- Errors are handled centrally (a global exception filter), not ad hoc per controller.
- Logs are structured and never contain secrets or full request bodies with sensitive fields.
- Every endpoint is documented via OpenAPI (NestJS Swagger module).

## 7.6 Frontend

- Components are reusable; shared UI logic is not duplicated across pages.
- No secrets, API keys, or credentials live in frontend code or bundles.
- The frontend never enforces authorization on its own — it reflects what the API allows but the
  API is the actual authority.
- The API is the only source of truth for business operations; the frontend does not compute
  business logic that belongs server-side.
- Every data-driven view handles loading, error, and empty states explicitly.
- UI is accessible (semantic HTML, labeled controls, keyboard navigation) and responsive.

## 7.7 Database

- Every schema change is a new, versioned Drizzle migration.
- An applied migration is never edited — a later change is a new migration.
- Constraints (NOT NULL, foreign keys, unique, checks) are used to enforce data integrity, not
  just application-level checks.
- Indexes are added deliberately, based on actual query patterns — not speculatively.
- Avoid N+1 queries; use joins/batched loading.
- Use transactions for multi-statement operations that must be atomic.
- Every new table/query involving tenant data is reviewed for tenant isolation.
- Historical data is never deleted without an explicit, documented decision (soft-delete or
  archival strategy, not silent hard deletes).

## 7.8 Git

Conventional Commits are mandatory:

```text
feat:     fix:      refactor:  docs:   test:
chore:    build:    ci:        perf:   security:
```

- No giant commits — each commit represents one logical change.
- Never push automatically. Pushing is always an explicit, separate action the user requests.

## 7.9 Definition of Done

A task is only done when:

- Code is implemented within the requested scope (nothing extra).
- Tests are written.
- Tests are executed and pass.
- Lint is executed and passes.
- Typecheck is executed and passes.
- Security has been reviewed (tenant isolation, input validation, secrets).
- Documentation is updated (README/docs/ADR as relevant).
- No secrets are present anywhere in the diff.
- Existing architecture is not broken.
- The git diff has been reviewed before considering the task complete.

## 7.10 Mandatory Claude Code process

Before modifying code:

1. Read this file (CLAUDE.md).
2. Inspect related files.
3. Review the architecture.
4. Review relevant ADRs (`docs/decisions/`).
5. Review existing tests.
6. Create a plan.
7. Implement only the requested scope.
8. Run tests.
9. Run lint.
10. Run typecheck.
11. Review security.
12. Update documentation.
13. Show a summary.
14. Show modified files.
15. Show risks.

Claude must not implement functionality that was not requested. Claude must not change the
architecture unilaterally — if an architectural decision needs to change, propose an ADR first
and get it agreed before implementing.

## Current project status

> **Verified status — 2026-10-26** (branch `develop`, HEAD `2215f5d`, clean tree, **not pushed**).
> The narrative below is **chronological and historical**: sentences such as "no role/permission
> CRUD exists yet", "no other business functionality exists yet" or "no frontend UI exists yet"
> described the repository at the time of that prompt and are **no longer true** — they are kept
> unchanged to preserve the decision history. For the current picture read, in this order:
> [docs/roadmap/roadmap.md](docs/roadmap/roadmap.md) ("Verified status" + "Work after FASE 18"),
> then [docs/roadmap/pending-register.md](docs/roadmap/pending-register.md) (open items with
> evidence), then the ADR index. In short: FASE 0–18 are implemented; FASE 19–24 are not started;
> much of the work after FASE 18 is implemented but **not validated** (the full real-PostgreSQL run
> of 2026-10-26 is green after the pre-FASE 19 fixes — 685 tests, 0 failed, 0 skipped — but its first run had 45 failing
> outdated tests; `apps/web` unit tests exit non-zero because of one unhandled error). Several rules
> described below were **changed by owner decision on 2026-10-26 / earlier** and are recorded in
> ADRs: the exceptional-discount trigger is `base_price`, not `min_price` (ADR-0022 amendment,
> 2026-10-05); any holder of `pricing.discount.approve` may resolve a price request, their own
> included (ADR-0022 amendment, 2026-10-26); serialized/lot-tracked variants are out of the MVP
> scope and rejected with 422 and no side effects (ADR-0039).

The PostgreSQL persistence layer (schema, migrations, RLS, constraints — Prompt 03) is
implemented. Authentication (Prompt 04) is implemented — registration (self-service tenant
provisioning), login, logout, session refresh/rotation, `GET /auth/me`, the guard chain
(JwtAuthGuard/TenantGuard/CsrfGuard/PermissionsGuard), and RBAC integration — see
[ADR-0030](docs/decisions/0030-authentication-foundation.md). Tenant/user/role administration
(Prompt 05-A) is implemented — `GET/PATCH /tenant`, `GET/POST /users`, `GET /users/:id`,
`PATCH /users/:id`, `GET /roles`, six new `core.*` permission codes (migration `0014`), and the
role-assignment self-escalation rule — see
[ADR-0031](docs/decisions/0031-role-assignment-escalation-prevention.md). No role/permission CRUD
(custom roles, per-role permission toggling) exists yet — roles remain the fixed
`DEFAULT_ROLE_TEMPLATES` set, editable only via direct database access. No other business
functionality exists yet: no product/inventory/order endpoints, no Telegram integration. See
[docs/roadmap/roadmap.md](docs/roadmap/roadmap.md) for the phase plan.

Prompt 05-B (integration hardening) verified the whole stack above against a real, local
PostgreSQL instance for the first time — no Docker required (`tools/pg-verify`, which starts a
disposable `embedded-postgres` server) — and fixed everything that surfaced only under that real
run: `@fastify/cookie` downgraded to `^9.4.0` (the last major compatible with the pinned
`fastify@^4.x`; `^11.x` requires Fastify 5 and crashed the server at boot); `apps/api/test/**/
*.integration.test.ts` now transforms via SWC (`vitest.integration.config.ts` +
`unplugin-swc`/`@swc/core`), not Vitest's default esbuild, because esbuild's `emitDecoratorMetadata`
approximation was silently dropping NestJS DI and `@nestjs/swagger` type metadata; `GET /health`
now carries `@Public()` + `@Version(VERSION_NEUTRAL)` so it is actually reachable unauthenticated
and unversioned, matching `docs/architecture/api.md`'s documented contract (previously 401/404);
`UsersService`'s unique-email-violation → 409 mapping now also unwraps
`DrizzleQueryError.cause` (drizzle-orm's postgres-js driver never puts Postgres's `.code` on the
thrown error directly); and two integration test files (`test/auth/auth-flow.integration.test.ts`,
`test/core/users-rbac.integration.test.ts`) no longer call `resetAndMigrate()` in their own
`beforeAll`, since that raced against `global-setup.ts`'s single run under `fileParallelism: true`.
See the Prompt 05-B final report for the full real-Postgres test matrix.

Prompt 06 added the CATALOG module (`apps/api/src/catalog/`) — `GET/POST /categories`,
`GET/PATCH /categories/:id`, `GET/PUT /categories/:id/attributes`, `GET/POST /attribute-definitions`
(+ options sub-resource), `GET /measurement-units`, `GET/POST /products`, `GET/PATCH /products/:id`,
`GET/POST /products/:id/variants`, `GET/PATCH /products/:id/variants/:variantId` — four new
`products.*`/`categories.*` permission codes (migration `0015`, filling a gap where `database.md`
had named `products.view` as an already-established example since Prompt 02-D but no migration had
ever inserted it), a shared `AttributeValidationService` enforcing the governed-JSONB rules from
[ADR-0026](docs/decisions/0026-dynamic-attribute-system.md) on every product/variant create and
update (including category-change re-validation), and `product_price_history` writes on every price
change per [ADR-0022](docs/decisions/0022-pricing-tiers-and-discount-approval.md). Every product
creates exactly one default variant alongside it, per
[ADR-0017](docs/decisions/0017-product-variant-attribute-model.md). Deliberately not built this
phase (each already scoped to its own module/phase — see
[modules.md](docs/architecture/modules.md)): brands/suppliers CRUD, QR, the Excel import pipeline
(needs its own Import Worker deployable per
[ADR-0029](docs/decisions/0029-import-worker-separation.md)), and the SALES-dependent
`price_approvals` exceptional-discount workflow. No frontend UI for CATALOG exists yet.

Prompt 07 added the INVENTORY module's physical structure (`apps/api/src/inventory/`) — strictly
roadmap.md's FASE 7 scope: `GET/POST /warehouses`, `GET/PATCH /warehouses/:id`, `GET/POST /locations`,
`GET/PATCH /locations/:id`, `GET/PUT /users/:id/locations` — four new `warehouses.*`/`locations.*`
permission codes (migration `0016`, same gap-filling precedent as Prompt 06's `0015`) plus reuse of
the already-seeded `core.users.locations.manage` (migration `0001`) for the location-assignment
endpoints. Creating a warehouse always creates its default "General" location in the same
transaction, per `database.md`'s "every warehouse always has at least one location" invariant.
Deliberately **not** built this phase (roadmap.md's FASE 8, a separate prompt): `inventory_balances`/
`inventory_movements` reads/writes, stock adjustments, initial stock, concurrency/locking on
balances, and inventory transfers — those tables (`inventory_balances`, `inventory_movements`,
`inventory_transfers` and friends) have existed, fully migrated, since Prompt 03/03-A, but no
application code touches them yet. The location-scoped-authorization *guard* (ADR-0024, combining
RBAC with `user_location_assignments` membership) is also FASE 8 work — this phase only manages the
assignment data itself. No frontend UI for INVENTORY exists yet.

Prompt 08 completed the INVENTORY module (`apps/api/src/inventory/`) — `GET /inventory/balances`,
`GET /inventory/balances/:id`, `GET /inventory/movements`, `POST /inventory/adjustments`
(RECEIPT/ADJUSTMENT_IN/ADJUSTMENT_OUT, the only client-selectable movement types outside the
transfer lifecycle), and the full transfer lifecycle under `/inventory/transfers` — `POST /`,
`GET /`, `GET /:id`, `POST /:id/approve`, `POST /:id/prepare`, `POST /:id/dispatch`,
`POST /:id/receive`, `POST /:id/cancel` — implementing the `draft -> approved -> preparing ->
dispatched -> partially_received/received` state machine exactly as documented in
[ADR-0020](docs/decisions/0020-multi-location-inventory-transfers.md), with in-transit stock derived
from open transfer items (never a stored balance bucket). Two new permission codes
(`inventory.view`, `inventory.adjust`; migration `0017`, same gap-filling precedent as migrations
0015/0016) join the `inventory.transfers.*`/`inventory.returns.manage` codes already seeded since
migration `0001`. Every stock-affecting write — adjustments and every transfer state transition —
goes through one shared locking convoy (`StockLedgerService.applyMovement`): `INSERT ... ON CONFLICT
DO NOTHING` (first-touch race), `SELECT ... FOR UPDATE` on the balance row, application-level
validation against the schema's own CHECK constraints, an append-only `inventory_movements` insert,
then an optimistic-locked `UPDATE` on `inventory_balances` — matching
[database.md#concurrency-strategy](docs/architecture/database.md#concurrency-strategy) verbatim.
Every transfer state transition additionally row-locks the `inventory_transfers` header itself
first, serializing concurrent attempts on the same transfer (double-dispatch, double-cancel) before
any balance row is ever touched. The ADR-0024 location-authorization guard FASE 7 deliberately
deferred is now `LocationAuthorizationService`, checked explicitly wherever a write targets a
specific physical location (adjustments; transfer prepare/dispatch on the source location; receive
on the destination location) — a second, independent check alongside the `inventory.*`
`RequirePermissions` gate, never a substitute for it. Transfer receiving requires a client-supplied
`Idempotency-Key` header (`database.md#idempotency`'s general `idempotency_keys` table, `scope =
'transfer.receive'`) since, unlike every other one-time transition, two legitimate receiving events
can have identical shape. Deliberately **not** built this phase: `product_serials`/`product_lots`
movement-level linkage (database.md itself leaves this "not fully pinned" and no schema column
exists for it — extending the schema to add one was out of this phase's no-schema-changes mandate),
and `sales_returns`/`sales_return_items` (ADR-0021's returns model FK-references `orders`/
`order_items`, which do not exist until SALES/FASE 10 — `inventory.returns.manage` is seeded but
unused until then). No frontend UI for INVENTORY exists yet.

Prompt 09 added the QR module (`apps/api/src/qr/`) — `POST/GET /qr-codes`, `GET/PATCH /qr-codes/:id`,
`GET /qr-codes/resolve/:code` (authenticated, tenant-scoped identity resolution), and the
unauthenticated, unversioned `GET /q/:code` public resolver, exactly matching api.md's literal
documented route. No new permission code: `catalog.qr.manage` (already seeded since migration 0001)
gates every `/qr-codes*` management route; `resolve/:code` needs only authentication, per
mobile.md#qr-on-mobile's explicit design — QR's own job is identity resolution only ("what does this
code point at"), never pricing, so the authenticated path hands the caller `{productId,
productVariantId}`/`{locationId}` and the caller then calls the pre-existing, unmodified
`GET /products/:id/variants/:variantId` (ADR-0028's field-level price authorization) or
`GET /locations/:id` — no pricing logic is duplicated inside QR. A real, pre-existing schema gap was
found and closed (migration `0018`): `database.md#row-level-security` and `#qr-codes` already
documented `app_public_resolver` as needing row access to `products`/`product_variants`/`locations`,
and migration 0003 had granted the column-level `GRANT`s for the first two — but no `CREATE POLICY`
naming that role ever existed on any of the three tables, and RLS defaults to deny with zero matching
policies, so the public QR resolver could never actually read a row at the database level despite the
column `GRANT`s. Migration 0018 adds the three `*_public_resolve` SELECT policies (`USING (deleted_at
IS NULL)`, no other restriction — access is bounded by the pre-existing `GRANT`s) plus the
column-level `GRANT SELECT (id, tenant_id, name, code, status) ON locations`, the one piece
`locations` never had at all. `qr_codes.code` is a `randomBytes(24)`-based opaque token (never
`generateId()`'s UUIDv7 — that's chosen for time-ordering, the opposite property wanted on a value
meant to be publicly printed), minted by insert-and-catch-`23505`-and-retry, never
SELECT-then-INSERT, against the table's existing global `UNIQUE (code)` constraint (migration 0004).
The public resolver runs on its own Postgres connection/role (`app_public_resolver`,
`public-resolver-client.ts`, `APP_PUBLIC_RESOLVER_DATABASE_URL`) — never `withTenantTransaction()`,
since there is no session to derive a tenant from — and is rate-limited by IP alone
(`QrPublicThrottlerGuard`, `QR_PUBLIC_RATE_LIMIT_MAX`/`_TTL_SECONDS`), consistent with
threat-model.md's brute-force mitigation already established for login. Because `DatabaseModule` is
`@Global()`, every existing `buildApp()`-based integration test (auth, catalog, core, inventory) now
also bootstraps `APP_PUBLIC_RESOLVER_DATABASE_URL` in its own `beforeAll` — a direct, unavoidable
consequence of wiring a new required global connection, not scope creep. No frontend UI for QR exists
yet.

Prompt 10 added the IMPORT module (`apps/api/src/import/`) — the staged Excel onboarding pipeline
per ADR-0027: `GET /imports/template` (dynamic `.xlsx` generation via `exceljs`, reflecting the
tenant's real categories/attributes/warehouses/locations), `POST /imports` (multipart upload via
`@fastify/multipart@^8` — downgraded from the latest major, which requires Fastify 5 and broke
every integration suite's `buildApp()`, the same class of pin this repo already hit with
`@fastify/cookie`), `GET /imports`, `GET /imports/:id`, `POST /imports/:id/mapping`,
`POST /imports/:id/validate`, `GET /imports/:id/preview`, `GET /imports/:id/rows`,
`POST /imports/:id/confirm`, `POST /imports/:id/cancel`, `GET /imports/:id/errors` (a sanitized,
formula-injection-safe error report), plus full `import-mapping-templates` CRUD. `import_jobs`/
`import_job_rows`/`import_mapping_templates` (schema-ready since migration 0008) get their first
application code here — no schema changes to those three tables. `ImportValidationService` and
`ImportExecutionService` are the two domain services both the synchronous (small-file) HTTP path
and the async Import Worker path call identically — `IMPORT_SYNC_ROW_THRESHOLD`/`IMPORT_BATCH_SIZE`
decide which path a job takes, never a second implementation. Every attribute check reuses
`AttributeValidationService` verbatim (ADR-0026); every quantity write reuses
`StockLedgerService.applyMovement` (`INITIAL_STOCK` for new SKUs, `ADJUSTMENT_IN` for
`update_catalog_and_inventory` on existing ones — never a parallel write path); every
location-targeting row is checked against `LocationAuthorizationService` at validation time, not
deferred to commit. `duplicate_handling_mode` defaults to `update_catalog_only` — inventory is only
ever touched when a job explicitly opts into `update_catalog_and_inventory`, which additionally
requires the `import.inventory` permission (checked in `ImportJobService.triggerConfirm`, not just
the route's `import.execute` gate). A real, necessary schema gap was found and closed: no
`app_import_worker` Postgres role existed (migration 0000 predates ADR-0029), so migration 0019
creates it — `RESET ROLE` back to the migration session's originally-authenticated identity first,
since by migration 0019 the session has already `SET ROLE app_migrator` (no `CREATEROLE` of its
own), confirmed necessary by actually running this migration against real PostgreSQL
(`tools/pg-verify`, which failed with `permission denied to create role` before the fix) — plus one
permissive, table-scoped policy each on `import_jobs`/`import_job_rows`, the same shape as
`app_event_processor`'s `event_outbox` policy. Migration 0020 adds
`import_jobs.claimed_at`/`claimed_by` (same shape as `event_outbox`'s own claim columns — needed to
distinguish "just transitioned, needs pickup" from "already claimed" from "stale, reclaimable",
which the schema had no way to express before) and migration 0021 adds the matching partial claim
index. The Import Worker itself (`apps/api/src/import-worker/main.ts`,
`worker:import:dev`/`worker:import:start`) is a separate `NestFactory.createApplicationContext`
process — never `.listen()`s — polling `ImportWorkerClaimRepository`'s `FOR UPDATE SKIP LOCKED`
claim query over its own `app_import_worker` connection (`import-worker-client.ts`,
`APP_IMPORT_WORKER_DATABASE_URL`), then calling the exact same `ImportJobService.runValidation`/
`runCommit` the synchronous HTTP path uses once a job's tenant is known. Serialized/lot-tracked rows
write directly into `product_serials`/`product_lots` (first application code to touch either
table); a duplicate SKU/serial/lot within one file is always rejected as an intra-file duplicate,
regardless of whether it also exists in the database — a known, deliberate scope limit: bulk-adding
multiple brand-new serialized units under one not-yet-existing SKU in a single file is not
supported (create the variant first, then import additional serials against the now-existing SKU).
Uploaded files and generated error reports are written through the new `ObjectStorageService`
(`apps/api/src/common/storage/`, `@aws-sdk/client-s3`, S3-compatible/MinIO) — the first module to
actually need object storage (`product_images.storage_key` was schema-ready but never wired to a
real client). `docker-compose.dev.yml` gained `minio`/`minio-init`/`import-worker` services.
Verified against real PostgreSQL end to end via `tools/pg-verify` (143 integration tests passing,
including the full staged pipeline, tenant isolation, RBAC, and location authorization) plus a
separate throwaway `embedded-postgres` run exercising the `app_import_worker` claim query
specifically (cross-tenant claiming, no double-claim under concurrency, stale-claim reclaiming) —
gated by `TEST_APP_IMPORT_WORKER_DATABASE_URL`, unset in the standard `pg-verify` harness, so
`test/import/import-worker.integration.test.ts` skips there by design; see the FASE 10 final report
for the exact command. No frontend UI for IMPORT exists yet (FASE 16/17).

FASE 11 added the ADMINISTRATION module (`apps/api/src/administration/`) — strictly the two
capabilities grounded in the existing architecture, per modules.md#administration and this phase's
final report. Tenant-level configuration: `GET`/`PATCH /administration/tenant-settings` (timezone,
business hours — `administration.settings.view`/`.manage`, migration `0023`), backed by a new
singleton-per-tenant `tenant_settings` table (migration `0022`); the effective value is resolved
server-side (stored row, or a hardcoded system default when none exists yet) — never a second
"defaults" table. `notification_preferences`/branding were deliberately not built: the former's
mechanism is an explicit `PENDING DECISION` events.md defers to FASE 15 (tenant-configurable
notifications), the latter modules.md itself names "later." System-level administration: the
platform-admin (SuperAdmin) authentication mechanism ADR-0030/Prompt 04 deliberately left unbuilt
(`auth_refresh_tokens.tenant_id`/`user_id` are `NOT NULL` by design — see that migration's own
header comment anticipating this exact follow-up) is now built — see
[ADR-0032](docs/decisions/0032-platform-admin-authentication.md): a structurally distinct JWT
payload (`context: 'global'`, never `tenantId`), a new `platform_admin_refresh_tokens` table
(platform-scoped, no RLS), distinct session cookies (`platform_access_token`/
`platform_refresh_token`/`platform_csrf_token`), and a new `@PlatformOnly()` route-guard branch
(`common/guards/tenant.guard.ts`) that requires a verified platform principal and never touches
tenant RBAC — no permission code exists for platform routes, by design. `POST /platform/auth/login`
has no self-service registration counterpart; the first platform admin is provisioned out-of-band
(`pnpm --filter @saas-inventory/database seed:platform-admin`, opt-in, never part of the default
demo seed). The one concrete system-level capability built on top of this: tenant lifecycle
management (`GET /platform/tenants`, `GET /platform/tenants/:tenantId`, `POST
/platform/tenants/:tenantId/suspend`/`activate`), reusing `TenantsPlatformRepository` (CORE/AUTH's
existing repository) as-is rather than a second `tenants`-table repository. A real, necessary grant
gap was found and closed (migration `0022`): `app_platform` had `SELECT`-only on `audit_log`
(migration 0002) because no platform-level write path existed before this phase — `PlatformAuditLogService`
(parallel to the existing tenant-scoped `AuditLogService`) is the first code to use the new `GRANT
INSERT`. Migration `0024` closes a second real gap, found running `test/database/
migrations.integration.test.ts` for real: `tenant_settings` was missing ADR-0018's universal `UNIQUE
(tenant_id, id)` composite-FK-target constraint. Platform-level metrics and global configuration/
"plans" — named as illustrative SuperAdmin capabilities in multi-tenancy.md but with no concrete
architectural definition anywhere — are deliberately not built. No frontend UI for ADMINISTRATION
exists yet (FASE 16/17).

PROMPT 011-A (post-FASE-11 controlled correction) audited and closed a real gap FASE 11's own
report did not demonstrate: `AuthService.login()` already rejected a non-`active` tenant, but
`AuthService.refresh()` did not, and — the P0 case — `TenantGuard` resolved tenant scope purely
from the already-verified JWT claims and never checked `tenants.status` at all, so an access token
minted while a tenant was `active` kept working on every tenant-scoped route (`GET /tenant`,
`GET /categories`, ...) for the rest of its TTL even after that tenant was suspended via `POST
/platform/tenants/:tenantId/suspend`. Fixed at the single central point every tenant-scoped
request already passes through — `TenantGuard` (`common/guards/tenant.guard.ts`) now reads
`tenants.status` live via `TenantsPlatformRepository` (added as a `CommonModule` provider) before
resolving `tenantContext`, and `AuthService.refresh()` does the same live check before rotating a
token. Neither the JWT nor the refresh-token row was changed to carry a frozen status — a token
rejected only because its tenant is suspended is left un-revoked, so reactivation (`tenants.status`
back to `active`) makes it work again immediately, with no forced re-login, since the check is a
live read evaluated fresh on every request, not a cached decision. No new table, no permission
code, no ADR (a gap-closure in already-approved lifecycle semantics, not a new architectural
decision), no controller-by-controller check, and `@PlatformOnly()` routes are structurally
unaffected (they never resolve a tenant context at all). See
[security.md#tenant-isolation](docs/architecture/security.md#tenant-isolation) and
[multi-tenancy.md#enforcement-layers-defense-in-depth](docs/architecture/multi-tenancy.md#enforcement-layers-defense-in-depth).

PROMPT 011-B (a second post-FASE-11 controlled correction) closed the two gaps 011-A's own audit
had flagged but left open: `TenantGuard` re-checked `tenants.status` but never `users.status` — a
disabled user's still-valid access token kept working on every tenant-scoped route until it
expired, since `loadEffectivePermissions` only ever reads `user_roles`/`role_permissions`, never
`users`. Fixed the same way as the tenant check: `TenantGuard` now also calls
`UsersRepository.findById(tx, tenantId, userId)` (tenant- *and* user-id-scoped, so a user from a
different tenant can never match) inside the transaction that already loads permissions, rejecting
with `403 ("User is not active.")` if the row is missing or not `active` — `login()`/`refresh()`
already had this check, unchanged. Second: the Import Worker (`apps/api/src/import-worker/`) never
passes through `TenantGuard` at all (no HTTP request, no guard chain) — nothing previously stopped
it from claiming or continuing a job belonging to a tenant a SuperAdmin had since suspended.
`ImportWorkerClaimRepository`'s claim query (`import-worker-claim.repository.ts`) now `JOIN`s
`tenants` and excludes any job whose tenant is not `active` — locking only `import_jobs` via `FOR
UPDATE OF ij`, deliberately never `tenants`, so this read can never block (or be blocked by) a
platform-admin suspend/activate call — requiring one narrow new grant, `GRANT SELECT (id, status)
ON tenants TO app_import_worker` (migration 0025; `tenants` has no RLS, access is by-GRANT alone).
An already-claimed job's own batch loop (`ImportValidationService.validateJob`/
`ImportExecutionService.commitJob`) now re-checks the same live status before starting every batch
via the existing `TenantsPlatformRepository` (no new grant needed there — `app_platform` already
reads `tenants` unrestricted) — a batch already in flight is allowed to finish (no mid-transaction
abort), only the *next* batch is prevented from starting, and the job is left in its current,
resumable status rather than being finalized. This required propagating a
`commitJob(): Promise<boolean>` "did it actually finish" signal up to
`ImportJobService.runCommit`, which previously finalized the job to `completed`/
`completed_with_errors` unconditionally after `commitJob` returned — a real bug this prompt's own
tracing caught before it could ship: without that signal, a job merely paused by a suspension would
have been incorrectly marked done. `tools/pg-verify` now also bootstraps `app_import_worker` and
passes `TEST_APP_IMPORT_WORKER_DATABASE_URL`, so `test/import/import-worker.integration.test.ts`
(previously a separate manual run per FASE 10's own report) runs as part of the standard verify
pass. No new ADR (both are gap-closures in already-approved status/lifecycle semantics), no new
table, no new permission code, no controller-by-controller or per-service-by-service check outside
the two central points named above.

FASE 12 added the SALES module (`apps/api/src/sales/`) — customers, the vendor cart, and orders,
per modules.md#sales. The `0009_sales`/`0011_idempotency` schema (customers, carts/cart_items,
orders/order_items, idempotency_keys — RLS + tenant-aware FKs since Prompt 03) gets its first
application code here; **no schema table was added or changed**. Six new `sales.*` permission codes
(migration `0026`, `module.resource.action` pattern, same gap-filling precedent as
0014-0017/0023): `sales.customers.view`/`.manage`, `sales.carts.manage`,
`sales.orders.view`/`.create`/`.cancel`; `pricing.floor.view` (ADR-0028 field-level `min_price`
visibility — enforced by explicit DTO construction, never a strip-after-the-fact) and
`pricing.discount.request` are reused as-is. **Customers**: `GET/POST /customers`,
`GET/PATCH /customers/:id`, search by displayName/taxId/email/phone; `taxId` is unique per tenant
(`customers_tenant_id_tax_id_key`), never globally; soft-deleted, never physically removed.
**Cart**: a singular `/cart` resource owned by the authenticated vendor (`carts.user_id`), one open
cart per vendor (enforced in-service via `findOpenByUser` + `pg_advisory_xact_lock`, not a new
unique index); `GET/POST/PATCH /cart`, `POST/PATCH/DELETE /cart/items[/:itemId]`; no inventory is
reserved by cart edits (database.md#cart's explicit design). **Orders**: `GET /orders`,
`GET /orders/:id`, `POST /orders` (`Idempotency-Key` header required — `idempotency_keys`,
`scope = 'orders.create'`, with a `pg_advisory_xact_lock` on the key serializing concurrent
retries), `POST /orders/:id/confirm`, `POST /orders/:id/cancel`. **Two-phase inventory lifecycle**
(derived from modules.md#order-flow, which only pins "reserve at creation / release on cancel"):
`POST /orders` freezes the customer + per-line price snapshots, writes one `RESERVATION` movement
per line through `StockLedgerService` (SALES never writes `inventory_balances` directly) and
creates the order `pending`; `confirm` writes `RESERVATION_RELEASE` + `SALE` per line (the physical
commit boundary) → `confirmed`; `cancel` releases a still-`pending` reservation → `cancelled` — a
`confirmed` order can only be reversed by a sales return (FASE 13), never cancelled. Totals are
server-computed with one half-up-to-2dp rounding policy (`line_total = unit_price * qty`,
`subtotal = Σ line_total`, `tax_total = 0`, `total = subtotal`; `discount_total` is informational,
not re-subtracted). `order_number` is `ORD-` + a 6-digit per-tenant sequence
(`pg_advisory_xact_lock` + `COUNT(*)+1`, never unlocked `MAX+1`). `currency` is `'USD'` (documented
FASE 12 assumption — no tenant currency config exists). Document type: `invoice` sets
`invoice_status = 'pending'` and requires the customer to have taxId/email/phone/address;
`sales_note` carries NULL `invoice_status`; the platform never issues a fiscal document (ADR-0023).
A negotiated price within `[min_price, max_price]` completes; in FASE 12 **below `min_price` was
rejected (`409`), never bypassed** — FASE 13 replaces that with the order-first
`price_approvals` workflow (see the FASE 13 paragraph below). **Deliberately not built in FASE 12**
(each a later phase): selling serialized/lot-tracked variants
(rejected `422` — no approved `order_items` ↔ `product_serials`/`product_lots` model, and
`inventory_movements` has no serial/lot column, the same "not fully pinned" gap FASE 8/10 flagged),
`price_approvals`/`sales_returns` (FASE 13), any `event_outbox` write (FASE 14), Telegram/n8n
(FASE 15), any frontend (FASE 16/17). Verified end to end against real PostgreSQL via
`tools/pg-verify` (232 integration tests, 0 skipped — including SALES tenant isolation, IDOR, RBAC,
location authorization, price-field visibility, historical snapshots, the last-unit checkout race,
idempotent order creation under HTTP retry + concurrent same-key + payload mismatch, and the
011-A/011-B tenant-suspension / user-deactivation regressions applied to SALES routes). No frontend
UI for SALES exists yet (FASE 16/17).

PROMPT 012-A (post-FASE-12 controlled correction) closed two points the FASE 12 review flagged.
**(1) Customer data.** FASE 12 required the full commercial customer record (`tax_id`, `email`,
`phone`, non-empty `address`, plus the always-present `display_name`) only for `document_type =
'invoice'`; a `sales_note` needed only `display_name`. The approved rule (this prompt's §6, and
FASE 12's own §34) is that **both** document types require the same complete buyer record to close
a sale — `invoice` vs `sales_note` differ only by `document_type` / `invoice_status`, never by
required customer data. `OrdersService.assertCustomerDataForDocument(customer, documentType)` became
`assertCustomerCommercialData(customer)` (no document-type branch), still run before `resolveLines`
and every write, still `422` naming the missing fields, still zero order / `order_items` /
inventory-reservation / idempotency-success side effect on failure. **(2) Order transition
concurrency.** Audited `confirm` vs `confirm` and `confirm` vs `cancel` on one `pending` order:
**no functional bug** — both `OrdersService.confirm` and `.cancel` already begin their
`withTenantTransaction` with `OrdersRepository.lockById` (`SELECT … FOR UPDATE` on the single
`orders` row), which serializes concurrent transitions: the second blocks on the row lock, then
re-reads the now-terminal status under READ COMMITTED and returns idempotently (`confirm` on an
already-`confirmed` order) or `409`. Effects are exactly-once (one `SALE` + one
`RESERVATION_RELEASE` per line, one `order.confirmed` audit; never a `confirmed`-then-`cancelled`
order or a double release), and the transition + its movements + the audit are one transaction — a
throw anywhere rolls back every write in that call. No code change to the transition logic (per the
prompt's "do not refactor if already correct"); the gap was **test coverage** — FASE 12 proved
`checkout` vs `checkout` and same-`Idempotency-Key` races but not transition-vs-transition. Added
`test/sales/sales-order-transitions.integration.test.ts` (T1/T5 confirm/confirm, T2/T10
confirm/cancel run repeatedly, T6/T7/T8 sequential terminal transitions, T9 multi-line, plus a
rollback test via a mid-transition `ForbiddenException`, all counting `inventory_movements` and
`audit_log` rows directly from the DB) and the C1-C7 customer-data cases in
`sales-cart-orders.integration.test.ts`. No new migration, table, permission code, ADR, or endpoint
— both are clarifications of already-approved rules.

FASE 13 added the two SALES-dependent workflows the `0009_sales` schema has carried, unused, since
Prompt 03 — **no schema table was added or changed**. Two new permission codes
(`sales.returns.view`/`sales.returns.create`, migration `0027`, `module.resource.action` pattern,
same gap-filling precedent as 0014-0017/0023/0026); `inventory.returns.manage`,
`pricing.discount.request`, `pricing.discount.approve` are reused as-is (all migration 0001).
`DEFAULT_ROLE_TEMPLATES` (`packages/shared`) gives the two new codes to Administrador/Supervisor/
Vendedor and additionally grants Bodega `inventory.returns.manage` (physical return processing is a
warehouse task, alongside its existing `inventory.transfers.*`/`inventory.adjust`) + `sales.returns.view`.
**Exceptional-discount pricing** (`apps/api/src/sales/pricing/price-approvals.*`,
`repositories/price-approvals.repository.ts`, `repositories/tenant-price-policies.repository.ts`) is
**order-first**, per ADR-0022 / database.md#orders ("confirmation is gated on price approvals") and
the `price_approvals` schema (`order_id`/`order_item_id` `NOT NULL`, no cart/variant column): a
below-`min_price` line is no longer rejected at checkout — `SalesPricingService.resolveUnitPrice`
classifies it `below_min`, `assertWithinHardFloor` rejects it outright (`422`, no order) only if it
is more than `tenant_price_policies.max_discount_below_min_percent` under the floor (read-only this
phase — `TenantPricePoliciesRepository.getEffective` returns documented defaults when no row exists,
there is no configuration endpoint), otherwise the order is created `pending` with
`order_items.is_exceptional_discount = true` and the normal `RESERVATION`. `POST /price-approvals`
(`pricing.discount.request`) locks the parent `orders` row, requires it `pending` + the line
exceptional, and inserts a `pending` `price_approvals` row whose price/tier fields are copied from
the frozen `order_items` snapshot — the optional client `requestedPrice` is a cross-check only
(`422` on mismatch), never the authority (§50). `discount_amount` is computed against `max_price`
(not `min_price`) so a caller without `pricing.floor.view` cannot back out the floor;
`minPriceAtRequest` is omitted from the response for such a caller (ADR-0028, explicit DTO
construction). `POST /price-approvals/:id/approve`|`/reject` (`pricing.discount.approve`) are
conditional `UPDATE … WHERE status = 'pending'` transitions; the **requester can never resolve their
own request** (`403`) — separation of duties, enforced in the service (the schema does not force it,
per ADR-0022). `OrdersService.confirm` gained `assertExceptionalDiscountsApproved`: after locking
the `orders` row it reads `tenant_price_policies.exceptional_discount_requires_approval` (default
`true`) and, when set, `PriceApprovalsRepository.lockByOrder`-row-locks every approval for the order
— a `pending` one → `409`, an exceptional line with no `approved` row matching its frozen
`unit_price_snapshot` → `409`. **No permission-based bypass** (`pricing.discount.approve` authorizes
*resolving* a request, never skipping the record — §59). Lock order everywhere: `orders` →
`price_approvals` → `inventory_balances`. `OrdersService.cancel` additionally marks a cancelled
order's still-`pending` approvals `cancelled`. Carts now accept a below-`min_price`
`negotiatedUnitPrice` (`SalesPricingService.assertNotAboveMax` — only above-`max_price` is rejected
early), since checkout turns it into the approval flow. **Sales returns / disposition**
(`apps/api/src/sales/returns/returns.*`, `repositories/sales-returns.repository.ts`,
`repositories/sales-return-items.repository.ts`) is a reversal traced to a **`confirmed`** order
(`fulfilled` accepted for forward-compat but unreachable) — never a second negative order, never a
cancellation. `POST /sales-returns` (`sales.returns.create`, `Idempotency-Key`, scope
`sales_return.create`) locks the `orders` row and validates every line against `returnable =
order_items.quantity − Σ(sales_return_items.quantity_returned for returns whose status ≠
'cancelled')` under that lock — the aggregate check ADR-0021 leaves to application code, evaluated
so two concurrent requests that together over-return cannot both win (`409`). `POST
/sales-returns/:id/inspect` (`inventory.returns.manage`) sets each line's `disposition` +
`disposition_location_id` (+ `inspected_by`/`inspected_at`/`notes`, and `received_by` on the
header), enforcing ADR-0021 (`restock` → an `is_sellable = true` location, `quarantine`/`damaged`/
`scrap` → a non-sellable one) and `LocationAuthorizationService` against each
`disposition_location_id`; → `inspecting`. `POST /sales-returns/:id/resolve`
(`inventory.returns.manage`, `Idempotency-Key`, scope `sales_return.disposition`) locks the return
row (concurrent processing is exactly-once), requires every line inspected, re-checks location
authorization, then writes **one `RETURN` `inventory_movements` row per line** through
`StockLedgerService.applyMovement` at `disposition_location_id` (`reference_type =
'sales_return_item'`, deterministic ledger key `sales-return:<itemId>`) — SALES never writes
`inventory_balances` directly. `restock` raises the sellable location's physical stock;
`quarantine`/`damaged`/`scrap` raise a non-sellable location's (fully ledgered, never counted as
available anywhere — ADR-0021's non-sellable-location mechanism, chosen over "no movement at all").
→ `resolved`. `POST /sales-returns/:id/cancel` (`sales.returns.create`) `requested`/`inspecting` →
`cancelled` (a `resolved` return cannot be cancelled), freeing the quantity back to `returnable`.
Returns never `UPDATE` `orders`/`order_items` — the original sale's snapshot and quantities are
immutable. **Deliberately still not built** (each a later phase): any `event_outbox` write
(FASE 14), Telegram/n8n (FASE 15), any frontend (FASE 16/17); selling serialized/lot-tracked
variants stays a `422` (no approved `order_items` ↔ `product_serials`/`product_lots` model, no
serial/lot column on `inventory_movements`) — not assigned to any phase yet. Verified end to end
against real PostgreSQL via `tools/pg-verify` (279 integration tests, 0 skipped — including the
P1-P18 exceptional-pricing suite and the R1-R12 returns suite: order-first below-min checkout,
hard-floor rejection, self-approval block, cross-tenant 404, concurrent confirm of an approved
exceptional order, min_price/cost visibility, concurrent over-return, restock vs quarantine
re-entry, retry + concurrent resolve idempotency, location authorization, historical-order
immutability). `pnpm --filter @saas-inventory/web build` still fails on the pre-existing Windows
`EPERM` symlink error in Next.js standalone output-tracing (unchanged — `apps/web` untouched). No
frontend UI for SALES exists yet (FASE 16/17).

PROMPT 013-A (post-FASE-13 controlled correction) audited the state-transition concurrency FASE 13's
own report proved only for `resolve` vs `resolve` / concurrent over-return / concurrent exceptional
`confirm`, and found **NO FUNCTIONAL CONCURRENCY BUG** in either subdomain — no code change to any
transition. `ReturnsService.inspect`/`resolve`/`cancel` already all begin with
`SalesReturnsRepository.lockById` (`SELECT ... FOR UPDATE` on the one `sales_returns` row, first DB
op; for `resolve`, after the per-`Idempotency-Key` advisory lock + idempotency-table check), status
re-read under the lock, every mutation + `audit_log` write in one transaction, consistent lock
ordering (`sales_returns` → `locations` read → `inventory_balances` via `StockLedgerService`).
`PriceApprovalsService`'s `approve`/`reject` already use `PriceApprovalsRepository.lockById`
(`FOR UPDATE`) **and** a `resolveIfPending` CAS (`UPDATE ... WHERE status = 'pending' RETURNING`),
audit written only when the CAS returns a row; `OrdersService.confirm` locks the approvals with
`lockByOrder` (`FOR UPDATE`) inside the txn already holding the `orders` row lock (lock order
`orders` → `price_approvals` → `inventory_balances`; `approve`/`reject` never touch `orders` or
`inventory_balances`, so no deadlock with `confirm`). The gap was **test coverage**: added
`test/sales/sales-transition-concurrency.integration.test.ts` — R13 (`inspect` || `inspect`: both
200, every item ends coherent, never field-mixed), R14 (`inspect` || `cancel`: exactly one leaves
`requested`, final `cancelled`, no partial inspection, no inventory), R15 (`resolve` || `cancel`,
repeated: `resolved`+1-`RETURN`-per-line **xor** `cancelled`+0, audit matches status, balance
matches status), R16 (`cancel` || `cancel`: one logical cancel, one audit), R16b (`resolve` ||
`resolve` regression: exactly-once), R17 (terminal-state immutability), R18 (multi-line
`resolve` || `cancel`: all-lines or zero, never partial), R19 (`resolve` mid-loop failure via a
location-auth denial on a later line → full rollback, stays `inspecting`, then completes cleanly);
P19 (`approve` || `reject`, repeated: one final status, one resolution audit), P20/P21 (`approve` ||
`approve` / `reject` || `reject`: one logical resolution + one audit, second idempotent), P22
(terminal approval immutability), P23 (`approve` || `confirm`: `SALE` only ever with an `approved`
approval; if `confirm` loses it 409s and a retry succeeds), P24 (`reject` || `confirm`: a `SALE`
never commits against a `rejected` approval — `confirm` always 409, stays blocked), P25
(self-approval still 403 under the CAS). No new migration (`db:migrate` from empty + re-run no-op
verified), table, permission code, ADR, or endpoint — the guarantees derive entirely from the
existing state machine's `FOR UPDATE` locks. Real-PostgreSQL: **294 integration tests, 0 skipped**;
lint / typecheck / API build pass; web build unchanged (`EPERM`).

FASE 14 added transactional domain-event publishing and the **Event Processor** — the `event_outbox`
table (migrated since Prompt 03) and the `app_event_processor` role (migration `0000`) get their
first application code; **no schema table or column was added, no migration**. Write path
(`apps/api/src/common/events/`, provided into `SalesModule` like `AuditLogService` — no
`SALES → NOTIFICATIONS` import): `OutboxRepository` (the single `event_outbox` writer) +
`DomainEventPublisher.append(tx, input)`, called inside the existing `withTenantTransaction` of
`OrdersService.confirm`/`.cancel`, `PriceApprovalsService.request`/`.resolve`,
`ReturnsService.create`/`.resolve`/`.cancel` — **not** best-effort (unlike audit): a failure throws
and rolls the business transaction back. Eight versioned events, `module.aggregate.action` past
tense (`sales.order.confirmed`/`.cancelled`, `sales.price_approval.requested`/`.approved`/
`.rejected`, `sales.return.requested`/`.resolved`/`.cancelled`), one per **logical** transition —
the idempotent early-returns and CAS-losers publish nothing, so HTTP retry / `confirm‖confirm` /
`approve‖reject` / `resolve‖resolve` / `resolve‖cancel` each yield exactly one event. The
`event_outbox.payload` holds a self-describing versioned envelope (`eventId` = row id, never
regenerated; `eventType`/`eventVersion`/`occurredAt`/`tenantId`/`aggregate*`/`correlationId`/`actor`/
`data`). Payloads are data-minimised — `sales.order.confirmed` carries the customer PII snapshot a
notification needs but **no** `min_price`/`unit_cost`/`base_price`/`max_price` (ADR-0028);
`sales.price_approval.requested` omits `minPriceAtRequest` entirely. **Event Processor**
(`apps/api/src/event-processor/` + the separate `worker:events:dev`/`worker:events:start` deployable,
`NestFactory.createApplicationContext(AppModule)`, never `.listen()` — mirrors the Import Worker,
ADR-0029): a poll loop over `EventProcessorService.runOnce()` that claims via one atomic
`FOR UPDATE SKIP LOCKED` CTE over the dedicated `app_event_processor` connection
(`event-processor-client.ts`, `APP_EVENT_PROCESSOR_DATABASE_URL`). `claimed_at` doubles as the
last-attempt timestamp so exponential capped backoff (`EVENT_PROCESSOR_RETRY_*`) is computed in SQL
with no new column; a stale `processing` row (crashed worker) is reclaimed (incrementing `attempts`)
and `reapStale` dead-letters it once `attempts` hits `EVENT_PROCESSOR_MAX_ATTEMPTS`; a `dead_letter`
row is never deleted. **Delivery is at-least-once** (crash-after-success-before-ack redelivers the
same `eventId`) — documented for FASE 15 consumers; business side effects stay exactly-once. The
claim query filters `event_type = ANY(:supportedTypes)` where `supportedTypes` is the dispatcher's
registered-handler set — **empty in FASE 14 production** (`EventProcessorModule` binds
`EVENT_HANDLERS` to `[]`), so nothing is claimed and **no event is ever falsely marked
`delivered`** before FASE 15's n8n adapter. An unknown `eventVersion` / malformed envelope is
terminal, not retried. `app_event_processor` has `SELECT, UPDATE` on `event_outbox` only — no grant
on any other table, not `BYPASSRLS`, cannot `SET ROLE` (verified as `app_event_processor` for real).
`last_error` and every log line pass through a token/credential/JWT sanitizer. `tools/pg-verify` now
bootstraps `app_event_processor` and passes `TEST_APP_EVENT_PROCESSOR_DATABASE_URL`, so the new
`test/events/*` suites run in the standard pass: **324 integration tests, 26 files, 0 skipped**
(up from 294/23). Deliberately **not** built (FASE 15+): n8n, Telegram, external webhook delivery,
notification preferences, message templates, manual retry/replay tooling, outbox retention/purge,
any frontend or reporting on events. `pnpm --filter @saas-inventory/web build` still fails on the
pre-existing Windows `EPERM` symlink error (`apps/web` untouched).

FASE 15 added the **n8n event-delivery adapter** (`apps/api/src/event-processor/n8n/`) — the last
segment of `event_outbox → Event Processor → n8n → Telegram`. **No schema change, no migration, no
new Postgres grant, no `tenants` join** — `app_event_processor` keeps its `event_outbox`-only
blast radius. `EventProcessorModule` now binds `EVENT_HANDLERS` from config via a factory:
`N8N_EVENTS_ENABLED=false` (default) → `[]` (FASE 14 behaviour exactly — nothing claimed, events
stay `pending`); `=true` → `loadN8nDeliveryConfig()` fail-closed-validates
`N8N_EVENTS_WEBHOOK_URL` (HTTPS except `localhost` dev, no embedded creds) + `N8N_EVENTS_AUTH_TOKEN`
(≥16 chars) at module init / worker startup, then registers one `EventHandler` per known event
type — the 8 SALES events, each pinned to `eventVersion = 1`, **no `sales.*` wildcard** — all
sharing one `N8nWebhookClient`. `N8nWebhookClient.post` uses the Node built-in `fetch` (no
Axios/undici dep added): `POST` the **unchanged** v1 envelope as JSON; `Authorization: Bearer
<token>` (never in body/URL/query) + non-secret `X-Event-*` trace headers; `AbortController`
timeout (`N8N_EVENTS_TIMEOUT_MS`, default 10000); `redirect: 'manual'` (a 3xx is a permanent
misconfiguration, never followed — the token is never resent to another host); only `2xx` is
success. Failures are classified **retryable** (408/425/429/5xx, network/DNS/TLS/timeout — FASE
14's backoff/`dead_letter`/stale-claim machinery is untouched) vs **permanent** (other 4xx,
redirect → a typed `PermanentDeliveryError` that `EventDispatcher` maps to `terminal` →
`dead_letter` now, no infinite retry); n8n error-response bodies are sanitised + truncated (reusing
`sanitizeError`) before they can reach `last_error`/logs. The adapter does **no** domain lookups —
the envelope is self-sufficient. The only `SaaS → n8n` call is from the Event Processor
deployable; `OrdersService`/`ReturnsService`/`PriceApprovalsService` are untouched (no HTTP call
added). **Telegram stays entirely in n8n** (ADR-0012) — the backend stores no bot token, does no
recipient routing, composes no message. The **`notification_preferences` `PENDING DECISION`
(deferred here since FASE 11) is resolved**: routing lives entirely in n8n keyed by the envelope's
`tenantId`/`eventType` — no backend preference schema/endpoints, no frontend. **Suspended-tenant
policy:** an already-committed event is delivered regardless of `tenants.status` (suspension gates
new operations, not committed facts). External delivery is **at-least-once** — the n8n workflow
must dedupe durably on `eventId`; exactly-once Telegram is **not** claimed. New contract doc
`docs/integrations/n8n.md` (webhook method/auth/headers, envelope, success/retry/permanent
classification, `eventId` dedupe, Telegram routing responsibilities, secret rotation). `.env.example`
`N8N_WEBHOOK_URL`/`N8N_WEBHOOK_SECRET` replaced by `N8N_EVENTS_{ENABLED,WEBHOOK_URL,AUTH_TOKEN,TIMEOUT_MS}`;
`docker-compose.dev.yml`'s `event-processor` service carries them (disabled by default). Verified
against real PostgreSQL via `tools/pg-verify`: **339 integration tests, 27 files, 0 skipped** (up
from 324/26 — `test/events/n8n-delivery.integration.test.ts` runs the outbox → real local HTTP
receiver → delivered/retry/`dead_letter` matrix), plus new unit specs for config validation, HTTP
failure classification, the webhook client (against a `node:http` fake), and the handler set.
Lint/typecheck/API build pass; web build unchanged (`EPERM`). **PROMPT 015-A** then validated the
whole path against the operator's **real n8n** (v2.36.7): a dedicated `SaaS Inventory — Event
Notifications` workflow (HTTPS webhook + Header Auth Bearer, envelope + `eventVersion==1` checks,
durable **n8n Data Table** `eventId` dedupe with `processing`/`completed` state — `completed` only
after the Telegram send, recent in-flight duplicate → HTTP 425, stale → reclaim, `STALE_MS`=120s)
and a **test-only** Telegram destination. Synthetic `sales.order.confirmed` /
`sales.price_approval.requested` events seeded into a throwaway local `event_outbox` and delivered
by the **real `dist/event-processor/main.js`** both reached Telegram; `event_outbox` → `delivered`
+ `processed_at` set + `eventId` preserved; no `minPrice`/`cost` leak; no secret/URL in any log; a
re-sent identical `eventId` → HTTP 200 `duplicate-ignored` with no second message. Dedupe is
**durable but not proven-atomic** on a concurrent first insert (n8n does not document its Data
Table upsert as atomic insert-if-absent) — the realistic concurrent case is covered by the 425
path; external delivery is **at-least-once-safe, not exactly-once**. **No product code change** in
015-A (a throwaway seed-script `jsonb` double-encoding bug was found and fixed in the smoke harness
only; the real Drizzle-based `OutboxRepository` write is unaffected). A FASE 17 note was recorded:
sales history should show a notification status and let an admin retry a failed notification over
the existing `event_outbox` row. **FASE 15 CLOSED.** PROMPT 015-B then aligned the n8n
dedupe-timestamp documentation (`processingUpdatedAt`, docs only).

FASE 16 built the **frontend foundation** in `apps/web` — the reusable base FASE 17's business
modules render on. **No `apps/api/**`, `database/**`, migration, n8n, Event Processor or Import
Worker change; no new runtime dependency.** **Same-origin transport:** `next.config.ts` now
rewrites `/api/*` → `API_URL`, so browser session cookies are first-party in every environment
(matching the Caddy prod topology, docs/deployment/docker.md) — the previous cross-origin
assumption left `getSession()` unable to see the session cookies in dev, so the authenticated
area was unreachable; `NEXT_PUBLIC_API_URL` stays only as a cross-origin override. **API client**
(`src/lib/api/`): one `apiFetch` for Server Components (`serverApiFetch` forwards `cookies()`) and
Client Components (`credentials:'include'` + double-submit `X-CSRF-Token` on mutations); a
normalised `ApiError` (`status`/`code`/`message`/`correlationId`, matching
`http-exception.filter.ts` exactly — no invented fields) with `httpErrorMessage()` per-status UX
text that never echoes a 5xx body; `AbortSignal`, 204/empty, `query`; a per-request
`Correlation-Id`. **401 → single-flight `POST /auth/refresh` → one retry** on the browser only,
deduplicated across concurrent callers; never on 403/400/404/409/422/429/5xx, never the refresh
call itself, never twice; a failed refresh emits one `session-expired` event and a single
`SessionExpiryListener` redirects to `/login?returnTo=…` via open-redirect-safe `safeReturnTo`.
**Auth/session:** `getSession()` = React `cache()`-deduped `/auth/me` gating the `(tenant)` layout
for UX (a non-401 failure goes to `error.tsx`, not `/login`); `login-form.tsx` tries one
`sessionStorage`-loop-guarded silent refresh before showing the form so an expired-access/valid-
refresh hard navigation restores with no flash of private content; presence-only `middleware.ts`
short-circuits obviously-unauthenticated navigations (never authorization). **Permissions:**
`createPermissionChecker(session.permissions)` → `can`/`canAny`/`canAll` over the real backend
codes (mirrored in `permission-codes.ts`, authority = `packages/shared` `DEFAULT_ROLE_TEMPLATES` +
`*_permissions` migrations); navigation is permission-filtered server-side; the backend stays the
authority and a 403-anyway is a normal error. **App shell** (`src/components/shell/`): persistent
desktop sidebar + mobile slide-over drawer (Esc/overlay/route-change close, scroll lock), header
with tenant name and an accessible account menu (name/email/tenant, real backend logout), one
`SessionProvider` + `SessionExpiryListener`. **UI foundation** (`src/components/ui/`):
Button/ButtonLink, Input/Select/Textarea, Field (label/hint/error id wiring), Card, Alert, Badge,
Spinner, Skeleton, EmptyState, ErrorState, PageHeader, PageContainer — real `<button>`/`<a>`,
labeled controls, visible focus; Tailwind unchanged, no component library added. **Routing:** the
`app/page.tsx` ↔ `(tenant)/page.tsx` `/` collision is resolved (dashboard owns `/`); `(tenant)`
gains `loading`/`error`/`not-found`, plus root `not-found` + `global-error`. `/settings`,
`/users`, `/users/new`, `/users/[id]` now render through the shell + primitives with **no
functional-scope change**. Tests: web unit 12 → 33; api unit 459; typecheck + lint green;
`pg-verify` **339 integration tests / 27 files / 0 skipped — PASS** (unchanged from FASE 15).
`pnpm --filter @saas-inventory/web build` compiles, type-checks and statically generates all 9
routes, then fails at *Collecting build traces* on the **pre-existing Windows `EPERM` symlink** in
Next.js standalone output-tracing — the same environmental issue documented since FASE 12,
not introduced here. **FASE 16 CLOSED.** FASE 17 (Frontend Main Modules) is next.

> **Documentation gap, not a code gap:** this "Current project status" narrative was not updated
> for FASE 17's 14 sub-phases (F17-01 through F17-14, plus the F17-AUDIT-01 correction) or for
> F18-00/F18-01/F18-02 — all real, already-merged work (see `git log`), just never appended here.
> F18-03's own paragraph below assumes that already-landed context (the FASE 18 reporting
> read-side pattern, the F17 frontend's app shell/permission model, etc.) without re-narrating it.
> Backfilling the missing entries is out of scope for F18-03 and was not attempted.

FASE 18 (roadmap.md's REPORTS read-side) started with **F18-01** (reporting foundations:
`ReportDateRangeQueryDto`/`toHalfOpenRange()`, tenant-timezone visibility on every session
response, the F18 permission rule — reuse the domain's `*.view`, no `reports.*` family) and
**F18-02** (`apps/api/src/reports/sales/` — `GET /reports/sales-summary`, day/week/month/product/
customer grouping over `orders`/`order_items`, integrated into `/sales`). **F18-03** extends the
same read-side pattern to INVENTORY and closes a standing F17 gap. **A. Inventory summary**
(`apps/api/src/reports/inventory/`) — `GET /reports/inventory-summary` (`inventory.view`, no new
permission): `Σ inventory_balances.quantity_available`/`quantity_reserved` and a distinct-variant
`outOfStockCount` (`available = 0`, never a threshold — `GAP-REORDER` stays closed to invented
low-stock rules), grouped by `warehouse` (default) or `category` via a two-level raw-SQL CTE
(`InventoryReportRepository`, mirroring `SalesReportRepository`'s precedent — never
`InventoryBalancesRepository`/`InventoryMovementsRepository`). A product with no category lands in
an explicit `'uncategorized'` bucket, never an invented id. No date range (a live snapshot —
`generatedAt` is the query-time clock, not a stored snapshot; `GAP-SNAPSHOTS` stays open) and no
monetary field anywhere (`GAP-COST` stays open). Scope is **tenant-wide**, matching the real,
already-shipped behaviour of `GET /inventory/balances`/`GET /inventory/movements` — neither is
restricted by `user_location_assignments` today; `LocationAuthorizationService` (ADR-0024) only
ever gates a *write* action (adjustments, transfer prepare/dispatch/receive), never a read, so this
report reuses that real policy rather than inventing per-report location scoping (a discrepancy
found and corrected in `filters-periods-and-scope.md`, which had previously and incorrectly
documented inventory reads as location-scoped). **B. Movements date filter** — `occurredFrom`/
`occurredTo` added to the pre-existing `GET /inventory/movements` (`GAP-MOVEMENTS-DATE-FILTER`),
half-open `[occurredFrom, occurredTo)` on `occurred_at` (the canonical "when the movement
happened" timestamp — confirmed distinct from `created_at`, "when the row was written"; both
already existed on the schema). A real, additive index was required and added — migration `0030`,
`inventory_movements_tenant_occurred_idx (tenant_id, occurred_at)` — since every pre-existing
index on this table covers `created_at`, not `occurred_at`. Frontend: a new "Inventory report"
section on `/inventory` (KPI tiles + warehouse/category filters + grouped table,
`InventoryReportSection`/`InventoryReportFilters`) above the unchanged balances list, and a new
`occurredFrom`/`occurredTo` date-range filter on `/inventory/movements`
(`MovementsDateFilter`) — self-contained via `useSearchParams()`/`usePathname()` rather than a
server-passed callback prop, after a real bug surfaced only under real-browser testing (React
rejects a plain function passed from a Server Component to a Client Component). Real-PostgreSQL:
`pg-verify` **412 integration tests, 33 files, 0 skipped** (up from 378 at FASE 17's close) —
including `test/reports/inventory-summary.integration.test.ts` (warehouse/category grouping,
reserved-quantity via a real cart→checkout reservation, distinct-SKU out-of-stock counting across
multiple depleted locations in one warehouse, tenant isolation, RBAC) and
`test/inventory/inventory-movements-date-filter.integration.test.ts` (boundary movements placed at
`from−1`/`from`/interior/`to`/`to+1` via the real backdatable `occurredAt` adjustment field). Web
unit 348 → 379 (12 new files); API unit 466 → 502. No new permission code, no new migration beyond
`0030`, no change to `InventoryBalancesRepository`/`InventoryMovementsRepository`/
`LocationAuthorizationService`. Visually validated end to end against a real local PostgreSQL +
real `nest start --watch`/`next dev` (no Docker; the same disposable-`embedded-postgres` mechanism
`tools/pg-verify` uses, seeded via the real HTTP API, torn down afterward) — desktop and mobile
(390×844) screenshots, a real login, real warehouse/category/reservation/out-of-stock data. One
genuine, pre-existing, out-of-scope finding surfaced by that testing: `/inventory`'s existing
8-column balances table (and, independently, `/locations`'/`/sales`'s own wide tables) overflow the
page horizontally at 390px — reproduced on pages this phase never touched, so left unfixed here,
not caused by F18-03; the new report table itself (4 columns) does not meaningfully contribute to
it. `pnpm --filter @saas-inventory/web build` still fails only at the pre-existing Windows `EPERM`
symlink step (unchanged, documented since FASE 12) after compiling/type-checking/statically
generating every route successfully. **FASE 18-03 CLOSED, not pushed.**

**F18-04** extends the same read-side pattern to the last SALES-dependent aggregate FASE 13 left
unbuilt and closes most of `GAP-RETURN-AGGREGATE`. **`GET /reports/returns-summary`**
(`apps/api/src/reports/returns/`, `sales.returns.view` — the exact permission `metrics.md`'s own
`RET-BY-DISPOSITION`/`RET-VALUE` rows already named, no `reports.*` permission added) aggregates
`sales_returns`/`sales_return_items` joined to `order_items` (never
`SalesReturnsRepository`/`SalesReturnItemsRepository` — reporting stays a separate read-side, same
rule as `sales/`/`inventory/`). `groupBy: day|week|month|product|customer|disposition` (default
`day`); half-open `[from, to)` on `sales_returns.created_at` — the only immutable, always-present
timestamp on that table (`updated_at` is rewritten by every transition alike: `inspect`, `resolve`,
`cancel`; no `resolved_at` column exists, documented as the new `GAP-RETURN-RESOLVED-AT`, the direct
analogue of `GAP-ORDER-CONFIRMED-AT`). `status` filter defaults to `resolved` (the return's
inventory effect is only committed once `resolve` runs — the direct analogue of `sales-summary`'s
`status=confirmed` default), any of the four real statuses selectable. `returnedValue = Σ
(quantity_returned × order_items.unit_price_snapshot)` — the frozen sale price, never the current
catalog price; `returnCount`/`orderCount` are `COUNT(DISTINCT sales_returns.id)`/`COUNT(DISTINCT
sales_returns.order_id)`, never inflated by the return→line→order_item join (a three-line return
counts as one return, verified against real data). The `disposition` grouping deliberately omits
`returnCount` — ADR-0021 fixes one disposition per *line*, not per return, so a multi-disposition
return legitimately lands in more than one bucket; only lines with a non-`NULL` `disposition`
(i.e., already inspected) are grouped — an uninspected line is excluded, never bucketed as an
invented "pending" disposition. `reason` (free text, no enum) is not a groupBy value. `RET-RATE`
(return rate vs. confirmed orders) is **not** computed server-side — it is a frontend combination of
this endpoint's `orderCount` and `sales-summary`'s confirmed-order count for the same period, the
same "2 calls" pattern already established for `RET-PENDING-COUNT`; no cross-read-side coupling was
added to compute it in one call. `unit_price_snapshot` is **not** gated by `pricing.floor.view`
(ADR-0028 only gates `min_price`/`max_price` visibility), so no second permission was needed to
expose `returnedValue`. Frontend: a new "Returns report" section on `/returns`
(`ReturnsReportSection`/`ReturnsReportFilters`, mirroring `SalesReportSection`/`SalesReportFilters`
exactly — same KPI-tiles-that-are-safe-to-sum rule, same `#report`-anchored filter navigation, same
local `ReturnsReportError` never redirecting on a 403) above the unchanged return list. **No schema
change, no migration, no new permission code, no change to the FASE 13 returns/disposition write
path.** Real-PostgreSQL: `pg-verify`'s actual `vitest` run reported **430 integration tests, 34
files, 0 failed** (up from 412/33 at FASE 18-03's close — 18 new tests in
`test/reports/returns-summary.integration.test.ts`: RBAC including a 403 case reached only by
stripping `sales.returns.view` from a throwaway tenant's own role row via direct DB access, since
**every** `DEFAULT_ROLE_TEMPLATES` role carries that permission by default; tenant isolation;
`[from,to)` boundary exactness; the `resolved` default excluding a `requested`/`cancelled` return;
known-quantity aggregation math; a multi-line return counting as one; product/customer grouping;
disposition grouping including the two-dispositions-per-return non-inflation case) — but the
`pg-verify` harness process itself then hit a Windows-only `EBUSY` (`rmdir` on `.verify-pgdata`)
during its own post-test cleanup, the same class of Windows-filesystem artifact already documented
for the web build's `EPERM` symlink issue, not a functional failure and not something this phase's
diff touches (`tools/pg-verify` was not modified). API unit 519 (+17, `returns-report.service.spec.ts`);
web unit 391 (+12: `returns-report-section.test.tsx`, `returns-report-filters.test.tsx`). Lint and
typecheck pass on both apps; API build passes; `pnpm --filter @saas-inventory/web build` compiles,
type-checks and statically generates all 40 routes, then fails only at the pre-existing Windows
`EPERM` symlink step during *Collecting build traces* (documented since FASE 12, reproduced
verbatim, `apps/web`'s own source is otherwise untouched by this class of issue). **No browser
automation tool was available in this environment this phase, so real-browser visual validation
(screenshots, console-error checks) was not performed** — substituted by the real-HTTP pg-verify
integration coverage above (exercising every path the UI calls) plus jsdom component-render tests
for the new report section/filters/error states; this is explicitly **not** claimed as a browser
check. `GAP-RETURN-AGGREGATE` is now `PARTIALLY RESOLVED` (day/week/month/product/customer/
disposition + returned value built; only the cross-endpoint return-rate composition remains a
frontend concern). **FASE 18-04 CLOSED, not pushed.**

**F18-05** extends the same read-side pattern to the exceptional-discount **approval workflow** and
closes `GAP-APPR-AGGREGATE`. **`GET /reports/approvals-summary`** (`apps/api/src/reports/approvals/`,
`pricing.discount.approve`) aggregates `price_approvals` **alone** — no join, so unlike the
sales/returns reports (whose grain is multiplied by an `order_items` join) every `COUNT(*)` /
`COUNT(*) FILTER` / `SUM(discount_amount)` / `SUM(...) FILTER` is exact with zero fan-out risk;
never `PriceApprovalsRepository` (reporting stays a separate read-side, same rule as
`sales/`/`inventory/`/`returns/`). `groupBy: day|week|month|status` (default `day`); half-open
`[from, to)` on `price_approvals.requested_at` — the request-cohort anchor. `price_approvals` **does**
carry a real `resolved_at` (unlike `sales_returns`, `GAP-RETURN-RESOLVED-AT`), but it is `NULL` for
exactly the `pending` rows, so a period that must surface open requests cannot be anchored on it — a
future `dateField=requested|resolved` toggle is possible but out of F18-05 scope (the F18-02/03/04
reports each anchor on one timestamp). `status` filter has **no default** (unlike `sales-summary`'s
`confirmed` / `returns-summary`'s `resolved`, which isolate a *committed* effect — this report's
purpose is the outcome mix). A **period bucket** carries `requestCount`,
`approved`/`rejected`/`cancelled`/`pendingCount`, `approvedDiscountValue`
(`Σ discount_amount FILTER (WHERE status = 'approved')`) and
`approvalRate = approved / (approved + rejected)` rounded 4dp — `null` when nothing has been decided;
cancelled and pending are excluded from the denominator (neither is a decision). A **status bucket**
carries `requestCount` + `discountValue` (no rate). `discount_amount` is computed at request time vs
`max_price`, never `min_price` (`PriceApprovalsService`), so `approvedDiscountValue` is **not** gated
by `pricing.floor.view` and `min_price_at_request` is never surfaced by the report. **Permission —
`pricing.discount.approve`** (Administrador + Supervisor): the one SALES sub-domain with no `*.view`
code, so the report reuses the exact permission `metrics.md`'s `APPR-RATE` / `APPR-DISCOUNT-VALUE`
rows already name — narrower than the operational `GET /price-approvals` queue's
`@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')` (a governance
aggregate, not a requester's "my requests" view); no new permission, no `reports.*`. **Scope
tenant-wide** — `price_approvals` has no location dimension; `GAP-ORDERS-LOCATION` untouched. **No
schema change, no migration** (follows F18-04's precedent — `price_approvals` is a naturally small
table, one row per escalated below-min line, and there is no evidence a `(tenant_id, requested_at)`
index is needed at scale yet; the existing pending-queue index is partial `WHERE status = 'pending'`
and does not cover an all-status range scan — noted for a future high-volume tenant, not added
speculatively). Frontend: an "Approvals report" section on `/approvals`
(`ApprovalsReportSection`/`ApprovalsReportFilters`, mirroring `ReturnsReportSection` exactly — same
local `ApprovalsReportError` that never redirects on a 403, same `#report`-anchored filter
navigation, KPI tiles recomputing the headline rate from summed approved/rejected totals rather than
averaging per-bucket rates), rendered only for a `pricing.discount.approve` holder (a Vendedor still
sees the queue below). `metrics.md` `APPR-RATE` / `APPR-DISCOUNT-VALUE` move **B → A**;
`GAP-APPROVALS-PERMISSION` was already `RESOLVED (F17-09)` and the report relies on that fix;
`GAP-EXCEPTIONAL-FILTER` stays **open** and distinct — the *full* `order_items.is_exceptional_discount`
set (below-min lines confirmed without a filed `price_approvals` request) is discount-leakage
analytics F18-05 does not cover. Real-PostgreSQL: `tools/pg-verify` **`test:integration` exited 0 —
Test Files 35 passed (35), Tests 449 passed (449)** (up from 430/34 at F18-04's close — 19 new tests
in `test/reports/approvals-summary.integration.test.ts`: RBAC incl. a Vendedor-is-403 case, tenant
isolation, `[from,to)` boundary exactness on `requested_at`, no-default-status behaviour, known-set
count/discount/rate math, multi-approval non-inflation, day/week/month/status grouping); the harness
process then hit the same Windows-only `EBUSY` (`rmdir` on `.verify-pgdata`) during its own
post-test cleanup that F18-04 documented — not a functional failure, `tools/pg-verify` untouched.
API unit 533 (+14, `approvals-report.service.spec.ts`); web unit 405 (+14:
`approvals-report-section.test.tsx`, `approvals-report-filters.test.tsx`). Lint and typecheck pass on
both apps; API build passes. **No browser automation tool was available in this environment this
phase**, so real-browser visual validation was not performed — substituted by the real-HTTP
pg-verify integration coverage plus jsdom component-render tests; **not** claimed as a browser check.
**FASE 18-05 CLOSED, not pushed.**

**F18-06** partially resolves `GAP-EXCEPTIONAL-FILTER` by adding an `exceptional` filter to the
existing `GET /reports/sales-summary` (F18-02) — **no new endpoint, no schema change, no
migration, no new permission** (the endpoint's `sales.orders.view` is unchanged; `discount_amount`
on `order_items` is computed vs `max_price`, so no floor is exposed and `pricing.floor.view` is
not needed). **The source of truth is `order_items.is_exceptional_discount`** — the boolean frozen
write-once at `POST /orders` in `OrdersService.resolveLines` when a line's negotiated price is
below the variant's `min_price`. It is **never** a join to `price_approvals`: an exceptional line
can exist with no approval row at all — a `pending` order nobody filed a request for, or a tenant
whose `tenant_price_policies.exceptional_discount_requires_approval = false` (no config endpoint
exists, but the column is real and defaults `true`) confirming a below-min order with nothing
filed. `price_approvals` is the authorisation-workflow overlay (F18-05's `approvals-summary`), not
the historical truth of the sale. The filter is a **three-state enum** `exceptional=all|only|
exclude` (`all` = default = byte-for-byte the pre-F18-06 behaviour, kept distinct from `exclude`),
echoed back in the response like `groupBy`, composing freely with `status` and the half-open
`[from,to)` range. Applied **per grouping at that grouping's own grain** (`SalesReportRepository`):
`day`/`week`/`month`/`customer` aggregate `orders` alone, so the filter is an `EXISTS`/`NOT EXISTS`
**semi-join** on `order_items` — `only` = "orders containing ≥1 exceptional line" with the
whole-order totals, `exclude` = "orders with no exceptional line" — no fan-out, every
`SUM(orders.*)` stays exact; `product` is already `order_items`-grain, so the filter is a plain
`is_exceptional_discount = true/false` predicate on the joined line ("exceptional **lines** of this
variant" — summing `discountTotal` across the product buckets is `SALES-EXCEPTIONAL-LINES`'s value
for the period). `order_items` has no `(tenant_id, order_id)` index today (a pre-existing F18-02
performance note the `EXISTS` path inherits; the `orders` side is bounded first by
`orders_tenant_status_created_idx` — no speculative migration added, following F18-05's precedent).
Frontend: a fourth "Exceptional discount" `<Select>` on `SalesReportFilters` (`/sales` report
section), `reportExceptional` URL param (omitted when `all`), the empty state names the filter when
it is the active one. **Still open (renamed within the gap):** a per-period exceptional *line
count* and therefore `KPI-SALES-EXCEPTIONAL`'s "exceptional lines ÷ total lines" *rate* — both
would be new metrics with no official definition (`metrics.md` `SALES-EXCEPTIONAL-LINES` **C → B**;
`REP-SALES-EXCEPTIONAL` **C → B**; `matrix.md` D8 **C → B**). Real-PostgreSQL: `tools/pg-verify`
**Tests 460 passed (460), Test Files 36 passed (36)** (up from 449/35 at F18-05's close — 11 new
tests in `test/reports/sales-summary-exceptional.integration.test.ts`: the critical
confirmed-exceptional-with-**zero**-`price_approvals`-rows case, the approved-request case, tenant
isolation, RBAC (401/403), invalid-value 400, default == `all`, `status=pending&exceptional=only`,
the mixed-line order-grain-vs-line-grain case, week/month/customer grouping, empty result); the
harness process then hit the same Windows-only `EBUSY` (`rmdir` on `.verify-pgdata`) during its own
post-test cleanup that F18-04/05 documented — not a functional failure, `tools/pg-verify`
untouched. API unit 533 → 535 (`sales-report.service.spec.ts` +2); web unit 405 → 408
(`sales-report-filters.test.tsx` +2, `sales-report-section.test.tsx` +1). Lint and typecheck pass
on both apps; API build passes; `pnpm --filter @saas-inventory/web build` compiles, type-checks and
statically generates all 40 routes, then fails only at the pre-existing Windows `EPERM` symlink
step (documented since FASE 12, `apps/web` source otherwise untouched). **No browser automation
tool was available in this environment**, so real-browser visual validation was not performed —
substituted by the real-HTTP pg-verify integration coverage plus jsdom component-render tests;
**not** claimed as a browser check. **FASE 18-06 CLOSED, not pushed.**

**F18-07** adds the **MOVEMENTS read-side** — `GET /reports/movements-summary`
(`apps/api/src/reports/movements/`, `inventory.view`, **tenant-wide**) — the aggregation half of
`metrics.md` `KPI-INV-MOVEMENTS` / `MOV-QTY-BY-TYPE` / `MOV-RECEIPTS-PERIOD` /
`MOV-ADJUSTMENTS-PERIOD` (Σ), all previously **B** ("no server-side aggregation"; the date-range
half was F18-03). Aggregates `inventory_movements` **alone** — no join, so every `COUNT(*)` /
`SUM(quantity)` is exact with zero fan-out (same clean property as `approvals-summary`). Never
`InventoryMovementsRepository` (reporting stays a separate read-side). `groupBy=day|week|month|type`
(default `day`); half-open `[from, to)` on `inventory_movements.occurred_at` — the *same* column
`GET /inventory/movements`'s `occurredFrom`/`occurredTo` filter uses (F18-03), reused under the
standard report `from`/`to` names (both required) since this *is* a FASE 18 report, and backed by
the *same* `inventory_movements_tenant_occurred_idx (tenant_id, occurred_at)` index F18-03's
migration `0030` added — **no new index, no new migration, no new permission, no new ADR, no schema
change**. Optional filters `movementType` (one of the 12 real `movement_type` values) /
`locationId` / `productVariantId` — the exact three `KPI-INV-MOVEMENTS` names ("type, location,
variant"), all real FK columns on `inventory_movements`. Each bucket carries `movementCount`
(`MOV-COUNT` grouped) and `totalQuantity` — the **signed** `Σ quantity` (`inventory_movements.quantity`
is stored signed relative to its balance bucket by `StockLedgerService`: RECEIPT / ADJUSTMENT_IN /
TRANSFER_IN / RETURN / RESERVATION / COMMITMENT / INITIAL_STOCK positive; SALE / ADJUSTMENT_OUT /
TRANSFER_OUT / RESERVATION_RELEASE / COMMITMENT_RELEASE negative) — this is `MOV-QTY-BY-TYPE`'s
"signed quantity by movement type" verbatim; unambiguous per `type` bucket, a documented mixed net
for a period bucket with no `movementType` filter. Response `{ from, to, timezone, groupBy, buckets }`
— **no `currency`** (this report carries no monetary value, unlike sales/returns/approvals). The
requirement had no `GAP-` id before (it lived only in `KPI-INV-MOVEMENTS` + `f17-f18-boundary.md`'s
"Movement analytics … aggregation still open" line) — F18-07 registers it as **`GAP-MOV-AGGREGATE`
(RESOLVED)**; `metrics.md` `MOV-QTY-BY-TYPE`/`MOV-RECEIPTS-PERIOD`/`MOV-ADJUSTMENTS-PERIOD`(Σ) and
`kpis.md` `KPI-INV-MOVEMENTS` and `matrix.md` D6/rows 13-14 all move **B → A**; new `reports.md`
`REP-INV-MOV-SUMMARY` (**A**). Frontend: a "Movements report" section on `/inventory/movements`
(`MovementsReportFilters` from/to/groupBy/movementType + `MovementsReportSection` KPI tiles +
grouped table, mirroring `SalesReportSection`/`InventoryReportSection` — same `#report`-anchored
navigation, same local `MovementsReportError` that never redirects on a 403) above the unchanged
movement list; `reportFrom`/`reportTo`/`reportGroupBy`/`reportMovementType` URL params, independent
of the operational list's own `occurredFrom`/`occurredTo`/`movementType`/`locationId` chips (the
`locationId`/`productVariantId` filters stay available on the endpoint for API callers). **Still
open (separate):** grouping by actor (`GAP-NAME-ENRICHMENT` — ids only) and a `sort` on the raw
list (`GAP-SORT`); in-transit aggregation is `GAP-INV-AGGREGATE`'s remainder, not this.
Real-PostgreSQL: `tools/pg-verify` **`test:integration` exited 0 — Test Files 37 passed (37), Tests
472 passed (472)** (up from 460/36 at F18-06's close — 12 new tests in
`test/reports/movements-summary.integration.test.ts`: RBAC incl. a Vendedor-is-403 case + a
Bodega-is-200 case, tenant isolation, `[from,to)` boundary exactness on `occurred_at`,
invalid-`groupBy`/`movementType` 400, `groupBy=type` exact signed-SUM math (RECEIPT + /
ADJUSTMENT_OUT −), day/week/month grouping, `movementType`/`locationId`/`productVariantId` filter
composition, empty result; one shared fixture tenant in `beforeAll` + per-test fresh variants —
the first draft's tenant-per-test caused a `registerTenant` deadlock with
`identity-backfill.integration.test.ts` under `fileParallelism`, fixed by the shared fixture).
API unit 535 → 545 (`movements-report.service.spec.ts` +10); web unit 408 → 417
(`movements-report-filters.test.tsx` +4, `movements-report-section.test.tsx` +5). Lint and
typecheck pass on both apps; API build passes; `pnpm --filter @saas-inventory/web build` compiles,
type-checks and statically generates every route, then fails only at the pre-existing Windows
`EPERM` symlink step (documented since FASE 12, `apps/web` source otherwise untouched). **No
browser automation tool was available in this environment**, so real-browser visual validation was
not performed — substituted by the real-HTTP pg-verify integration coverage plus jsdom
component-render tests; **not** claimed as a browser check. **FASE 18-07 CLOSED, not pushed.**

**F18-08** ("Transfer analytics" — the conceptual F18-04 slot; execution numbering has been
offset from the conceptual roadmap since F18-03, see `docs/architecture/reporting/reports.md` for
the reconciliation) adds the **TRANSFERS read-side** — `GET /reports/transfers-summary`
(`apps/api/src/reports/transfers/`, `inventory.view`, **tenant-wide**). Resolves the transfer
aggregation items every reporting doc left open: `metrics.md` `TRF-OPEN-COUNT` /
`TRF-INTRANSIT-COUNT` / `TRF-INTRANSIT-QTY` and `kpis.md` `KPI-INV-INTRANSIT` /
`KPI-OPS-TRANSFERS-OPEN` / `KPI-OPS-TRANSFERS-TO-RECEIVE`, all previously **B** ("5 separate calls,
or one aggregate" / "no cross-transfer aggregate") — now **A**. Aggregates `inventory_transfers` /
`inventory_transfer_items` (never the transactional `InventoryTransfersRepository` /
`InventoryTransferItemsRepository` — modules.md's read-side rule, same as every `reports/<domain>/`).
`groupBy=status|destination|variant` (default `status`); **no `from`/`to`** — a live snapshot of
current open-transfer state (like `inventory-summary`, F18-03; `inventory_transfers` carries stage
timestamps but no history to bucket "open-ness" by — `GAP-SNAPSHOTS` stays open), `generatedAt` is
the query-time clock. Two grains, never mixed: `status` = `COUNT(*)` over `inventory_transfers`
**alone** (one bucket per real status, exact, zero fan-out); `destination`/`variant` =
`Σ (quantity_dispatched − quantity_received)` over `inventory_transfer_items` of transfers whose
status is `dispatched`/`partially_received` (the fixed "in transit" set, ADR-0020), joined **1:1**
to the parent header for the status filter + `destination_location_id` and to
`locations`/`product_variants`+`products` for names — `COUNT(DISTINCT transfer id)` for the
per-destination open count, so a 3-line transfer counts once, never once per line. The DB `CHECK`
`quantity_received <= quantity_dispatched <= quantity_requested` guarantees `dispatched − received
>= 0` (never a negative "in transit"). `groupBy`-independent `totals: { inTransitQuantity,
openTransferCount }` — the KPI row on every grouping. **No monetary field** (a transfer has no
value; same `NO COSTING` posture as `inventory-summary`/`movements-summary`). Deliberately **not**
sourced from `inventory_movements` `TRANSFER_OUT`/`TRANSFER_IN` rows — those are the ledger
side-effects of the dispatch/receive transitions, not the transfer's own state (`movements-summary`,
F18-07, aggregates the movement rows; this report aggregates the transfers), and the reporting docs
are explicit that in-transit stock "is derived from open transfers, not a stored balance bucket".
**Deliberately not built** (each `BLOCKED BY DEFINITION`, documented as a gap, not implemented
speculatively): transfer **cycle time** (`TRF-CYCLE-TIME` — `received_at − created_at` is a per-row
value, but the aggregation function *and* the period-anchor timestamp are undefined in every doc;
new `GAP-TRANSFER-CYCLE-TIME`, needs an ADR/metrics definition first) and receiving **incidents**
(`TRF-INCIDENTS` — `inventory_transfer_receipt_items` is exposed by no endpoint and has no defined
analytic metric). **No schema change, no migration, no new index** (`inventory_transfers_tenant_status_created_idx`
+ `inventory_transfer_items_tenant_transfer_idx` cover it), **no new permission code** (`inventory.view`
reused per F18-01), **no new ADR**, **no change to the FASE 8 transfer lifecycle / stock ledger**.
Frontend: a "Transfer report" section on `/inventory/transfers` (`TransfersReportSection` /
`TransfersReportFilters`, mirroring `InventoryReportSection` — `#report`-anchored `reportGroupBy`
param independent of the operational list's `status`/`sourceLocationId`/`destinationLocationId`
chips, a local `TransfersReportError` that never redirects on a 403) above the unchanged transfer
list. New gaps: `GAP-TRANSFER-AGGREGATE` (**RESOLVED**), `GAP-TRANSFER-CYCLE-TIME` (open).
`GAP-INV-AGGREGATE`'s "in-transit aggregate (`TRF-INTRANSIT-QTY`)" remainder is now resolved;
`GAP-MULTI-STATUS` stays open (the transfer *count-by-status* case is covered, but the array-status
*filter* on the operational list endpoints — returns/imports/orders — is not). Real-PostgreSQL:
`tools/pg-verify` — `test/reports/transfers-summary.integration.test.ts` (RBAC incl. a
Vendedor-is-403 + Bodega-is-200 case, tenant isolation, invalid-`groupBy` 400, the `status` rollup
with delta assertions, in-transit by destination/variant with grain-safety — a multi-line transfer
counted once — a fully-received transfer excluded, `totals` groupBy-independence, empty tenant →
`buckets: []` + zeroed totals); the harness process then hit the same Windows-only `EBUSY` (`rmdir`
on `.verify-pgdata`) during its own post-test cleanup that F18-04/05/06/07 documented — not a
functional failure, `tools/pg-verify` untouched. API unit 545 → 554
(`transfers-report.service.spec.ts` +9); web unit 417 → 428 (`transfers-report-section.test.tsx`
+8, `transfers-report-filters.test.tsx` +3). Lint and typecheck pass on both apps (API source +
API tests + web); API build passes. **No browser automation tool was available in this
environment**, so real-browser visual validation was not performed — substituted by the real-HTTP
pg-verify integration coverage plus jsdom component-render tests; **not** claimed as a browser
check. **FASE 18-08 CLOSED, not pushed.**

**F18-09** ("Imports analytics" — the conceptual and execution numbers coincide here) adds the
**IMPORTS read-side** — `GET /reports/imports-summary` (`apps/api/src/reports/imports/`,
`import.execute`, **tenant-wide** — `import_jobs` has no location dimension). Resolves the one
import metric the reporting catalogue marks a FASE 18 aggregate: `metrics.md` `IMP-ROWS-PERIOD`
("`Σ imported_rows` over jobs completed in range … no filter/sum", **B**) and `reports.md`'s "a
cross-job 'rows imported this month' rollup is **B**" — both now **A**. Aggregates `import_jobs`
**alone** (never `ImportJobsRepository`/`ImportJobRowsRepository` — modules.md's read-side rule;
and critically **never a join to `import_job_rows`**, so `COUNT(*)` = jobs and every `SUM(*_rows)`
is exact with zero fan-out — a `import_job_rows` join would multiply the job count by its row
count, the trap the sales/returns reports guard with `DISTINCT`). `groupBy=day|week|month|status`
(default `day`); half-open `[from, to)` (both required) on **`import_jobs.completed_at`** — the
field `IMP-ROWS-PERIOD` explicitly names, and code evidence confirms it is set on **every**
terminal transition (`ImportJobService.runCommit` → `completed`/`completed_with_errors`, `.cancel`
→ `cancelled`, `.markFailedAndAudit` → `failed`) and `NULL` only while a job is non-terminal
(`uploaded`…`importing`). **Jobs with `NULL` `completed_at` are excluded from every bucket** — they
have not completed in any period; a live "imports in progress" count (`IMP-JOBS-PENDING` /
`KPI-OPS-IMPORTS-RUNNING`) is a queue depth over exactly those and is **not** what this period
report answers — it stays `GAP-MULTI-STATUS` territory, the same boundary F18-05 drew for
`APPR-AGE`. `groupBy=status` therefore surfaces only the **terminal outcome mix** (`completed` /
`completed_with_errors` / `failed` / `cancelled`) — the direct analogue of
`approvals-summary?groupBy=status` — and resolves `KPI-OPS-IMPORTS-ATTENTION` (sum the `failed` +
`completed_with_errors` buckets) in one call. `status` filter, **no default**. `totals` and every
bucket share one shape: `{ key, jobCount, totalRows, validRows, invalidRows, warningRows,
importedRows }` (`COALESCE(SUM(col), 0)` — `0`, never `null`, for a job that never validated /
committed). **No `currency`** (an import has no monetary value — same as `movements-summary`).
**Sensitive-data posture:** the report exposes only `status` + the six numeric aggregates — **no**
`original_filename`, `storage_key`, `created_by`, `column_mapping`, and **zero** `import_job_rows`
content (`raw_data`/`mapped_data` raw uploaded cell values, `errors`/`warnings` messages) — the
prompt's explicit "raw uploaded row contents must not appear in an analytic response" rule.
**Deliberately not built** (`BLOCKED BY DEFINITION`, documented as gaps, not implemented
speculatively): a **period-level import error rate** (`IMP-ERROR-RATE` is defined **per job only** —
`invalid_rows ÷ total_rows`; a *period* ratio has no defined numerator/denominator/`0÷0` behaviour;
new `GAP-IMPORT-ERROR-RATE-PERIOD`, F18-09 exposes the raw `Σ` components instead, the same
"components, not the ratio" stance F18-04 took for `RET-RATE`); grouping by `mapping_template_id` /
`created_by` / `duplicate_handling_mode` (no `metrics.md` row, KPI or gap asks). **No schema
change, no migration, no new index** (`import_jobs` is a naturally small table — one row per
human-initiated import — so the tenant scan is trivial; `(tenant_id, completed_at)` is the additive
index for a future high-volume tenant, F18-05 precedent), **no new permission code** (`import.execute`
reused per F18-01 — IMPORT's single-permission-for-the-whole-flow design, database.md's RBAC), **no
new ADR**, **no change to the FASE 10 import pipeline / validation / retry / idempotency / stock
ledger**. Frontend: an "Imports report" section on `/imports` (`ImportsReportSection` /
`ImportsReportFilters`, mirroring `ApprovalsReportSection` — `#report`-anchored `reportFrom`/
`reportTo`/`reportGroupBy`/`reportStatus` params independent of the operational list's `status`
chip, a local `ImportsReportError` that never redirects on a 403) above the unchanged job list.
New gaps: `GAP-IMPORT-ROWS-PERIOD` (**RESOLVED**), `GAP-IMPORT-ERROR-RATE-PERIOD` (open).
`GAP-MULTI-STATUS` stays open (the *completed* import outcome mix is covered; the live "running"
count and the array-`status` filter on `GET /imports` are not). Real-PostgreSQL: `tools/pg-verify`
— **`Test Files 39 passed (39)`, `Tests 495 passed (495)`, `0 failed`, `0 skipped`, `[PASS]
"test:integration" exited 0`** (up from 38/484 at F18-08's close —
`test/reports/imports-summary.integration.test.ts` = +11 tests, +1 file: RBAC incl. a
Vendedor-is-403 case — `import.execute` is Administrador-only in `DEFAULT_ROLE_TEMPLATES`; tenant
isolation; `[from,to)` on `completed_at` via a direct backdating `UPDATE` on the disposable
pg-verify DB only, since the HTTP contract has no `completedAt` override unlike
`inventory/adjustments`' `occurredAt`; the **cardinality** guarantee — a job that imported 3 rows
is **one** job with `importedRows: 3`, never 3 jobs; error isolation — a job's `invalidRows` is
that one job's, never multiplied; multi-job aggregation; `groupBy=status` bucketing a `cancelled`
job; empty tenant → `buckets: []` + zeroed totals; 400 batch on missing/invalid params). Every
fixture job is produced by the real upload → validate → confirm/cancel pipeline through
`buildImportTestApp()` (only `ObjectStorageService` is the in-memory stand-in — Postgres/RLS/the
pipeline are real). The harness process then hit the same Windows-only `EBUSY` (`rmdir` on
`.verify-pgdata`) during its own post-test cleanup that F18-04/05/06/07/08 documented — the
`embedded-postgres@18.4.0-beta.17` teardown artifact, **not a functional failure** (`test:integration`
exited 0 before it); controlled manual cleanup applied and verified (orphan `postgres.exe` +
pg-verify node tree killed, port 55432 freed, `.verify-pgdata` removed, dev servers untouched, no
persistent DB touched). API unit 554 → 564 (`imports-report.service.spec.ts` +10); web unit 428 →
438 (`imports-report-section.test.tsx` +6, `imports-report-filters.test.tsx` +4). Lint and
typecheck pass on both apps (API source + API tests + web); API build passes; `pnpm --filter
@saas-inventory/web build` compiles/type-checks/statically generates every route, then fails only
at the pre-existing Windows `EPERM` symlink step during *Collecting build traces* (documented since
FASE 12). **No browser automation tool was available in this environment**, so real-browser visual
validation was not performed — substituted by the real-HTTP pg-verify integration coverage plus
jsdom component-render tests; **not** claimed as a browser check. **FASE 18-09 CLOSED, not pushed.**

**F18-10** ("Super-Admin Platform Metrics" — the last conceptual FASE 18 block) added the one
platform-metrics capability grounded in existing data: **`GET /platform/summary`**
(`apps/api/src/administration/platform-summary/`, `@PlatformOnly()` — **never `@RequirePermissions`**;
ADR-0032 line 101-103 names this exact mechanism for "platform metrics", and there is no tenant
permission catalog entry for a platform route by design, so a tenant Administrador role can never
be configured into platform access). A **dedicated read-side aggregate** (`PlatformSummaryRepository`,
never `TenantsPlatformRepository` — that is the lifecycle/write-path repo) over the platform-scoped
**`tenants` table ALONE**, on the `app_platform` connection (the only role granted `SELECT ON tenants`;
`tenants` has no `tenant_id`, no RLS — access is by GRANT alone, "exactly the tables the SuperAdmin
context is allowed to touch directly", multi-tenancy.md). Response: `{ generatedAt, totalCount,
byStatus: { active, suspended, archived }, demoCount, period: { from, to, newInPeriod } | null }` —
one `COUNT(*)` with `FILTER` clauses (+ one more `COUNT(*)` for the optional period). `from`/`to`
are **optional but both-or-neither** (400 on a half period or `from >= to`) — a half-open `[from, to)`
window on `tenants.created_at` for `newInPeriod` (`PLAT-TENANT-CREATED` / `KPI-PLAT-TENANTS-NEW`, the
metric's verbatim formula). **No timezone, no `date_trunc`, no `groupBy`** — a platform metric spans
every tenant, so there is no single tenant timezone (F18-01's timezone semantics are tenant-scoped);
the period count is a raw `[from, to)` comparison on the `timestamptz`, `from`/`to` supplied as UTC
instants by the caller. **Data minimisation:** numeric aggregates only — never an individual
tenant's id / name / slug (that is `GET /platform/tenants`), never any tenant-scoped table
(`users`/`orders`/`inventory_*`/`audit_log` — `app_platform` has `BYPASSRLS` + `SELECT` grants on
them, but this repository touches **only `tenants`**), never a billing figure. `active + suspended
+ archived === totalCount`. No `currency`, no `timezone`. Scope decision **B — PARCIALMENTE
IMPLEMENTABLE**: metrics 1-4 (`PLAT-TENANT-COUNT` / `PLAT-TENANT-BY-STATUS` / `PLAT-DEMO-COUNT` all
**A** — moved server-side from "fold the unpaginated array client-side"; `PLAT-TENANT-CREATED` /
`KPI-PLAT-TENANTS-NEW` **B → A**) built; **deliberately not built** (each blocked, its own gap, no
speculative architecture): `KPI-PLAT-ACTIVITY` / `PLAT-USERS-PER-TENANT` (cross-tenant aggregate
over tenant-scoped tables — `GAP-PLATFORM-AGGREGATE`, needs an ADR + a dedicated **audited** read
path; "building it naively would breach the isolation model", f17-super-admin.md §3),
`KPI-PLAT-BILLING` / `PLAT-BILLING` (`GAP-SA-BILLING` — no billing/plan/subscription table exists
anywhere in the schema; a bounded context of its own), a platform audit view (`GAP-SA-AUDIT`).
Common SaaS indicators (MRR/ARR/churn/DAU/MAU/LTV/uptime/health/adoption/conversion) have **no
documented definition** and were **not** implemented — the "NO INVENTAR ANALYTICS" rule; they are
class **D** (not a metric of this system). **No schema change, no migration, no new index**
(`tenants` is one row per company — a `COUNT(*)` over the whole table is trivial), **no new
permission code** (`@PlatformOnly()` reused), **no new ADR**, **no `SECURITY DEFINER`**, **no RLS
bypass beyond what `app_platform` already does for `tenants`**, **no change to the FASE 11 platform
auth / tenant-lifecycle code**. Frontend: a KPI-tile row on the `(superadmin)/platform` home
(`PlatformSummarySection` — 4 tiles: Companies / Active (+ suspended·archived hint) / Demo / New;
the "new" window is the current UTC calendar month, labelled "(UTC)" so the boundary is honest;
`PlatformSummaryError` never blanks the page), replacing the "Platform metrics ... not available
yet" copy with "Per-tenant usage, activity and billing metrics are not available yet". New/updated
gaps: `GAP-PLATFORM-AGGREGATE` **partially resolved** (company counts done; tenant-data part still
needs an ADR), `GAP-SA-BILLING` registered in `reporting/data-gaps.md` (was only in
`frontend/f17-super-admin.md`). Real-PostgreSQL: `tools/pg-verify` — **`Test Files 40 passed (40)`,
`Tests 503 passed (503)`, `0 failed`, `0 skipped`, `[PASS] "test:integration" exited 0`, `All
checks PASSED`** (up from 39/495 at F18-09's close — `test/administration/platform-summary.serial.integration.test.ts`
= +8 tests, +1 file: 401 anon / 403 tenant session — even a full-access Administrador — and a
`?tenantId=` param that cannot widen scope / 200 platform admin with numeric-only response asserted
to contain no `slug`/`name`/`users`/`currency`; both-or-neither `from`/`to` + `from>=to` + invalid
date → 400; N-tenant cardinality — `totalCount` rises by exactly N, `byStatus` always sums to
`totalCount`, single-table so no fan-out; suspend moves a tenant active→suspended with `totalCount`
unchanged; `[from,to)` on `created_at` via a direct backdating `UPDATE` on the disposable pg-verify
DB only; a window with no tenant → `newInPeriod: 0`, never an error). The harness process then hit
the same Windows-only `EBUSY` handle-leak (`.verify-pgdata`) during its own post-summary shutdown
that F18-04..09 documented — the `embedded-postgres@18.4.0-beta.17` teardown artifact, **not a
functional failure** (`All checks PASSED` + `test:integration` exited 0 both printed first);
controlled manual cleanup applied and verified (orphan `postgres.exe` + pg-verify node tree killed,
port 55432 freed, `.verify-pgdata` removed, dev servers 14280/24544 untouched, no persistent DB
touched). API unit 564 → 571 (`platform-summary.service.spec.ts` +7); web unit 438 → 442
(`platform-summary-section.test.tsx` +4). Lint and typecheck pass on both apps (API source + API
tests + web); API build passes; `pnpm --filter @saas-inventory/web build` compiles/type-checks/
statically generates every route, then fails only at the pre-existing Windows `EPERM` symlink step
(documented since FASE 12). **No browser automation tool was available in this environment**, so
real-browser visual validation was not performed — substituted by real-HTTP pg-verify integration
coverage plus jsdom component-render tests; **not** claimed as a browser check. **FASE 18-10
CLOSED, not pushed. FASE 18 (Reporting) = 10/10 conceptual blocks COMPLETE.**

The ROLES/PERMISSIONS block closed `GAP-ROLE-CRUD` — `roles`/`role_permissions` (tenant-owned,
schema-ready since migration `0002`) finally get application code beyond `GET /roles`: `POST /roles`,
`PATCH /roles/:id` (name/description), `PUT /roles/:id/permissions` (replaces the set), `DELETE
/roles/:id` (soft-delete, `409` while 1+ users still hold the role), and `GET /permissions` (the
platform-wide catalog, for the role editor's "group by module" picker). One new permission code,
`core.roles.manage` (migration `0032`, `module.action` pattern, same gap-filling precedent as
0014-0027), given to Administrador only in `DEFAULT_ROLE_TEMPLATES` — `core.roles.read`/
`core.roles.assign` unchanged. `is_system_default` still grants no protection (unchanged from
database.md#rbac-roles-permissions) — a predefined role is editable/deletable exactly like a
custom one. New authorization rule, not covered by ADR-0031's existing self-escalation block:
[ADR-0034](docs/decisions/0034-role-permission-self-escalation-prevention.md) — a caller can never
replace the permission set of a role currently assigned to themselves (`403`,
`ROLE_SELF_PERMISSION_ESCALATION`, checked live against `user_roles`), independent of holding
`core.roles.manage`; renaming/describing their own role is still allowed, since it cannot grant
anything. `HttpExceptionFilter` gained a narrow `extractCode` extension point so an exception
thrown as `new ForbiddenException({ code, message })` surfaces that specific code instead of the
generic per-status one — every existing plain-string `ForbiddenException` elsewhere is unaffected.
Same block also closed a real, narrow gap under `WAREHOUSE OPERATION SCOPE`:
`TransfersService.create` (`POST /inventory/transfers`, requesting a transfer) did not call
`LocationAuthorizationService.assertAccess` on `sourceLocationId` — only `prepare`/`dispatch`/
`receive` did — so a location-restricted user could originate (though never actually prepare or
dispatch) a transfer sourced outside their scope; fixed with the same existing ADR-0024 mechanism,
no new permission/migration/ADR (same "controlled correction" precedent as 011-A/012-A/013-A).
SALES (cart/order creation) was already fully location-scoped before this gap-closure. Frontend:
`/roles` gained a "Crear rol" action and per-row Editar/Eliminar (`core.roles.manage`); `/roles/new`
and `/roles/[id]` (name/description form + a permission picker grouped by the catalog's 7 `module`
values, disabled with an explanation on the caller's own role per ADR-0034); `/users/[id]` gained
explanatory copy contrasting role (capabilities) vs. almacén asignado (operational scope) — no
backend change to the user/location-assignment flow, which was already correct. Verified: API
unit 607 passed, web unit 573 passed, lint/typecheck pass on both apps; new integration tests
(`test/core/roles-crud.integration.test.ts` — create/rename/delete, ADR-0034 self-block on own vs.
other roles, unknown-permission-code 400, delete-in-use 409, ADR-0031 regression check; plus a new
case in `test/inventory/inventory-transfers.integration.test.ts` for the transfer-create location
check) were written but **not executed against real PostgreSQL this pass** — `tools/pg-verify`'s
fixed port 55432 was already held by an unrelated, longer-running local dev-server
(`scratchpad/.dev-pgdata`) this session deliberately did not stop, per the user's explicit choice;
pg-verify still needs to be run once to confirm these tests pass for real. Not pushed.

The TENANT ONBOARDING + TENANT SUPPORT block added two SuperAdmin-side capabilities under
`apps/api/src/administration/` (`platform-tenants/`, `platform-support/`) —
[ADR-0036](docs/decisions/0036-tenant-onboarding-and-support.md), closing `GAP-SA-CREATE-TENANT`
and resolving `GAP-SA-IMPERSONATION`. **Tenant Onboarding:** `POST /platform/tenants` provisions a
company + founding admin without the SuperAdmin ever collecting a password — reuses
`TenantProvisioningService`/`IdentityProvisioningService` verbatim, branches on the admin email's
global `identities` status (ADR-0033): `active` reuses the identity with no invitation,
`pending_credential` issues a one-time invitation link (`tenant_admin_invitations`, new table,
`InvitationTokenService` mirroring `RefreshTokenService`'s opaque-token-plus-HMAC shape), `disabled`
is refused (409) with compensation (tenant suspended, user soft-deleted — combining
`TenantProvisioningService`'s and `UsersService.create`'s existing rollback patterns). The invitee
accepts via `GET/POST /auth/invitations/:token` + `/auth/accept-invitation` (both `@Public`,
`(public)/accept-invitation/[token]`), setting their own password and logging in immediately.
**Tenant Support:** `POST /platform/tenants/:tenantId/support-sessions` opens an audited,
tenant-scoped, time-boxed `platform_support_sessions` row (`read`/`write` mode, required `reason`,
`SUPPORT_SESSION_TTL_SECONDS` default 1800s, one live session per admin — DB-unique, gracefully
superseded across tenants) — gated by a **new** `SupportSessionGuard`/`@RequireSupportSession()`
layered strictly beside `@PlatformOnly()`, never through tenant RBAC (explicit prompt requirement).
The curated `PlatformSupportController` exposes exactly `GET support/users`,
`GET support/warehouses` (read), and `PATCH support/warehouses/:id/status` (the one write action,
backed by a new column-level `GRANT UPDATE (status) ON warehouses TO app_platform`) — every write
audited with the session id and reason attached (`GAP-SUPPORT-READ-SCOPE`: deliberately not a
general tenant-data browser). No tenant JWT is ever issued for support and no phantom/shared-credential
admin is ever created — the actor stays the Platform Admin throughout, re-verified live on every
request. Migration `0033` adds both new platform-scoped (no-RLS) tables plus the grants; no existing
table changes. Frontend: `/platform/tenants/new` (create, no password field), an "Administrador del
Tenant" invitation panel + "Acceder como soporte" trigger on `/platform/tenants/[id]`, the curated
`/platform/tenants/[id]/support` panel, and a persistent "MODO SOPORTE" banner
(`support-mode-banner.tsx`, composed by `PlatformShell` on every `(superadmin)/` page) with an
explicit exit action. Verified: 50/50 new integration tests passed against an isolated, disposable
`embedded-postgres` instance (port 55433) — the developer's own persistent dev-server (port 55432)
was never touched; API unit 608/608 (unchanged count — only existing specs' mocks extended for the
`AuthConfig`/`AuthService` constructor additions); web unit 617/617 (96 files, +32 new tests across
6 new components); lint/typecheck clean on both apps. Not pushed.

The LOGIN + USUARIOS UI/UX block removed the "Crear empresa"/"Crear cuenta" CTA from `/login`
(tenant creation is invitation-only now, ADR-0036) and relaxed the user-creation identifier: the
UI now calls it "Usuario" instead of "Correo" and accepts any 10+ character string, not only a
valid email address. Audited first — architecturally unblocked, not a `PENDING DECISION`:
ADR-0033's `identities.email` (the login identifier's actual backing store, shared by every
tenant's `users.email`) has no format CHECK at the DB level and is matched by plain
case-insensitive string equality (`IdentitiesRepository.findByEmail`), so nothing downstream
depends on email *format* — only `@IsEmail()` on two DTOs enforced it. `CreateUserDto.email`
(`apps/api/src/core/users/dto/create-user.dto.ts`) is now `@IsString() @Length(10, 128)`,
matching the pre-existing password minimum; `LoginDto.email`
(`apps/api/src/auth/dto/login.dto.ts`) is now `@IsString() @Length(1, 255) @IsNotEmpty()` — both
changed together deliberately, since relaxing only one would strand either new-style accounts
(username accepted at creation, rejected at login) or existing ones (a real email, always ≥ some
length, was never at risk either way). The DB column and wire-contract field are both still named
`email` (unchanged) — renaming either was judged out of scope for a UI-label change, same
principle CLAUDE.md §7.7 already applies to DB columns. `UpdateUserDto` has no email field at all
(pre-existing — the identifier is set once, at creation, never edited), so no login-affecting edit
path exists to re-check. `/register`, `POST /auth/register`, and `RegisterDto.email` (`@IsEmail()`)
are **unchanged** — out of this block's explicit scope; the login page's CTA to it was removed, the
route/endpoint itself is untouched, still directly reachable, and middleware.ts's
`TENANT_PUBLIC_PATHS` still lists it (audited: no other in-app caller referenced the removed link).
**Search:** `GET /users` gained `?q=` — free-text, case-insensitive, partial match against
`fullName` only (never `email`), resolved server-side (`UsersRepository.findManyByTenant`'s
`ILIKE '%q%'`, the same convention `CustomersRepository.listByTenant` already established, not a
client-side filter over the paged slice) — closes `GAP-USER-FILTERS`'s name-search half
(role/date filters remain open). `/users` gained a debounced `users-filters.tsx` search box (same
live-search convention `ProductsFilters` established) and a trailing pencil-icon action column —
same `href`, same permission surface as clicking the row name, not a second edit implementation;
no new permission code. Verified against real PostgreSQL via `tools/pg-verify` (isolated,
disposable `embedded-postgres` instance temporarily reassigned to port 55433 for this run only —
the developer's own persistent dev-server on port 55432 was never touched; the tool's `PORT`
constant and one call-site edit were reverted immediately after, zero residual diff): **557
integration tests, 43 files** — the new `test/core/users-rbac.integration.test.ts` cases (7 added,
20/20 in that file) all passed on both of two separate full runs. **5 failures on run 1 and 7 on
run 2 are pre-existing flakiness, not a regression**: the specific tests that failed were
different and non-overlapping between the two runs (e.g. `auth-flow`'s F18-01 failed on run 1 and
passed on run 2; `sales-transition-concurrency`'s R13/R14 failed only on run 2) across files this
block never touched (`event-processor`, `inventory-summary`, `sales-transition-concurrency`,
`auth-flow`, `platform-summary`) — the signature of resource contention under
`fileParallelism: true` against one shared embedded Postgres instance, not a deterministic defect;
confirmed by the underlying Postgres log showing a `deadlock detected` and RLS-policy races in the
exact same time window. API unit 622/622 (+14: the 2 new `UsersService.list` search-passthrough
cases plus pre-existing uncommitted specs elsewhere in the tree); web unit 633/633 (97 files, +19:
2 new `login-form.test.tsx` cases, 2 new + 1 rewritten `create-user-form.test.tsx` cases, 5 new
`users-filters.test.tsx`); lint/typecheck clean on both apps. Not pushed — pending the user's
visual/functional review.

**Blocks after the Login + Usuarios entry (not narrated above — documentation catch-up, 2026-10-26).**
Everything below is read from commits, migrations and ADRs; none of it has a recorded real-PostgreSQL
run for the current tree (see `PG-VERIFY-FULL-RUN` in the pending register). Migrations `0034`–`0050`:

- **Kardex / costing** (`1283de8`, ADR-0037, `0034`): costed Kardex view, `GET /reports/kardex`,
  weighted-average cost; movements history rebuilt. Inventory total value uses physical stock, not
  availability (`2e5eded`).
- **Transfers** (`0035` code, `0036` tenant workflow flags): configurable approval/preparation steps
  via tenant settings (`transfersRequireApproval`/`transfersRequirePreparation`), modal actions,
  created-date filter, product search.
- **Sales** (`0037`–`0041`, `0044`, `0047`, `0050`; ADR-0038): customers redesign; split payments
  (`order_payments`); order PDF export via the browser print dialog (server-side generation
  deferred); approver price editing; **the exceptional-discount trigger is now `base_price`, not
  `min_price`** (ADR-0022 amendment of 2026-10-05; `min_price` remains the hard floor; migration
  `0038` adds `base_price_at_request`) — the FASE 12/13 paragraphs above still say "below
  `min_price`" and are historical (`DOC-ADR0022-TRIGGER-DRIFT`); sequential return and approval
  numbers; the
  `sales.orders.view_all` permission scoping sales history to the seller; exports and payments
  report. **Separation-of-duties change:** the FASE 13 rule "the requester can never resolve their
  own request" is withdrawn — first bypassed for `pricing.policy.manage` holders in code only
  (`b198a7d`, migration `0049` backfills the admin pricing permissions), then settled by the owner on
  2026-10-26: any holder of `pricing.discount.approve` may resolve a request, their own included
  (ADR-0022 amendment; `PriceApprovalsService` and the approval UI no longer special-case the
  requester). By default only the Administrador holds both `.request` and `.approve`
  (`DECISION-SELF-APPROVAL`). **Serialized / lot-tracked variants** are out of the MVP scope (ADR-0039,
  422 at the cart and at checkout, no side effects).
- **Catalog / import / QR** (`0042`, `0043`, `0045`, `0046`): category codes and SKU prefix, uppercase
  names, the `draft` product status removed, bulk stock load from Excel, import-pipeline fixes, bulk
  and printable QR generation.
- **Tenant branding / home** (`0048`, `88acde0`): tenant logos; home KPIs with per-warehouse filter
  and yearly trend chart.
- **UI/UX redesign** (≈35 `apps/web` commits, 2026-10-22…26): Spanish UI, 64 px hover-expand
  navigation rail, mobile tab bar and phone layouts for transfers, new sale, order detail, payments,
  approvals, returns and movements. The design-token layer, blue primary and Lotes 2–3 specified in
  `docs/ui-ux/UI-UX-SPEC-001.md` were **not** delivered (`UIUX-SPEC-VS-IMPLEMENTATION`).
- **Verification baseline (2026-10-26, after the HTTP isolation sweep):** `apps/api` unit 819/819 (72 files);
  `apps/web` unit 1010 passed (138 files) plus 1 unhandled error → non-zero exit
  (`DEFECT-WEB-TEST-UNHANDLED`, open); typecheck (incl. `test/tsconfig.json`) and eslint pass on both apps.
  Real PostgreSQL, `tools/pg-verify` on an isolated instance (`PG_VERIFY_PORT=55433`; the development
  database on :55432 untouched): **812 tests, 0 failed** (781 in the parallel phase + 31 in the serial phase; `platform-summary` moved to the serial phase) and all
  catalog checks passed. **Test-suite rules:** a file that replays migration SQL or does DDL on shared tables must be
  named `*.serial.integration.test.ts` (`pnpm test:integration:all`; the earlier "flaky under contention" runs were
  deadlocks caused by such files, `TEST-FLAKY-DEADLOCKS`); `pg-verify` accepts `PG_VERIFY_PORT` and
  `PG_VERIFY_TEST_FILTER`. **HTTP hardening done:** malformed UUID path params → 400 (`ParseUUIDPipe` on all UUID
  params; guard `src/common/uuid-path-params.spec.ts`), empty `application/json` bodies are read as "no body",
  Fastify `FST_*` 4xx errors are mapped instead of 500, `UTC` is an accepted timezone. **Tenant isolation over HTTP**
  (GAP-F19-RLS-IDOR-DEPTH): 47 cases in `apps/api/test/security/` — support sessions, onboarding / invitations /
  revocation, `view_all`, order payments, bulk load, import jobs, exports, Kardex / movements; matrix in
  `docs/security/tenant-isolation-http-matrix.md`. No cross-tenant access succeeded. Two defects were found and fixed:
  `confirm`/`cancel` of an order now honour the same seller scope as the reads (a seller without
  `sales.orders.view_all` gets 404 for another seller's order — **behaviour change**), and `POST /imports` validates
  `defaultLocationId` / `mappingTemplateId` (400/404 instead of a 500). A follow-up sweep (23 more cases) closed the seller scope of `POST /price-approvals`, `POST /sales-returns` and return cancel — the rule lives in `sales/orders/order-seller-scope.ts` and also governs order confirm/cancel; the return idempotency hash includes the actor; the default Supervisor can no longer create/cancel a return, or confirm/cancel an order, for another seller's order without `sales.orders.view_all`, but keeps the approvals queue and every return (**behaviour change**). The **reads** follow the same rule by owner decision ([ADR-0040](docs/decisions/0040-seller-scope-for-order-derived-operations.md), no new permission): a seller reads only the approval requests and returns of their own orders; approvers (`pricing.discount.approve`) keep the whole queue, the warehouse (`inventory.returns.manage`) keeps every return, `sales.orders.view_all` widens both and grants no action; the returns-summary report carries the same scope. `approve`/`reject`/`inspect`/`resolve` were attacked cross-seller with no defect (20 more cases). The **inventory ledger** (`GET /inventory/movements`, `GET /reports/kardex` and its export) leaked another seller's order numbers, order uuid, reason and actor to any `inventory.view` holder (`FINDING-LEDGER-REFERENCE-LEAK`); fixed by ADR-0040 point 5 (the reference of an order movement is shown to the seller who placed it and to `view_all`; of a return movement also to the warehouse; rows and stock figures stay, with a generic label otherwise) — the default Supervisor and Bodega no longer see order numbers there (**behaviour change**), 7 more cases (`ISO-LED-01…07`). A second pass over the ledger (transfer codes, import numbers, typed reasons; `ISO-LED-08…12`, real xlsx cells and PDF text) found only the import job uuid in `referenceId` (P4, fixed); transfer codes are served to every `inventory.view` holder by the transfers list anyway, and the typed reason of receipts / adjustments is shown as written by decision. A third pass (`ISO-LED-13…18`) attacked `sales-summary`, `payments`, `movements-summary`, `transfers-summary`, `imports-summary`, the transfers export and the transfer `notes` over HTTP with two tenants and found no defect (create-time transfer notes are served to `inventory.view` holders by design; receive-time notes are returned by no route). Support read-through is now audited: every `GET` served under a support session (the general tenant-API read-through and the curated `support/*` reads) writes one `support.tenant_read` row through `PlatformAuditLogService` from `SupportReadAuditInterceptor` — actor the platform admin, route template, outcome, query key names (no values), fail-closed on success (`SUP-READ-NOT-AUDITED`, `ISO-SUP-15…19`, ADR-0036 amendment); residual: volume/retention and a tenant-facing view are undecided. The fail-closed rule and the downloads under support are proven over HTTP (`ISO-SUP-20…21`); that pass also found that `81d4277` had closed movements / Kardex to support (401), fixed with `@CurrentReaderId()` — support reads the rows with the commercial references masked (`FINDING-SUPPORT-LEDGER-401`, `ISO-SUP-22`). `inventory-summary`, `product-catalog` and transfer cancel were attacked with no defect (`ISO-LED-19…21`). Control-plane reads: `GET /platform/tenants/:id` and `/:id/admin-invitation` write a fail-closed `platform.read` audit row via the opt-in `@AuditPlatformRead` (owner decision, option B); the list, the summary and `GET /platform/support-sessions/current` are deliberately unaudited (`ISO-SUP-23…28`). FASE 19 is **not** complete and isolation is not validated for
  surfaces outside that sweep.
- **UI/UX spec closure (owner, option B):** `UI-UX-SPEC-001` is closed with a delivered/deferred table
  (its §0); a tokens + blue primary block is scheduled after FASE 19 and before FASE 22.
- **Migration identity, history integrity and data migrations under RLS (ADR-0041 — Proposed, 2026-10-28).** Synthetic-cluster
  experiments (PostgreSQL 16.15 is the reference; none against a real database, no production database exists) showed that
  `migrate.ts` runs as whatever role `MIGRATOR_DATABASE_URL` authenticates as, that Drizzle never validates the history it reads, and
  that a data migration run by an identity subject to RLS can succeed with zero effect. **`CREATEROLE` alone is not enough to bootstrap**
  (the header of `0000` and the docblock of `migrate.ts` say otherwise; applied files are not edited). Approved direction: a privileged
  bootstrap plus a limited incremental login (`SET ROLE app_migrator`, no `CREATEROLE`), `0000`/`0019` always privileged, `drizzle`
  kept under the bootstrap owner with reduced grants, abort without repair on an inconsistent state, and a contract for `NO FORCE`
  windows. **Implemented (delivery 2b, D-7.2):** `db:migrate` now runs through an integrity wrapper
  (`apps/api/src/database/migrate.ts` → `migration-runner/run-migrations.ts`): the configuration, the files (journal, `history-manifest.json` version 2
  with an **explicit `classification` and `reviewedIn` per migration**, `privileged-manifest.json`), the PostgreSQL identity and the state of Drizzle's
  registry are all checked **before** Drizzle runs, and an inconsistent state is refused, never repaired. **`MIGRATOR_EXPECTED_DATABASE` is now
  required**; use `MIGRATOR_BOOTSTRAP_DATABASE_URL` (superuser; a new database or a pending privileged migration, `--mode bootstrap`) or
  `MIGRATOR_INCREMENTAL_DATABASE_URL` + `MIGRATOR_INCREMENTAL_LOGIN` (limited login, `--mode incremental`); every consumer (wrapper, seeds, `reset-demo`,
  `bootstrap-dev-roles`) reads the bootstrap name, and `MIGRATOR_DATABASE_URL` is a deprecated **bootstrap-only** alias that cannot apply ordinary migrations to an
  existing database. Write `db:migrate` options without `--`; unknown options are refused before anything connects. **Owner / RLS invariants (D-8B):** a hook inside Drizzle's transaction refuses (and rolls back) a batch that leaves an object of `public` not owned by `app_migrator`, an RLS table without FORCE, RLS newly disabled, or a registry that is not the journal; a post-commit audit only reports (nothing committed is undone); pre-existing deviations are warned about, not blocking. **Concurrent runs (D-8C):** a per-database session advisory lock serialises wrapper runs (second waits up to `MIGRATOR_LOCK_TIMEOUT_SECONDS`, default 60); it does not cover `drizzle-kit migrate`/`push` or a hand-written `migrate()`. **SQL/RLS linter (D-8D):** the pending migrations are linted before Drizzle runs (`libpg-query@16.8.1`, PostgreSQL 16 grammar); an ERROR (PUBLIC grants, `GRANT ALL`, ownership changes, `DISABLE`/unrestored `NO FORCE` RLS, `SECURITY DEFINER`, transaction control, SQL that does not parse, PL/pgSQL in an ordinary migration…) refuses the batch; PL/pgSQL bodies and dynamic SQL cannot be analysed and are reported as such; `sql-lint.cli.ts` runs it standalone. Reviewed exceptions live in `database/migrations/sql-lint-exceptions.json` (one exact statement per entry — rule, migration, line, file sha256, reason, review; shipped empty; an invalid file or a stale/unmatched entry stops the run; an accepted finding stays visible); a parser that cannot load refuses the run before Drizzle; exceptions are validated even with nothing pending (D-8E). CI (`.github/workflows/ci.yml`, jobs `migration-harness` and `pg-verify`) runs the harness and pg-verify on `postgres:16.15@sha256:...` with the version verified from the server; it is implemented and statically/locally validated but **no real runner execution has been observed** (see migration-integrity.md 10b). Bootstrap mode with
  `MIGRATOR_INCREMENTAL_LOGIN`/`MIGRATOR_INCREMENTAL_PASSWORD` creates the limited login and narrows the `drizzle` grants; an existing database adopts
  it with `--provision-only`. **Adding a migration**: declare it in `privileged-manifest.json` first if it needs privileges, then
  `history-manifest.cli.ts --write --classify <tag>=ordinary|privileged --reviewed-in <pr:N|commit:sha|review:id:date>`; `database/migrations/**` is pinned
  to LF by `.gitattributes`. Verified **only** on disposable PostgreSQL 16.15 clusters (harness `pnpm --filter @saas-inventory/api
  test:migration-harness` with `MIGRATION_HARNESS_PG_BIN`; `tools/pg-verify` with `PG_VERIFY_PG_BIN`/`PG_VERIFY_PORT`). **Not complete protection:** the
  text scan does not see `GRANT`, `DISABLE ROW LEVEL SECURITY` and others (`MIG-SQL-RLS-LINTER`, accepted risk until its own delivery). See
  [docs/architecture/migration-integrity.md](docs/architecture/migration-integrity.md), [ADR-0041](docs/decisions/0041-migration-identity-and-history-integrity.md)
  and the `MIG-*` entries of [docs/roadmap/pending-register.md](docs/roadmap/pending-register.md). E1-B1 (whether `0032` took effect in any
  particular database) remains inconclusive.
