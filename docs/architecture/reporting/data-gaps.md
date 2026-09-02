# DATA GAPS

> Every piece of information that **cannot be produced today**, with the exact reason. **Nothing
> here is implemented, scheduled, or designed by 017-A** — it is a register for `F17-00` and
> `FASE 18` to draw from. Each gap: what is missing, why it matters, blast radius, recommended
> phase, and a classification: **F17-needed** · **F18-needed** · **future** · **not recommended**.

Anchors are stable (linked from the other files): `#gap-<id>`.

| ID | Short name | Class |
| --- | --- | --- |
| [`GAP-REORDER`](#gap-reorder) | Reorder point / low-stock threshold | F18-needed |
| [`GAP-COST`](#gap-cost) | Inventory cost / valuation / COGS | future |
| [`GAP-SNAPSHOTS`](#gap-snapshots) | Historical snapshots for trend KPIs | F18-needed |
| [`GAP-SALES-AGGREGATE`](#gap-sales-aggregate) | Sales aggregation endpoint | F18-needed |
| [`GAP-INV-AGGREGATE`](#gap-inv-aggregate) | Inventory aggregation + name enrichment | F17-needed (partial) / F18 |
| [`GAP-MOVEMENTS-DATE-FILTER`](#gap-movements-date-filter) | Date range + sort on movements | F17-needed |
| [`GAP-MULTI-STATUS`](#gap-multi-status) | Multi-status filter on lists | F17-needed |
| [`GAP-ORDERS-LOCATION-FILTER`](#gap-orders-location-filter) | `locationId` filter on orders | F18-needed |
| [`GAP-ORDER-CONFIRMED-AT`](#gap-order-confirmed-at) | `confirmed_at` timestamp on orders | F18-needed |
| [`GAP-NOTIF-STATUS`](#gap-notif-status) | Notification status per order + retry | F17-needed |
| [`GAP-AUDIT-READ`](#gap-audit-read) | Audit-log read endpoint | future |
| [`GAP-CUSTOMER-HISTORY`](#gap-customer-history) | Per-customer order history / LTV | F18-needed |
| [`GAP-CUSTOMER-DATE-FILTER`](#gap-customer-date-filter) | Date filter on customers | F18-needed |
| [`GAP-EXCEPTIONAL-FILTER`](#gap-exceptional-filter) | Filter/aggregate exceptional-discount lines | F18-needed |
| [`GAP-RETURN-AGGREGATE`](#gap-return-aggregate) | Return lines by disposition / value | F18-needed |
| [`GAP-SERIAL-LOT-READ`](#gap-serial-lot-read) | Serial / lot read + traceability | future |
| [`GAP-PRICE-HISTORY-READ`](#gap-price-history-read) | Price-history read endpoint | F18-needed |
| [`GAP-VARIANT-LIST`](#gap-variant-list) | Tenant-wide variant list + search | F17-needed |
| [`GAP-BRAND-SUPPLIER-LIST`](#gap-brand-supplier-list) | Brand / supplier list for selectors | F17-needed |
| [`GAP-TRANSFER-CODE`](#gap-transfer-code) | Human-readable transfer code | not recommended (cosmetic) |
| [`GAP-NAME-ENRICHMENT`](#gap-name-enrichment) | Name resolution in list responses | F17-needed |
| [`GAP-SEARCH`](#gap-search) | Free-text search on products / orders | F17-needed |
| [`GAP-SORT`](#gap-sort) | `sort` param on list endpoints | F17-needed |
| [`GAP-PLATFORM-AGGREGATE`](#gap-platform-aggregate) | Cross-tenant platform metrics | future |
| [`GAP-EXPORT`](#gap-export) | Export infrastructure | F18-needed |
| [`GAP-APPROVALS-PERMISSION`](#gap-approvals-permission) | `GET /price-approvals` has no permission | F17-needed (defect) |

---

### `GAP-REORDER`
- **Required:** a per-variant (or per-variant-per-location) reorder point / minimum / par level to
  define "low stock".
- **Why:** every "low stock" / "reorder" KPI, tile, tab, and alert. `KPI-INV-LOW-STOCK`,
  Inventory "Stock bajo" tab and status badge, Home low-stock section.
- **Domain:** Inventory.
- **Missing:** a column (e.g. `product_variants.reorder_point` or a new
  `inventory_reorder_rules(variant_id, location_id, min_qty, target_qty)` table). **Schema
  change.** No endpoint, no calculation.
- **Impact:** "low stock" cannot be shown at all. The prototypes' most prominent inventory signal
  is unbuildable. Any threshold chosen without this is invented and wrong.
- **Recommended phase:** **F18-needed** (with an ADR — it is a new domain concept, not a
  gap-fill). F17 shows "out of stock" (available = 0, state B) instead.

### `GAP-COST`
- **Required:** cost-at-the-moment-of-movement on `inventory_movements` (or a costing engine:
  FIFO / weighted-average / standard), to compute inventory value and COGS.
- **Why:** `KPI-INV-VALUE`, `REP-INV-VALUATION`, gross-margin reporting, any "worth" figure.
- **Domain:** Inventory / Sales.
- **Missing:** `inventory_movements` has **no cost/value column**. `product_variants.cost` is
  current, nullable, mutable — not an as-of cost. No costing method is defined anywhere.
  `order_items.unit_cost_snapshot` **does** exist (per-order margin is possible — see
  `GAP-ORDER-MARGIN` note below) but inventory-side valuation is not.
- **Impact:** no inventory valuation, no COGS, no margin-by-product from the ledger.
- **Recommended phase:** **future** — needs an explicit ADR (costing method is a significant
  accounting decision) before any phase.
- **Sub-note `GAP-ORDER-MARGIN`:** `order_items.unit_cost_snapshot` is captured at sale time but
  **not exposed** by `OrderItemResponseDto`. Exposing it (gated by `pricing.cost.view`) would make
  per-order and by-product **sales margin** computable without the inventory costing engine.
  Small, additive. **F18-needed.**

### `GAP-SNAPSHOTS`
- **Required:** periodic snapshots / rollups of point-in-time state (stock levels, queue depths,
  open value) so trend lines and "vs last month" for non-`orders` subjects are possible.
- **Why:** every trend chart; comparison for `KPI-INV-*`, `KPI-OPS-*`.
- **Missing:** no snapshot table, no rollup job.
- **Impact:** point-in-time KPIs are a single number with no history.
- **Recommended phase:** **F18-needed** (the REPORTS read-side; roadmap already anticipates
  "materialized views or a read replica").

### `GAP-SALES-AGGREGATE`
- **Required:** a read-side endpoint that returns grouped sales figures:
  `{ from, to, groupBy: day|week|month|product|customer|location, status }` →
  `{ orderCount, subtotal, discountTotal, total, avgTicket }` per group.
- **Why:** `KPI-SALES-REVENUE`, `KPI-SALES-AVG-TICKET`, `REP-SALES-BY-PERIOD/PRODUCT/CUSTOMER`,
  the executive dashboard, `SalesHistoryDesktop` KPI tiles.
- **Missing:** `GET /orders` returns rows only, `meta.total` gives counts but no sums, no grouping.
- **Impact:** revenue and everything derived from it require paging every matching order and
  folding client-side — acceptable for a tiny tenant, wrong at scale.
- **Recommended phase:** **F18-needed** — the core REPORTS read-side deliverable. Must not reuse
  `OrdersRepository` (modules.md / roadmap FASE 18).

### `GAP-INV-AGGREGATE`
- **Required:** aggregated inventory reads — `Σ available/reserved/committed` by tenant / warehouse
  / category; count of zero/out-of-stock SKUs; in-transit per variant/location across all open
  transfers — **with product/location/warehouse names**.
- **Why:** `KPI-INV-ONHAND`, `KPI-INV-OOS-SKUS`, `KPI-INV-INTRANSIT`, `REP-INV-STOCK`,
  `REP-INV-INTRANSIT`, the Inventory screen's columns and tabs.
- **Missing:** `GET /inventory/balances` returns raw rows, no joins, no warehouse/category filter,
  no Σ; no cross-transfer in-transit aggregate.
- **Impact:** the Inventory list is IDs + numbers only; totals and the enriched view are not
  available.
- **Recommended phase:** **F17-needed (partial)** — name enrichment + a warehouse filter on the
  operational list is a small F17 addition; the Σ / grouped / valuation views are **F18**.

### `GAP-MOVEMENTS-DATE-FILTER`
- **Required:** `occurredFrom` / `occurredTo` (and/or `createdFrom`/`createdTo`), a `sort` param,
  and a `referenceType` / `referenceId` filter on `GET /inventory/movements`.
- **Why:** kardex (`REP-INV-KARDEX`), "movements this month", adjustments audit, drill-down from a
  reference.
- **Missing:** the DTO has only `productVariantId` / `locationId` / `movementType`.
- **Impact:** a proper stock card (which the ledger fully supports — `balance_after` is stored)
  cannot be rendered for a date range or guaranteed chronological.
- **Recommended phase:** **F17-needed** — small, additive DTO/query change, no schema impact
  (`inventory_movements(tenant_id, created_at)` index already exists).

### `GAP-MULTI-STATUS`
- **Required:** `status` as a repeatable/array param on the list endpoints (transfers, returns,
  imports, orders).
- **Why:** "open transfers", "returns to process", "imports running" — all are multi-status
  concepts today requiring N separate calls.
- **Missing:** every list DTO takes a single `@IsIn` status.
- **Impact:** dashboard queue tiles fan out into multiple requests; state drops from A to B.
- **Recommended phase:** **F17-needed** — trivial DTO change.

### `GAP-ORDERS-LOCATION-FILTER`
- **Required:** `locationId` query param on `GET /orders`.
- **Why:** `KPI-SALES-BY-LOCATION`, `REP-SALES-BY-LOCATION`, location-scoped sales visibility.
- **Missing:** `orders.location_id` is on the row; not a filter.
- **Impact:** sales-by-branch is impossible; and there is no way to location-scope order
  visibility for a restricted user.
- **Recommended phase:** **F18-needed** (filter) — and `F17-00` must decide whether order
  visibility should be location-scoped at all (ADR-0024 currently does not cover orders).

### `GAP-ORDER-CONFIRMED-AT`
- **Required:** a `confirmed_at` timestamp on `orders` (and possibly `cancelled_at`).
- **Why:** "revenue confirmed in period" vs the current "orders *created* in period that are now
  confirmed". Also enables confirm-latency metrics.
- **Missing:** `orders` has only `created_at` / `updated_at`. The `sales.order.confirmed` event's
  `occurredAt` in `event_outbox` is the closest existing signal, but that table is not a reporting
  source.
- **Impact:** period revenue has a boundary ambiguity (small, real).
- **Recommended phase:** **F18-needed** — additive column, backfillable from `event_outbox` /
  `audit_log`.

### `GAP-NOTIF-STATUS`
- **Required:** a narrow, tenant-scoped read of `event_outbox` keyed by `aggregate_id` (order id),
  returning `{ eventType, status, attempts, processedAt, lastError? }`; plus an authorized
  "retry" action that re-enqueues the existing row.
- **Why:** the roadmap's **FASE 17** item — notification-status indicator + "retry notification"
  on `SalesHistoryDesktop` / order detail (`NOTIF-ORDER-STATUS`).
- **Missing:** only the **endpoint + a permission**. The DB layer already permits a tenant read:
  migration `0010` grants `SELECT, INSERT ON event_outbox TO app_tenant` **and** an
  `event_outbox_tenant_isolation` RLS policy (`FOR ALL TO app_tenant`), plus the
  `event_outbox_tenant_created_idx` index. There is simply no repository/service/controller that
  reads it and no `*.view` gate. The **retry** action is the harder half: `app_tenant` has
  `SELECT, INSERT` but **not `UPDATE`** on `event_outbox`, so a requeue that resets
  `status`/`attempts`/`claimed_*` needs either a narrow new grant (guarded to those columns / that
  transition) or a processor-mediated action — and must never recreate the domain event, the
  order, or its inventory movements (a `prevent_tenant_id_change` trigger already guards the
  `tenant_id`).
- **Impact:** the order screen cannot show whether the Telegram notification was sent.
- **Recommended phase:** **F17-needed** (explicitly a FASE 17 scope item). The read is a small,
  safe projection; the retry needs a careful, minimal design.

### `GAP-AUDIT-READ`
- **Required:** a paginated, filterable read endpoint over `audit_log` (by `entity_type`/
  `entity_id`, `actor_id`, `action_code`, date range) + a `core.audit.read` permission; and a
  SuperAdmin variant for platform actions (`tenant_id IS NULL`).
- **Why:** `REP-ADMIN-AUDIT`, `KPI-ADMIN-ACTIVITY`, "who changed this price/order/user", security
  review.
- **Missing:** `audit_log` is **write-only** from the app — no controller, no permission. Indexes
  `(tenant_id, entity_type, entity_id)`, `(tenant_id, created_at)`, `(action_code, created_at)`
  already support the reads.
- **Impact:** no in-app audit visibility at all.
- **Recommended phase:** **future** — natural fit with FASE 19 (security hardening) or FASE 20
  (observability). A new permission + read endpoint; `before_state`/`after_state` JSONB may need
  redaction rules.

### `GAP-CUSTOMER-HISTORY`
- **Required:** per-customer order rollup (order count, total spent, last order date, avg ticket),
  and a "customers with no orders" view.
- **Why:** `CUST-LTV`, `REP-SALES-BY-CUSTOMER`, a "Clientes" detail screen, executive "top
  customers".
- **Missing:** `GET /orders?customerId=` gives one customer's orders (client-side sum); no
  rollup, no ranking, no "zero orders".
- **Recommended phase:** **F18-needed** (part of `GAP-SALES-AGGREGATE` with `groupBy: customer`).

### `GAP-CUSTOMER-DATE-FILTER`
- **Required:** `createdFrom`/`createdTo` on `GET /customers`.
- **Why:** `CUST-NEW-PERIOD` ("new customers this month").
- **Missing:** the DTO has `status` / `type` / `q` only.
- **Recommended phase:** **F18-needed** (small).

### `GAP-EXCEPTIONAL-FILTER`
- **Required:** filter `GET /orders` (or a sales-lines read) by `is_exceptional_discount`, and/or
  aggregate exceptional-line count and discount value by period.
- **Why:** `KPI-SALES-EXCEPTIONAL` ("discount leakage"), `REP-SALES-EXCEPTIONAL`, pricing
  governance oversight.
- **Missing:** the flag is on `order_items`, not filterable, not aggregated. `price_approvals`
  covers *below-min* lines that went through approval, but not the full exceptional set, and has
  no date filter.
- **Recommended phase:** **F18-needed**.

### `GAP-RETURN-AGGREGATE`
- **Required:** returns aggregated by disposition, by period, by product; returned value (qty ×
  `order_item.unit_price_snapshot`); return rate vs sales.
- **Why:** `RET-BY-DISPOSITION`, `RET-VALUE`, `RET-RATE`, `REP-RET-BY-DISPOSITION`.
- **Missing:** `sales_return_items` are only visible inside a return's detail; no list, no filter,
  no aggregate; `sales_returns` has no date filter.
- **Recommended phase:** **F18-needed**.

### `GAP-SERIAL-LOT-READ`
- **Required:** read endpoints for `product_serials` (by variant, by status) and `product_lots`
  (by variant, by expiry); and serial/lot linkage on movements for traceability.
- **Why:** serial/lot reports, expiry alerts, unit traceability.
- **Missing:** no read endpoint for either table; `inventory_movements` has no serial/lot column
  (a **known deferred design** — "no approved `order_items` ↔ `product_serials`/`product_lots`
  model", roadmap).
- **Recommended phase:** **future** — gated on the deferred serialized/lot-sale design.

### `GAP-PRICE-HISTORY-READ`
- **Required:** `GET /products/:id/variants/:variantId/price-history` (or similar), field-gated.
- **Why:** `CAT-PRICE-CHANGES`, price-audit, "how has this price moved".
- **Missing:** `product_price_history` is append-only, written on every price change, **no read
  endpoint**.
- **Recommended phase:** **F18-needed** (small, additive; respect ADR-0028 field gates).

### `GAP-VARIANT-LIST`
- **Required:** a tenant-wide `GET /variants` (or `GET /products/variants`) with SKU/barcode/name
  search and status filter.
- **Why:** New Sale instant SKU search, a flat variant report, inventory filtering by SKU.
- **Missing:** variants are only reachable per-product (`GET /products/:id/variants`).
- **Recommended phase:** **F17-needed** — New Sale's core interaction depends on it.

### `GAP-BRAND-SUPPLIER-LIST`
- **Required:** `GET /brands`, `GET /suppliers` (at least a read list) for the Product form
  selectors.
- **Why:** `ProductForm` shows brand + supplier fields; `products.brand_id`/`supplier_id` are real
  FKs.
- **Missing:** ADR-0019 keeps brands/suppliers as reference entities **without CRUD** — there is
  no list endpoint, so the selectors have no data source.
- **Impact:** a product cannot be assigned a brand or supplier through the API today (only the
  columns exist).
- **Recommended phase:** **F17-needed** — `F17-00` must decide: add read-only list endpoints, or
  drop the fields from the form for F17. Adding write CRUD would need an ADR amendment.

### `GAP-TRANSFER-CODE`
- **Required:** a human-readable transfer identifier (like `orders.order_number`).
- **Why:** the Transfers prototype shows a "Código" column.
- **Missing:** `inventory_transfers` has only the UUID `id`.
- **Recommended phase:** **not recommended** as a data gap — cosmetic. F17 can display a short id
  slice or a derived label; a real sequence column is a minor schema addition only if operators
  demand it.

### `GAP-NAME-ENRICHMENT`
- **Required:** list responses that carry human names, not just FKs — product name/SKU on
  balances/movements/transfer lines; location/warehouse names on balances/movements/transfers/
  orders; user names on movements/transfers/approvals/returns.
- **Why:** every operational list screen; without it the UI must issue N lookup calls or maintain
  client-side dictionaries.
- **Missing:** balances, movements, transfers responses are **IDs only**.
- **Recommended phase:** **F17-needed** — additive response fields (a join in the service), no
  schema change. This is the single highest-leverage F17 backend adjustment for the operational
  screens.

### `GAP-SEARCH`
- **Required:** free-text `q` on `GET /products` (name / SKU / barcode) and `GET /orders`
  (order number / customer name snapshot).
- **Why:** Products list search, Sales history search — both drawn, neither backed.
- **Missing:** only `GET /customers` has `q`.
- **Recommended phase:** **F17-needed** — api.md already frames search as a per-endpoint
  documented `q` param.

### `GAP-SORT`
- **Required:** an allow-listed `sort` param per list endpoint (api.md specifies this; none
  implemented).
- **Why:** sortable table headers in every list prototype.
- **Recommended phase:** **F17-needed** — additive, per endpoint.

### `GAP-PLATFORM-AGGREGATE`
- **Required:** an explicit, audited, SuperAdmin-scoped cross-tenant aggregate read path
  (users-per-tenant, activity, storage, last-activity) — never the tenant repository with the
  filter off.
- **Why:** a real SuperAdmin platform dashboard beyond company counts.
- **Missing:** no such endpoint; multi-tenancy.md explicitly requires it be a dedicated aggregate
  path, and it does not exist.
- **Recommended phase:** **future** — FASE 18+ / a platform-operations phase, with its own ADR.

### `GAP-EXPORT`
- **Required:** an export mechanism for lists/reports (CSV/XLSX), reusing the existing
  `ObjectStorageService` + a job pattern, or streaming for small sets.
- **Why:** "Exportar" buttons in `Main`, `SalesHistoryDesktop`; operational data extraction.
- **Missing:** the only file-generation paths are the import template (`exceljs`) and the import
  error report — neither is a generic export. No export endpoint, no async export job.
- **Recommended phase:** **F18-needed** — see [exports](#exports) below.

### `GAP-APPROVALS-PERMISSION`
- **Required:** `@RequirePermissions(...)` on `GET /price-approvals` and `GET /price-approvals/:id`.
- **Why:** every other tenant read endpoint declares a permission; these two do not, so any
  authenticated tenant member can read the price-approval queue (which carries pricing context).
- **Missing:** the decorator. **This is a pre-existing gap, observed during the 017-A audit —
  017-A does not change code.**
- **Recommended phase:** **F17-needed** (or FASE 19) — pick the right gate (`pricing.discount.request`
  to see one's own, `pricing.discount.approve` to see the queue, or a new `pricing.discount.view`).

---

## Exports

(017-A §14 — analysis only, nothing built.)

| Export type | Example | Infra today | State |
| --- | --- | --- | --- |
| **Operational** — a filtered list as-is | current stock, orders of a period, import rows | `ObjectStorageService` (S3/MinIO) exists; `exceljs` is a dependency (import template). No generic export endpoint or job. | **C** — `GAP-EXPORT`. F17 can offer client-side CSV of the *current page* only. |
| **Report** — a defined report with totals | sales-by-period, transfers, approvals | none (reports themselves are B/C) | **C** — depends on the FASE 18 read-side existing first. |
| **Analytical** — large dataset / scheduled | full sales export, inventory valuation | none | **C** — FASE 18+, async job over the read-side, delivered via object storage (same pattern as the import error report). |

**Recommendation:** exports are a **FASE 18** concern, built on top of the read-side, using the
existing object-storage + async-job patterns (the Import Worker is the precedent). F17 must not
ship a server-side export; a client-side "download visible rows as CSV" is acceptable as a stopgap
and needs no backend.

## Not recommended

| Item | Why not |
| --- | --- |
| Inventing a low-stock threshold (fixed number / % of some baseline) | Wrong by construction — the business has no such rule modelled. Wait for `GAP-REORDER` + ADR. |
| A generic query/filter passthrough (`?filter=...`) for reports | api.md explicitly rejects this (leaks schema shape). Each filter stays explicit and allow-listed. |
| Reusing transactional repositories for report aggregation | modules.md / roadmap FASE 18 forbid it — reporting gets its own read-side. |
| SuperAdmin dashboards over tenant data via "don't filter this time" | Violates the tenant-isolation invariant. Needs `GAP-PLATFORM-AGGREGATE`. |
| A `PURCHASING` / supplier-receiving reporting set | No PURCHASING context (ADR-0019 / roadmap). Must be designed as a bounded context first. |
| Fiscal / tax / e-invoice reports | `tax_total` always 0; no fiscal document is ever issued (ADR-0023). |
