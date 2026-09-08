# Metric Catalogue

> Atomic, measurable quantities. Each has an exact definition tied to real tables/fields, the
> existing endpoint (if any), the filters it needs, its scope, its permission, and an **A/B/C**
> support state (see [README](README.md#support-state-classification-used-everywhere)). KPIs
> ([kpis.md](kpis.md)) and reports ([reports.md](reports.md)) are built only from A/B metrics;
> C metrics are listed so the gap is explicit, never to be silently "assumed".

**Conventions used below**

- **"count via `meta.total`"** — every paginated list endpoint returns
  `PaginatedResult<T>.meta.total`, the exact row count for the applied filter set. A single-value
  *count* for one filter combination is therefore **A** even when the rows themselves are heavy.
- **"client-side sum/aggregate"** — the rows are retrievable but there is **no server-side
  aggregation**; a caller must page through and fold. Marked **B** (missing: aggregation endpoint),
  with the cost noted. FASE 18's read-side is the proper home.
- **Scope** — `tenant` (all data for the active tenant), `location` (further narrowed by
  `user_location_assignments`, ADR-0024), `user` (the acting user's own rows), `platform`
  (SuperAdmin, `tenants`-level only).

---

## 1. INVENTORY — stock levels

| ID | Name | Definition / formula | Unit · type | Source | Endpoint | Filters it needs | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `INV-PHYSICAL` | Physical quantity | `inventory_balances.quantity_physical` for a (variant, location) | qty · saldo | `inventory_balances` | `GET /inventory/balances` | variant, location (both exist) | location | `inventory.view` | **A** (per row) / **B** (tenant or per-warehouse Σ — no aggregation, no warehouse filter, no name join) | Physical quantity itself is not summed by `GET /reports/inventory-summary` either (F18-03 sums `available`/`reserved` only) — still B for a Σ. |
| `INV-AVAILABLE` | Available quantity | `quantity_available` = GENERATED `physical − reserved − committed` | qty · saldo | `inventory_balances` | `GET /inventory/balances` (per row) / `GET /reports/inventory-summary` (Σ by warehouse or category, F18-03) | variant, location | location (raw) / tenant-wide (summary) | `inventory.view` | **A** | Never computed by the app — always read back from the DB, and the Σ is a real server-side `SUM`, never a client-side fold. |
| `INV-RESERVED` | Reserved quantity | `quantity_reserved` (held by `pending` orders) | qty · saldo | `inventory_balances` | `GET /inventory/balances` (per row) / `GET /reports/inventory-summary` (Σ, F18-03) | variant, location | location (raw) / tenant-wide (summary) | `inventory.view` | **A** | Same resolution as `INV-AVAILABLE`. |
| `INV-COMMITTED` | Committed quantity | `quantity_committed` | qty · saldo | `inventory_balances` | `GET /inventory/balances` | variant, location | location | `inventory.view` | **A** (per row) / **B** (Σ) | No flow writes `COMMITMENT` today (reserved for future); value is normally 0. `GET /reports/inventory-summary` does not sum this field (not required by F18-03's scope) — still B for a Σ. |
| `INV-BALANCE-ROWS` | Stocked variant-locations | `count(inventory_balances)` for a filter | count | `inventory_balances` | `GET /inventory/balances` (`meta.total`) | variant, location | location | `inventory.view` | **A** | Count of (variant, location) pairs, **not** a SKU count and not a quantity. |
| `INV-ZERO-AVAILABLE` | Variant-locations with 0 available | `count` where `quantity_available = 0` | count | `inventory_balances` | — | needs `available=0` filter | location | `inventory.view` | **B** | Still no filter on the raw balances list. `GET /reports/inventory-summary`'s `outOfStockCount` (F18-03) answers the related but distinct **distinct-SKU** question (`INV-OUT-OF-STOCK-SKUS`, below) — not this per-row count. |
| `INV-OUT-OF-STOCK-SKUS` | SKUs with no available stock anywhere | variants where `Σ available over all locations = 0` (or no balance row) | count | `inventory_balances` × `product_variants` | `GET /reports/inventory-summary` (`outOfStockCount`, F18-03) | grouping by variant, join to variants; `warehouseId`/`categoryId` narrow the "anywhere" scope | tenant-wide | `inventory.view` | **A** (within a bucket/filter) / **B** (a single unscoped tenant-wide total across zero grouping) | F18-03's `outOfStockCount` is *per bucket* (per warehouse or per category) and *per filter* — summing it across every bucket double-counts a variant stocked in more than one bucket, so a single "SKUs out of stock tenant-wide" number is not directly this field; a variant with **zero** balance rows anywhere is not counted (no synthetic zero row, F18-02's precedent). |
| `INV-LOW-STOCK` | Low-stock / reorder alerts | count / list of variant-locations at or below a reorder threshold | count | — | — | — | — | `inventory.view` | **C** | **No reorder point, minimum, safety-stock or par-level field exists on any table.** A "low stock" indicator cannot be defined contractually. Any threshold would be invented. → [data-gaps.md](data-gaps.md#gap-reorder). |
| `INV-VALUE` | Inventory value (valuation) | `Σ physical × cost` | money · sum | `inventory_balances` × `product_variants.cost` | — | — | tenant/warehouse | `pricing.cost.view` | **C** | `inventory_movements` has **no cost/value column**; `product_variants.cost` is *current, nullable, mutable* — not an as-of cost. No costing method (FIFO/avg/std) is defined. A crude "current cost × on-hand" is possible but is **not** a valuation and is `NULL` for any variant without a cost. → [data-gaps.md](data-gaps.md#gap-cost). |

## 2. INVENTORY — movements (ledger)

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters it needs | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MOV-COUNT` | Movement count | `count(inventory_movements)` for a filter | count | `inventory_movements` | `GET /inventory/movements` (`meta.total`) / `GET /reports/movements-summary` (`movementCount` per bucket, F18-07) | variant, location, movementType, `occurredFrom`/`occurredTo` (F18-03) / `from`/`to` + `groupBy` (report) | tenant | `inventory.view` | **A** | "Movements this month" is a real filtered count; F18-07 additionally gives it grouped by day/week/month/type. |
| `MOV-QTY-BY-TYPE` | Signed quantity by movement type | `Σ quantity` grouped by `movement_type` | qty · sum | `inventory_movements` | `GET /reports/movements-summary?groupBy=type` (`totalQuantity` per bucket, F18-07) | `from`/`to` (half-open), `groupBy`, `movementType`/`locationId`/`productVariantId` | tenant | `inventory.view` | **A** (F18-07) | Real server-side `SUM(quantity)` per `movement_type` — `quantity` is stored signed relative to its balance bucket (`StockLedgerService`), so this is a true signed net. Was **B**. |
| `MOV-RECEIPTS-PERIOD` | Units received in a period | `Σ quantity` where `movement_type='RECEIPT'` and `occurred_at` in range | qty · sum | `inventory_movements` | `GET /reports/movements-summary?movementType=RECEIPT&groupBy=day\|week\|month` (`totalQuantity`, F18-07) | `from`/`to` (half-open), `groupBy` | tenant | `inventory.view` | **A** (F18-07) | Real server-side `SUM` — no more page-and-sum. Was **B**. |
| `MOV-ADJUSTMENTS-PERIOD` | Adjustment count / net qty in a period | `count` / `Σ quantity` where `movement_type IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT')` in range | count / qty | `inventory_movements` | `GET /reports/movements-summary?groupBy=type` (both adjustment buckets, F18-07) / `?movementType=ADJUSTMENT_IN&groupBy=day` per type | `from`/`to` (half-open), `groupBy`, `movementType` (one value) | tenant | `inventory.view` | **A** (F18-07) | `groupBy=type` returns the `ADJUSTMENT_IN` + `ADJUSTMENT_OUT` buckets in one call (each `movementCount` + signed `totalQuantity`); the single-value `movementType` filter still means "both types" is one call via `groupBy=type` or two via the filter. Was **A** (count) / **B** (Σ). |
| `MOV-KARDEX` | Stock card (per variant, per location, chronological) | ordered `inventory_movements` rows with `quantity`, `balance_after`, `reason`, `reference_type`, `occurred_at` | list | `inventory_movements` | `GET /inventory/movements` (+ `occurredFrom`/`occurredTo`, F18-03) | variant + location + date range (**now real**) + chronological sort | location | `inventory.view` | **B** | The ledger *stores* everything a kardex needs (`balance_after` snapshot per row) and the date-range filter is now real. Still missing: an explicit sort param (rows come back `created_at DESC`, not guaranteed by contract) and name enrichment. → [reports.md](reports.md#rep-inv-kardex). |

## 3. INVENTORY — transfers

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TRF-COUNT-STATUS` | Transfers in a given status | `count` for `?status=X` | count | `inventory_transfers` | `GET /inventory/transfers` (`meta.total`) | status, source, destination (exist) | location | `inventory.view` | **A** (one status at a time) | |
| `TRF-OPEN-COUNT` | Open transfers (needing attention) | `count` where `status NOT IN ('received','cancelled')` | count | `inventory_transfers` | — (sum of per-status calls) | multi-status OR | location | `inventory.view` | **B** | The list filter takes one `status`; "open" = 5 separate calls today, or one aggregate. |
| `TRF-INTRANSIT-COUNT` | Transfers in transit | `count` where `status IN ('dispatched','partially_received')` | count | `inventory_transfers` | 2 calls | multi-status OR | location | `inventory.view` | **B** | |
| `TRF-INTRANSIT-QTY` | Units currently in transit (aggregate) | `Σ (quantity_dispatched − quantity_received)` over items of open transfers, grouped by variant / destination | qty · sum | `inventory_transfer_items` | — | grouping, open-transfer join | location | `inventory.view` | **B** | Per-transfer `quantityInTransit` is in the detail response; there is **no** endpoint that aggregates it across transfers for a variant/location. |
| `TRF-CYCLE-TIME` | Transfer cycle time | `received_at − created_at` (and stage deltas from `approved_at`/`dispatched_at`) | duration · avg | `inventory_transfers` | detail only | period, aggregation | location | `inventory.view` | **B** | All timestamps are on the row; no aggregate. Per-transfer value is computable from the detail. |
| `TRF-INCIDENTS` | Receiving incidents | `count` of `inventory_transfer_receipt_items` with `incident_type IS NOT NULL` | count | `inventory_transfer_receipt_items` | — | — | location | `inventory.view` | **C** | Receipt items are not exposed by any endpoint. |

## 4. SALES — orders & revenue

| ID | Name | Definition / formula | Unit · type | Source | Endpoint | Filters it needs | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SALES-ORDER-COUNT` | Order count | `count(orders)` for a filter set | count | `orders` | `GET /orders` (`meta.total`) | status, customerId, documentType, createdFrom/To (**all exist**) | tenant | `sales.orders.view` | **A** | This is the one sales metric fully supported today: count of orders for any combination of {status, customer, document type, date range}. |
| `SALES-REVENUE` | Revenue for a period | `Σ orders.total` where `status = 'confirmed'` and `created_at` in range | money · sum | `orders.total` | `GET /orders` (rows) | status + date range (exist); **no server sum** | tenant | `sales.orders.view` | **B** | Rows are retrievable and filterable; the client must page and sum, or FASE 18 provides the aggregate. Cost grows with order volume. |
| `SALES-SUBTOTAL` / `SALES-DISCOUNT-TOTAL` / `SALES-TAX-TOTAL` | Component sums | `Σ subtotal` / `Σ discount_total` / `Σ tax_total` | money · sum | `orders` | `GET /orders` (rows) | as above | tenant | `sales.orders.view` | **B** | `tax_total` is always 0 (ADR-0023). `discount_total` is informational. |
| `SALES-AVG-TICKET` | Average ticket | `SALES-REVENUE ÷ SALES-ORDER-COUNT` (confirmed, period) | money · avg | `orders` | derived | status + date range | tenant | `sales.orders.view` | **B** | Inherits B from `SALES-REVENUE`. |
| `SALES-BY-DOCTYPE` | Count / revenue by document type | grouped by `document_type` (`invoice` / `sales_note`) | count / money | `orders` | `GET /orders?documentType=` (count via `meta.total`) | documentType (exists) | tenant | `sales.orders.view` | **A** (count, per type) / **B** (revenue) | |
| `SALES-BY-CUSTOMER` | Orders / revenue for one customer | filter `?customerId=` | count / money | `orders` | `GET /orders?customerId=` (count via `meta.total`) | customerId (exists) | tenant | `sales.orders.view` | **A** (count) / **B** (revenue; grouping across all customers) | Per-customer history is doable one customer at a time; a "top customers" ranking is B (grouping). |
| `SALES-BY-LOCATION` | Sales by sales point | grouped by `orders.location_id` | count / money | `orders` | — | **`locationId` is NOT a filter on `GET /orders`** | tenant/location | `sales.orders.view` | **C** (filter) / **B** (aggregate) | `orders.location_id` exists on the row but cannot be filtered; and there is no grouping. |
| `SALES-BY-PRODUCT` | Units / revenue by product/variant | `Σ order_items.quantity` / `Σ line_total` grouped by `product_variant_id`, over `confirmed` orders in range | qty / money | `order_items` | — | grouping, period | tenant | `sales.orders.view` | **B** | `order_items` are embedded in each order response; no grouped endpoint. FASE 18. |
| `SALES-EXCEPTIONAL-LINES` | Exceptional-discount line count / value | `count` / `Σ discount_amount` of `order_items` where `is_exceptional_discount = true`, in range | count / money | `order_items` | `GET /reports/sales-summary?exceptional=only` (F18-06) | `exceptional=all\|only\|exclude`, `from`/`to`, `status`, `groupBy` | tenant | `sales.orders.view` (no `pricing.floor.view` — `discount_amount` is computed vs `max_price`, no floor exposed) | **B** | **Value:** `groupBy=product&exceptional=only` gives `Σ discount_amount` per variant (sum across buckets = the period total) — **A**. **Line count:** still no per-period exceptional *line* count (product grouping has no period axis; period/customer grouping is order-grain via `EXISTS`) — **B/C**. Source of truth is the frozen `order_items.is_exceptional_discount`, never `price_approvals`. |
| `INVOICE-STATUS-MIX` | Orders by `invoice_status` | grouped by `invoice_status` (`pending`/`issued`/`failed`, invoice only) | count | `orders` | — | **`invoiceStatus` is NOT a filter** | tenant | `sales.orders.view` | **C** | `invoice_status` is on the row, not filterable, not aggregated. Note: nothing in the system ever moves it off `pending` (no e-invoicing — ADR-0023). |

## 5. SALES — price approvals

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APPR-COUNT-STATUS` | Approvals in a status | `count` for `?status=X` | count | `price_approvals` | `GET /price-approvals` (`meta.total`) / `GET /reports/approvals-summary?groupBy=status` (F18-05) | status, orderId (exist); `from`/`to` on the report | tenant | `pricing.discount.request` OR `pricing.discount.approve` (queue, F17-09) / `pricing.discount.approve` (report) | **A** | `GAP-APPROVALS-PERMISSION` was closed in F17-09 (`@RequireAnyPermission` on both GETs) — the original 017-A "no permission declared" observation is stale. |
| `APPR-PENDING-COUNT` | Pending approvals | `count` where `status = 'pending'` | count | `price_approvals` | `GET /price-approvals?status=pending` / `GET /reports/approvals-summary` (`pendingCount` per period bucket, F18-05) | status; `from`/`to` on the report | tenant | *(as above)* | **A** | Point-in-time queue depth via `meta.total`; the F18-05 report additionally gives "pending, of the requests filed in period P". Backed by the partial index `price_approvals_tenant_pending_queue_idx`. |
| `APPR-AGE` | Age of pending approvals | `now − requested_at` per pending row | duration | `price_approvals.requested_at` | detail/list rows | — | tenant | *(as above)* | **B** | Per-row value available; no "oldest pending" / avg-age aggregate. F18-05 buckets by `requested_at` but does not compute a queue-age metric (point-in-time, not a period aggregate). |
| `APPR-RATE` | Approval rate | `approved ÷ (approved + rejected)` over a period | percentage | `price_approvals.status` | `GET /reports/approvals-summary` (`approvalRate` per period bucket, F18-05) | `from`/`to` (half-open), `groupBy`, `status` | tenant | `pricing.discount.approve` | **A** (F18-05) | Server-computed per day/week/month bucket, rounded 4dp; `null` when no request in the bucket has been decided. Cancelled + pending are excluded from the denominator (neither is a decision). Was **B** ("not time-bounded"). |
| `APPR-DISCOUNT-VALUE` | Approved discount value | `Σ discount_amount` where `status = 'approved'` in range | money · sum | `price_approvals.discount_amount` | `GET /reports/approvals-summary` (`approvedDiscountValue` per period bucket / `discountValue` per status bucket, F18-05) | `from`/`to` (half-open), `groupBy`, `status` | tenant | `pricing.discount.approve` | **A** (F18-05) | Real server-side `SUM(discount_amount) FILTER (WHERE status = 'approved')`. `discount_amount` is computed vs `max_price` (never `min_price`), so it never leaks the floor and needs **no** `pricing.floor.view` — `min_price_at_request` is never surfaced by this report. Was **B** ("no server-side aggregation"). |

## 6. SALES — returns

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `RET-COUNT-STATUS` | Returns in a status | `count` for `?status=X` | count | `sales_returns` | `GET /sales-returns` (`meta.total`) | status, orderId (exist) | tenant | `sales.returns.view` | **A** | |
| `RET-PENDING-COUNT` | Returns needing processing | `count` where `status IN ('requested','inspecting')` | count | `sales_returns` | 2 calls | multi-status OR | tenant | `sales.returns.view` | **B** | |
| `RET-BY-DISPOSITION` | Return lines by disposition | `count(sales_return_items)` grouped by `disposition` (`restock`/`quarantine`/`damaged`/`scrap`) | count | `sales_return_items` | `GET /reports/returns-summary?groupBy=disposition` | grouping, `from`/`to`, `status` | tenant | `sales.returns.view` | **A** (F18-04) | Lines with `disposition IS NULL` (not yet inspected) are excluded, never bucketed as "pending". |
| `RET-QTY` / `RET-VALUE` | Returned units / value | `Σ quantity_returned` / `Σ (quantity_returned × order_item.unit_price_snapshot)` in range | qty / money | `sales_return_items` × `order_items` | `GET /reports/returns-summary` (any `groupBy`) | grouping, `from`/`to` (half-open), `status` | tenant | `sales.returns.view` | **A** (F18-04) | `unit_price_snapshot` is not gated by `pricing.floor.view` (ADR-0028 only gates `min_price`/`max_price`), so no extra permission was needed. |
| `RET-RATE` | Return rate | `returns ÷ confirmed orders` over a period | percentage | `sales_returns` / `orders` | 2 calls: `GET /reports/returns-summary?groupBy=day` + `GET /reports/sales-summary?groupBy=day` | `from`/`to` (both endpoints, F18-04 date filter resolves the returns side) | tenant | `sales.returns.view` + `sales.orders.view` | **B** | Both endpoints now support the same `[from,to)` period; the division itself is a frontend computation across the two responses — the same "2 calls" pattern as `RET-PENDING-COUNT`, never combined server-side to avoid a returns↔sales cross-read-side dependency. |

## 7. IMPORT

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `IMP-JOBS-STATUS` | Import jobs in a status | `count` for `?status=X` | count | `import_jobs` | `GET /imports` (`meta.total`) | status (exists) | tenant | `import.execute` | **A** | |
| `IMP-JOBS-PENDING` | Jobs in progress | `count` where `status IN ('uploaded','mapping','validating','ready','importing')` | count | `import_jobs` | multiple calls | multi-status OR | tenant | `import.execute` | **B** | |
| `IMP-ROWS` | Total / valid / invalid / warning / imported rows of a job | `import_jobs.total_rows` / `valid_rows` / `invalid_rows` / `warning_rows` / `imported_rows` | count | `import_jobs` | `GET /imports/:id` | — | tenant | `import.execute` | **A** | **Per job** — these are stored columns, no aggregation needed. |
| `IMP-ERROR-RATE` | Job error rate | `invalid_rows ÷ total_rows` per job | percentage | `import_jobs` | `GET /imports/:id` | — | tenant | `import.execute` | **A** | Both operands are on the job row. |
| `IMP-ROWS-PERIOD` | Rows imported across jobs in a period | `Σ imported_rows` over jobs completed in range | count · sum | `import_jobs` | — | period + aggregation | tenant | `import.execute` | **B** | `import_jobs` has `completed_at`; no filter/sum. |

## 8. CATALOG

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CAT-PRODUCT-COUNT` | Product count | `count(products)` for a filter | count | `products` | `GET /products` (`meta.total`) | status, categoryId (exist) | tenant | `products.view` | **A** | |
| `CAT-DRAFT-PRODUCTS` | Products in draft | `count` where `status = 'draft'` | count | `products` | `GET /products?status=draft` | status | tenant | `products.view` | **A** | |
| `CAT-CATEGORY-COUNT` | Category count | `count(categories)` for a filter | count | `categories` | `GET /categories` (`meta.total`) | status | tenant | `categories.view` | **A** | |
| `CAT-VARIANT-COUNT` | Variant count | `count(product_variants)` | count | `product_variants` | — | **no top-level variant list** (only `GET /products/:id/variants`) | tenant | `products.view` | **B** | Only per-product; a tenant-wide variant count needs paging every product. |
| `CAT-PRICE-CHANGES` | Price changes in a period | `count(product_price_history)` in range | count | `product_price_history` | — | — | tenant | `pricing.floor.view`/`.cost.view` (field-level) | **C** | `product_price_history` has no read endpoint. |
| `CAT-SERIALIZED-COUNT` / `CAT-LOT-COUNT` | Serialized units / lots on hand | `count(product_serials)` by `status` / `count(product_lots)` | count | `product_serials` / `product_lots` | — | — | tenant | `products.view`/`inventory.view` | **C** | No read endpoint for either table. |

## 9. CUSTOMERS

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CUST-COUNT` | Customer count | `count(customers)` for a filter | count | `customers` | `GET /customers` (`meta.total`) | status, type, `q` (exist) | tenant | `sales.customers.view` | **A** | |
| `CUST-NEW-PERIOD` | New customers in a period | `count` where `created_at` in range | count | `customers` | — | **no date filter** | tenant | `sales.customers.view` | **C** (filter) / **B** (aggregate) | |
| `CUST-LTV` | Customer lifetime value / order history | `Σ orders.total` for a customer | money | `orders` (via `customerId` filter) | `GET /orders?customerId=` | — | tenant | `sales.customers.view` + `sales.orders.view` | **B** | Per-customer, one at a time, client-side sum. A "customers with 0 orders" or "top customers" view is B (grouping). |

## 10. CORE / ADMINISTRATION

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `USR-COUNT-STATUS` | Users in a status | `count(users)` for `?status=X` | count | `users` | `GET /users` (`meta.total`) | status (exists) | tenant | `core.users.read` | **A** | |
| `USR-RECENT-LOGIN` | Users active in last N days | `count` where `last_login_at ≥ now − N` | count | `users.last_login_at` | `GET /users` (rows) | **no date filter** | tenant | `core.users.read` | **B** | `lastLoginAt` is per-row in `UserResponseDto`; client-side over the paged list. |
| `USR-NEVER-LOGGED-IN` | Users who never logged in | `count` where `last_login_at IS NULL` | count | `users.last_login_at` | `GET /users` (rows) | — | tenant | `core.users.read` | **B** | Client-side. |
| `ROLE-DISTRIBUTION` | Users per role | grouped by `user_roles.role_id` | count | `user_roles` / `roles` | `GET /users` (`roleNames` per row) | grouping | tenant | `core.users.read` + `core.roles.read` | **B** | `roleNames[]` per user; client aggregate over the paged list. |
| `AUDIT-ACTIVITY` | Actions by actor / entity / period | `count(audit_log)` grouped | count | `audit_log` | — | **no read endpoint at all** | tenant | *(no permission defined — no route)* | **C** | `audit_log` is write-only from the app. A read path + a permission would both be new. → [data-gaps.md](data-gaps.md#gap-audit-read). |

## 11. EVENTS / NOTIFICATIONS

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `NOTIF-ORDER-STATUS` | Notification state for an order | `event_outbox.status` for `aggregate_id = order.id`, `event_type = 'sales.order.confirmed'` (→ `sent` / `pending` / `failed`) | enum | `event_outbox` | — | keyed read by `aggregate_id` | tenant | *(new — none defined)* | **C** | Roadmap FASE 17 wants this on the order detail. Needs a **new narrow tenant read** over `event_outbox` (which today only `app_event_processor` touches). → [data-gaps.md](data-gaps.md#gap-notif-status). |
| `NOTIF-DELIVERY-HEALTH` | Delivered / retrying / dead-lettered event counts | `count(event_outbox)` grouped by `status` | count | `event_outbox` | — | — | platform/ops | *(new)* | **C** | An operations concern (FASE 20 observability), not a tenant KPI. |

## 12. PLATFORM (SuperAdmin — `tenants` only)

| ID | Name | Definition | Unit · type | Source | Endpoint | Filters | Scope | Permission | State | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PLAT-TENANT-COUNT` | Total companies | `count(tenants)` | count | `tenants` | `GET /platform/tenants` (array length) | — | platform | `@PlatformOnly()` | **A** | Endpoint returns the **whole array, unpaginated**. |
| `PLAT-TENANT-BY-STATUS` | Companies by status | group the array by `status` (`active`/`suspended`/`archived`) | count | `tenants.status` | `GET /platform/tenants` | client-side | platform | `@PlatformOnly()` | **A** | |
| `PLAT-DEMO-COUNT` | Demo tenants | `count` where `is_demo = true` | count | `tenants.is_demo` | `GET /platform/tenants` | client-side | platform | `@PlatformOnly()` | **A** | |
| `PLAT-TENANT-CREATED` | Companies created in a period | `count` where `created_at` in range | count | `tenants.created_at` | `GET /platform/tenants` | client-side (no filter) | platform | `@PlatformOnly()` | **B** | Only `created_at` is on the row; no `updated_at`/first-activity. |
| `PLAT-USERS-PER-TENANT` | Users / activity / usage per tenant | any tenant-scoped aggregate | — | tenant tables | — | — | platform | — | **C** | SuperAdmin **must not** read tenant-scoped data (multi-tenancy.md#superadmin-vs-tenant). Needs an explicit, audited cross-tenant aggregate endpoint that does not exist. |
| `PLAT-BILLING` | MRR / plan / usage-based billing | — | — | — | — | — | platform | — | **C** | No billing, plan, or subscription model exists anywhere in the schema. |
