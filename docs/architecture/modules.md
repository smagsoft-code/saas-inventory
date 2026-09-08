# Modules / Bounded Contexts

This defines the module map for the NestJS modular monolith (see [backend.md](backend.md)) and,
conceptually, for the domain model overall. Each module below is a **bounded context**: it owns
its data, exposes a narrow interface to other modules, and no other module reaches into its tables
directly.

None of these modules are implemented yet. This document defines responsibility, boundaries, and
dependency direction so implementation (starting with Prompt 02 — database design) has a map to
follow.

## Dependency rule

Dependencies point one way, shown top-to-bottom below. A module may depend on modules above it,
never below or sideways without going through an explicit interface. Cross-module communication
that isn't a direct synchronous call (e.g. "notify sales when stock changes") goes through domain
events on the [outbox](events.md), not a direct import.

```mermaid
flowchart TB
    Core["CORE\ntenants, users, roles, permissions, audit"]
    Catalog["CATALOG\nproducts, categories, brands, suppliers, attributes, images"]
    Inventory["INVENTORY\nwarehouses, locations, inventory, movements, adjustments, transfers"]
    QR["QR\nproduct QR, location QR"]
    Sales["SALES (future)\ncustomers, cart, orders"]
    Notifications["NOTIFICATIONS\nevents, outbox"]
    Reports["REPORTS (future)\ndashboards, reports"]
    Admin["ADMINISTRATION\ntenant settings, system settings"]
    Demo["DEMO\ndemo tenant/users/data"]
    Import["IMPORT\nimport jobs, staging, mapping templates"]

    Catalog --> Core
    Inventory --> Core
    Inventory --> Catalog
    QR --> Catalog
    QR --> Inventory
    Sales --> Core
    Sales --> Catalog
    Sales --> Inventory
    Reports --> Core
    Reports --> Catalog
    Reports --> Inventory
    Reports --> Sales
    Admin --> Core
    Notifications -. "consumes events from all modules\nvia outbox, not direct calls" .-> Core
    Notifications -. " " .-> Catalog
    Notifications -. " " .-> Inventory
    Notifications -. " " .-> Sales
    Demo --> Core
    Demo --> Catalog
    Demo --> Inventory
    Demo --> Sales
    Import --> Core
    Import --> Catalog
    Import --> Inventory
```

## CORE

**Responsibility:** the identity and access substrate every other module depends on — who the
tenant is, who the user is, what they're allowed to do, and a record of what happened.

- `tenants` — the list of companies (global, no `tenant_id` on this table itself).
- `users` — tenant-scoped user accounts.
- `roles`, `permissions` — see [ADR-0009](../decisions/0009-rbac-permissions.md).
- `audit` — the audit log (see [Audit](#audit) below).

**Depends on:** nothing else (it is the foundation).

**Exposes to other modules:** tenant context resolution, permission checks, an audit-write
interface.

**Implemented in `apps/api/src/core/` (Prompt 05-A):** self-administration of the caller's own
tenant (`GET`/`PATCH /tenant`) and its users (`GET`/`POST /users`, `GET`/`PATCH /users/:id`), plus
read-only role listing for assignment (`GET /roles`) — reusing `auth/`'s `UsersRepository`/
`RolesRepository`/`TenantsPlatformRepository` rather than a parallel data-access layer. The
audit-write interface this section promises is `common/audit/audit-log.service.ts`, a thin insert
wrapper around the already-provisioned `audit_log` table. Role/permission CRUD (custom roles,
per-role permission toggling) is not implemented — see
[ADR-0031](../decisions/0031-role-assignment-escalation-prevention.md) and the roadmap for what's
deliberately out of this phase's scope.

## CATALOG

**Responsibility:** what a tenant sells — products and the taxonomy around them, including the
per-tenant/per-category dynamic attribute system that governs what a product's flexible data can
contain, and the bulk-onboarding path (Excel import) that populates the catalog and initial stock at
scale. Deliberately generic; see the product model design in
[database.md#catalog-products-variants-attributes](database.md#catalog-products-variants-attributes)
and [ADR-0017](../decisions/0017-product-variant-attribute-model.md) (Prompt 02); the attribute
governance layer in
[database.md#dynamic-attributes-governance-for-the-catalog-jsonb](database.md#dynamic-attributes-governance-for-the-catalog-jsonb)
and [ADR-0026](../decisions/0026-dynamic-attribute-system.md) (Prompt 02-B); and the import pipeline
in [database.md#excel-import-pipeline](database.md#excel-import-pipeline) and
[ADR-0027](../decisions/0027-staged-excel-import-pipeline.md) (Prompt 02-B).

- `products`, `product_variants`, `categories`, `brands`, `product_images`.
- `suppliers` — a passive reference/attribution entity ("who this product is sourced from"), placed
  here rather than under SALES or a not-yet-existing PURCHASING module; see
  [ADR-0019](../decisions/0019-suppliers-ownership.md) for why. No purchase-order/receiving workflow
  is in scope.
- `attribute_definitions`, `attribute_options`, `category_attributes`, `measurement_units` — the
  metadata that validates every product/variant's `attributes` JSONB; see
  [ADR-0026](../decisions/0026-dynamic-attribute-system.md).

**Implemented in `apps/api/src/catalog/`** (Prompt 06) — categories (+ the attribute-governance
assignment layer), `attribute_definitions`/`attribute_options` CRUD, products + variants (always
created together, per ADR-0017), the shared `AttributeValidationService` enforcing §Dynamic
attributes' governed-JSONB rules on every create/update (including category-change re-validation),
and `product_price_history` writes on every price change. `products.view`/`products.manage`/
`categories.view`/`categories.manage` (migration `0015`) plus the existing `catalog.attributes.manage`
gate it via the same `PermissionsGuard` every other module uses. **Not implemented in this phase**
(deliberately, each already scoped to its own module/phase elsewhere in this document): brands/
suppliers CRUD (schema-ready, assignable by id only), QR, the Excel IMPORT pipeline below (needs its
own Import Worker deployable, [ADR-0029](../decisions/0029-import-worker-separation.md)), and the
`price_approvals` exceptional-discount workflow (SALES-dependent, see below).

**Depends on:** CORE (tenant scoping, audit).

**Consumed by:** INVENTORY (a stock record refers to a product), SALES (a cart/order line refers to
a product), QR (a product can have a QR code), IMPORT (populates CATALOG data), REPORTS.

## INVENTORY

**Responsibility:** where stock physically is and how it moves, including stock moving *between*
locations and stock in transit. See [Inventory](#inventory-and-locations-summary) below and the
Inventory Flow diagram; full schema and concurrency design (row locking, idempotency) in
[database.md#inventory-warehouses-locations-balance-ledger](database.md#inventory-warehouses-locations-balance-ledger)
and [database.md#concurrency-strategy](database.md#concurrency-strategy) (Prompt 02); multi-location
transfers, in-transit representation, and location-scoped authorization in
[database.md#inventory-transfers-and-in-transit-stock](database.md#inventory-transfers-and-in-transit-stock)
and [database.md#location-scoped-authorization](database.md#location-scoped-authorization)
(Prompt 02-A, [ADR-0020](../decisions/0020-multi-location-inventory-transfers.md),
[ADR-0024](../decisions/0024-location-scoped-authorization.md)).

- `warehouses`, `locations` (hierarchical, `is_sellable`-flagged), `inventory_balances`,
  `inventory_movements`, `stock adjustments`, `inventory_transfers`/`inventory_transfer_items`/
  `inventory_transfer_receipts`/`inventory_transfer_receipt_items`, `user_location_assignments`.

**Depends on:** CORE, CATALOG.

**Consumed by:** SALES (reserving/committing stock for an order, receiving returned stock), QR (a
location can have a QR code), REPORTS.

## QR

**Responsibility:** generating and resolving QR codes that point at a product or a location. See
[api.md](api.md) for how a scanned QR resolves through the API.

**Depends on:** CATALOG (product QR), INVENTORY (location QR).

**Consumed by:** nothing depends on QR — it is a leaf module.

## SALES

**Responsibility:** the commerce flow — a vendor builds a cart, which becomes an order (with a
negotiated price, an invoice-or-sales-note choice, and a frozen customer snapshot), which consumes
inventory, and which may later be returned. Full schema in
[database.md#cart](database.md#cart), [database.md#orders-conceptual--sales-not-built-yet](database.md#orders-conceptual--sales-not-built-yet),
[database.md#pricing-history-tenant-policy-and-exceptional-discount-approval](database.md#pricing-history-tenant-policy-and-exceptional-discount-approval),
and [database.md#sales-returns-and-disposition](database.md#sales-returns-and-disposition)
(Prompt 02-A, [ADR-0021](../decisions/0021-sales-returns-disposition.md),
[ADR-0022](../decisions/0022-pricing-tiers-and-discount-approval.md),
[ADR-0023](../decisions/0023-document-type-and-external-invoicing.md)).

- `customers`, `carts`/`cart_items`, `orders`/`order_items` (FASE 12). `price_approvals`,
  `sales_returns`/`sales_return_items` — application behavior added in FASE 13 (below).

**Depends on:** CORE (tenant scoping, audit), CATALOG (reads `product_variants`/`products` directly
for price + sellability — SALES must validate a negotiated price against `min_price` server-side
even for a caller who cannot *see* it, ADR-0028), INVENTORY (`StockLedgerService` — the one stock
locking convoy; `LocationAuthorizationService` — ADR-0024; `LocationsRepository` /
`InventoryBalancesRepository`).

**Implemented in `apps/api/src/sales/` (FASE 12):**

- **Customers** — `GET/POST /customers`, `GET/PATCH /customers/:id`, search by
  displayName/taxId/email/phone. `taxId` (identification) is unique per tenant, never globally
  (`customers_tenant_id_tax_id_key`). Soft-deleted, never physically removed (historical orders
  still reference `customer_id`). `sales.customers.view`/`sales.customers.manage` (migration 0026).
- **Cart** — a singular `/cart` resource owned by the authenticated vendor (`carts.user_id`); one
  open cart per vendor (enforced in-service via `findOpenByUser` + a `pg_advisory_xact_lock`, not a
  new unique index). `GET /cart`, `POST /cart`, `PATCH /cart`, `POST/PATCH/DELETE /cart/items[/:id]`.
  No inventory is reserved by cart edits (database.md#cart's explicit design) — availability is a
  live read shown for guidance. `sales.carts.manage`.
- **Orders** — `GET /orders`, `GET /orders/:id`, `POST /orders` (checkout, `Idempotency-Key`
  required), `POST /orders/:id/confirm`, `POST /orders/:id/cancel`. Two-phase lifecycle:
  `POST /orders` validates everything under lock, freezes the customer + per-line price snapshots,
  writes a `RESERVATION` movement per line and creates the order `pending`; `confirm` writes
  `RESERVATION_RELEASE` + `SALE` per line (the inventory commit boundary) and moves to `confirmed`;
  `cancel` releases a still-`pending` reservation (`RESERVATION_RELEASE`) and moves to `cancelled` —
  a `confirmed` order can only be reversed by a sales return (FASE 13), never cancelled.
  `confirm`/`cancel` serialize on a `SELECT ... FOR UPDATE` of the `orders` row (PROMPT 012-A), so
  concurrent transitions on one order are exactly-once — see
  [database.md#fase-12-application-behavior](database.md#fase-12-application-behavior).
  `sales.orders.view`/`.create`/`.cancel`.
- **Document type** — `invoice` records `invoice_status = 'pending'` for a later external process;
  `sales_note` carries a NULL `invoice_status`. The platform never issues a fiscal document
  (ADR-0023). Both document types require the **same** complete commercial customer record
  (display_name/taxId/email/phone/address) to close the sale — they differ only by document type /
  invoice status, never by required buyer data (PROMPT 012-A).
- **Pricing** — a per-line negotiated price within `[min_price, max_price]` completes. Above
  `max_price` is always invalid (400). A price **below `min_price`** — from FASE 13 — is an
  exceptional discount: it creates the order `pending` with `order_items.is_exceptional_discount =
  true` (never silently bypassing the floor), subject to the tenant hard floor
  (`tenant_price_policies.max_discount_below_min_percent`), and its order cannot be confirmed until
  a `price_approvals` request for that line is approved. See **FASE 13** below.

**Added in FASE 13** (`apps/api/src/sales/pricing/`, `apps/api/src/sales/returns/`):

- **Exceptional-discount approvals** — order-first (ADR-0022, database.md#orders "confirmation is
  gated on price approvals"). `POST /price-approvals` (`pricing.discount.request`) files a request
  bound to one `order_items` row of a still-`pending` order; the server derives the price / tier
  snapshots from that frozen line (never from the client). `POST /price-approvals/:id/approve` and
  `/reject` (`pricing.discount.approve`) are conditional `UPDATE ... WHERE status = 'pending'`
  transitions; the requester can **never** resolve their own request (separation of duties,
  enforced in the service — the schema does not force it). `OrdersService.confirm` reads
  `tenant_price_policies.exceptional_discount_requires_approval` (default `true`, read-only this
  phase) and, when set, blocks confirmation (409) unless every exceptional line has an `approved`
  request and none is `pending` — `lockByOrder` row-locks the approvals so a concurrent
  approve/reject serializes against confirmation (lock order: `orders` → `price_approvals` →
  `inventory_balances`). `min_price` in an approval response is gated on `pricing.floor.view`
  (ADR-0028); `discount_amount` is computed against `max_price` so it never leaks the floor.
- **Sales returns / disposition** — a reversal traced to a **confirmed** order, never a second
  negative order, never a cancellation. `POST /sales-returns` (`sales.returns.create`,
  `Idempotency-Key`) locks the `orders` row and validates every line against
  `returnable = sold − Σ(non-cancelled returns)` under that lock. `POST /sales-returns/:id/inspect`
  (`inventory.returns.manage`) records each line's `disposition` + `disposition_location_id`
  (ADR-0021: `restock` → an `is_sellable` location, `quarantine`/`damaged`/`scrap` → a
  non-sellable one — enforced) and location authorization. `POST /sales-returns/:id/resolve`
  (`inventory.returns.manage`, `Idempotency-Key`) writes one `RETURN` `inventory_movements` row per
  line through `StockLedgerService` (SALES never writes `inventory_balances` directly), locking the
  return row so concurrent processing is exactly-once. `POST /sales-returns/:id/cancel`
  (`sales.returns.create`). Returns never mutate the original order / `order_items`.
  **PROMPT 013-A** verified that `inspect`/`resolve`/`cancel` all take the same `SELECT ... FOR
  UPDATE` on the `sales_returns` row as their first DB op (status re-read under the lock), so two
  incompatible transitions on one return are serialized by PostgreSQL — `resolve` vs `cancel`
  yields `resolved`+inventory **xor** `cancelled`+none, never a mix; a terminal return is
  immutable; `inspect` is atomic; a failed `resolve` rolls back every `RETURN` it wrote. Same for
  `price_approvals` (`approve`/`reject` = `FOR UPDATE` + a `WHERE status = 'pending'` CAS, audit
  only on the winning transition) — see
  [database.md#fase-13-application-behavior](database.md#fase-13-application-behavior).

**FASE 14 — domain events.** `OrdersService`/`PriceApprovalsService`/`ReturnsService` now call
`DomainEventPublisher.append(tx, ...)` inside their existing `withTenantTransaction` on every real
state transition (`sales.order.confirmed`/`.cancelled`, `sales.price_approval.requested`/`.approved`/
`.rejected`, `sales.return.requested`/`.resolved`/`.cancelled` — one per *logical* transition, not
per HTTP request), so the `event_outbox` row commits or rolls back atomically with the sale. SALES
still has no knowledge of n8n/Telegram — it publishes a generic, Telegram-agnostic, data-minimised
envelope (no `min_price`/`cost` — ADR-0028) and the Event Processor delivers it later. Payloads and
the full catalog: [events.md#event-catalog](events.md#event-catalog).

**Still deliberately not built** (each a later phase): selling serialized/lot-tracked variants (no
approved `order_items` ↔ `product_serials`/`product_lots` linkage, no serial/lot column on
`inventory_movements` — the same "not fully pinned" gap FASE 8/10/12 flagged; a `422`); Telegram/n8n
and external delivery (FASE 15); any frontend (FASE 16/17).

## NOTIFICATIONS

**Responsibility:** turning domain events into outbound notifications without coupling any other
module to *how* a notification is delivered. See [events.md](events.md) in full and
[database.md#outbox](database.md#outbox) for the `event_outbox` table shape and the
`FOR UPDATE SKIP LOCKED` claiming pattern that lets multiple Event Processor instances share the
queue safely.

> **Status:** **FASE 14** built the transactional write path and the Event Processor deployable
> (claim / retry / backoff / stale recovery / dead-letter). **FASE 15** added the **n8n delivery
> adapter** (`apps/api/src/event-processor/n8n/`): with `N8N_EVENTS_ENABLED=true` the Event
> Processor registers one handler per SALES event and `POST`s each claimed envelope to a single
> generic n8n webhook over authenticated HTTPS. n8n owns routing, message composition, and the
> Telegram credential (ADR-0012). With the adapter disabled the registry is empty and nothing is
> claimed. See [integrations/n8n.md](../integrations/n8n.md).

- `event_outbox` (the outbox table) — owned here. `DomainEventPublisher` +
  `OutboxRepository` ([`apps/api/src/common/events/`](../../apps/api/src/common/events/)) are the
  **single** shared write API; producer modules get them as providers (like `AuditLogService`),
  never via a module import — so there is no `SALES → NOTIFICATIONS` edge.
- Event Processor: `apps/api/src/event-processor/` + its own deployable
  (`event-processor/main.ts`, `worker:events:start`), authenticating as the dedicated
  `app_event_processor` Postgres role (blast radius = `event_outbox` only).
- n8n delivery adapter (FASE 15): `apps/api/src/event-processor/n8n/` — one `EventHandler` per
  SALES event forwarding the claimed envelope to `N8N_EVENTS_WEBHOOK_URL` over authenticated
  HTTPS. No new Postgres grant, no `tenants` join, no schema change. Telegram routing + credential
  are entirely n8n's (ADR-0012). FASE 15 did **not** add `notification_preferences` — routing
  lives in n8n. See [integrations/n8n.md](../integrations/n8n.md).

**Depends on:** nothing (it only reads events written by other modules' transactions). The Event
Processor is a distinct process from IMPORT's Import Worker below
([ADR-0029](../decisions/0029-import-worker-separation.md)) — they share the same claiming pattern
but never the same deployable, DB role, or claim repository, so a large import can never delay a
notification or vice versa.

**Consumed by:** nothing inside the backend — its only consumer is the external Event Processor
deployable, which (from FASE 15) forwards to n8n.

## REPORTS

**Responsibility:** read-side aggregation across CORE/CATALOG/INVENTORY/SALES for dashboards and
reports. Built as read-optimized queries, one dedicated repository/service/controller per domain
under `apps/api/src/reports/<domain>/` — never reusing the transactional write-path repositories
(`OrdersRepository`/`OrderItemsRepository`, `InventoryBalancesRepository`/
`InventoryMovementsRepository`, etc.). Materialized views / a read replica remain a future option,
not needed yet at current scale.

**Implemented in `apps/api/src/reports/`:**
- **`sales/` (F18-02, extended F18-06):** `GET /reports/sales-summary` (`sales.orders.view`) —
  day/week/month/product/customer grouping over `orders`/`order_items`, half-open `[from, to)`,
  tenant timezone resolved server-side. **F18-06** added an `exceptional=all|only|exclude` filter
  over the frozen `order_items.is_exceptional_discount` flag (`GAP-EXCEPTIONAL-FILTER`, partially
  resolved) — order grain via `EXISTS` for the period/customer groupings, line grain for `product`;
  never a `price_approvals` join (an exceptional line can have no approval row). See
  [reporting/reports.md#rep-sales-by-period--rep-sales-by-product--rep-sales-by-customer](../reporting/reports.md#rep-sales-by-period--rep-sales-by-product--rep-sales-by-customer).
- **`inventory/` (F18-03):** `GET /reports/inventory-summary` (`inventory.view`) — available/
  reserved/out-of-stock aggregation over `inventory_balances`, grouped by warehouse or category; a
  live snapshot (no period, no `from`/`to` — `inventory_balances` carries no history to bucket by).
  Also closed in F18-03: `occurredFrom`/`occurredTo` on the pre-existing `GET
  /inventory/movements` (an F17 operational list, not a REPORTS endpoint — the date filter lives on
  `apps/api/src/inventory/movements/`, not under `reports/`). See
  [reporting/reports.md#rep-inv-summary--inventory-summary-availablereservedout-of-stock](../reporting/reports.md#rep-inv-summary--inventory-summary-availablereservedout-of-stock).
- **`returns/` (F18-04):** `GET /reports/returns-summary` (`sales.returns.view`) —
  day/week/month/product/customer/disposition grouping over `sales_returns`/`sales_return_items`
  joined to `order_items` for the frozen `unit_price_snapshot`, half-open `[from, to)` on
  `sales_returns.created_at` (`GAP-RETURN-RESOLVED-AT` — no `resolved_at` column exists), `status`
  filter (default `resolved`). Never `SalesReturnsRepository`/`SalesReturnItemsRepository`. See
  [reporting/reports.md#rep-ret-by-disposition](../reporting/reports.md#rep-ret-by-disposition).
- **`approvals/` (F18-05):** `GET /reports/approvals-summary` (`pricing.discount.approve`) —
  `day`/`week`/`month`/`status` grouping over `price_approvals` **alone** (no join — one row is one
  request; `COUNT(*)`/`SUM(discount_amount)` are exact with zero fan-out), half-open `[from, to)`
  on `price_approvals.requested_at` (the request-cohort anchor; `resolved_at` is `NULL` for a
  `pending` row so it cannot anchor a period that must include open requests). `status` filter with
  **no default** (the report's point is the outcome mix). Per-period buckets carry
  `approved`/`rejected`/`cancelled`/`pendingCount`, `approvedDiscountValue`
  (`Σ discount_amount FILTER approved` — computed vs `max_price`, never `min_price`, so no
  `pricing.floor.view` gate) and `approvalRate = approved / (approved + rejected)` (`null` when
  nothing decided). Resolves `metrics.md` `APPR-RATE` / `APPR-DISCOUNT-VALUE` (both **B** → **A**).
  Never `PriceApprovalsRepository`. See
  [reporting/reports.md#rep-appr-summary--approvals-workflow-summary](../reporting/reports.md#rep-appr-summary--approvals-workflow-summary).

The APPROVALS report reuses `pricing.discount.approve` rather than a `*.view` code (there is none
for `price_approvals`) — it is the exact permission `metrics.md`'s `APPR-RATE` /
`APPR-DISCOUNT-VALUE` rows already name, and narrower than the operational `GET /price-approvals`
queue's `@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')` gate (a
governance aggregate, not a requester's "my requests" view). No `reports.*`/`analytics.*`
permission family exists — every other report reuses the `*.view` permission of the domain it
reports on (F18-01, ratified in
[reporting/filters-periods-and-scope.md#4-permission-catalogue-41-codes](../reporting/filters-periods-and-scope.md#4-permission-catalogue-41-codes)).

## ADMINISTRATION

**Responsibility:** tenant-level configuration (business hours, notification preferences, branding
later, etc.) and system-level configuration that only a SuperAdmin can change.

**Depends on:** CORE.

**Implemented in `apps/api/src/administration/` (FASE 11):** tenant-level configuration —
`GET`/`PATCH /administration/tenant-settings` (timezone, business hours; `administration.settings.
view`/`.manage`, migration `0023`), backed by a new singleton-per-tenant `tenant_settings` table
(migration `0022`) — see
[database.md#administration-tenant-settings-and-platform-admin-sessions](database.md#administration-tenant-settings-and-platform-admin-sessions).
`notification_preferences`/`branding` are deliberately not built: **FASE 15 resolved the
`notification_preferences` `PENDING DECISION` by deciding routing lives entirely in n8n** (keyed by
the `tenantId`/`eventType` in every event envelope) — no backend preference schema or endpoints,
no frontend. See [events.md#n8n-and-telegram-fase-15--implemented](events.md#n8n-and-telegram-fase-15--implemented)
and [integrations/n8n.md](../integrations/n8n.md). `branding` remains "later." System-level administration — the SuperAdmin (`platform_admins`) authentication
mechanism ADR-0030/Prompt 04 deliberately left unbuilt, plus the one concrete system-level
capability this phase found grounded in the existing architecture (tenant lifecycle management:
`GET /platform/tenants`, `GET /platform/tenants/:tenantId`, `POST /platform/tenants/:tenantId/
suspend`, `POST /platform/tenants/:tenantId/activate`, `POST/GET /platform/auth/*`) — see
[ADR-0032](../decisions/0032-platform-admin-authentication.md) for the full authentication design
and [multi-tenancy.md#superadmin-vs-tenant](multi-tenancy.md#superadmin-vs-tenant) for why this is
structurally separate from CORE's tenant self-administration (Prompt 05-A) rather than an extension
of it. `TenantsPlatformRepository` (CORE/AUTH's existing repository) is reused as-is for the
tenant-status mutation — no second `tenants`-table repository was introduced. Platform-level
metrics/global configuration/"plans" — named as illustrative SuperAdmin capabilities in
multi-tenancy.md but with no concrete architectural definition anywhere — are deliberately not
built; see this phase's final report for the full scope-boundary rationale.

## DEMO

**Responsibility:** a fully isolated demo tenant — same isolation rules as any other tenant (see
[multi-tenancy.md](multi-tenancy.md)) — seeded with synthetic data for prospects/sales demos. See
[the demo strategy ADR](../decisions/0014-demo-tenant-strategy.md).

## IMPORT (Prompt 02-B, implemented FASE 10)

**Responsibility:** the guided, staged bulk-inventory-onboarding flow — dynamic Excel template
generation, upload, column mapping, validation, preview, and batched commit into CATALOG (products,
variants) and INVENTORY (initial stock, ledgered like any other movement). See
[database.md#excel-import-pipeline](database.md#excel-import-pipeline) and
[ADR-0027](../decisions/0027-staged-excel-import-pipeline.md). Large-import processing runs on a
**separate Import Worker process** from the NOTIFICATIONS module's Event Processor below — same
Postgres-backed claiming pattern, different deployable, resolved in Prompt 02-D; see
[ADR-0029](../decisions/0029-import-worker-separation.md) and
[database.md#large-imports](database.md#large-imports).

- `import_mapping_templates`, `import_jobs`, `import_job_rows`.

**Depends on:** CORE (tenant scoping, audit), CATALOG (creates/updates products, variants, and reads
`attribute_definitions`/`category_attributes` to validate rows and generate templates), INVENTORY
(writes `inventory_movements`/`inventory_balances` for initial stock, through INVENTORY's own
concurrency-safe write path — never touching INVENTORY's tables directly from CATALOG code). Shaped
like DEMO above — a module whose entire purpose is populating other modules' data — rather than folded
into CATALOG, specifically so CATALOG itself keeps its single, simple `Catalog --> Core` dependency
edge and IMPORT carries the (legitimate, narrower) multi-module dependency instead.

**Consumed by:** nothing depends on IMPORT — like QR, it is a leaf module.

**PROMPT 011-B** closed a real gap: the Import Worker never passes through `TenantGuard` (it is a
background process, not an HTTP path), so nothing previously stopped it from claiming or continuing
to process a job belonging to a tenant a SuperAdmin had since suspended. `ImportWorkerClaimRepository`'s
claim query now excludes any job whose tenant is not `active`; `ImportValidationService`/
`ImportExecutionService` re-check the same live status before starting each batch of an already-claimed
job. Either check leaves the job in its current, resumable status (never `failed`, never falsely
finalized to `completed`) — see [security.md#tenant-isolation](security.md#tenant-isolation) for
the full design and [database.md#row-level-security](database.md#row-level-security) for the one
narrow grant (`GRANT SELECT (id, status) ON tenants TO app_import_worker`, migration 0025) this
required.

## Inventory and locations summary

Full detail: [database.md](database.md) (conceptual model) and the Inventory Flow diagram below.
Locations are a hierarchy under a warehouse, not a fixed two- or three-level scheme:

```mermaid
flowchart TB
    Tenant --> Warehouse["Warehouse: Bodega Principal"]
    Warehouse --> ZoneA["Location: Zona A"]
    Warehouse --> ZoneB["Location: Zona B"]
    ZoneA --> ShelfA1["Location: Estante 01"]
    ZoneA --> ShelfA2["Location: Estante 02"]
    ShelfA1 --> LevelA1a["Location: Nivel 1 (optional deeper nesting)"]
```

A `location` has a nullable `parent_location_id` (self-referencing), so the tree can be as shallow
or as deep as a tenant's real layout requires — "zone / shelf / level" is an example depth, not a
fixed schema. Each location can carry a QR code (see QR module) and a status (active/inactive).

Inventory itself is **never** a single `quantity` column on `products`. It is:

```mermaid
flowchart LR
    Product --> Inventory["Inventory (balance)\nper product + warehouse + location"]
    Warehouse --> Inventory
    Location --> Inventory
    Inventory --> Movement["InventoryMovement (ledger)\nevery change is a row"]
    Movement -. "sum of movements reconciles to balance" .-> Inventory
```

`Inventory` holds the current balance (fast reads); `InventoryMovement` is the append-only ledger
that produced that balance (traceability, auditability, and the ability to reconstruct history).
The balance additionally distinguishes:

- **Physical stock** — what is actually on the shelf.
- **Reserved stock** — held against an in-progress cart/order, not yet committed.
- **Committed stock** — allocated to a confirmed order not yet fulfilled/shipped.
- **Available stock** — physical minus reserved minus committed; what can be sold right now.

## Inventory flow (conceptual)

```mermaid
sequenceDiagram
    participant U as Tenant user
    participant API as API (inventory module)
    participant DB as PostgreSQL

    U->>API: Adjust stock (e.g. receive shipment)
    API->>API: Authorize (inventory.adjust permission) + resolve tenant context
    API->>DB: BEGIN transaction
    API->>DB: INSERT InventoryMovement (type=RECEIPT, qty, warehouse, location)
    API->>DB: UPDATE Inventory balance (physical += qty, available += qty)
    API->>DB: COMMIT
    API->>API: Write domain event INVENTORY_ADJUSTED to outbox (same transaction)
    API-->>U: 200 OK (new balance)
```

The event write happens in the **same database transaction** as the inventory change — see
[events.md](events.md#why-outbox) for why.

## Order flow (conceptual — SALES not implemented yet)

> **Implemented in FASE 12, extended in FASE 13** — heading kept for anchor stability. The diagram
> below is the checkout half; FASE 12 splits it into a `pending` (reservation) phase and a
> `confirm` (commit) phase. FASE 13: a below-`min_price` line creates the `pending` order with
> `is_exceptional_discount = true` and a `price_approvals` request must be `approved` before
> `confirm`. See [SALES](#sales) and
> [database.md#fase-12-application-behavior](database.md#fase-12-application-behavior).

```mermaid
sequenceDiagram
    participant C as Customer (via tenant user or storefront, future)
    participant API as API (sales module)
    participant Inv as API (inventory module)
    participant DB as PostgreSQL

    C->>API: Create order (Idempotency-Key header)
    API->>API: Check idempotency key (has this order already been created?)
    API->>DB: BEGIN transaction
    API->>Inv: Reserve stock for each line (row-level lock on Inventory balance)
    Inv-->>API: Reserved (or 409 if insufficient available stock)
    API->>DB: INSERT Order + OrderLines
    API->>DB: INSERT InventoryMovement (type=RESERVATION)
    API->>DB: COMMIT
    API->>API: Write ORDER_CREATED event to outbox
    API-->>C: 201 Created

    Note over API,Inv: Cancellation releases the reservation via a\ncompensating InventoryMovement, never by deleting history.
```

Concurrency is handled with row-level locking (`SELECT ... FOR UPDATE`) on the `Inventory` balance
row(s) being reserved against, inside a single transaction — two simultaneous orders for the last
unit of stock cannot both succeed. Idempotency is handled via a client-supplied `Idempotency-Key`
(see [api.md](api.md#idempotency)) so a retried request (e.g. after a timeout) does not create a
duplicate order.

**Prompt 02-A:** an order carries a negotiated price per line, frozen at the moment of sale, plus the
customer's chosen document type (invoice/sales note) and a frozen snapshot of their contact details —
see [database.md#orders-conceptual--sales-not-built-yet](database.md#orders-conceptual--sales-not-built-yet).
If any line's price falls below the product's authorized minimum, order confirmation is additionally
gated on that line's `price_approvals` request being resolved — see
[database.md#pricing-history-tenant-policy-and-exceptional-discount-approval](database.md#pricing-history-tenant-policy-and-exceptional-discount-approval).
Before an order exists at all, the customer's selections live in a `cart` — see
[database.md#cart](database.md#cart).

## Audit

Every module that mutates tenant data writes to the CORE audit log. What gets audited (initial
list — extended as modules are built):

- Authentication events: login success/failure, logout, password change, token refresh.
- Authorization failures (attempted access denied by a guard) above a noise threshold.
- User/role/permission changes.
- Tenant lifecycle (created, activated, deactivated) — SuperAdmin actions.
- Inventory adjustments and transfers (dispatch, receipt, including incidents/discrepancies).
- Order creation and cancellation (once SALES exists).
- Exceptional price-discount requests and their approval/rejection.
- Sales returns and their disposition (restock/quarantine/damaged/scrap).
- Any SuperAdmin action touching a specific tenant.

Each entry captures **who** (actor + whether SuperAdmin or tenant user), **what** (action code),
**when** (timestamp), **where** (tenant_id, correlation ID, IP if applicable), **on what** (entity
type + ID), and **before/after** state where the action is a mutation. See
[ADR-0015](../decisions/0015-audit-log.md).
