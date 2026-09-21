# F17 — Gaps & Ambiguities

> Every backend/frontend gap and open decision found during the F17-00 audit. **Nothing here is
> implemented.** Each is classified:
>
> - **F17-blocking** — a core F17 interaction cannot be built correctly without this.
> - **F17-additive** — small, additive backend change that materially improves an F17 screen
>   (no schema/RLS change); F17 can ship a degraded version without it.
> - **F18** — belongs to the reporting/analytics read-side.
> - **future** — needs an ADR / new bounded context before any phase.
> - **decision** — no code needed yet; a product/architecture choice must be made before the
>   affected screen is built.
>
> Overlaps with [017-A data-gaps](../reporting/data-gaps.md) are cross-linked, not duplicated.

## Priority list

| # | Gap | Class | Affected screens |
| --- | --- | --- | --- |
| 1 | [`GAP-NAME-ENRICHMENT`](#gap-name-enrichment) | F17-additive (high leverage) | Inventory, Movements, Transfers, QR, Products list |
| 2 | [`GAP-VARIANT-LIST`](#gap-variant-list) | F17-blocking | New Sale (SKU search), Transfer form, flat variant view |
| 3 | [`GAP-BRAND-SUPPLIER-LIST`](#gap-brand-supplier-list) | decision → F17-additive | Product form |
| 4 | [`GAP-APPROVALS-PERMISSION`](#gap-approvals-permission) | ~~F17-blocking (defect)~~ **RESOLVED (F17-09)** | Approvals list, nav gating |
| 4b | [`GAP-RETURNS-UI-DEFERRED`](#gap-returns-ui-deferred--resolved-f17-10) | ~~non-blocking~~ **RESOLVED (F17-10)** | Returns list/new/detail, Order detail |
| 6b | [`GAP-NOTIF-RETRY-BACKEND`](#gap-notif-retry-backend) | future (needs migration + permission + ADR) | Order detail |
| 5 | [`GAP-ORDERS-LOCATION`](#gap-orders-location) | decision → F18 | Sales history, Order detail, Home "orders today" |
| 6 | [`GAP-NOTIF-STATUS`](#gap-notif-status) | status half **RESOLVED (F17-10)**; list-level deferred | Order detail, Sales history |
| 7 | [`GAP-MULTI-STATUS`](#gap-multi-status) | F17-additive — worked around in F17-12 (2 parallel GETs per rollup) | Home tiles, Transfers/Returns/Imports tabs |
| 8 | [`GAP-HOME-DATE-TZ`](#gap-home-date-tz) | ~~PARTIALLY RESOLVED~~ **RESOLVED (F18-01)** | Home, any date filter |
| 8b | [`GAP-TZ-VISIBILITY`](#gap-tz-visibility) | ~~OPEN~~ **RESOLVED (F18-01)** — `timezone` on `GET /auth/me`, ungated | Home date tiles for non-Administrador roles |
| 9 | [`GAP-DATE-SEMANTICS`](#gap-date-semantics) | ~~decision~~ **RATIFIED (F18-01)** for new FASE 18 endpoints — `GET /orders` unchanged | Sales history date filter |
| 10 | [`GAP-MOVEMENTS-DATE-FILTER`](#gap-movements-date-filter) | F17-additive | Movements, Kardex |
| 11 | [`GAP-SEARCH`](#gap-search) | F17-additive | Products, Sales history |
| 12 | [`GAP-SORT`](#gap-sort) | F17-additive | every list |
| 13 | [`GAP-INV-AGGREGATE`](#gap-inv-aggregate) | F18 (+ small F17 slice) | Inventory list totals/tabs, Home |
| 14 | [`GAP-REORDER`](#gap-reorder) | future (ADR) | Inventory "low stock" tab/tile |
| 15 | [`GAP-INV-LOCATION-SCOPE`](#gap-inv-location-scope) | decision → F17-additive | Inventory list, Movements |
| 16 | [`GAP-ROLE-CRUD`](#gap-role-crud) | CLOSED (ROLES/PERMISSIONS block) | Roles screen |
| 17 | [`GAP-USER-FILTERS`](#gap-user-filters) | F17-additive | Users list |
| 18 | [`GAP-CUSTOMER-HISTORY`](#gap-customer-history) | F18 | Customer detail |
| 19 | [`GAP-PRICE-HISTORY-READ`](#gap-price-history-read) | F18-additive | Product detail |
| 20 | [`GAP-ORDER-MARGIN`](#gap-order-margin) | F18-additive | Order detail |
| 21 | [`GAP-TRANSFER-CODE`](#gap-transfer-code) | decision (cosmetic) | Transfers list |
| 22 | [`GAP-IMPORT-PROGRESS`](#gap-import-progress) | decision — **OPEN**, degraded honestly (F17-11) | Import detail |
| 22b | [`GAP-IMPORT-FILE-HEADERS`](#gap-import-file-headers) | F17-additive — **OPEN** (F17-11) | Import upload / mapping |
| 23 | [`GAP-SUSPENDED-TENANT-UX`](#gap-suspended-tenant-ux) | decision | App shell |
| 24 | [`GAP-SA-CREATE-TENANT`](#gap-sa-create-tenant) | future | Super-Admin |
| 25 | [`GAP-SA-TENANT-ADMINS`](#gap-sa-tenant-admins) | future | Super-Admin |
| 26 | [`GAP-SA-ADMIN-CRUD`](#gap-sa-admin-crud) | future | Super-Admin |
| 27 | [`GAP-AUDIT-READ`](#gap-audit-read) | future | (no F17 screen) |
| 28 | [`GAP-PLATFORM-AGGREGATE`](../reporting/data-gaps.md#gap-platform-aggregate) | future | Super-Admin dashboard |
| 29 | [`GAP-ATTR-DEF-DETAIL`](#gap-attr-def-detail) | F17-additive (low) | Attribute detail/edit |
| 30 | [`GAP-ATTR-DISPLAY-ORDER`](#gap-attr-display-order) | F17-additive (low) | Attributes list ordering |
| 31 | [`GAP-MEASUREMENT-UNITS-PERMISSION`](#gap-measurement-units-permission) | decision (low) | Attribute form unit selector |
| 32 | [`GAP-QR-PRINT`](#gap-qr-print) | decision / additive — **OPEN** (F17-14) | QR list (print / bitmap) |
| 33 | [`GAP-SA-PLATFORM-401`](#gap-sa-platform-401) | F17-additive — **OPEN** (F17-13) | Super-Admin mutations |

---

### `GAP-NAME-ENRICHMENT`
`GET /inventory/balances`, `GET /inventory/movements`, `GET /inventory/transfers` return **FK ids
only** — no product name/SKU, no location/warehouse name, no user name. The design shows named
columns everywhere. **F17-additive:** add the joined names to the response DTOs (a service-level
join; no schema change; indexes exist). Without it F17 must either issue N lookups (rejected —
audit §9 GAP 2 says no N+1 from the frontend) or maintain client-side dictionaries. **This is the
single highest-leverage F17 backend adjustment.** See [017-A `GAP-INV-AGGREGATE`](../reporting/data-gaps.md#gap-inv-aggregate).

**F17-06 (2026-09) — OPEN, worked around.** The stock-on-hand and movements screens resolve
`locationId` → location/warehouse name from **one bounded list fetch each** (`pageSize: 100`
`GET /locations` + `GET /warehouses`), the same bounded-list approach F17-03/F17-05 use — no N+1.
The **variant** cannot be named on the tenant-wide list (no `GET /variants` — `GAP-VARIANT-LIST`),
so `productVariantId` shows as a short id there; the fully-named view is the drill-in from
`/products/[id]/variants/[variantId]`, which already knows the product + SKU and shows that
variant's balances per location. Actor names are not shown (`actorId` short id only). A tenant with
>100 warehouses/locations is beyond the tested range.

**F17-06 note carried into F17-07 (2026-09) — OPEN.** The transfers list and detail resolve
`sourceLocationId`/`destinationLocationId` → location + warehouse name from the shared
`buildLocationIndex()` (one bounded `GET /locations` + `GET /warehouses`, `pageSize: 100`) — no
N+1, no per-transfer or per-item lookup. `TransferResponseDto` items carry only `productVariantId`
with **no product context** (no `productId`, SKU or name), so transfer lines show the variant as a
short id and link to `/inventory/movements?productVariantId=` (an existing route) rather than a
`/products/[id]/variants/[variantId]` route that cannot be constructed. `requestedBy`/`approvedBy`/
`dispatchedBy` are shown as short ids (no user-name resolution).

**F17-14 (2026-09) — OPEN, same workaround.** `S-QR-LIST` and the `S-USER-DETAIL` location-access
editor resolve `targetId` / `locationId` → location name from the shared `buildLocationIndex()`
(bounded `GET /locations` + `GET /warehouses`, `pageSize: 100`) — no N+1. A QR `product_variant`
target has no tenant-wide list (`GAP-VARIANT-LIST`) so it shows a short id; `qr_codes` carries no
`code`/user enrichment either (`assignedBy` on a user-location row shows a short id).

### `GAP-VARIANT-LIST`
Variants are reachable **only** per-product (`GET /products/:id/variants`). New Sale's core
interaction is "type a SKU → add the line". **F17-blocking:** needs a tenant-wide
`GET /variants?q=<sku|barcode|name>&status=` (or `GET /products/variants`). Interim: F17 can force
"pick a product, then a variant" — clunky but functional. See [017-A](../reporting/data-gaps.md#gap-variant-list).

**Re-audited during F17-05 (2026-09) — status: OPEN, not blocking for F17-05.** Confirmed against
the code: no tenant-wide variant controller exists (`@Controller('products')` is the only one;
variants live at the nested `GET/POST /products/:id/variants` + `GET/PATCH
/products/:id/variants/:variantId`, `products.view`/`.manage`). F17-05 (product CRUD) needs only
the per-product path and uses it — the product detail page lists a product's variants and links to
per-variant create/edit. The gap stays for **F17-08** (New Sale SKU search), decision deferred to
that phase per [f17-implementation-order.md](f17-implementation-order.md).

**Re-audited during F17-07 (2026-09) — status: OPEN, worked around.** `CreateTransferItemDto` takes
a bare `productVariantId` (UUID). The transfer creation form reuses the F17-06 pattern verbatim:
pick a product (`GET /products?status=active`), then a variant (`GET /products/:id/variants`, SKU
shown), then a quantity — one line per variant, add/remove lines, no duplicate variant. No
tenant-wide variant list is created, simulated or requested. On the transfer detail, lines carry
only `productVariantId` (no product context) so they show a short id.

**Re-audited during F17-08 (2026-09) — status: OPEN, worked around.** `AddCartItemDto` takes a bare
`productVariantId`. New Sale reuses the same Product → Variant → quantity pattern
(`GET /products?status=active` → `GET /products/:id/variants`, SKU shown as the option label). No
tenant-wide `GET /variants` created/simulated/requested. Cart and order **line responses** already
carry `sku` + `productName` (the backend enriches those), so once a line is on the cart it is named
without any extra lookup — the gap only affects the *picker*.

### `GAP-BRAND-SUPPLIER-LIST`
`products.brand_id` / `supplier_id` are real FKs and the Product form shows the fields, but
ADR-0019 keeps brands/suppliers as reference entities **without any endpoint** — no list, so the
selectors have no data source, and a product cannot actually be assigned a brand/supplier via the
API today. **Decision:** (a) add read-only `GET /brands` / `GET /suppliers` (F17-additive, no ADR
change — they'd stay CRUD-less), or (b) omit both fields from the F17 product form. Recommend (a).
**Still open after F17-03** (F17-03 covers categories + attributes only). F17-05 (products) must
resolve it before building the product form's brand/supplier selectors.

**Re-audited during F17-04 (2026-09) — status: `BLOCKING / BACKEND DEPENDENCY`.** A dedicated
backend audit for this phase re-confirmed the code (the source of truth): there is **no**
`brands`/`suppliers` controller, service, DTO, route, permission code, OpenAPI entry or test —
the only application code touching either table is `ProductsRepository.brandExists()` /
`supplierExists()` (existence checks used when a product is assigned a `brandId`/`supplierId`).
No alternative real endpoint exposes the data. Because F17-04 cannot modify the backend or invent
a contract, no brand/supplier UI was built (Case C). F17-04 was implemented as **Warehouses &
Locations** (its scope in [f17-implementation-order.md](f17-implementation-order.md); the
brands/suppliers gap remains F17-05's to resolve, via option (a) read-only `GET /brands` /
`GET /suppliers` or option (b) omitting the fields — both still open).

**F17-05 decision (2026-09) — `NOT RESOLVED`; the product form takes option (b).** F17-05 built
the product/variant frontend. The audit re-confirmed: `CreateProductDto`/`UpdateProductDto` accept
`brandId`/`supplierId` (validated by `ProductsRepository.brand/supplierExists`), but there is still
no endpoint to list either, so the product form **omits the brand/supplier selectors entirely** —
no fake selector, no hardcoded list, no invented endpoint, no backend change. The product detail
page shows a raw `brandId`/`supplierId` only when the response already carries one (it cannot
resolve them to names). The gap stays a backend dependency: whenever read-only `GET /brands` /
`GET /suppliers` are added, the product form gains the two selectors and the fields become
assignable from the UI.

### F17-05 dependency — category ↔ attributes: **RESOLVED by F17-03**
The category-driven dynamic attribute contract F17-05's product form needs is fully in place and
fully manageable (ADR-0026, "case A"):
- `GET /categories/:id/attributes` → `{ attributeDefinitionId, code, name, dataType, isRequired,
  displayOrder }[]` (ordered) — the product form calls this for the product's category and renders
  one input per definition by `dataType`.
- `PUT /categories/:id/attributes` (`catalog.attributes.manage`) — whole-set replace; F17-03 ships
  the editor for it.
- `GET /attribute-definitions` + `GET /attribute-definitions/:id/options` — definitions and their
  select/multi_select options.
- Reusable frontend contracts left by F17-03: `lib/types/catalog.ts` (all DTO mirrors +
  `ATTRIBUTE_DATA_TYPES`, `isSelectType`, `isNumericType`), `lib/catalog/categories.ts` /
  `lib/catalog/attributes.ts` (server read helpers).

### `GAP-APPROVALS-PERMISSION`
`GET /price-approvals` and `GET /price-approvals/:id` declare **no `@RequirePermissions`** — any
authenticated tenant member can read the price-approval queue (which carries pricing context).
Every other tenant read endpoint declares a permission. **F17-blocking (defect):** the backend
must add a gate before the Approvals screen ships; F17-00 recommends `pricing.discount.approve`
for the queue and `pricing.discount.request` (own requests) — or a new `pricing.discount.view`.
Also affects nav-item gating. Observed in 017-A, unchanged.

**Re-audited during F17-08 (2026-09) — status: OPEN / BLOCKING for the Approvals screen, unchanged.**
Confirmed against `price-approvals.controller.ts`: the two `GET` routes carry no `@RequirePermissions`;
the service does an OR check (`pricing.discount.request` OR `pricing.discount.approve`) the guard's
AND semantics can't express. F17-08 builds **Clientes + Nueva Venta only** — no Approvals list, no
nav item, no `price-approvals` read. When checkout produces a `pending` order with a below-`min_price`
line, New Sale and the read-only order detail show an informational "needs a price approval before it
can be confirmed" notice (no link to a queue that does not exist yet). The Approvals screen, the
`POST /price-approvals` request flow and the order confirm/cancel lifecycle are **F17-09**; the
backend gate still needs correcting first.

**RESOLVED — F17-09 (2026-09).** The AND-only `@RequirePermissions` genuinely could not express the
OR, so F17-09 adds a minimal, behaviour-preserving mechanism: `@RequireAnyPermission(...codes)`
(`common/decorators/require-any-permission.decorator.ts`) + OR support in `PermissionsGuard` (a
route may carry both — every AND code and at least one ANY code). Both `GET /price-approvals` and
`GET /price-approvals/:id` now declare
`@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')` — the exact set the
service already checked (kept as defense in depth). **No new permission code**, no role-template
change, no business-logic change; `POST` routes are unchanged. Proven by
`common/guards/permissions.guard.spec.ts` (7 cases) and two new HTTP-level cases in
`test/sales/sales-exceptional-pricing.integration.test.ts` (requester-only reads, approver-only
reads, neither → 403 on both the list and the row, tenant isolation intact). The nav item
(`/approvals`, label "Approvals") mirrors the OR with `NavItem.anyPermission`.

### `GAP-RETURNS-UI-DEFERRED` — **RESOLVED (F17-10)**
**F17-10 (2026-09) — built.** `/returns` (list, `sales.returns.view`), `/returns/new` (create,
`sales.returns.create` + `Idempotency-Key`; confirmed-order picker + returnable-quantity hint
from `GET /orders/:id` + `GET /sales-returns?orderId=`), `/returns/[id]` (detail + `inspect` /
`resolve` / `cancel` via `ReturnActions` — `inventory.returns.manage` for the stock-sensitive half,
`sales.returns.create` for cancel, `Idempotency-Key` on resolve, ADR-0021 sellable/non-sellable
disposition pairing surfaced, backend re-authorizes state + permission + location on every call).
Nav item "Returns" (`sales.returns.view`, icon `undo`). Order detail gained a "Start a return"
action (confirmed order + `sales.returns.create`) and a related-returns list. Line SKUs are resolved
from the parent order when the caller holds `sales.orders.view` (`GAP-NAME-ENRICHMENT` — no
`orderNumber`/SKU on the return DTO). No backend change. The original text is kept below for
history.

The sales-returns backend contract is **complete and tested** (`returns.controller.ts` /
`returns.service.ts`; `create → inspect → resolve` + `cancel`; `sales.returns.view` /
`sales.returns.create` for the administrative half, `inventory.returns.manage` for the
stock-sensitive half; two `Idempotency-Key` scopes; ADR-0021 dispositions;
`test/sales/sales-returns.integration.test.ts` + `returns.service.spec.ts`). **F17-09 deliberately
did not build the Returns UI** — no `/returns` route, no nav item, no `sales-returns` read, no fake
button. Rationale: keep F17-09 focused on Orders + Approvals (the GAP-APPROVALS-PERMISSION fix was
the hard prerequisite) and avoid a large multi-role screen (`ReturnResponseDto` carries no
`orderNumber` / SKU on lines, so a returns list/detail needs the same `GAP-NAME-ENRICHMENT`
work-arounds as transfers, plus a two-persona inspect/resolve flow). **non-blocking.** Recommended
phase: **F17-10 or a dedicated F17-RETURNS slice.** The order detail links to `/sales` and shows a
`confirmed` order's state but offers no "start a return" action yet.

### `GAP-ORDERS-LOCATION`
`orders.location_id` exists but `GET /orders` has **no `locationId` filter** and the endpoint does
not location-scope order visibility. **Decision needed:** should an operational user see only
orders placed at their authorized locations? If yes → add the filter + scope (F18/additive). If no
→ document that order visibility is tenant-wide for `sales.orders.view` holders. Blocks
`REP-SALES-BY-LOCATION` (F18) either way. See [017-A](../reporting/data-gaps.md#gap-orders-location-filter).

**F17-08 (2026-09) — OPEN, unchanged.** Confirmed against `OrdersService.list`/`getById`: no actor
is taken, `user_location_assignments` is never read — order visibility is **tenant-wide** for a
`sales.orders.view` holder. F17-08's customer-detail order list (`GET /orders?customerId=`) and the
read-only order detail (`GET /orders/:id`) therefore show any tenant order; the frontend does not
replicate or simulate location scoping. The cart *location* selector lets the vendor pick any active
sellable location and surfaces the backend's `403` (ADR-0024 location authorization on the cart /
checkout) in place. If reads should be scoped, that is a backend change.

**F17-09 (2026-09) — OPEN, unchanged.** The sales-history list (`/sales`, `GET /orders`) is
explicitly tenant-wide: it shows a "Every sales order in the company" description, has **no**
location filter or chip, and does not read `user_location_assignments`. `confirm` / `cancel` on the
detail surface the backend's `403` (order-location authorization) in place. Still a backend
decision.

### `GAP-NOTIF-STATUS`
Roadmap FASE 17 item: a `sent`/`pending`/`failed` badge on the order + an authorized "retry
notification". `event_outbox` is DB-readable by `app_tenant` (migration 0010 grants `SELECT,
INSERT` + tenant-isolation RLS + `event_outbox_tenant_created_idx`) but **no
repository/service/controller reads it and no permission gates it**. The retry needs an `UPDATE`
grant (`app_tenant` has none) or a processor-mediated action, and must never recreate the event,
the order, or its inventory movements. **F17-blocking for this feature:** a small read projection
+ a guarded requeue, contract to be designed first. See [017-A](../reporting/data-gaps.md#gap-notif-status).

**F17-08 (2026-09) — OPEN, not addressed.** `OrderResponseDto` carries no notification field and
there is no read endpoint for `event_outbox`. F17-08's order detail shows the order status only —
no `sent`/`pending`/`failed` notification badge and no "retry notification" control. Deferred to the
phase that designs the read projection + guarded requeue (roadmap FASE 17 item / F17-09+).

**F17-09 (2026-09) — OPEN, not addressed.** The order lifecycle (confirm / cancel / approvals) is
built, but still no `event_outbox` read: no notification-status column on `/sales`, no badge on the
order detail, no requeue control. Deferred to **F17-10** (Notifications).

**RESOLVED (status half) — F17-10 (2026-09).** New read-only endpoint
`GET /api/v1/orders/:id/notifications` (`sales.orders.view`) →
`OrderNotificationsResponseDto { orderId, overallStatus: none|pending|delivered|failed, events:[{ eventId, eventType, status, attempts, occurredAt, processedAt? }] }`.
`app_tenant` has held `SELECT` on `event_outbox` since migration 0010 (+ tenant-isolation RLS) —
`OrderNotificationsRepository` is the first application read; **no schema/grant/migration change**.
Delivery **metadata only** — never `payload` (buyer PII) or `last_error` (worker-internal). The
order detail (`/sales/[id]`) shows a rollup badge + the per-event list. A deployment with
`N8N_EVENTS_ENABLED=false` legitimately reports every event `pending` (nothing claims the row) —
the badge says "Queued", not an error. Backend: `permissions.guard`-gated, 404 cross-tenant, proven
by `test/sales/sales-order-notifications.integration.test.ts`. The **list** (`/sales`) still has no
per-row status (would be N+1 — needs a batch/projection endpoint, minor, deferred). The **retry**
half is `GAP-NOTIF-RETRY-BACKEND`.

### `GAP-NOTIF-RETRY-BACKEND`
Re-sending a failed (`dead_letter`) notification has **no backend contract** and F17-10 did not
build one (deliberate scope decision — status read is a safe existing-grant addition, retry is not).
Evidence / what a retry needs:
- **Grant:** `app_tenant` has only `SELECT, INSERT` on `event_outbox` (migration 0010) — **no
  `UPDATE`**. A retry must reset a `dead_letter` row (`status → 'pending'`, `attempts → 0`,
  `claimed_at/claimed_by/last_error → NULL`) so the Event Processor's claim query (which requires
  `attempts < maxAttempts` and skips `dead_letter`) re-picks it. That is a new column-scoped
  `GRANT UPDATE (status, attempts, claimed_at, claimed_by, last_error) ON event_outbox TO app_tenant`
  — a migration.
- **Permission:** no notification permission exists; `notifications.retry` must **not** be invented
  (per the F17-10 prompt). The reviewed choice if/when built is `administration.settings.manage`
  (Administrador-only — treats notification delivery as tenant infra, matches the FASE 15 note
  "let an admin retry").
- **Service + endpoint:** a guarded `POST /orders/:id/notifications/:eventId/retry` (or similar)
  that only ever touches `event_outbox` — never the order, its lifecycle, or any inventory movement.
  Re-delivery re-POSTs the frozen payload to n8n, which dedupes on `eventId`, so it is safe.
- **ADR:** the grant + permission choice + "retry is delivery-only" invariant warrant a short ADR.

**Class:** future. **Blocking:** no (the status badge already tells an operator delivery failed).
**Recommended phase:** a dedicated notifications-ops slice, or F17-19 (observability).

### `GAP-MULTI-STATUS`
Every list DTO takes a single `@IsIn` status. "Open transfers", "returns to process", "imports
running" are multi-status → N calls each. **F17-additive:** accept `status` as a repeatable/array
param on transfers, returns, imports, orders. Trivial DTO change, no schema impact.

**F17-07 (2026-09) — OPEN, confirmed.** `ListTransfersQueryDto` accepts a single `status`
(`@IsIn` over the 7 states), plus `sourceLocationId` / `destinationLocationId`. The transfers list
offers status **chips** (one real value at a time, "All statuses" clears it) — no `status[]`, no
synthetic "open" bucket, no client-side merge of several calls. Source/destination filters are two
native `<select>`s in a GET form (real params only).

**F17-09 (2026-09) — OPEN, confirmed.** `ListOrdersQueryDto` / `ListPriceApprovalsQueryDto` each
take a single `@IsIn` status. Sales history uses a single-select status dropdown; the Approvals
queue uses status chips (one value at a time). No `status[]`, no synthetic buckets.

**F17-12 (2026-09) — OPEN, worked around per this doc's own guidance.** The operational Home needs
two multi-status rollups — "Returns to process" (`requested` + `inspecting`) and "Transfers to
receive" (`dispatched` + `partially_received`). Each is **two parallel `GET`s** merged client-side
(`lib/home/dashboard.ts` `combined()`), never an invented `status=a,b`, never assuming the DTO takes
an array. Two independent reads per tile is not an abusive pattern (both `Promise.all`-parallel with
the rest of the Home). If the secondary read fails the tile still shows the primary-status count (a
documented possible undercount) rather than blanking. A repeatable `status` param would collapse
each pair to one call — still a clean `F17-additive`.

### `GAP-HOME-DATE-TZ`
"Orders today", "this month" etc. must be computed in `tenant_settings.timezone` (the only tz
source), converted to a UTC `createdFrom`/`createdTo` range for `GET /orders`. **No endpoint does
this.** F17 must fetch the tenant timezone and do the conversion client-side (or F18 read-side
does it). "today" is wrong for non-UTC tenants otherwise.

**Status after F17-02: PARTIALLY RESOLVED.**
- **Done:** the tenant timezone is now a real, read/write, persisted setting —
  `GET`/`PATCH /administration/tenant-settings` wired in the `S-SETTINGS` screen, with a stable
  server-side read contract for later phases (`lib/tenant/tenant-settings.ts` —
  `getTenantSettings()` / `resolveTenantTimezone()`) and a picker built from the exact set the
  backend validates against (`lib/tenant/timezones.ts` = `Intl.supportedValuesOf('timeZone')`).
  F17-02 deliberately does **not** compute any date range / "today" / "this month" — that is F17-12.
- **Still open → `GAP-TZ-VISIBILITY` (F17-12 / decision):** `GET /administration/tenant-settings`
  requires `administration.settings.view`, which in `DEFAULT_ROLE_TEMPLATES` only **Administrador**
  holds. A Vendedor/Bodega/Supervisor rendering Home's "orders today" tile cannot read the tenant
  timezone through this endpoint (403). F17-12 must resolve this before wiring per-role date tiles
  — options: (a) add `timezone` to `GET /auth/me` (small backend change, best), (b) a new
  low-sensitivity `GET /tenant/timezone`, or (c) Home date tiles only for `administration.settings.view`
  holders / browser-timezone fallback (degraded). Not solved by F17-02 (no backend change).

### `GAP-TZ-VISIBILITY`
The tenant operational timezone is only readable with `administration.settings.view` (Administrador
only in the default roles). Home's per-role date computation (F17-12) needs it for every
operational role. **F17-12 / decision** — see `GAP-HOME-DATE-TZ` above for the options. F17-02
records it; it needs a backend decision (recommended: `timezone` on `GET /auth/me`).

**F17-12 (2026-09) — was OPEN; Home degraded option (c).** F17-12 was frontend-only and did not add
`timezone` to `GET /auth/me`. The single date-dependent Home tile ("Orders confirmed today") was
shown as a real number only for a caller who held `administration.settings.view`; every other role
saw a `no-timezone` "Not available" state with a note pointing here. No browser-timezone fallback.

**RESOLVED — F18-01 (2026-09).** `timezone` is now on `CurrentUserResponseDto`
(`apps/api/src/auth/dto/auth-session-response.dto.ts`) — populated in `AuthService` (`me`,
`refresh`, and `issueTenantSession`, used by login + select-tenant) via a new
`resolveTenantTimezone(tx, tenantId)` helper that reads `tenant_settings` through
`TenantSettingsRepository` (added as a provider to `AuthModule`, the same "reuse the repository
class directly" convention `AdministrationModule` already uses for `TenantsPlatformRepository` —
no module-level import cycle either way), defaulting to `'UTC'` exactly like
`TenantSettingsService.getEffective` does for a tenant with no row yet (`DEFAULT_TIMEZONE`,
exported from `tenant-settings.service.ts` so the default is never duplicated). **No permission
check** — every authenticated tenant member may know their own tenant's timezone; only writing it
(or reading business hours) stays behind `administration.settings.*`. Proven by two new
`auth-flow.integration.test.ts` cases: a fresh tenant's `/auth/me` timezone defaults to `'UTC'`,
and two tenants each see only their own timezone after `PATCH /administration/tenant-settings` (no
cross-tenant leak). The frontend `Session` type gained the matching `timezone: string` field.

**F17-08 (2026-09) — not affected at the time.** `GAP-HOME-DATE-TZ` / `GAP-TZ-VISIBILITY` concerned
Home date tiles and the Sales history date picker. F17-08 built neither — New Sale, customers and
the read-only order detail have no date-range control and compute no "today"/"this month". The
order DTO's `createdFrom`/`createdTo` filters are left unused; unaffected by the F18-01 resolution
above (no F17-08 screen consumes `session.timezone`).

**F17-12 (2026-09) — was OPEN; Home shipped one date tile, degraded honestly.** The computation
half was solved: `lib/home/tenant-day.ts` `tenantStartOfDayUtc(timeZone, now)` turns
`tenant_settings.timezone` into the UTC instant of the tenant's local midnight using only the
platform `Intl` API (two-pass DST correction, UTC fallback for an unknown zone, never `new Date()`
interpreting a business period). It feeds **only** `GET /orders?createdFrom=` (a `>=` lower bound,
so the unresolved `createdTo` inclusive/exclusive question — `GAP-DATE-SEMANTICS` — never bites).
The **visibility** half was unsolved in a frontend-only phase: the timezone was readable only with
`administration.settings.view`. F17-12 took **option (c)** — the "Orders confirmed today" tile
rendered a real number only for a caller who could read the tenant settings and otherwise degraded
to a `no-timezone` state.

**RESOLVED — F18-01 (2026-09).** `GET /auth/me` (and every session-issuing response) now carries
`timezone`, never permission-gated (see `GAP-TZ-VISIBILITY` below). `lib/home/dashboard.ts`'s
`loadHomeDashboard` takes `session.timezone` directly as a parameter — the `getTenantSettings()`
call, the `no-timezone` `TileState`, and its degraded note are all removed (dead code once the
timezone is unconditionally available). Every role now sees a real "Orders confirmed today" count.
`apps/web/src/lib/home/tenant-day.ts` itself is untouched (same algorithm, same tests, same import
path) — `apps/api` gets the identical algorithm via a new port, `tenantStartOfDayUtc` in
`@saas-inventory/shared`, so both apps share one tested source without `apps/web` taking on its
first runtime dependency on a workspace package.

### `GAP-DATE-SEMANTICS`
`api.md` does not document whether `createdFrom`/`createdTo` are inclusive/exclusive. **Decision:**
confirm the service behaviour (recommend half-open `[from, to)`), document it in `api.md` before
building the Sales history date picker.

**F17-09 (2026-09) — was OPEN, worked around.** The Sales history date filter ships. The two inputs
are calendar dates; they are sent as an explicit UTC day boundary (`…T00:00:00.000Z` /
`…T23:59:59.999Z`) and each field carries a "UTC day start/end" hint so the behaviour is legible
rather than silently wrong.

**RATIFIED — F18-01, for new FASE 18 endpoints only.** `[from, to)` (half-open, `to` exclusive) is
now the documented, tested convention for every FASE 18 reporting endpoint —
[api.md](../api.md#date-range-filters-fase-18-reporting-endpoints) /
[reporting/filters-periods-and-scope.md#period-boundaries](../reporting/filters-periods-and-scope.md#period-boundaries),
backed by `apps/api/src/common/reporting/date-range.ts` (`toHalfOpenRange`, unit-tested) and
`ReportDateRangeQueryDto`. **`GET /orders` (Sales History's own filter) is a deliberate exception,
unchanged**: it keeps its FASE 12 inclusive-both-bounds (`gte`/`lte`) semantics, since F17-09's
`…T23:59:59.999Z` compensation already relies on it and retroactively changing it would break an
already-shipped screen. Tenant-timezone-correct *conversion* of a calendar period into either
convention's UTC range is `GAP-HOME-DATE-TZ` (resolved for the Home tile, F18-01) — Sales History's
own date picker still sends raw UTC day boundaries, not tenant-timezone-corrected ones (unchanged
by F18-01, no F17-09 screen code was touched).

### `GAP-MOVEMENTS-DATE-FILTER`
`GET /inventory/movements` has only `productVariantId`/`locationId`/`movementType` — **no date
range, no `sort`, no reference filter**. A proper kardex (the ledger *stores* `balance_after`)
needs a date range + guaranteed chronological order. **F17-additive:** `occurredFrom`/`occurredTo`
+ `sort` + `referenceType`/`referenceId`. Index `(tenant_id, created_at)` already exists. See
[017-A](../reporting/data-gaps.md#gap-movements-date-filter).

**F17-06 (2026-09) — OPEN.** Confirmed against `ListMovementsQueryDto`: the only params are
`page`, `pageSize`, `productVariantId`, `locationId`, `movementType` — no `occurredFrom`/`occurredTo`,
no `sort`. `/inventory/movements` ships the filtered feed + the kardex (`?productVariantId=&locationId=`)
and displays rows in the order the endpoint returns them (repository `created_at DESC`); it offers
**no date-range control and no sortable headers**. Period/kardex-window views stay B.

### `GAP-SEARCH`
Only `GET /customers` has `?q=`. Products list and Sales history show search boxes with no
backing. **F17-additive:** `?q=` on `GET /products` (name/SKU/barcode) and `GET /orders`
(order number / customer snapshot name). `api.md` already frames search as a per-endpoint `q`
param. See [017-A](../reporting/data-gaps.md#gap-search).

**F17-08 (2026-09) — partially exercised.** `ListCustomersQueryDto.q` is real (case-insensitive over
displayName / taxId / email / phone, tenant-scoped) and F17-08 uses it: the customers list search
box and the New Sale customer picker both send `?q=` and let the **backend** match — no client-side
filtering of a pre-fetched list. `GET /orders` / `GET /products` still have no `q` — F17-08 builds
no order search box and no product search (the New Sale product picker is a bounded `pageSize: 100`
`status=active` select, same as F17-06/07). The gap stays for Products list and Sales history.

**F17-09 (2026-09) — OPEN, unchanged.** `ListOrdersQueryDto` still has no `q`. The Sales history
screen has **no order-number / customer text search** — only the real filters (`status`,
`documentType`, `customerId`, date range). Its customer filter reuses `GET /customers?q=` (the
only `q`-capable list) to resolve a `customerId`, never to search orders. Same for the Approvals
queue — `ListPriceApprovalsQueryDto` is `status` + `orderId` only.

### `GAP-SORT`
No list endpoint exposes `sort`. **F17-additive:** an allow-listed `sort` param per endpoint
(`api.md` specifies this pattern). Until then F17 tables do not offer sortable headers.

### `GAP-INV-AGGREGATE`
`GET /inventory/balances` returns raw rows, no Σ, no warehouse/category filter, no cross-transfer
in-transit aggregate, no zero/out-of-stock rollup. **F17 slice (additive):** warehouse filter +
name enrichment on the operational list. **F18:** the Σ / grouped / valuation views and the
`KPI-INV-OOS-SKUS` read for Home. See [017-A](../reporting/data-gaps.md#gap-inv-aggregate).

**F17-12 (2026-09) — OPEN; the Home did NOT build an inventory KPI.** No aggregate/rollup endpoint
exists, and scanning every `inventory_balances` row from the Home to synthesise an "out of stock"
or "low stock" count is exactly the full-list-download-to-count pattern this phase forbids
(`GAP-REORDER` also means "low stock" has no definition). The operational Home therefore carries
**no** inventory-level tile — only the transfer queue (`inventory.view`). An `KPI-INV-OOS-SKUS`
aggregate read stays F18.

### `GAP-REORDER`
No reorder point / minimum / par-level field on any table → **"low stock" cannot be defined
without inventing a threshold.** **future (ADR):** a new domain concept
(`product_variants.reorder_point` or an `inventory_reorder_rules` table). **F17 does not build a
low-stock tab/tile/alert.** F17 may show "out of stock" (available = 0) instead, once the
aggregate exists. See [017-A](../reporting/data-gaps.md#gap-reorder).

### `GAP-INV-LOCATION-SCOPE`
`GET /inventory/balances` / `/movements` do not filter by the caller's `user_location_assignments`
— a location-restricted user could *read* balances outside their locations (writes are blocked).
**Decision → F17-additive:** should reads be assignment-scoped? ADR-0024 is about writes; this
extends it to reads. Recommend scoping the reads for consistency with the transfer/adjustment
screens.

**F17-06 (2026-09) — OPEN, unchanged.** Confirmed: `BalancesService.list` / `MovementsService.list`
take no actor and never touch `user_location_assignments` (only `MovementsService.createAdjustment`
calls `LocationAuthorizationService`). F17-06's `/inventory` and `/inventory/movements` therefore
show every tenant balance/movement a `inventory.view` holder can reach — the frontend does **not**
replicate or simulate location scoping (backend is the authority). The adjustment form lets the
user pick any active location and surfaces the backend's `403` ("not authorized to operate on this
location") in place. If reads should be scoped, that is a backend change.

**F17-07 (2026-09) — OPEN, unchanged.** `TransfersService.list`/`getById` take no actor —
`inventory.view` sees every tenant transfer. Only the write transitions check
`LocationAuthorizationService` (`prepare`/`dispatch` → source, `receive` → destination). The
transfer form lets the user select any active location for either end; the detail page renders
Prepare/Dispatch/Receive whenever status + permission allow, and shows the backend's `403`
("not authorized to operate on this transfer's location") in place — the frontend never reads or
simulates `user_location_assignments`.

### `GAP-ROLE-CRUD` — CLOSED (ROLES/PERMISSIONS block)
No endpoint to create/edit roles or toggle role permissions — the catalogue is fixed
(`DEFAULT_ROLE_TEMPLATES`), editable only via direct DB. The nav/design imply "Roles / Permisos"
as manageable. **future:** custom-role CRUD + per-role permission toggling (database.md anticipates
it). **F17 = read-only Roles view.**

**F17-14 (2026-09) — the read-only view is built; CRUD stays FUTURE, unchanged.** `S-ROLES-LIST`
(`/roles`, `GET /roles`, `core.roles.read`) ships with **no** create/edit/delete control (asserted
by test). Managing roles/permissions from the UI is still a backend dependency (no endpoint).

**ROLES/PERMISSIONS block — CLOSED.** New endpoints `POST /roles`, `PATCH /roles/:id`,
`PUT /roles/:id/permissions`, `DELETE /roles/:id`, `GET /permissions` — one new flat permission
`core.roles.manage` (migration `0032`). `S-ROLES-LIST` gained a "Crear rol" action and per-row
Editar/Eliminar (`/roles/new`, `/roles/[id]`) — both gated by `core.roles.manage`; `core.roles.read`
alone still gets the pre-existing read-only view. `is_system_default` grants no extra backend
protection (unchanged from database.md's "a label, not a protection mechanism") — a predefined role
is editable/deletable exactly like a custom one, only visually distinguished. New rule, not covered
by this doc's earlier assumptions: [ADR-0034](../../decisions/0034-role-permission-self-escalation-prevention.md)
blocks a caller from replacing the permission set of a role currently assigned to themselves
(`403 ROLE_SELF_PERMISSION_ESCALATION`), independent of holding `core.roles.manage` — renaming/
describing their own role is still allowed. Same block also closed
`WAREHOUSE OPERATION SCOPE` — `POST /inventory/transfers` (request/create) now also checks
`LocationAuthorizationService` on `sourceLocationId`, matching prepare/dispatch/receive (previously
only those three checked it).

### `GAP-QR-PRINT`
`GET /q/:code` (the public resolver) is the URL that goes on a printed QR label, but it is **not**
under the `/api/v1` prefix, so Next.js's `/api/*` rewrite does not proxy it — turning it into a
clickable link from the admin UI is a reverse-proxy/deployment concern, not a frontend one. There
is also no QR-image contract and no image library in the bundle. **F17-14 (2026-09)** therefore
shows the opaque `code` token (for label reconciliation) but renders **no QR bitmap and no
"open/print link"**. **Class:** decision / additive. **Blocking:** no. **Fix:** either a Caddy/
proxy rule exposing `/q/*` from the web origin + a small client-side QR renderer, or a backend
endpoint returning the code image. Discovered in F17-14.

### `GAP-USER-FILTERS`
`GET /users` filters by `status` only — no role filter, no `?q=` name/email search, no
`lastLoginAt` date filter. **F17-additive** (small) or accept client-side over the paged list for
`KPI-USR-DORMANT` / role distribution.

### `GAP-CUSTOMER-HISTORY`
No per-customer order rollup / LTV / "customers with no orders". `GET /orders?customerId=` gives
one customer's orders (client-side sum). **F18** (part of the sales-summary read-side, `groupBy:
customer`). F17 customer detail shows the single-customer order list only. See
[017-A](../reporting/data-gaps.md#gap-customer-history).

### `GAP-PRICE-HISTORY-READ`
`product_price_history` is append-only, written on every price change, **no read endpoint**.
**F18-additive:** `GET /products/:id/variants/:variantId/price-history` (field-gated). F17 product
detail does not show a price timeline. See [017-A](../reporting/data-gaps.md#gap-price-history-read).

### `GAP-ORDER-MARGIN`
`order_items.unit_cost_snapshot` is captured at sale time but **not in `OrderItemResponseDto`**.
Exposing it (gated by `pricing.cost.view`) makes per-order / by-product **sales margin** possible
without the inventory costing engine. **F18-additive.** See [017-A](../reporting/data-gaps.md#gap-cost).

### `GAP-TRANSFER-CODE`
`inventory_transfers` has only the UUID `id` — no human code like `orders.order_number`. **Decision
(cosmetic):** F17 displays a short id slice or a derived label; a real sequence column is a minor
schema addition only if operators require it. Not a blocker.

**F17-07 (2026-09) — OPEN.** Confirmed against `TransferResponseDto`: no `code`/`number`/`folio`
field. The list and detail show `shortId(transfer.id)` (the shared 8-char helper) as the human
handle — no invented `TRF-…` code. A real sequence column stays a future minor schema addition.

### `GAP-IMPORT-PROGRESS`
Large imports are processed asynchronously by the Import Worker; the client learns status by
polling `GET /imports/:id`. **Decision:** polling cadence / a lightweight long-poll / SSE — pick
the simplest that gives acceptable UX. No backend contract change needed for basic polling.

**F17-11 (2026-09) — OPEN, degraded honestly.** Audited every import contract: `ImportJobResponseDto`
carries `status` + `totalRows`/`validRows`/`invalidRows`/`warningRows`/`importedRows`; `GET
/imports/:id/preview` adds a live per-status breakdown (`pendingRows`, `skippedRows`, `newProducts`,
`existingProducts`). There is **no** `progress` / `processedRows` / percentage field, **no** progress
endpoint, and **no** SSE/websocket anywhere in the module. F17-11 shows the **status and the real
counters only** — no progress bar, no percentage, no time-based estimate. While `status ∈
{validating, importing}` the detail page lightly auto-refreshes (`GET /imports/:id` every ~4s, the
polling this doc already blesses) and also offers a manual "Refresh". The cadence is a UI choice, and
there is still no true progress signal, so the gap stays **open**; a `processed_rows` counter or a
long-poll would be a clean, non-schema `F17-additive` improvement.

### `GAP-IMPORT-FILE-HEADERS`
No endpoint returns an uploaded file's parsed column headers. `POST /imports` stages
`import_job_rows.raw_data` (header-keyed) but the job DTO does not surface the header list, and there
is no `GET /imports/:id/headers`. **Consequence:** a free-form "map every column we detected" visual
mapper at the `uploaded` step is not buildable from a first-class contract.

**F17-11 (2026-09) — OPEN, degraded.** `S-IMP-NEW` requires the mapping **up front** — either a saved
`import_mapping_templates` row (`mappingTemplateId`) or a built-in "standard template layout" whose
`columnMapping` mirrors `ImportTemplateService.BASE_COLUMNS`'s exact header→field pairs (the same
module's own generator output — used when the operator filled in the downloadable template).
`S-IMP-TEMPLATES` provides a generic header→target builder the operator populates from their own
spreadsheet. A `GET /imports/:id/headers` (or headers on the job DTO) would let the wizard render a
real per-column mapper — small, non-schema, `F17-additive`.

### `GAP-SUSPENDED-TENANT-UX`
When a tenant is suspended mid-session (011-A), **every** tenant-scoped request starts returning
`403` (TenantGuard live check), while the access token stays valid (reactivation is instant).
**Decision:** the app shell should detect this pattern (systematic 403 across screens, or a
dedicated signal) and render a single clear "esta empresa está suspendida" state instead of a raw
403 per screen. Not in the prototypes. No backend change strictly required (a distinguishing
`code` on the 403 would help — F17-additive).

### `GAP-SA-CREATE-TENANT`
No `POST /platform/tenants` — companies are created only via the tenant's own self-service
`POST /auth/register`. **future** — a platform-ops phase, ADR first (who becomes the first admin,
invite flow). Super-Admin in F17 does not create tenants.

**F17-13 (2026-09) — OPEN, confirmed by code audit.** No create endpoint exists; the built
`S-SA-TENANTS` list is read-only (no "New company" control anywhere). Also confirmed there is **no**
platform `PATCH`/`DELETE` for a tenant (`TenantsPlatformRepository.updateName` is wired only to the
tenant's own `PATCH /tenant`), so `S-SA-TENANT-DETAIL` offers view + suspend/activate only — no
edit, no delete. Still `future`.

### `GAP-SA-TENANT-ADMINS`
No endpoint lets a Platform Admin list/manage a company's administrators or users. A Platform
Admin **must not** read tenant-scoped data (multi-tenancy.md) — this needs an explicit, audited,
SuperAdmin-scoped aggregate path that does not exist. **future.**

**F17-13 (2026-09) — OPEN, unchanged.** `S-SA-TENANT-DETAIL` shows only the 6 `tenants`-row fields;
it reads no tenant-scoped data and has no "users of this company" section. Still `future`.

### `GAP-SA-ADMIN-CRUD`
`platform_admins` has no CRUD endpoint — only the `seed:platform-admin` script. Managing other
platform admins from the UI is **future** (ADR: bootstrap vs UI, MFA).

**F17-13 (2026-09) — OPEN, unchanged.** No platform-admin management screen was built. Still `future`.

### `GAP-SA-PLATFORM-401`
The shared `apiFetch` 401 path always calls the **tenant** `POST /auth/refresh` and, on failure,
emits `session-expired`. The `(superadmin)` shell mounts no `SessionExpiryListener`, so a browser
401 during a platform mutation (suspend/activate) surfaces as a "session expired" alert in the
action panel rather than an automatic redirect to `/platform/login` (the admin reloads → the layout
redirects). Reads are unaffected (server-side, gated by `getPlatformSession()` in the layout).
**Class:** F17-additive. **Blocking:** no. **Fix:** a platform-aware refresh path + a platform
`SessionExpiryListener` (or a small platform variant of the client). Discovered in F17-13; not
worth a parallel HTTP client for the current surface.

### `GAP-AUDIT-READ`
`audit_log` is write-only from the app — no controller, no permission. Indexes for the reads
already exist. **future** — fits FASE 19 (security) or FASE 20 (observability); a new permission
(`core.audit.read`) + read endpoint + a SuperAdmin variant for platform actions + redaction rules
for `before_state`/`after_state`. No F17 screen. See [017-A](../reporting/data-gaps.md#gap-audit-read).

### `GAP-ATTR-DEF-DETAIL`
There is **no `GET /attribute-definitions/:id`** — only the list (`GET /attribute-definitions`).
F17-03's attribute detail/edit page fetches the (bounded, governance) list and finds the one by
id — fine for the current scale. **F17-additive (low):** a real detail endpoint would avoid the
full-list fetch if the attribute set ever grows large. Discovered in F17-03; not blocking.

### `GAP-ATTR-DISPLAY-ORDER`
`attribute_definitions.displayOrder` exists on the schema and the list is ordered by it, but the
column is **not in `CreateAttributeDefinitionDto` / `UpdateAttributeDefinitionDto` / the response
DTO** — so the F17-03 UI cannot set or show a definition's global display order (only the
*per-category* `displayOrder` on `category_attributes`, which F17-03 does manage). **F17-additive
(low):** add `displayOrder` to the definition DTOs if a tenant-global ordering is wanted.
Discovered in F17-03; not blocking (per-category order covers the product-form use case).

### `GAP-MEASUREMENT-UNITS-PERMISSION`
`GET /api/v1/measurement-units` declares **no `@RequirePermissions`** — any authenticated tenant
member can list the platform measurement-unit reference data. Low sensitivity (platform reference
data, no tenant content), same class of finding as `GAP-APPROVALS-PERMISSION`. **decision (low):**
gate it on `products.view` for consistency, or leave it (it is harmless reference data).
Observed in F17-03; **no code change made** (F17-03 does not touch the backend).

---

## Ambiguities requiring a decision before implementation

| # | Ambiguity | Options | Recommendation |
| --- | --- | --- | --- |
| A1 | Route names/structure for new modules | flat `(tenant)/products` vs nested; `/approvals` vs tab of `/sales` | Follow the flat FASE 16 convention; keep one route per screen ([f17-navigation.md](f17-navigation.md)) |
| A2 | Order visibility & location scope | tenant-wide vs location-scoped | Decide with `GAP-ORDERS-LOCATION` before Sales history |
| A3 | Inventory read location scope | scoped vs not | Scope for consistency (`GAP-INV-LOCATION-SCOPE`) — **F17-06 left it unscoped** (backend takes no actor on the read paths); revisit if the backend adds it |
| A4 | Brand/supplier fields in the product form | add read endpoints vs omit | **Decided in F17-05: omit** (option b) — no `GET /brands`/`GET /suppliers` exists; the form has no brand/supplier selector. Re-add when the endpoints land (`GAP-BRAND-SUPPLIER-LIST`) |
| A5 | Approvals permission gate | `.approve` / `.request` / new `.view` | **Decided in F17-09:** `@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')` — no new permission code; matches the service's existing OR check and the two real personas (`GAP-APPROVALS-PERMISSION`) |
| A6 | Notification-status contract shape | read-only projection + requeue endpoint | **F17-10:** read-only projection built (`GET /orders/:id/notifications`, no migration); requeue deferred as `GAP-NOTIF-RETRY-BACKEND` (needs a migration + permission + ADR) |
| A7 | Roles screen scope | read-only vs "coming soon" placeholder | F17: read-only view of the fixed catalogue. **Superseded** by the ROLES/PERMISSIONS block: full CRUD + permission picker + ADR-0034 self-escalation guard (`GAP-ROLE-CRUD` closed) |
| A8 | Date-filter boundary semantics | inclusive vs half-open | **Decided in F18-01:** half-open `[from, to)` for new FASE 18 endpoints, documented in `api.md`; `GET /orders` keeps its pre-existing inclusive-both-bounds semantics unchanged (`GAP-DATE-SEMANTICS`) |
| A9 | Home revenue tile | client-side sum (small tenants) vs defer to F18 | Defer to F18; F17 Home shows counts/queues only |
| A10 | Suspended-tenant UX | per-screen 403 vs shell-level state | Shell-level state (`GAP-SUSPENDED-TENANT-UX`) |
