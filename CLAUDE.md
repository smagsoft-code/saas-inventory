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
