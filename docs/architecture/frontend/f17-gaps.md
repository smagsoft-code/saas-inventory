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
| 4 | [`GAP-APPROVALS-PERMISSION`](#gap-approvals-permission) | F17-blocking (defect) | Approvals list, nav gating |
| 5 | [`GAP-ORDERS-LOCATION`](#gap-orders-location) | decision → F18 | Sales history, Order detail, Home "orders today" |
| 6 | [`GAP-NOTIF-STATUS`](#gap-notif-status) | F17-blocking for that feature | Order detail, Sales history |
| 7 | [`GAP-MULTI-STATUS`](#gap-multi-status) | F17-additive | Home tiles, Transfers/Returns/Imports tabs |
| 8 | [`GAP-HOME-DATE-TZ`](#gap-home-date-tz) | F17-blocking for date tiles | Home, any date filter |
| 9 | [`GAP-DATE-SEMANTICS`](#gap-date-semantics) | decision | Sales history date filter |
| 10 | [`GAP-MOVEMENTS-DATE-FILTER`](#gap-movements-date-filter) | F17-additive | Movements, Kardex |
| 11 | [`GAP-SEARCH`](#gap-search) | F17-additive | Products, Sales history |
| 12 | [`GAP-SORT`](#gap-sort) | F17-additive | every list |
| 13 | [`GAP-INV-AGGREGATE`](#gap-inv-aggregate) | F18 (+ small F17 slice) | Inventory list totals/tabs, Home |
| 14 | [`GAP-REORDER`](#gap-reorder) | future (ADR) | Inventory "low stock" tab/tile |
| 15 | [`GAP-INV-LOCATION-SCOPE`](#gap-inv-location-scope) | decision → F17-additive | Inventory list, Movements |
| 16 | [`GAP-ROLE-CRUD`](#gap-role-crud) | future | Roles screen |
| 17 | [`GAP-USER-FILTERS`](#gap-user-filters) | F17-additive | Users list |
| 18 | [`GAP-CUSTOMER-HISTORY`](#gap-customer-history) | F18 | Customer detail |
| 19 | [`GAP-PRICE-HISTORY-READ`](#gap-price-history-read) | F18-additive | Product detail |
| 20 | [`GAP-ORDER-MARGIN`](#gap-order-margin) | F18-additive | Order detail |
| 21 | [`GAP-TRANSFER-CODE`](#gap-transfer-code) | decision (cosmetic) | Transfers list |
| 22 | [`GAP-IMPORT-PROGRESS`](#gap-import-progress) | decision | Import wizard |
| 23 | [`GAP-SUSPENDED-TENANT-UX`](#gap-suspended-tenant-ux) | decision | App shell |
| 24 | [`GAP-SA-CREATE-TENANT`](#gap-sa-create-tenant) | future | Super-Admin |
| 25 | [`GAP-SA-TENANT-ADMINS`](#gap-sa-tenant-admins) | future | Super-Admin |
| 26 | [`GAP-SA-ADMIN-CRUD`](#gap-sa-admin-crud) | future | Super-Admin |
| 27 | [`GAP-AUDIT-READ`](#gap-audit-read) | future | (no F17 screen) |
| 28 | [`GAP-PLATFORM-AGGREGATE`](../reporting/data-gaps.md#gap-platform-aggregate) | future | Super-Admin dashboard |

---

### `GAP-NAME-ENRICHMENT`
`GET /inventory/balances`, `GET /inventory/movements`, `GET /inventory/transfers` return **FK ids
only** — no product name/SKU, no location/warehouse name, no user name. The design shows named
columns everywhere. **F17-additive:** add the joined names to the response DTOs (a service-level
join; no schema change; indexes exist). Without it F17 must either issue N lookups (rejected —
audit §9 GAP 2 says no N+1 from the frontend) or maintain client-side dictionaries. **This is the
single highest-leverage F17 backend adjustment.** See [017-A `GAP-INV-AGGREGATE`](../reporting/data-gaps.md#gap-inv-aggregate).

### `GAP-VARIANT-LIST`
Variants are reachable **only** per-product (`GET /products/:id/variants`). New Sale's core
interaction is "type a SKU → add the line". **F17-blocking:** needs a tenant-wide
`GET /variants?q=<sku|barcode|name>&status=` (or `GET /products/variants`). Interim: F17 can force
"pick a product, then a variant" — clunky but functional. See [017-A](../reporting/data-gaps.md#gap-variant-list).

### `GAP-BRAND-SUPPLIER-LIST`
`products.brand_id` / `supplier_id` are real FKs and the Product form shows the fields, but
ADR-0019 keeps brands/suppliers as reference entities **without any endpoint** — no list, so the
selectors have no data source, and a product cannot actually be assigned a brand/supplier via the
API today. **Decision:** (a) add read-only `GET /brands` / `GET /suppliers` (F17-additive, no ADR
change — they'd stay CRUD-less), or (b) omit both fields from the F17 product form. Recommend (a).

### `GAP-APPROVALS-PERMISSION`
`GET /price-approvals` and `GET /price-approvals/:id` declare **no `@RequirePermissions`** — any
authenticated tenant member can read the price-approval queue (which carries pricing context).
Every other tenant read endpoint declares a permission. **F17-blocking (defect):** the backend
must add a gate before the Approvals screen ships; F17-00 recommends `pricing.discount.approve`
for the queue and `pricing.discount.request` (own requests) — or a new `pricing.discount.view`.
Also affects nav-item gating. Observed in 017-A, unchanged.

### `GAP-ORDERS-LOCATION`
`orders.location_id` exists but `GET /orders` has **no `locationId` filter** and the endpoint does
not location-scope order visibility. **Decision needed:** should an operational user see only
orders placed at their authorized locations? If yes → add the filter + scope (F18/additive). If no
→ document that order visibility is tenant-wide for `sales.orders.view` holders. Blocks
`REP-SALES-BY-LOCATION` (F18) either way. See [017-A](../reporting/data-gaps.md#gap-orders-location-filter).

### `GAP-NOTIF-STATUS`
Roadmap FASE 17 item: a `sent`/`pending`/`failed` badge on the order + an authorized "retry
notification". `event_outbox` is DB-readable by `app_tenant` (migration 0010 grants `SELECT,
INSERT` + tenant-isolation RLS + `event_outbox_tenant_created_idx`) but **no
repository/service/controller reads it and no permission gates it**. The retry needs an `UPDATE`
grant (`app_tenant` has none) or a processor-mediated action, and must never recreate the event,
the order, or its inventory movements. **F17-blocking for this feature:** a small read projection
+ a guarded requeue, contract to be designed first. See [017-A](../reporting/data-gaps.md#gap-notif-status).

### `GAP-MULTI-STATUS`
Every list DTO takes a single `@IsIn` status. "Open transfers", "returns to process", "imports
running" are multi-status → N calls each. **F17-additive:** accept `status` as a repeatable/array
param on transfers, returns, imports, orders. Trivial DTO change, no schema impact.

### `GAP-HOME-DATE-TZ`
"Orders today", "this month" etc. must be computed in `tenant_settings.timezone` (the only tz
source), converted to a UTC `createdFrom`/`createdTo` range for `GET /orders`. **No endpoint does
this.** **F17-blocking for date tiles:** F17 must fetch the tenant timezone and do the conversion
client-side (or F18 read-side does it). Low effort, must not be skipped or "today" is wrong for
non-UTC tenants.

### `GAP-DATE-SEMANTICS`
`api.md` does not document whether `createdFrom`/`createdTo` are inclusive/exclusive. **Decision:**
confirm the service behaviour (recommend half-open `[from, to)`), document it in `api.md` before
building the Sales history date picker.

### `GAP-MOVEMENTS-DATE-FILTER`
`GET /inventory/movements` has only `productVariantId`/`locationId`/`movementType` — **no date
range, no `sort`, no reference filter**. A proper kardex (the ledger *stores* `balance_after`)
needs a date range + guaranteed chronological order. **F17-additive:** `occurredFrom`/`occurredTo`
+ `sort` + `referenceType`/`referenceId`. Index `(tenant_id, created_at)` already exists. See
[017-A](../reporting/data-gaps.md#gap-movements-date-filter).

### `GAP-SEARCH`
Only `GET /customers` has `?q=`. Products list and Sales history show search boxes with no
backing. **F17-additive:** `?q=` on `GET /products` (name/SKU/barcode) and `GET /orders`
(order number / customer snapshot name). `api.md` already frames search as a per-endpoint `q`
param. See [017-A](../reporting/data-gaps.md#gap-search).

### `GAP-SORT`
No list endpoint exposes `sort`. **F17-additive:** an allow-listed `sort` param per endpoint
(`api.md` specifies this pattern). Until then F17 tables do not offer sortable headers.

### `GAP-INV-AGGREGATE`
`GET /inventory/balances` returns raw rows, no Σ, no warehouse/category filter, no cross-transfer
in-transit aggregate, no zero/out-of-stock rollup. **F17 slice (additive):** warehouse filter +
name enrichment on the operational list. **F18:** the Σ / grouped / valuation views and the
`KPI-INV-OOS-SKUS` read for Home. See [017-A](../reporting/data-gaps.md#gap-inv-aggregate).

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

### `GAP-ROLE-CRUD`
No endpoint to create/edit roles or toggle role permissions — the catalogue is fixed
(`DEFAULT_ROLE_TEMPLATES`), editable only via direct DB. The nav/design imply "Roles / Permisos"
as manageable. **future:** custom-role CRUD + per-role permission toggling (database.md anticipates
it). **F17 = read-only Roles view.**

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

### `GAP-IMPORT-PROGRESS`
Large imports are processed asynchronously by the Import Worker; the client learns status by
polling `GET /imports/:id`. **Decision:** polling cadence / a lightweight long-poll / SSE — pick
the simplest that gives acceptable UX. No backend contract change needed for basic polling.

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

### `GAP-SA-TENANT-ADMINS`
No endpoint lets a Platform Admin list/manage a company's administrators or users. A Platform
Admin **must not** read tenant-scoped data (multi-tenancy.md) — this needs an explicit, audited,
SuperAdmin-scoped aggregate path that does not exist. **future.**

### `GAP-SA-ADMIN-CRUD`
`platform_admins` has no CRUD endpoint — only the `seed:platform-admin` script. Managing other
platform admins from the UI is **future** (ADR: bootstrap vs UI, MFA).

### `GAP-AUDIT-READ`
`audit_log` is write-only from the app — no controller, no permission. Indexes for the reads
already exist. **future** — fits FASE 19 (security) or FASE 20 (observability); a new permission
(`core.audit.read`) + read endpoint + a SuperAdmin variant for platform actions + redaction rules
for `before_state`/`after_state`. No F17 screen. See [017-A](../reporting/data-gaps.md#gap-audit-read).

---

## Ambiguities requiring a decision before implementation

| # | Ambiguity | Options | Recommendation |
| --- | --- | --- | --- |
| A1 | Route names/structure for new modules | flat `(tenant)/products` vs nested; `/approvals` vs tab of `/sales` | Follow the flat FASE 16 convention; keep one route per screen ([f17-navigation.md](f17-navigation.md)) |
| A2 | Order visibility & location scope | tenant-wide vs location-scoped | Decide with `GAP-ORDERS-LOCATION` before Sales history |
| A3 | Inventory read location scope | scoped vs not | Scope for consistency (`GAP-INV-LOCATION-SCOPE`) |
| A4 | Brand/supplier fields in the product form | add read endpoints vs omit | Add read-only lists (`GAP-BRAND-SUPPLIER-LIST`) |
| A5 | Approvals permission gate | `.approve` / `.request` / new `.view` | New `pricing.discount.view` is cleanest (`GAP-APPROVALS-PERMISSION`) |
| A6 | Notification-status contract shape | read-only projection + requeue endpoint | Design a minimal read + a guarded requeue (`GAP-NOTIF-STATUS`) |
| A7 | Roles screen scope | read-only vs "coming soon" placeholder | Read-only view of the fixed catalogue (`GAP-ROLE-CRUD`) |
| A8 | Date-filter boundary semantics | inclusive vs half-open | Half-open `[from, to)`, document in `api.md` (`GAP-DATE-SEMANTICS`) |
| A9 | Home revenue tile | client-side sum (small tenants) vs defer to F18 | Defer to F18; F17 Home shows counts/queues only |
| A10 | Suspended-tenant UX | per-screen 403 vs shell-level state | Shell-level state (`GAP-SUSPENDED-TENANT-UX`) |
