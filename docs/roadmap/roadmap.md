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
  serialized/lot-tracked variants stays deferred. **PROMPT 013-A** (controlled correction) then
  verified the state-transition concurrency — `inspect`/`resolve`/`cancel` and `approve`/`reject`
  all serialize on `SELECT ... FOR UPDATE` (approvals also via a `WHERE status = 'pending'` CAS),
  so incompatible transitions on one return / one approval can never both win, a cancelled return
  never has inventory applied, a resolved return can never be cancelled, and a `SALE` never commits
  against a pending/rejected approval — **no functional bug found, no code change**, only new
  concurrency tests. *(done)*

- **FASE 14 — Events & Outbox** — transactional domain-event publishing and the Event Processor.
  `DomainEventPublisher` + `OutboxRepository` (`apps/api/src/common/events/`) are the single shared
  write API — `OrdersService`/`PriceApprovalsService`/`ReturnsService` call
  `append(tx, ...)` inside their existing `withTenantTransaction` on every real state transition, so
  the `event_outbox` row and the business mutation commit or roll back atomically. Eight versioned
  SALES events (`sales.order.confirmed`/`.cancelled`, `sales.price_approval.requested`/`.approved`/
  `.rejected`, `sales.return.requested`/`.resolved`/`.cancelled`), one per *logical* transition —
  HTTP retry / concurrent transitions never duplicate. Payloads are data-minimised (no
  `min_price`/`cost` — ADR-0028). The **Event Processor** (`apps/api/src/event-processor/` + its own
  `worker:events` deployable, `NestFactory.createApplicationContext`, no HTTP) claims via
  `FOR UPDATE SKIP LOCKED` over the dedicated `app_event_processor` role (blast radius =
  `event_outbox` only), with exponential capped backoff, stale-claim recovery, and a terminal
  `dead_letter` state — **no schema change, no migration** (`claimed_at` doubles as the last-attempt
  timestamp; ADR-0010 already accepted). It ships with an **empty delivery-handler registry**, so no
  event is ever marked `delivered` until FASE 15 registers an adapter — nothing is claimed while the
  registry is empty. Import Worker ≠ Event Processor (ADR-0029): separate entry point, DB role, and
  claim repository. pg-verify: 324 integration tests, 26 files, 0 skipped. *(done)*

- **FASE 15 — n8n Integration & Notifications** — the last segment of the notification path:
  `event_outbox → Event Processor → n8n delivery adapter → n8n → Telegram`. The **n8n delivery
  adapter** (`apps/api/src/event-processor/n8n/`) registers one `EventHandler` per SALES event
  (each pinned to `eventVersion = 1`, no `sales.*` wildcard) that `POST`s the unchanged v1 envelope
  to **one** generic n8n webhook (`N8N_EVENTS_WEBHOOK_URL`) over HTTPS, authenticated by a
  dedicated shared bearer secret (`N8N_EVENTS_AUTH_TOKEN`, sent only as `Authorization: Bearer`,
  runtime-env only — never Git/logs/payload/query string). `EventProcessorModule` binds
  `EVENT_HANDLERS` from config: `N8N_EVENTS_ENABLED=false` (default) → `[]` (nothing claimed,
  events stay `pending`); `=true` → fail-closed startup validation of URL/secret. Per-call
  `AbortController` timeout; `redirect: 'manual'` (a 3xx is never followed — the token is never
  resent to another host); only `2xx` is success; failures classified **retryable**
  (408/425/429/5xx, network/DNS/TLS/timeout — FASE 14 backoff/dead-letter unchanged) vs
  **permanent** (other 4xx, redirect → `PermanentDeliveryError` → `dead_letter` now); error bodies
  sanitised + truncated. The adapter does **no** domain lookups and adds **no** Postgres grant,
  **no** `tenants` join, **no** schema change / migration — `app_event_processor` keeps its
  `event_outbox`-only least privilege; a suspended tenant's already-committed events are still
  delivered (explicit FASE 15 decision). Domain modules
  (`OrdersService`/`ReturnsService`/`PriceApprovalsService`) are untouched — no HTTP call added,
  the only `SaaS → n8n` call is from the Event Processor deployable. **Telegram stays entirely in
  n8n** (ADR-0012): the backend stores no bot token, does no recipient routing, composes no
  message. **`notification_preferences` `PENDING DECISION` resolved:** routing lives in n8n keyed
  by the envelope's `tenantId`/`eventType` — no backend preference schema/endpoints, no frontend.
  At-least-once external delivery — the n8n workflow must dedupe durably on `eventId`; exactly-once
  Telegram is **not** claimed. New contract doc [integrations/n8n.md](../integrations/n8n.md).
  pg-verify: 339 integration tests, 27 files, 0 skipped (up from 324/26). **PROMPT 015-A**
  validated the whole path end to end against the operator's **real n8n** (v2.36.7) with a
  dedicated `SaaS Inventory — Event Notifications` workflow and a **test-only** Telegram
  destination — synthetic events seeded into a throwaway local `event_outbox`, delivered by the
  **real `dist/event-processor/main.js`**: `sales.order.confirmed` and
  `sales.price_approval.requested` both reached Telegram (`event_outbox` → `delivered`,
  `processed_at` set, `eventId` preserved, no price-floor/cost leak, no secret in any log); a
  re-sent identical `eventId` hit the workflow's **durable n8n Data Table dedupe** (`processing`/
  `completed` per `eventId`, `completed` written only after Telegram) → HTTP 200
  `duplicate-ignored`, no second message; a recent in-flight duplicate → HTTP 425 (retryable), no
  message. Dedupe is **durable but not proven-atomic** on concurrent first insert — the realistic
  concurrent case is covered by the 425 path; external delivery is **at-least-once-safe, not
  exactly-once**. No code change (a throwaway seed-script bug was found and fixed in the harness
  only; the real Drizzle producer is unaffected). *(done)*

- **FASE 16 — Frontend Foundation** — the reusable `apps/web` base for the authenticated SaaS
  admin app. **Same-origin transport:** `next.config.ts` now rewrites `/api/*` to `API_URL`, so
  browser session cookies are first-party in every environment (matching the Caddy prod topology,
  docs/deployment/docker.md) — the pre-existing cross-origin assumption that left the authenticated
  area unreachable in dev is gone; `NEXT_PUBLIC_API_URL` remains only as a cross-origin override.
  **API client** (`src/lib/api/`): one `apiFetch` for Server Components (forwards `cookies()`) and
  Client Components (`credentials: 'include'` + double-submit CSRF header on mutations); a
  normalised `ApiError` (`status`/`code`/`message`/`correlationId`) with per-status UX text that
  never echoes a 5xx body; `AbortSignal`, empty-body (204), `query`. **401 → single-flight
  `POST /auth/refresh` → one retry** on the browser only; never on 403/400/404/409/422/429/5xx,
  never the refresh call itself, never twice; a failed refresh emits one `session-expired` event
  and a single listener redirects to `/login?returnTo=…` (open-redirect-safe `safeReturnTo`).
  **Auth/session:** `getSession()` (React `cache()`-deduped `/auth/me`) gates the `(tenant)`
  layout for UX; `login-form.tsx` attempts one silent refresh (loop-guarded) before showing the
  form, so an expired-access/valid-refresh hard navigation restores without a flash of private
  content; a presence-only `middleware.ts` short-circuits obviously-unauthenticated navigations
  (never authorization). **Permissions:** `createPermissionChecker(session.permissions)` →
  `can`/`canAny`/`canAll` against the real backend codes (mirrored in `permission-codes.ts`);
  navigation is permission-filtered server-side; the backend stays the authority and a 403 is
  handled as a normal error. **App shell** (`src/components/shell/`): persistent desktop sidebar,
  mobile slide-over drawer (Esc/overlay/route-change close, scroll lock), header with tenant name
  and an accessible account menu (name/email/tenant, real backend logout). **UI foundation**
  (`src/components/ui/`): Button/ButtonLink, Input/Select/Textarea, Field (label/hint/error id
  wiring), Card, Alert, Badge, Spinner, Skeleton, EmptyState, ErrorState, PageHeader,
  PageContainer — small, composed, keyboard-accessible, no design-system dependency added.
  **Routing:** the `app/page.tsx` ↔ `(tenant)/page.tsx` `/` collision is resolved (dashboard owns
  `/`); `(tenant)` has `loading` (skeleton) / `error` (ErrorState) / `not-found`; root
  `not-found` + `global-error`. Existing `/settings`, `/users`, `/users/new`, `/users/[id]` now
  render through the shell + primitives with **no functional-scope change**. No new runtime
  dependency; no backend / DB / migration / n8n / worker change. web unit tests 12 → 33 (api
  errors, api client incl. refresh-retry & single-flight, permission checker, `safeReturnTo`,
  navigation filtering/active-path, login-form). Regression: `pg-verify` **339 integration tests,
  27 files, 0 skipped — PASS** (unchanged from FASE 15); api unit 459, typecheck + lint green;
  `pnpm --filter @saas-inventory/web build` compiles, type-checks and statically generates all 9
  routes, then fails at *Collecting build traces* on the **pre-existing Windows `EPERM` symlink**
  in Next.js standalone output-tracing (unchanged environmental issue, not introduced here).
  *(done)*

- **FASE 17 — Frontend Main Modules** — frontend implementation of the principal application
  modules using the established API contracts: administration, catalog, warehouses/locations,
  inventory, QR, import, customers, sales/orders and related operational workflows. Includes (noted
  during PROMPT 015-A) a **notification status** indicator on the sales history / order detail view
  (`sent` / `pending` / `not sent`, derived from the order's `event_outbox` state). The
  authorized-admin **"retry notification"** action is deferred: no backend re-enqueue/re-deliver
  endpoint exists yet (`GAP-NOTIF-RETRY-BACKEND`), so the order-detail card shows status only.
  Delivered as F17-01…F17-14, **43/43 screens**; frontend-only, no backend/DB/migration change;
  see the per-sub-phase reports. *(done)*

- **FASE 18 — Dashboards & Reports** — REPORTS bounded context, operational read-side queries and
  the home dashboard. Nine read-side modules (`GET /reports/sales-summary`,
  `/inventory-summary`, `/movements-summary`, `/transfers-summary`, `/returns-summary`,
  `/approvals-summary`, `/imports-summary`, plus `/platform/summary`), each with its own
  repository/service/controller, half-open `[from,to)` date semantics, and no dependency on the
  transactional write-path repositories. Surfaced in the frontend as report sections embedded in
  the existing `/approvals`, `/imports`, `/inventory` pages and the `/` home KPIs — there is no
  standalone `/reports` route. Commits `c79d93a`…`1a50133`; migration `0030` (movements
  `occurred_at` index) is the only schema change. *(done)*

## Work after FASE 18 (outside the numbered phases)

Between 2026-09-10 (QA 5S, `develop` at `1a50133`) and 2026-10-26 (HEAD `2215f5d`) the repository
gained 61 commits after the last roadmap commit (`6fcfb79`) and migrations `0031`–`0050`. None of it
was a numbered phase. Each block lists what the code/commit history shows; **"validated" means a
re-runnable proof exists, which for most blocks it does not yet** — see
[pending-register.md](pending-register.md) (`PG-VERIFY-FULL-RUN`). Commit hashes are the evidence.

| Block | Delivered (per commits / migrations / ADRs) | Validation state |
| --- | --- | --- |
| **QA campaign 5A–5S** (2026-09) | Functional QA over the finished system; not a development phase. 5R/5R-A: outbox → Event Processor → n8n → Telegram, 2-layer idempotency, 5 `dead_letter` rows replayed to `delivered` after the operator fixed the n8n workflow. 5S: second tenant, cross-tenant/IDOR + RLS probes (all 404/denied), public QR resolver, HTTP-level page loads. | Results recorded in prose and session notes only; raw evidence files are **not** in the repo (`QA-EVIDENCE-PERSISTENCE`). Visual/interaction regression **never run**. |
| **Roles & permissions + warehouse scope** (`c8d3305`) | Role CRUD, `core.roles.manage` (migration `0032`), ADR-0034 (role-permission self-escalation), ADR-0035 (zero location assignments now denies, except the founding Administrador); `TransfersService.create` now checks the source location. | Integration tests exist; a passing run on an isolated instance was reported, not re-run. |
| **Tenant onboarding + support** (`4c1e31a`, `abdbba3`) | `POST /platform/tenants` with invitation acceptance, audited time-boxed support sessions, migration `0033`, ADR-0036. | 2 integration files; passing run reported (50/50), not re-run. |
| **Login & Users UI** | "Crear cuenta" removed from `/login`; login/user identifier relaxed from email to a 10+ character string; `GET /users?q=`. | Reported in `CLAUDE.md`; the 557-test run it cites had 5–7 failures attributed to contention without proof. |
| **Inventory / Kardex** (`1283de8`, `07d6fc3`, `2e5eded`) | Costed Kardex, `GET /reports/kardex`, weighted-average cost (ADR-0037, migration `0034`), rebuilt movements history. | Code present; no recorded real-PostgreSQL run for later fixes. |
| **Transfers overhaul** | Transfer codes (`0035`), tenant-configurable approval/preparation workflow (`0036`), modal actions, date filter, product search. | As above. |
| **Sales rework** (`24cc91b`, `b198a7d`, `3bae5aa`, `bdbd28e`, …) | Split payments (`0039` `order_payments`), PDF export by browser print (ADR-0038), approver price editing with an `order_items` price-edit grant (`0040`), return numbers (`0041`), `sales.orders.view_all` seller scope (`0044`), confirmed-order date backfill (`0047`), approval numbers (`0050`), exports and payments report, customers redesign (`0037`). **The exceptional-discount trigger moved from `min_price` to `base_price`** (ADR-0022 amendment of 2026-10-05, `base_price_at_request` in `0038`; `min_price` stays the hard floor) — FASE 12/13 text elsewhere still says "below `min_price`" (`DOC-ADR0022-TRIGGER-DRIFT`). **Also includes a change to separation of duties — see `DECISION-SELF-APPROVAL`.** | As above. |
| **Catalog & stock loading** | Category codes and SKU prefix (`0042`), uppercase names (`0043`), `draft` product status removed (`0045`–`0046`), bulk stock load from Excel, import pipeline fixes, bulk/printable QR. | As above. |
| **Home & tenant branding** (`88acde0`, `0048`) | Home KPIs with per-warehouse filter and yearly trend chart; tenant logos. | As above. |
| **UI/UX redesign** | Spanish UI, 64 px hover-expand navigation rail, mobile tab bar, and phone layouts for transfers, new sale, order detail, payments, approvals, returns and movements (≈35 web commits, 2026-10-22…26). The design tokens, blue primary and Lotes 2–3 of `UI-UX-SPEC-001` were **not** delivered — see `UIUX-SPEC-VS-IMPLEMENTATION`. | Unit tests only; no browser regression. |

## Future phases

None of FASE 19–24 has been started: no commit, ADR or document of this repository delivers any of
their scope (verified in `git log` on 2026-10-26). Pre-existing building blocks (the `/health`
route, `docker-compose.prod.yml`, `docs/security/threat-model.md`, a demo seed script) predate the
phases and do not count as phase work (see the phase execution rule below).

- **FASE 19 — Security Hardening & Testing** — application-wide security review, threat-model
  validation, RLS verification, tenant-isolation testing, RBAC/authorization review, IDOR and
  mass-assignment testing, concurrency/security regression, dependency review and remediation of
  findings. Existing per-phase unit and integration testing remains mandatory and is not replaced
  by this phase. It should start by closing the open security items in
  [pending-register.md](pending-register.md) (`GAP-F19-PARSE-UUID`, `GAP-F19-EMPTY-BODY`,
  `GAP-F19-RLS-IDOR-DEPTH`, `PG-VERIFY-FULL-RUN`) and the owner decision `DECISION-SELF-APPROVAL`.

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

  > **Pending owner decision:** a proposal to redefine FASE 22 (scenario-based demo preparation,
  > `DEMO-01…DEMO-12` + "Reset Demo") and FASE 23 ("use and destroy/repeat" QA over it) is recorded
  > in `UI-UX-SPEC-001.md` §22.3 and **has not been applied** to the rows above
  > (`ROADMAP-F22-F23-SPLIT`).

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

### Verified status — 2026-10-26

- **Repository:** branch `develop`, HEAD `2215f5d`, clean working tree, 119 commits,
  **no upstream configured — nothing has been pushed**. Migrations `0000`–`0050` (51 files); ADRs `0001`–`0038`.
- **Numbered phases:** FASE 0–18 implemented and committed. FASE 19–24 **not started**.
- **Work after FASE 18** (roles, onboarding/support, Kardex, sales rework, UI/UX redesign, …) is
  implemented and committed but **not formally validated** — see "Work after FASE 18" above.
- **Tests (run 2026-10-26):** `apps/api` unit 778 passed (70 files); `apps/web` unit 1009 passed
  (138 files) with **1 unhandled error that makes `pnpm test` exit non-zero**
  (`DEFECT-WEB-TEST-UNHANDLED`). **No full real-PostgreSQL run exists for the current tree**
  (52 integration files; last full totals 503/40 and 557/43 are outdated and the latter had failures)
  — `PG-VERIFY-FULL-RUN`.
- **Notifications:** backend flag `N8N_EVENTS_ENABLED=false` by default; the n8n → Telegram path was
  validated end to end in 015-A and 5R/5R-A against a test destination; which event types produce a
  Telegram message is defined in the operator's n8n workflow, not in this repository — 5S notes
  report 3 of 8, unconfirmed and pending an owner definition (`GAP-NOTIF-COVERAGE`). Operational notifications are not enabled by
  this documentation pass. Retry from the UI does not exist (`GAP-NOTIF-RETRY-BACKEND`).
- **Open items:** every pending security item, defect, limitation, verification gap and owner
  decision is in [pending-register.md](pending-register.md). Headline items: `GAP-F19-PARSE-UUID`,
  `GAP-F19-RLS-IDOR-DEPTH`, `DECISION-SELF-APPROVAL`, `DEFECT-TZ-DEFAULT-UNSETTABLE`,
  `LIMIT-SERIALIZED-LOT-SALES`, `UIUX-SPEC-VS-IMPLEMENTATION`, `ROADMAP-F22-F23-SPLIT`.
- **Next phase:** FASE 19, starting with the register's verification items.

### Narrative history (as of 2026-09-10, kept unchanged)

FASE 0–16 are completed and committed. FASE 15 is closed: the implementation is verified locally
(pg-verify 339/27/0) **and** the full path was validated end to end against the operator's real
n8n instance and a test Telegram destination in PROMPT 015-A (synthetic data, throwaway local
database, no production SaaS DB) — see
[integrations/n8n.md#real-validation--prompt-015-a](../integrations/n8n.md#real-validation--prompt-015-a).
PROMPT 015-B aligned the n8n dedupe-timestamp documentation.

FASE 16 is closed: `apps/web` now has the authenticated application foundation — same-origin API
transport, a centralised API client with normalised errors and single-flight 401 refresh/retry,
`getSession()`/permission helpers, the responsive app shell + navigation registry, reusable UI
primitives, and route-level loading/error/not-found boundaries — with the existing tenant/user
pages moved onto it and no functional-scope change. No backend, database, migration, n8n or
worker change; pg-verify unchanged at 339/27/0.

FASE 17 is closed: **43/43 frontend screens** delivered across F17-01…F17-14 against the existing
API contracts (frontend-only, no backend/DB/migration change). FASE 18 is closed: nine read-side
report modules (`/reports/*` + `/platform/summary`) plus the home dashboard, migration `0030` the
only schema change, commits `c79d93a`…`1a50133` (HEAD).

**Fase 5 QA campaign** (5A–5S) is a functional-QA pass over the completed system — not a
development phase, and not a source of functional commits. Run against `develop` HEAD `1a50133`
with an ephemeral local Postgres and a persistent QA tenant (`qa-tenant`). 5L–5R covered returns,
exceptional pricing, import, administration, reports, platform lifecycle and the notification
path; **5R/5R-A** validated `event_outbox → Event Processor → n8n → Telegram` end to end
(2-layer idempotency, retry, dead-letter, replay); **5S** added a second tenant (`qa-tenant-2`)
for real cross-tenant/IDOR + RLS isolation testing (all cross-tenant access `404`, RLS denies),
the public QR resolver, a frontend page-load regression, and the remaining 5R checks
(retryable→dead-letter, suspended-tenant delivery). Open items are tracked as `GAP-F19-*`
(ParseUUID / additional RLS-IDOR), `GAP-NOTIF-RETRY-BACKEND`, `DEFECT-TZ-DEFAULT-UNSETTABLE`, a
UI/UX backlog, and two n8n-workflow corrections applied operator-side. The authoritative status is
each phase's final report.

**FASE 19 (Security Hardening & Testing) is the next phase to be started** (optionally preceded by
a UI/UX specification pass — `UI-UX-SPEC-001` — for the non-blocking frontend findings 5S deferred).
*(As of 2026-10-26: the UI/UX pass happened only partially — see "Work after FASE 18"; FASE 19 has
still not started.)*

No future phase has been started merely by defining its database schema or architecture. FASE 14
gave `event_outbox` (migrated since Prompt 03) its first application code — transactional publishing
from SALES and the Event Processor deployable. **FASE 15 closed the loop**: the Event Processor now
registers an n8n delivery handler (`apps/api/src/event-processor/n8n/`) that `POST`s each claimed
envelope to one generic n8n webhook over authenticated HTTPS — no schema change, no migration, no
new Postgres grant. The backend still stores **no** Telegram token and makes no direct Telegram
call — n8n owns the Telegram credential and all routing/composition (ADR-0012). With
`N8N_EVENTS_ENABLED=false` the handler is not registered and nothing is claimed, exactly as in
FASE 14 — this is the state the Fase 5 QA campaign leaves the local environment in. Selling
serialized / lot-tracked variants remains a pending explicit design (no approved
`order_items` ↔ `product_serials`/`product_lots` model, no serial/lot column on
`inventory_movements`) — it is not assigned to any phase yet.

**Deferred (owner decision):** a monetary refund registry for sales returns is **not** started —
returns remain product-only. See [future-refunds.md](future-refunds.md) for the current state, the
proposal and the open decisions.
