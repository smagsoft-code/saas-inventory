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
[ADR-0030](docs/decisions/0030-authentication-foundation.md). No other business functionality
exists yet: no product/inventory/order endpoints, no Telegram integration. See
[docs/roadmap/roadmap.md](docs/roadmap/roadmap.md) for the phase plan.
