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
