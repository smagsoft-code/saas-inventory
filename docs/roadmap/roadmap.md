# Roadmap

High-level phase plan for the SaaS Inventory project. Phases are executed in order; each phase is
driven by its own prompt/spec and is only started once the prior phase is complete and reviewed.

The roadmap preserves the completed FASE 0–8 history exactly as implemented. Future phases expand
the original high-level roadmap to explicitly represent all architectural bounded contexts and
delivery concerns already defined by `modules.md`, `database.md`, and the ADRs.

## Completed phases

- **FASE 0 — Project Foundation** — monorepo scaffolding, tooling, governance docs. *(done)*

- **FASE 1 — Architecture** — formal architecture definition, bounded contexts, security model,
  architecture documentation and ADRs. *(done)*

- **FASE 2 — Infrastructure** — Docker, reverse proxy, development environments and infrastructure
  foundation. *(done)*

- **FASE 3 — Database** — PostgreSQL schema, Drizzle setup, migrations, constraints, indexes,
  tenant isolation and RLS strategy. *(done)*

- **FASE 4 — Authentication & Authorization** — authentication foundation, sessions, JWT guards,
  tenant context, RBAC integration and authorization infrastructure. *(done)*

- **FASE 5 — Tenant Administration** — tenant self-administration, users, roles and role assignment
  within the tenant, including escalation-prevention rules. *(done)*

- **FASE 6 — Catalog / Products** — categories, products, variants, dynamic attributes, governed
  JSONB attributes, three-tier pricing and price history. Brands and suppliers remain reference
  entities without CRUD, as defined by ADR-0019 and the approved scope. *(done)*

- **FASE 7 — Warehouses & Locations** — warehouses, hierarchical locations, default "General"
  location creation and user-location assignments with location-scoped authorization data.
  *(done)*

- **FASE 8 — Inventory** — inventory balances and movement history, manual stock adjustments,
  multi-location transfers, in-transit representation, concurrency-safe stock mutations,
  idempotency and location-scoped authorization. *(done)*

- **FASE 9 — QR** — QR generation and resolution workflows for products and locations, including
  public and authenticated resolution according to the established authorization and pricing rules.
  *(done)*

- **FASE 10 — Import / Excel Onboarding** — staged Excel import pipeline: dynamic template
  generation, upload, mapping, validation, preview, batch commit, initial inventory and the Import
  Worker as a separate deployable from the (not-yet-built) Event Processor, per ADR-0027/ADR-0029.
  A new `app_import_worker` Postgres role (migration 0019) and `import_jobs.claimed_at`/`claimed_by`
  claim-tracking columns (migration 0020) plus a supporting partial index (migration 0021) were
  added — real, necessary schema completions the pre-FASE-10 design left unfinished, not a
  redesign; see this phase's final report for the full rationale. *(done)*

- **FASE 11 — Administration & Tenant Configuration** — tenant-level configuration (`tenant_settings`:
  timezone, business hours) and the one system-level administration capability grounded in the
  existing architecture (platform-admin authentication, ADR-0032, plus tenant lifecycle management:
  list/suspend/activate a company), without duplicating CORE tenant/user/RBAC responsibilities
  already implemented in FASE 5. `notification_preferences`/branding and platform-level metrics/
  global configuration remain explicitly out of scope — see modules.md#administration and this
  phase's final report. *(done)*

- **FASE 12 — Customers, Cart & Orders / Sales** — SALES bounded context (`apps/api/src/sales/`):
  customers CRUD + per-tenant identification uniqueness + frozen customer snapshot; the vendor's
  single open cart with negotiated per-line pricing; orders / order items with frozen price
  snapshots; invoice-or-sales-note document type (the platform records the choice, never issues a
  fiscal document — ADR-0023); a two-phase inventory lifecycle — `POST /orders` reserves
  (`RESERVATION`) into `pending`, `POST /orders/:id/confirm` commits (`RESERVATION_RELEASE` +
  `SALE`) into `confirmed`, `POST /orders/:id/cancel` releases a still-`pending` reservation — all
  through `StockLedgerService` (SALES never writes `inventory_balances`); idempotent order creation
  via `idempotency_keys` (`scope = 'orders.create'`). Six new `sales.*` permission codes (migration
  0026). Selling serialized/lot-tracked variants is deferred (no approved `order_items` ↔
  `product_serials`/`product_lots` model — see this phase's final report and
  database.md#orders-conceptual--sales-not-built-yet). Exceptional (below-`min_price`) pricing,
  `price_approvals`, `sales_returns`, event-outbox writes and any frontend remain out of scope.
  *(done)*

- **FASE 13 — Sales Returns & Exceptional Pricing** — the two SALES-dependent workflows the
  `0009_sales` schema has carried since Prompt 03, implemented in `apps/api/src/sales/`.
  **Sales returns** (`sales_returns`/`sales_return_items`): a reversal traced to a **confirmed**
  order (never a second negative order, never a cancellation), `requested → inspecting → resolved`
  (or `→ cancelled`); `create` locks the `orders` row and validates every line against
  `returnable = sold − already-returned` under that lock; `inspect` records each line's disposition
  + re-entry location (ADR-0021: `restock` → a sellable location, `quarantine`/`damaged`/`scrap` →
  a non-sellable one); `resolve` writes one `RETURN` `inventory_movements` row per line through
  `StockLedgerService` (SALES never writes `inventory_balances` directly), idempotent via
  `idempotency_keys` (`scope = 'sales_return.disposition'`) + a deterministic ledger key. Two new
  permission codes (`sales.returns.view`/`sales.returns.create`, migration `0027`); `inspect`/
  `resolve` reuse `inventory.returns.manage`. **Exceptional-discount approvals**
  (`price_approvals`): order-first — a below-`min_price` line now creates the order `pending` with
  `order_items.is_exceptional_discount = true` (subject to the tenant hard floor,
  `tenant_price_policies.max_discount_below_min_percent`, read-only with defaults this phase);
  `POST /price-approvals` files the request bound to that line; `POST /orders/:id/confirm` is gated
  on every exceptional line having an `approved` request (never a permission-based bypass). Reuses
  `pricing.discount.request`/`pricing.discount.approve`; the requester can never approve their own
  request. No `event_outbox`/Telegram/n8n (FASE 14/15), no frontend (FASE 16/17); selling
  serialized/lot-tracked variants stays deferred. *(done)*

## Future phases

- **FASE 14 — Events & Outbox** — transactional domain-event publishing through the existing
  `event_outbox` design, reliable event claiming/retry behavior and the Event Processor.
  This phase must remain separate from the IMPORT Worker.

- **FASE 15 — n8n Integration & Notifications** — external automation through n8n, webhook
  consumption and Telegram notifications. Domain modules must not integrate directly with Telegram;
  they publish events and the notification path consumes them through the outbox architecture.

- **FASE 16 — Frontend Foundation** — Next.js App Router frontend foundation, API client,
  authentication/session integration, tenant context, permissions/RBAC integration, application
  shell, navigation, layouts, error handling, forms, tables and reusable UI primitives.

- **FASE 17 — Frontend Main Modules** — frontend implementation of the principal application
  modules using the established API contracts: administration, catalog, warehouses/locations,
  inventory, QR, import, customers, sales/orders and related operational workflows.

- **FASE 18 — Dashboards & Reports** — REPORTS bounded context, dashboards, operational reports,
  inventory reports, sales reports and cross-domain read-side queries. Reporting must remain
  separated from transactional write-path repositories.

- **FASE 19 — Security Hardening & Testing** — application-wide security review, threat-model
  validation, RLS verification, tenant-isolation testing, RBAC/authorization review, IDOR and
  mass-assignment testing, concurrency/security regression, dependency review and remediation of
  findings. Existing per-phase unit and integration testing remains mandatory and is not replaced
  by this phase.

- **FASE 20 — Observability** — production-grade structured logging, correlation/request IDs,
  health/readiness/liveness checks, metrics, error visibility, worker monitoring and operational
  observability for API, database, Event Processor and Import Worker.

- **FASE 21 — Production Deployment** — production Docker configuration, reverse proxy,
  environment configuration, secrets handling, database migration procedure, backups/restore
  strategy, deployment validation and production rollout.

- **FASE 22 — Seed / Demo Environment** — isolated demo tenant, synthetic catalog/inventory/sales
  data, reproducible seed process and demo reset/reinitialization strategy according to
  ADR-0014. Demo data must never compromise tenant isolation or production data.

- **FASE 23 — QA Integral** — complete end-to-end validation of the finished system across backend,
  frontend, database, security, concurrency, integrations, workers, reports, demo environment and
  production-like deployment. Includes regression of all previously completed phases and validation
  of critical business workflows.

- **FASE 24 — MVP Release** — final release readiness review, versioning, release artifacts,
  production acceptance criteria and public MVP release.

## Architectural scope notes

### Suppliers and Purchasing

`suppliers` is currently owned by CATALOG as a passive reference/attribution entity according to
ADR-0019. The current architecture deliberately does NOT define a PURCHASING bounded context or
purchase-order/receiving workflow.

Therefore, no dedicated PURCHASING phase is added to this roadmap at this time.

If a future business requirement introduces purchase orders, supplier receiving, supplier invoices,
purchase returns or procurement workflows, that capability must first receive an explicit
architectural design/ADR and then be inserted into the roadmap according to its dependencies.
It must not be inferred from the existence of the `suppliers` table.

### Audit, Domain Events and Outbox

These are distinct concerns:

- CORE owns the audit log and audit-write interface.
- Business modules generate domain events when appropriate.
- NOTIFICATIONS owns the transactional outbox and event-processing infrastructure.
- External automation such as n8n consumes events through the established outbox/event path.

Audit logging is therefore not postponed until FASE 19; every mutating module must continue to
produce the required audit records during its own implementation phase.

### Testing

Every implementation phase must continue to include:

- unit tests;
- integration tests;
- PostgreSQL-real verification where applicable;
- tenant-isolation tests;
- RBAC/authorization tests;
- regression tests;
- lint;
- typecheck;
- build verification.

FASE 19 is system-wide security hardening and FASE 23 is final integral QA; neither replaces
testing during individual feature implementation.

### Frontend

The backend remains the source of truth for authorization, tenant isolation and business rules.
The frontend must never be treated as a security boundary.

Next.js is the web client foundation according to ADR-0006. Flutter/mobile remains a separate
client implementation according to ADR-0025 and must consume the same backend contracts. Mobile
offline-first synchronization is not part of the MVP unless explicitly approved by a future
architectural decision.

### Import Worker vs Event Processor

The Import Worker and Event Processor are separate processes/deployables.

- IMPORT owns the staged Excel onboarding workflow.
- NOTIFICATIONS owns the event/outbox processing path.
- They may use similar PostgreSQL claiming/locking patterns but must not be merged into one worker.

### Phase execution rule

No future phase is considered started merely because its database tables already exist.

The schema may be prepared in an earlier database phase, while application behavior is implemented
only in the phase that owns the corresponding bounded context.

A phase is complete only after implementation, security verification, tests, regression checks and
explicit review/commit.

## Current status

FASE 0–13 are completed and committed.

FASE 14 (Events & Outbox) is the next phase to be started.

No future phase has been started merely by defining its database schema or architecture. In
particular, `event_outbox` (FASE 14) has existed, fully migrated, since Prompt 03, and still has
no application code — FASE 13 writes audit records but no domain events. Selling serialized /
lot-tracked variants remains a pending explicit design (no approved `order_items` ↔
`product_serials`/`product_lots` model, no serial/lot column on `inventory_movements`) — it is not
assigned to any phase yet.