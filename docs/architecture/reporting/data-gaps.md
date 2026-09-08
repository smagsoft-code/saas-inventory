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
| [`GAP-SALES-AGGREGATE`](#gap-sales-aggregate) | Sales aggregation endpoint | ~~F18-needed~~ **RESOLVED (F18-02)** — `location` grouping still open |
| [`GAP-INV-AGGREGATE`](#gap-inv-aggregate) | Inventory aggregation + name enrichment | ~~F17-needed (partial) / F18~~ **PARTIALLY RESOLVED (F18-03)** — Σ available/reserved + out-of-stock count by warehouse/category built; name enrichment on the *raw* balances/movements lists stays open |
| [`GAP-MOVEMENTS-DATE-FILTER`](#gap-movements-date-filter) | Date range + sort on movements | ~~F17-needed~~ **PARTIALLY RESOLVED (F18-03)** — `occurredFrom`/`occurredTo` built; `sort` and `referenceType`/`referenceId` filters still open |
| [`GAP-MOV-AGGREGATE`](#gap-mov-aggregate) | Movement count / signed quantity aggregated by period or type | ~~F18-needed~~ **RESOLVED (F18-07)** — `GET /reports/movements-summary` (`inventory.view`), `groupBy=day\|week\|month\|type`, `[from,to)` on `occurred_at`, `movementType`/`locationId`/`productVariantId` filters |
| [`GAP-MULTI-STATUS`](#gap-multi-status) | Multi-status filter on lists | F17-needed |
| [`GAP-ORDERS-LOCATION-FILTER`](#gap-orders-location-filter) | `locationId` filter on orders | F18-needed |
| [`GAP-ORDER-CONFIRMED-AT`](#gap-order-confirmed-at) | `confirmed_at` timestamp on orders | F18-needed |
| [`GAP-NOTIF-STATUS`](#gap-notif-status) | Notification status per order + retry | F17-needed |
| [`GAP-AUDIT-READ`](#gap-audit-read) | Audit-log read endpoint | future |
| [`GAP-CUSTOMER-HISTORY`](#gap-customer-history) | Per-customer order history / LTV | ~~F18-needed~~ **PARTIALLY RESOLVED (F18-02)** — ranking done; last-order-date / zero-order view still open |
| [`GAP-CUSTOMER-DATE-FILTER`](#gap-customer-date-filter) | Date filter on customers | F18-needed |
| [`GAP-EXCEPTIONAL-FILTER`](#gap-exceptional-filter) | Filter/aggregate exceptional-discount lines | ~~F18-needed~~ **PARTIALLY RESOLVED (F18-06)** — `exceptional=all\|only\|exclude` filter on `GET /reports/sales-summary` (order grain for period/customer, line grain for product); a per-period exceptional *line-count* / the `KPI-SALES-EXCEPTIONAL` rate stays open |
| [`GAP-RETURN-AGGREGATE`](#gap-return-aggregate) | Return lines by disposition / value | ~~F18-needed~~ **PARTIALLY RESOLVED (F18-04)** — day/week/month/product/customer/disposition grouping + returned value built; return rate vs sales stays a client-side combination of two endpoints |
| [`GAP-RETURN-RESOLVED-AT`](#gap-return-resolved-at) | `resolved_at`/`received_at` timestamp on `sales_returns` | F18-needed |
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
| [`GAP-APPROVALS-PERMISSION`](#gap-approvals-permission) | `GET /price-approvals` has no permission | ~~F17-needed (defect)~~ **RESOLVED (F17-09)** |
| [`GAP-APPR-AGGREGATE`](#gap-appr-aggregate) | Approval-workflow rate / discount-value aggregation | ~~F18-needed~~ **RESOLVED (F18-05)** |

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
**RESOLVED (day/week/month/product/customer) — F18-02.** `GET /reports/sales-summary`
(`sales.orders.view`) — `{ from, to, groupBy: day|week|month|product|customer, status }` →
`{ orderCount, subtotal, discountTotal, total, avgTicket }` (period/customer buckets) or
`{ quantity, discountTotal, total }` (product buckets, no `avgTicket` — a "ticket" is order-level).
Real server-side `SUM`/`COUNT`/`GROUP BY`/`date_trunc(... AT TIME ZONE tenant_tz)` in
`apps/api/src/reports/sales/sales-report.repository.ts` — never `OrdersRepository`/
`OrderItemsRepository` (modules.md's read-side rule honored). Integrated into `/sales` (Sales
History) as its own report section, F18-02.

**`groupBy: location` — still not implemented.** `GAP-ORDERS-LOCATION` (F18-01, still open) blocks
it: order visibility has no location scope anywhere in SALES, so grouping by `orders.location_id`
needs that product decision first. `REP-SALES-BY-LOCATION` stays **C**.

- **Original text (for history):** a read-side endpoint that returns grouped sales figures was
  needed; `GET /orders` returned rows only, `meta.total` gave counts but no sums, no grouping —
  revenue and everything derived from it required paging every matching order and folding
  client-side. Recommended phase was F18-needed, the core REPORTS read-side deliverable — done.

### `GAP-INV-AGGREGATE`
**PARTIALLY RESOLVED — F18-03.** `GET /reports/inventory-summary` (`inventory.view`, tenant-wide,
matching `GET /inventory/balances`'s real current read scope) — `{ warehouseId?, categoryId?,
groupBy: warehouse|category }` → `{ generatedAt, groupBy, totals, buckets[] }`, each bucket carrying
`availableQuantity` (`Σ quantity_available`), `reservedQuantity` (`Σ quantity_reserved`) and
`outOfStockCount` (distinct variants at `availableQuantity = 0` within the bucket). Real server-side
`SUM`/`COUNT(*) FILTER`/`GROUP BY` via a two-level CTE in
`apps/api/src/reports/inventory/inventory-report.repository.ts` — never
`InventoryBalancesRepository` (modules.md's read-side rule honored, same precedent as F18-02's
`SalesReportRepository`). Names ARE resolved here (warehouse/category joined server-side) — this
report does not inherit the raw-list id-only gap. Integrated into `/inventory` as its own report
section, F18-03.

**Still missing:** `Σ committed`, in-transit aggregate (`TRF-INTRANSIT-QTY`), valuation
(`GAP-COST`), low-stock (`GAP-REORDER`), and — separately — **name enrichment on the raw
`GET /inventory/balances` / `GET /inventory/movements` list responses themselves** stays open
(that is `GAP-NAME-ENRICHMENT`'s job, not this endpoint's).

- **Original text (for history):** aggregated inventory reads were needed — `Σ available/reserved/
  committed` by tenant/warehouse/category, count of zero/out-of-stock SKUs, in-transit per variant/
  location across all open transfers, with names; `GET /inventory/balances` returned raw rows only,
  no joins, no warehouse/category filter, no Σ. Recommended F18 for the Σ/grouped views — done for
  available/reserved/out-of-stock by warehouse/category; committed and in-transit remain a future,
  smaller addition if actually needed.

### `GAP-MOVEMENTS-DATE-FILTER`
**PARTIALLY RESOLVED — F18-03.** `occurredFrom`/`occurredTo` added to `GET /inventory/movements` —
half-open `[occurredFrom, occurredTo)`, filtered on `inventory_movements.occurred_at` (the
canonical "when the physical movement happened" timestamp — confirmed distinct from `created_at`,
"when the row was written"; the schema already carries both). A new additive index,
`inventory_movements_tenant_occurred_idx (tenant_id, occurred_at)` (migration `0030`), was required
— the pre-existing `(tenant_id, created_at)` index this gap's original text assumed would cover it
does **not**, since the real business timestamp is `occurred_at`, not `created_at`.

**Still missing:** a `sort` param (`GAP-SORT`) and a `referenceType`/`referenceId` filter on this
same operational endpoint — neither was in scope. Server-side **aggregation** over the same
`occurred_at` axis is now `GAP-MOV-AGGREGATE` (**RESOLVED — F18-07**, `GET /reports/movements-summary`).

- **Original text (for history):** `occurredFrom`/`occurredTo` (and/or `createdFrom`/`createdTo`),
  a `sort` param, and a `referenceType`/`referenceId` filter were needed for kardex/"movements this
  month"/adjustments audit/drill-down; the DTO had only `productVariantId`/`locationId`/
  `movementType`. Recommended F17-needed, assumed no schema impact — done for the date filter
  (a real, additive index *was* needed, on the correct column); sort and the reference filter
  remain open, tracked separately.

### `GAP-MOV-AGGREGATE`
**RESOLVED — F18-07.** `GET /reports/movements-summary` (`inventory.view`, tenant-wide — matching
`GET /inventory/movements` / `GET /reports/inventory-summary`, neither location-scoped) — a
dedicated read-side over `inventory_movements` **alone** (no join: one row is one ledger movement,
so `COUNT(*)` / `SUM(quantity)` are exact with zero fan-out). `groupBy=day|week|month|type`
(default `day`); half-open `[from, to)` on `inventory_movements.occurred_at` — the same "when the
physical movement happened" timestamp `GET /inventory/movements`'s `occurredFrom`/`occurredTo`
filter uses (F18-03), backed by the same `inventory_movements_tenant_occurred_idx` (migration
`0030`, **no new index**). Optional filters `movementType` / `locationId` / `productVariantId` —
the exact three `KPI-INV-MOVEMENTS` names ("type, location, variant"). Each bucket carries
`movementCount` (`MOV-COUNT` grouped) and `totalQuantity` (signed `Σ quantity` — `MOV-QTY-BY-TYPE`;
unambiguous per `type` bucket, a mixed net for a period bucket with no `movementType` filter). No
monetary field, no `currency`. Resolves `metrics.md` `MOV-QTY-BY-TYPE` / `MOV-RECEIPTS-PERIOD` /
`MOV-ADJUSTMENTS-PERIOD` (Σ) and `kpis.md` `KPI-INV-MOVEMENTS` (all **B → A**). Never
`InventoryMovementsRepository`.

- **Was:** the flag is on `order_items`… (n/a) — the movement ledger had a date-range filter on the
  operational list (F18-03) but no server-side `SUM`/`COUNT`/`GROUP BY`; `metrics.md` marked those
  rows "a FASE 18 aggregation item" and `f17-f18-boundary.md` listed "Movement analytics …
  aggregation still open". This gap id registers that requirement (it had none before — the
  requirement lived only in `KPI-INV-MOVEMENTS` and the boundary doc).
- **Still open (separate):** grouping by actor (`GAP-NAME-ENRICHMENT` — ids only), by
  location/variant *dimension* (only filterable, not a `groupBy` value), and a `sort` on the raw
  list (`GAP-SORT`). In-transit aggregation is `GAP-INV-AGGREGATE`'s remainder, not this.

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
**PARTIALLY RESOLVED — F18-02.** `GET /reports/sales-summary?groupBy=customer` gives order
count/subtotal/discountTotal/total/avgTicket **per customer, ranked** (server-ordered by
`Σ total DESC` — top-customers "ranking" is answered) for a chosen period. **Still missing:**
"last order date" (not a bucket field) and a "customers with no orders" view (a customer with zero
matching orders simply produces no bucket — never a synthetic zero row, consistent with the "no
data is invented" rule; a dedicated left-join view would be needed to see the zero-order set).

- **Original text (for history):** per-customer order rollup (order count, total spent, last order
  date, avg ticket) and a "customers with no orders" view were needed; `GET /orders?customerId=`
  gave one customer's orders with a client-side sum only, no rollup, no ranking. Recommended F18
  as part of `GAP-SALES-AGGREGATE` with `groupBy: customer` — done for the ranking; the two
  remaining pieces are a future, smaller addition if actually needed.

### `GAP-CUSTOMER-DATE-FILTER`
- **Required:** `createdFrom`/`createdTo` on `GET /customers`.
- **Why:** `CUST-NEW-PERIOD` ("new customers this month").
- **Missing:** the DTO has `status` / `type` / `q` only.
- **Recommended phase:** **F18-needed** (small).

### `GAP-EXCEPTIONAL-FILTER`
**PARTIALLY RESOLVED — F18-06.** `GET /reports/sales-summary` gained an `exceptional` filter
(`all` — the default, unchanged behaviour · `only` · `exclude`) over the frozen, write-once
`order_items.is_exceptional_discount` flag — **never** a join to `price_approvals` (an exceptional
line can exist with no approval row: a `pending` order nobody filed for, or a tenant with
`tenant_price_policies.exceptional_discount_requires_approval = false`, so `price_approvals` is the
authorisation-workflow overlay, not the historical truth of the sale). It composes with `status`
and the half-open `[from,to)` range. Applied per grouping **at that grouping's own grain**:

- `day`/`week`/`month`/`customer` (aggregate `orders` alone) — an `EXISTS`/`NOT EXISTS` semi-join:
  `only` = "orders containing **at least one** exceptional line", with the whole-order totals;
  `exclude` = "orders with **no** exceptional line". Order grain.
- `product` (already `order_items`-grain) — a plain predicate on the joined line: `only` =
  "exceptional **lines** of this variant". Summing `discountTotal` across the `product` buckets is
  `SALES-EXCEPTIONAL-LINES`'s value for the period.

Permission is the endpoint's existing `sales.orders.view` (no `pricing.floor.view` needed —
`order_items.discount_amount` is computed vs `max_price`, so no floor is ever exposed). No schema
change, no migration, no new permission.

- **Still open:** a per-period exceptional **line count** (the `product` grouping has no period
  axis; the period grouping is order-grain, not line-grain) and therefore
  `KPI-SALES-EXCEPTIONAL`'s "exceptional lines ÷ total lines" rate — both would be **new metrics**
  with no official definition today. `REP-SALES-EXCEPTIONAL` stays a filter/aggregate over
  `sales-summary`, not a dedicated lines endpoint.
- **Original text (for history):** filter `GET /orders` (or a sales-lines read) by
  `is_exceptional_discount`, and/or aggregate exceptional-line count and discount value by period;
  the flag was on `order_items`, not filterable, not aggregated; `price_approvals` covered only the
  *below-min* lines that went through approval, not the full exceptional set, and had no date
  filter. Recommended F18-needed.

### `GAP-RETURN-AGGREGATE`
- **Required:** returns aggregated by disposition, by period, by product; returned value (qty ×
  `order_item.unit_price_snapshot`); return rate vs sales.
- **Why:** `RET-BY-DISPOSITION`, `RET-VALUE`, `RET-RATE`, `REP-RET-BY-DISPOSITION`.
- **Missing (pre-F18-04):** `sales_return_items` were only visible inside a return's detail; no
  list, no filter, no aggregate; `sales_returns` had no date filter.
- **PARTIALLY RESOLVED (F18-04):** `GET /reports/returns-summary` (`sales.returns.view`) — a
  dedicated read-side over `sales_returns`/`sales_return_items` joined to `order_items` for the
  frozen `unit_price_snapshot`. `groupBy=day|week|month|product|customer|disposition`, `[from,to)`
  on `sales_returns.created_at` (see `GAP-RETURN-RESOLVED-AT` below), `status` filter (default
  `resolved`). `returnedValue = Σ(quantity_returned × unit_price_snapshot)`; `returnCount` is
  `COUNT(DISTINCT sales_returns.id)`, never inflated by the line/order_item join. **Still missing:**
  `RET-RATE` (return rate vs. confirmed-order count) is **not** computed server-side — it requires
  combining this endpoint's per-period `orderCount` with `sales-summary`'s per-period confirmed
  order count, the same "2 calls" pattern already established for `RET-PENDING-COUNT`; no new
  cross-module coupling was added to compute it in one call. `reason` (free text, no enum) is not a
  groupBy value — grouping by unbounded free text would not produce a meaningful bucket set.
- **Recommended phase:** ~~F18-needed~~ **largely done, F18-04**; `RET-RATE`'s two-call composition
  is a frontend concern, not a further backend gap.

### `GAP-RETURN-RESOLVED-AT`
- **Required:** a timestamp on `sales_returns` (or `sales_return_items`) that answers "when was this
  return physically resolved/received", distinct from "when was it requested".
- **Why:** `GET /reports/returns-summary` (F18-04) buckets by `sales_returns.created_at` (when the
  return was *requested*) for every `groupBy`, including when the caller filters to
  `status=resolved` — there is no way to instead bucket "when the resolution actually happened".
  The direct analogue of `GAP-ORDER-CONFIRMED-AT` for the returns lifecycle.
- **Missing:** `sales_returns` has `created_at`/`updated_at` only; `updated_at` is rewritten by
  every transition (`inspect`, `resolve`, `cancel` alike per FASE 13's own state machine), so it
  cannot answer "when did resolution specifically happen" even as an approximation.
  `sales_return_items.inspected_at` exists but is line-level and reflects `inspect`, not `resolve`.
- **Recommended phase:** **F18-needed** (a small additive migration — a nullable `resolved_at`
  timestamp set once in `ReturnsService.resolve` — would close this without touching FASE 13's
  approved state machine; not attempted in F18-04 per its own "no returns workflow changes"
  scope boundary).

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
- **RESOLVED — F17-09.** `GET /price-approvals` and `GET /price-approvals/:id` now carry
  `@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')` — the requester
  reads to track their own submissions, the approver reads the queue; no new permission code was
  added (a new `@RequireAnyPermission` guard mechanism was introduced instead). The service keeps
  the equivalent check as defense in depth.
- **Original text (for history):** `@RequirePermissions(...)` was missing on both GETs, so any
  authenticated tenant member could read the price-approval queue (which carries pricing context).
  Observed during the 017-A audit; 017-A did not change code.
- **F18-05 note:** `GET /reports/approvals-summary` (the approvals read-side) reuses the **narrower**
  `pricing.discount.approve` alone — a tenant-wide pricing-governance aggregate is an
  approver/supervisor concern, not a requester's "my requests" view — matching the permission
  `metrics.md`'s `APPR-RATE` / `APPR-DISCOUNT-VALUE` rows already name.

### `GAP-APPR-AGGREGATE`
- **RESOLVED — F18-05.** `GET /reports/approvals-summary` (`pricing.discount.approve`) — a dedicated
  read-side over `price_approvals` **alone** (no join: one row is one exceptional-discount request,
  so `COUNT(*)` / `COUNT(*) FILTER` / `SUM(discount_amount)` / `SUM(...) FILTER` are exact with zero
  fan-out). `groupBy=day|week|month|status`; half-open `[from, to)` on `price_approvals.requested_at`
  (the request-cohort anchor — `resolved_at` **does** exist, unlike `sales_returns`, but is `NULL`
  for a `pending` row, so a period that must surface open requests cannot be anchored on it; a
  future `dateField=requested|resolved` toggle is possible, out of F18-05 scope). `status` filter
  with **no default** (the report's purpose is the outcome mix). Period buckets carry
  `requestCount`, `approved`/`rejected`/`cancelled`/`pendingCount`, `approvedDiscountValue`
  (`Σ discount_amount FILTER (WHERE status = 'approved')` — computed vs `max_price`, so no
  `pricing.floor.view` gate, and `min_price_at_request` is never surfaced) and
  `approvalRate = approved / (approved + rejected)` rounded 4dp (`null` when nothing decided;
  cancelled + pending excluded from the denominator). Resolves `metrics.md` `APPR-RATE` /
  `APPR-DISCOUNT-VALUE` (both **B** → **A**). Never `PriceApprovalsRepository`.
- **Separate gap:** the *full* exceptional-discount picture — every
  `order_items.is_exceptional_discount = true` line, not only the subset for which a
  `price_approvals` request was actually *filed* — is `GAP-EXCEPTIONAL-FILTER`, now **PARTIALLY
  RESOLVED (F18-06)** via the `exceptional` filter on `GET /reports/sales-summary`. F18-05 covers
  the **approval-workflow** analytics; F18-06 covers the below-min *sales* set (approved or not).

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
