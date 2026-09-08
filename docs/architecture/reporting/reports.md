# Report Catalogue

> A report is a **detailed, filterable, drillable list or grouped view** of real data. Included
> only if (1) the information exists and (2) it has real utility in this architecture — never
> because "an ERP usually has it". Each approved report is specified per 017-A §7. Reports the
> backend cannot support are listed with the reason, not designed.
>
> **Rule:** a report never reuses a transactional write-path repository for aggregation
> (modules.md#reports, roadmap FASE 18) — B/C reports become FASE 18 read-side queries.

## Summary

| ID | Report | Domain | Existing endpoint | State | Home |
| --- | --- | --- | --- | --- | --- |
| `REP-INV-STOCK` | Existencias (stock on hand) | Inventory | `GET /inventory/balances` (raw) | **B** | F17 operational list (raw); the grouped/enriched view is now `GET /reports/inventory-summary` (FASE 18-03) |
| `REP-INV-KARDEX` | Stock card / kardex | Inventory | `GET /inventory/movements` (date range added, F18-03) | **B** | Still needs an explicit sort guarantee + name enrichment |
| `REP-INV-MOVEMENTS` | Movement history | Inventory | `GET /inventory/movements` (list) / `GET /reports/movements-summary` (grouped, F18-07) | **A** (list + date range) / **A** (grouped by day/week/month/type, F18-07) — by-actor still **B** (`GAP-NAME-ENRICHMENT`) |
| `REP-INV-ADJUSTMENTS` | Adjustments | Inventory | `GET /inventory/movements?movementType=ADJUSTMENT_*` (list) / `GET /reports/movements-summary?groupBy=type` (F18-07) | **A** (filtered + dated list) / **A** (grouped count + signed net, F18-07) |
| `REP-INV-SUMMARY` | Inventory summary (available/reserved/out-of-stock by warehouse or category) | Inventory | `GET /reports/inventory-summary` | **A** | FASE 18-03 |
| `REP-INV-MOV-SUMMARY` | Movements summary (count + signed quantity by period or type) | Inventory | `GET /reports/movements-summary` | **A** | F18-07 |
| `REP-INV-TRANSFERS` | Transfers (operational list) | Inventory | `GET /inventory/transfers` | **A** (list) / **B** (route names, cycle time) | F17 |
| `REP-INV-TRANSFERS-SUMMARY` | Transfer analytics (status rollup + in-transit by destination/variant) | Inventory | `GET /reports/transfers-summary` | **A** | F18-08 |
| `REP-INV-INTRANSIT` | In-transit stock | Inventory | `GET /reports/transfers-summary?groupBy=destination\|variant` | **A** | F18-08 |
| `REP-INV-VALUATION` | Inventory valuation | Inventory | — | **C** | Blocked ([data-gaps.md](data-gaps.md#gap-cost)) |
| `REP-CAT-PRODUCTS` | Product catalogue | Catalog | `GET /products` (+ per-product `/variants`) | **A** (list) / **B** (flat variant+price+stock) | F17 |
| `REP-CAT-VARIANTS` | Variants (flat, all products) | Catalog | — | **B** | FASE 18 |
| `REP-CAT-PRICE-HISTORY` | Price change history | Catalog | — | **C** | `product_price_history` unexposed |
| `REP-CAT-SERIALS` | Serial numbers | Catalog | — | **C** | `product_serials` unexposed |
| `REP-CAT-LOTS` | Lots & expiry | Catalog | — | **C** | `product_lots` unexposed |
| `REP-CAT-QR` | QR codes | QR | `GET /qr-codes` | **A** | F17 |
| `REP-CAT-ATTRIBUTES` | Attribute definitions | Catalog | `GET /attribute-definitions` | **A** | F17 |
| `REP-SALES-ORDERS` | Sales / orders list | Sales | `GET /orders` | **A** | F17 |
| `REP-SALES-ORDER-DETAIL` | Order detail | Sales | `GET /orders/:id` | **A** | F17 |
| `REP-SALES-BY-PERIOD` | Sales by period (day/week/month) | Sales | `GET /reports/sales-summary` | **A** | F18-02 |
| `REP-SALES-BY-PRODUCT` | Sales by product | Sales | `GET /reports/sales-summary?groupBy=product` | **A** | F18-02 |
| `REP-SALES-BY-CUSTOMER` | Sales by customer / customer history | Sales | `GET /orders?customerId=` (one at a time) / `GET /reports/sales-summary?groupBy=customer` (ranking) | **A** | F17 (single customer) / F18-02 (ranking) |
| `REP-SALES-BY-LOCATION` | Sales by sales point | Sales | — | **C** (no `locationId` filter) | FASE 18 (+ contract change) |
| `REP-SALES-APPROVALS` | Price-approval queue & history | Sales | `GET /price-approvals` | **A** | F17 |
| `REP-APPR-SUMMARY` | Approvals-workflow summary (rate / discount value by period or status) | Sales | `GET /reports/approvals-summary` | **A** | F18-05 |
| `REP-SALES-EXCEPTIONAL` | Exceptional-discount lines | Sales | `GET /reports/sales-summary?exceptional=only` | **B** | F18-06 — `exceptional` filter (`all\|only\|exclude`) over `order_items.is_exceptional_discount`; no dedicated lines endpoint / per-period line count |
| `REP-CUST-LIST` | Customers | Sales | `GET /customers` | **A** | F17 |
| `REP-RET-LIST` | Returns list | Sales | `GET /sales-returns` | **A** | F17 |
| `REP-RET-DETAIL` | Return detail (lines + disposition) | Sales | `GET /sales-returns/:id` | **A** | F17 |
| `REP-RET-BY-DISPOSITION` | Returns by disposition / period / product / customer / value | Sales | `GET /reports/returns-summary` | **A** | F18-04 |
| `REP-IMP-JOBS` | Import jobs | Import | `GET /imports` | **A** | F17 |
| `REP-IMP-ROWS` | Import job rows | Import | `GET /imports/:id/rows` | **A** | F17 |
| `REP-IMP-ERRORS` | Import error report | Import | `GET /imports/:id/errors` | **A** | F17 |
| `REP-ADMIN-USERS` | Users & roles | Core | `GET /users`, `GET /roles` | **A** | F17 |
| `REP-ADMIN-LOCATION-ACCESS` | User → location access | Core | `GET /users/:id/locations` | **A** (per user) / **B** (matrix) | F17 |
| `REP-ADMIN-AUDIT` | Audit trail | Core | — | **C** | No `audit_log` read endpoint |
| `REP-PLAT-TENANTS` | Companies (SuperAdmin) | Platform | `GET /platform/tenants` | **A** | F17 (platform area) |

---

## Report specifications

Fields: **ID · Name · Objective · Domain · Target user · Permission · Scope · Source · Endpoint ·
Query params · Columns · Calculated columns · Filters · Sort · Grouping · Totals · Pagination ·
Export · Drill-down · Related operational screen · State**.

### `REP-INV-STOCK` — Existencias (stock on hand)

- **Objective:** know current available/reserved/committed stock per variant per location.
- **Domain:** Inventory · **Target user:** Bodega, Supervisor, Administrador · **Permission:**
  `inventory.view` · **Scope:** tenant, narrowed by `user_location_assignments` (ADR-0024).
- **Source:** `inventory_balances` (materialized read model) — needs joins to `product_variants`,
  `products`, `locations`, `warehouses` for names.
- **Endpoint:** `GET /inventory/balances` — returns **raw rows: `productVariantId`, `locationId`,
  `quantityPhysical/Reserved/Committed/Available`, `version`, `updatedAt`**. No names.
- **Query params (today):** `page`, `pageSize`, `productVariantId`, `locationId`.
- **Columns (desired):** Producto, SKU, Almacén, Ubicación, Disponible, Reservado, Comprometido,
  En tránsito, Físico. **Calculated:** `disponible` is the DB GENERATED column;
  `en tránsito` is `TRF-INTRANSIT-QTY` (a separate query).
- **Filters (desired):** warehouse, category, "only with stock", "only zero available". **Today
  only** `productVariantId` + `locationId`.
- **Sort:** none exposed (repo orders by `updated_at`). **Grouping:** none. **Totals:** none
  (no Σ of quantities).
- **Pagination:** offset (`meta.total` = row count). **Export:** none.
- **Drill-down:** → `REP-INV-KARDEX` for a (variant, location); → variant detail.
- **Related screen:** `InventoryDesktop/Tablet/Mobile`.
- **State: B.** Missing: name enrichment (join), warehouse/category filters, quantity totals,
  the in-transit column, and the "zero/low" filters. The numbers themselves are correct and
  page-retrievable.

### `REP-INV-KARDEX` — Stock card / kardex

- **Objective:** chronological ledger of every movement for one variant at one location, with
  running balance.
- **Domain:** Inventory · **Permission:** `inventory.view` · **Scope:** tenant / location.
- **Source:** `inventory_movements` (append-only; `balance_after` snapshot is stored per row).
- **Endpoint:** `GET /inventory/movements` (partial).
- **Query params (today):** `page`, `pageSize`, `productVariantId`, `locationId`, `movementType`,
  `occurredFrom`/`occurredTo` (F18-03 — half-open `[occurredFrom, occurredTo)` on `occurred_at`,
  never `created_at`; `occurredFrom` requires `occurredFrom < occurredTo` when both are given).
- **Columns:** Fecha (`occurred_at`), Tipo, Cantidad (signed), Saldo después (`balance_after`),
  Motivo, Referencia (`reference_type`/`reference_id`), Actor.
- **Filters (desired):** date range — **resolved, F18-03**; reference type still missing.
  **Sort:** chronological — **no explicit sort param** (repo default,
  `created_at DESC`). **Grouping:** none. **Totals:** period net movement.
- **Export:** none. **Drill-down:** reference → the order/transfer/adjustment that caused it
  (needs `reference_type` → route mapping).
- **Related screen:** Inventory (row → detail).
- **State: B.** The ledger fully supports a kardex; the date-range filter is now real (F18-03), but
  the endpoint still lacks an explicit chronological sort guarantee, name enrichment, and reference
  resolution.

### `REP-INV-MOVEMENTS` — Movement history

- As `REP-INV-KARDEX` but not scoped to a single variant/location — a tenant/location-wide
  movement feed. Same endpoint, same date filter. **State: A** for the list + its 4 filters
  (including `occurredFrom`/`occurredTo`, F18-03). **Grouped/aggregated** count + signed quantity by
  day/week/month/type is now `REP-INV-MOV-SUMMARY` (**A**, F18-07); by-actor grouping is still **B**
  (`GAP-NAME-ENRICHMENT`).

### `REP-INV-ADJUSTMENTS` — Adjustments

- **Objective:** audit manual stock corrections (`RECEIPT` / `ADJUSTMENT_IN` / `ADJUSTMENT_OUT`),
  who made them and why.
- **Endpoint:** `GET /inventory/movements?movementType=ADJUSTMENT_IN` (one type per call) `+
  occurredFrom`/`occurredTo` (F18-03).
- **Columns:** Fecha, Tipo, Producto, Ubicación, Cantidad, Motivo (`reason`), Usuario (`actor_id`).
- **Filters (desired):** date range — **resolved, F18-03**; user, reason still missing. **State: A**
  for the dated, typed list; `actor_id`/product/location are still not name-resolved. **Aggregated**
  adjustment count + net quantity by period is `REP-INV-MOV-SUMMARY?groupBy=type` (**A**, F18-07).

### `REP-INV-MOV-SUMMARY` — Movements summary

**RESOLVED — F18-07.** `GET /reports/movements-summary` (`inventory.view`, **tenant-wide** — same
posture as `REP-INV-SUMMARY` / `GET /inventory/movements`, neither is location-scoped) — real
server-side aggregation over `inventory_movements`, no client-side fold.

- **Objective:** "how much inventory activity happened" — movement count and signed net quantity,
  by calendar period or by movement type, for a date range. Resolves `metrics.md`
  `KPI-INV-MOVEMENTS` / `MOV-QTY-BY-TYPE` / `MOV-RECEIPTS-PERIOD` / `MOV-ADJUSTMENTS-PERIOD` (Σ).
- **Query params:** `from`, `to` (both **required** — half-open `[from, to)` on
  `inventory_movements.occurred_at`, F18-01 convention), `groupBy` (`day` | `week` | `month` |
  `type`, default `day`), and the three filters `KPI-INV-MOVEMENTS` names: `movementType` (one of
  the 12 real `movement_type` values), `locationId`, `productVariantId`.
- **Response:** `{ from, to, timezone, groupBy, buckets[] }` — **no `currency`** (this report has no
  monetary value). A `day`/`week`/`month` bucket: `{ key: 'YYYY-MM-DD', movementCount, totalQuantity }`;
  a `type` bucket: `{ key: <MOVEMENT_TYPE>, movementCount, totalQuantity }`. `totalQuantity` is the
  **signed** `Σ quantity` — `inventory_movements.quantity` is stored signed relative to its balance
  bucket (`StockLedgerService`: RECEIPT / ADJUSTMENT_IN / TRANSFER_IN / RETURN / RESERVATION /
  COMMITMENT / INITIAL_STOCK positive; SALE / ADJUSTMENT_OUT / TRANSFER_OUT / RESERVATION_RELEASE /
  COMMITMENT_RELEASE negative). Unambiguous per `type` bucket; a mixed net for a period bucket with
  no `movementType` filter (documented, never re-interpreted).
- **Aggregation:** `COUNT(*)` / `SUM(quantity)` over `inventory_movements` **alone** — no join, no
  fan-out. Bounded by `inventory_movements_tenant_occurred_idx (tenant_id, occurred_at)` (migration
  `0030`, added by F18-03 — **no new index**). `date_trunc(unit, occurred_at AT TIME ZONE tenant_tz)`
  for the period key, tenant timezone server-side.
- **Not built:** grouping by actor (`GAP-NAME-ENRICHMENT` — ids only) or by location/variant as a
  *dimension* (they are filters, not `groupBy` values — no metric/KPI asks for a per-location
  movement rollup); a `sort` on the raw list (`GAP-SORT`). In-transit aggregation is
  `REP-INV-INTRANSIT` / `GAP-INV-AGGREGATE`, separate.
- **Related screen:** a "Movements report" section on `/inventory/movements` (mirrors the `/sales`
  and `/inventory` report sections) above the unchanged movement list.
- **State: A** (F18-07).

### `REP-INV-TRANSFERS` — Transfers

- **Objective:** track stock moves between locations and their lifecycle.
- **Permission:** `inventory.view` · **Scope:** tenant / location.
- **Source:** `inventory_transfers` (+ items).
- **Endpoint:** `GET /inventory/transfers`.
- **Query params:** `page`, `pageSize`, `status`, `sourceLocationId`, `destinationLocationId`.
- **Columns:** Código *(note: the schema has no human transfer code — only the UUID `id`;
  a display label would be derived)*, Ruta (source → destination), Ítems (count), Estado, Creada,
  Actualizada, Aprobada/Despachada/Recibida (timestamps present). **Calculated:** cycle time
  = `received_at − created_at` (per-row, client-side).
- **Filters:** status (one at a time), source, destination. **Sort:** none exposed. **Grouping:**
  none. **Totals:** count per status (separate calls). **Pagination:** offset. **Export:** none.
- **Drill-down:** → transfer detail (items, receipts, incidents).
- **Related screen:** `TransfersDesktop/Tablet/Mobile`.
- **State: A** for the list with the 3 filters; **B** for source/destination **names** and a human
  transfer code. Status counts and in-transit aggregates are now `REP-INV-TRANSFERS-SUMMARY`
  (**A**, F18-08); cycle-time aggregation stays **B** (`GAP-TRANSFER-CYCLE-TIME`).

### `REP-INV-TRANSFERS-SUMMARY` — Transfer analytics

**RESOLVED — F18-08 ("Transfer analytics").** `GET /reports/transfers-summary` (`inventory.view`,
tenant-wide — same posture as `GET /inventory/transfers` / `REP-INV-SUMMARY` / `REP-INV-MOV-SUMMARY`,
none location-scoped) — real server-side aggregation over `inventory_transfers` /
`inventory_transfer_items`, never the transactional `InventoryTransfersRepository` /
`InventoryTransferItemsRepository`.

- **Objective:** "how many transfers are in each state" and "how much stock is currently in transit,
  and where is it arriving / what is it" — without paging every transfer.
  Resolves `metrics.md` `TRF-OPEN-COUNT` / `TRF-INTRANSIT-COUNT` / `TRF-INTRANSIT-QTY` and `kpis.md`
  `KPI-INV-INTRANSIT` / `KPI-OPS-TRANSFERS-OPEN` / `KPI-OPS-TRANSFERS-TO-RECEIVE` (all **B → A**).
- **Query params:** `groupBy` (`status` | `destination` | `variant`, default `status`). **No
  `from`/`to`** — a live snapshot of current open-transfer state, not a period query
  (`inventory_transfers` carries stage timestamps but no history to bucket "open-ness" by;
  `GAP-SNAPSHOTS` stays open). `generatedAt` is the query-time server clock.
- **Response:** `{ generatedAt, groupBy, totals: { inTransitQuantity, openTransferCount }, buckets[] }`.
  `totals` is `groupBy`-independent: `inTransitQuantity` = tenant-wide `Σ (quantity_dispatched −
  quantity_received)` over items of `dispatched`/`partially_received` transfers; `openTransferCount`
  = count of those transfers.
- **Bucket shape per `groupBy`:**
  - `status`: `{ key: <inventory_transfers.status>, transferCount }` — `COUNT(*)` over
    `inventory_transfers` **alone**, one bucket per status present, exact (no item join, no fan-out).
  - `destination`: `{ key: destinationLocationId, destinationName, inTransitQuantity, openTransferCount }`
    — items of open transfers joined 1:1 to their parent header for `destination_location_id` and to
    `locations` for the name; `SUM(dispatched − received)` at item grain, `COUNT(DISTINCT transfer id)`
    for the open count (a 3-line transfer counts once).
  - `variant`: `{ key: variantId, sku, productName, inTransitQuantity }` — same item-grain sum,
    grouped by `product_variant_id`, joined to `product_variants`/`products` for sku/name.
- **No monetary field** — a transfer has no price/cost/value (`NO COSTING`, same as the other
  inventory reports).
- **Filters:** none beyond `groupBy` — the in-transit set is intrinsically
  `status IN ('dispatched','partially_received')`; the `status` rollup covers all seven.
  **Sort:** buckets are name/status-ordered. **Grouping:** the `groupBy` axes above. **Totals:**
  the `totals` object. **Pagination:** none (bucket sets are small). **Export:** none.
- **Drill-down:** → the transfer list filtered by status (`GET /inventory/transfers?status=`), →
  transfer detail.
- **Related screen:** a "Transfer report" section on `/inventory/transfers` above the unchanged
  transfer list.
- **Not built (F18-08):** transfer **cycle time** (`TRF-CYCLE-TIME` — `received_at − created_at` is a
  per-row value, but the aggregation grain and the period-anchor timestamp are undefined in every
  doc; → [`GAP-TRANSFER-CYCLE-TIME`](data-gaps.md#gap-transfer-cycle-time)) and receiving
  **incidents** (`TRF-INCIDENTS` — `inventory_transfer_receipt_items` is exposed by no endpoint and
  has no defined analytic metric). `inventory_movements`' `TRANSFER_OUT`/`TRANSFER_IN` rows are
  deliberately **not** the source — those are the ledger side-effects of the dispatch/receive
  transitions, not the transfer's own state (`REP-INV-MOV-SUMMARY`, F18-07, aggregates those; this
  report is about transfers, not movements).
- **State: A.**

### `REP-INV-INTRANSIT` — In-transit stock

**RESOLVED — F18-08.** Now a `groupBy` of `REP-INV-TRANSFERS-SUMMARY` above:
`GET /reports/transfers-summary?groupBy=destination` (units arriving per destination location) or
`?groupBy=variant` (units in transit per SKU). `totals.inTransitQuantity` on any response is the
tenant-wide figure.

- **Objective:** units currently between locations, by destination / variant.
- **Source:** `inventory_transfer_items` of `dispatched`/`partially_received` `inventory_transfers`
  (`quantity_dispatched − quantity_received`).
- **State: A** — real server-side `SUM` in PostgreSQL. Was **B** ("a cross-transfer aggregate query
  is a FASE 18 read-side item").

### `REP-INV-SUMMARY` — Inventory summary (available/reserved/out-of-stock)

**RESOLVED — F18-03.** `GET /reports/inventory-summary` (`inventory.view`, tenant-wide — see
[filters-periods-and-scope.md](filters-periods-and-scope.md#3-security--multi-tenancy-model--non-negotiable-for-all-reporting)
for why this endpoint is not location-scoped) — real server-side aggregation over current
`inventory_balances`, no client-side sum, no full-table fetch.

- **Objective:** Σ available/reserved stock and a count of out-of-stock SKUs, grouped by warehouse
  or category, without paging every balance row.
- **Query params:** `warehouseId?`, `categoryId?` (independent filters, compose with either
  grouping), `groupBy` (`warehouse|category`, default `warehouse`). **No date range** — this is a
  live snapshot of current state, not a period query (`inventory_balances` carries no history to
  bucket by; `GAP-SNAPSHOTS` stays open).
- **Response:** `{ generatedAt, groupBy, totals: { availableQuantity, reservedQuantity,
  outOfStockCount }, buckets[] }`. `generatedAt` is the server clock at query time — an honest
  "as of now" marker, never a persisted historical snapshot.
- **Bucket shape per `groupBy`:**
  - `warehouse`: `{ key: warehouseId, warehouseName, availableQuantity, reservedQuantity,
    outOfStockCount }`.
  - `category`: `{ key: categoryId | 'uncategorized', categoryName, availableQuantity,
    reservedQuantity, outOfStockCount }` — a variant with no category lands in an explicit
    `'uncategorized'` bucket (`categoryName: 'Uncategorized'`), never an invented id, never
    silently dropped.
- **`availableQuantity`/`reservedQuantity`:** `Σ inventory_balances.quantity_available` /
  `Σ quantity_reserved` across every balance row in the bucket — never computed by the app, always
  summed from the DB-generated `quantity_available` column.
- **`outOfStockCount`:** distinct `product_variant_id` whose `Σ quantity_available` **within the
  bucket** is exactly `0` (never a threshold — `GAP-REORDER` stays closed to invented low-stock
  rules). A variant with several balance rows in the same bucket is counted once, not once per row
  (a two-level aggregate: per-(bucket, variant) sum first, then count-where-zero). A variant with
  **zero** balance rows anywhere in the bucket (never stocked there) is **not** counted — this
  report only aggregates rows that exist, the same "no synthetic zero row" rule F18-02 established
  for `GAP-CUSTOMER-HISTORY`.
- **No monetary field anywhere** — `NO COSTING` (rule, this phase): `inventory_movements`/
  `inventory_balances` carry no cost; `product_variants.cost` is current/nullable/mutable, not an
  as-of cost; no costing method exists (`GAP-COST`, still open).
- **Source:** `inventory_balances`, joined (never written) to `locations`/`warehouses` and
  `product_variants`/`products`/`categories` — read-side only
  (`apps/api/src/reports/inventory/`), never `InventoryBalancesRepository`/
  `InventoryMovementsRepository` (modules.md's read-side rule, same precedent as F18-02's
  `SalesReportRepository`).
- **State: A.**

### `REP-CAT-PRODUCTS` — Product catalogue

- **Objective:** find and manage products/variants.
- **Permission:** `products.view` (+ `pricing.floor.view` / `pricing.cost.view` for the price
  columns) · **Scope:** tenant.
- **Source:** `products` (+ `product_variants`).
- **Endpoint:** `GET /products` (list), `GET /products/:id/variants` (per product).
- **Query params:** `page`, `pageSize`, `status`, `categoryId`.
- **Columns (list):** Nombre, Estado, Categoría *(id only — name needs a join)*, warrantyMonths,
  createdAt. **Per-variant:** SKU, barcode, unit, `basePrice`, `maxPrice`, `minPrice`
  *(gated `pricing.floor.view`)*, `cost` *(gated `pricing.cost.view`)*, `status`, `isSerialized`,
  `isLotTracked`.
- **Not on the list today:** stock, default price, image, brand/supplier name, variant count.
- **Filters:** status, categoryId. **No free-text name/SKU search.** **Sort:** none exposed.
  **Grouping:** none. **Totals:** product count (`meta.total`). **Export:** none.
- **Drill-down:** → product detail → variants → `REP-INV-STOCK` filtered by variant.
- **Related screen:** `ProductsDesktop/Tablet/Mobile`, `ProductForm`.
- **State: A** (product list + per-product variants). A flat "every variant with price + stock +
  category name" table is **B** (no top-level variant endpoint, no stock join, no name join,
  no search).

### `REP-CAT-QR` — QR codes

- **Permission:** `catalog.qr.manage` · **Endpoint:** `GET /qr-codes` (filters in
  `list-qr-codes-query.dto.ts`). Columns: code, targetType, targetId, status, expiresAt, createdAt.
  **State: A.**

### `REP-CAT-ATTRIBUTES` — Attribute definitions

- **Permission:** `catalog.attributes.manage` (manage) / `products.view` context · **Endpoint:**
  `GET /attribute-definitions` (+ options), `GET /categories/:id/attributes`. **State: A.**

### `REP-SALES-ORDERS` — Sales / orders list

- **Objective:** find an order, filter, open detail.
- **Permission:** `sales.orders.view` · **Scope:** tenant (no per-location scoping on this
  endpoint).
- **Source:** `orders` (+ `order_items` embedded).
- **Endpoint:** `GET /orders`.
- **Query params:** `page`, `pageSize`, `status`, `customerId`, `documentType`, `createdFrom`,
  `createdTo`.
- **Columns:** orderNumber, status, documentType, invoiceStatus, customer (frozen snapshot name),
  subtotal, discountTotal, taxTotal (0), total, currency, createdAt, placedByUserId. Each row also
  carries the full `items[]` (variant, sku, name, qty, unitPrice, maxPrice, basePrice,
  `minPrice` *(gated)*, discountAmount, isExceptionalDiscount, lineTotal).
- **Filters:** status, customer, document type, **date range** (the only date-filterable list in
  the API). **No text search** (order number / customer name). **No `locationId` filter.**
  **Sort:** none exposed. **Grouping:** none. **Totals:** order count (`meta.total`) — **no sum of
  `total`**. **Pagination:** offset. **Export:** none.
- **Drill-down:** → `REP-SALES-ORDER-DETAIL`; → `REP-SALES-APPROVALS` for exceptional lines;
  → `REP-RET-LIST?orderId=`.
- **Related screen:** `SalesHistoryDesktop`.
- **State: A** for the list and its filters. Any **aggregation** (period revenue, KPI tiles,
  "top" anything) is **B** — see `REP-SALES-BY-*`.

### `REP-SALES-ORDER-DETAIL` — Order detail

- `GET /orders/:id` — full order + lines + frozen customer snapshot + totals. **State: A.**
  A **notification-status** field (`sent`/`pending`/`failed`) is desired here (roadmap FASE 17)
  but is **C** today — → [data-gaps.md](data-gaps.md#gap-notif-status).

### `REP-SALES-BY-PERIOD` / `REP-SALES-BY-PRODUCT` / `REP-SALES-BY-CUSTOMER`

**RESOLVED — F18-02.** `GET /reports/sales-summary` (`sales.orders.view`, tenant-wide) — real
server-side aggregation, no client-side sum, no full-table fetch.

- **Query params:** `from`, `to` (both **required** — half-open `[from, to)`, F18-01), `groupBy`
  (`day|week|month|product|customer` — no `location` yet, `GAP-ORDERS-LOCATION` still open),
  `status` (defaults to `confirmed`; any real `orders.status` value accepted), `exceptional`
  (`all` — default — `| only | exclude`, F18-06 — filters `order_items.is_exceptional_discount`:
  order grain via `EXISTS` for period/customer, line grain for `product`).
- **Response:** `ReportResult<T>` shape — `{ from, to, timezone, currency, groupBy, exceptional,
  buckets[] }` (`exceptional` echoed back like `groupBy`, F18-06).
  `timezone` is the caller's own tenant timezone (`session.timezone`/`GET /auth/me`, F18-01),
  applied server-side via `date_trunc(unit, created_at AT TIME ZONE tenant_tz)` so day/week/month
  boundaries land on the tenant's real calendar days, not UTC ones.
- **Bucket shape per `groupBy`** (never a field that doesn't apply to that grouping):
  - `day`/`week`/`month`: `{ key: 'YYYY-MM-DD', orderCount, subtotal, discountTotal, total, avgTicket }`
    — order-level, from `orders` alone (no join; `subtotal`/`discountTotal`/`total` already live on
    the row).
  - `customer`: same shape as above + `customerName` (frozen `customer_name_snapshot`) instead of a
    period `key` — also `orders`-only, no join to `customers`.
  - `product`: `{ key: variantId, sku, productName, orderCount, quantity, discountTotal, total }` —
    from `order_items` joined to `orders` (only `orders` carries `status`/`created_at`); `sku`/
    `productName` are the frozen `sku_snapshot`/`product_name_snapshot`, no join to `products`/
    `product_variants`.
- **Source:** `orders` / `order_items` — read-side only (`apps/api/src/reports/sales/`), never
  `OrdersRepository`/`OrderItemsRepository` (modules.md's REPORTS-is-a-separate-read-side rule).
- **State: A.**

`REP-SALES-BY-CUSTOMER` for **one** customer via `?customerId=` on `GET /orders` (client-side sum)
remains available as a lighter alternative when only one customer's history is needed (e.g. the
Customer detail screen, F17-08) — unchanged by this endpoint.

### `REP-SALES-BY-LOCATION` — Sales by sales point

- **State: C** — `orders.location_id` is on the row but is **not a query parameter** on
  `GET /orders`, and there is no grouped endpoint. Needs a contract addition (a filter) **and** a
  FASE 18 aggregate.

### `REP-SALES-APPROVALS` — Price-approval queue & history

- **Permission:** `@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')`
  on both GETs (F17-09 closed `GAP-APPROVALS-PERMISSION`); `pricing.discount.approve` to resolve.
- **Endpoint:** `GET /price-approvals` — params `page`, `pageSize`, `status`, `orderId`.
- **Columns:** order number, variant/sku/name, requestedPrice, `maxPriceAtRequest`,
  `minPriceAtRequest` *(gated `pricing.floor.view`)*, discountAmount, reason, requestedBy, status,
  requestedAt, resolvedAt, approvedBy.
- **Filters:** status, orderId. **No date filter.** **Sort:** none exposed (pending queue is
  index-backed by `requested_at`). **Totals:** count per status (`meta.total`).
- **Drill-down:** → order detail.
- **Related screen:** `ReturnsDesktop` (master-detail pattern reused for Approvals) /
  `SalesHistoryDesktop`.
- **State: A** for the queue (`status=pending`) and per-status counts. Time-bounded rates and
  discount-value sums are now **A** too — see `REP-APPR-SUMMARY` below (F18-05).

### `REP-APPR-SUMMARY` — Approvals-workflow summary

- **Permission:** `pricing.discount.approve` (F18-05). Narrower than the operational queue's
  request-OR-approve gate — a tenant-wide governance aggregate, not a "my requests" view; the exact
  permission `metrics.md`'s `APPR-RATE` / `APPR-DISCOUNT-VALUE` rows name. No `reports.*` code
  (F18-01).
- **Endpoint:** `GET /reports/approvals-summary` — params `from`, `to` (**both required**, half-open
  `[from, to)` on `price_approvals.requested_at`), `groupBy` (`day` | `week` | `month` | `status`,
  default `day`), `status` (`pending` | `approved` | `rejected` | `cancelled`, **no default** — the
  outcome mix is the point).
- **Response:** `{ from, to, timezone, currency, groupBy, buckets }`. A **period bucket**
  (day/week/month) is a request-cohort: `key` (YYYY-MM-DD), `requestCount`, `approvedCount`,
  `rejectedCount`, `cancelledCount`, `pendingCount`, `approvedDiscountValue`
  (`Σ discount_amount FILTER (WHERE status = 'approved')`), `approvalRate`
  (`approved / (approved + rejected)`, 4dp, `null` when nothing decided). A **status bucket**:
  `key`, `requestCount`, `discountValue` (no `approvalRate`).
- **Aggregation:** real server-side `COUNT(*)` / `COUNT(*) FILTER` / `SUM(...) FILTER` over
  `price_approvals` **alone** — no join, so no fan-out. `discount_amount` is computed at request
  time vs `max_price`, never `min_price`, so `approvedDiscountValue` needs no `pricing.floor.view`
  and `min_price_at_request` is never surfaced.
- **Not built:** grouping by requester/approver (`GAP-NAME-ENRICHMENT` — user ids only) or by
  product/customer (no metric/KPI/gap asks for it); a queue-age aggregate (`APPR-AGE`, point-in-time,
  not a period metric); the full `order_items.is_exceptional_discount` set including lines confirmed
  without a filed request (`GAP-EXCEPTIONAL-FILTER`).
- **Related screen:** an "Approvals report" section on `/approvals` (mirrors the `/returns` report
  section), visible only to a `pricing.discount.approve` holder.
- **State: A** (F18-05).

### `REP-CUST-LIST` — Customers

- **Permission:** `sales.customers.view` · **Endpoint:** `GET /customers` — params `page`,
  `pageSize`, `status`, `type`, `q` (free-text: displayName / taxId / email / phone).
- **Columns:** type, displayName, taxId, email, phone, status, notes, createdAt, updatedAt.
- **Not available:** order count / last order / lifetime value per row.
- **State: A** for the list + search. **Per-customer history** = **B** (`?customerId=` on
  `GET /orders` + client sum). "New customers this month" = **C** (no date filter on customers).

### `REP-RET-LIST` / `REP-RET-DETAIL`

- **Permission:** `sales.returns.view` · **Endpoint:** `GET /sales-returns` (params `page`,
  `pageSize`, `status`, `orderId`), `GET /sales-returns/:id`.
- **List columns:** id, order (id + number from the return payload), locationId, status, reason,
  requestedBy, receivedBy, createdAt.
- **Detail columns (per line):** orderItem, variant, sku, `quantityReturned`, `disposition`,
  `dispositionLocationId`, `inspectedBy`, `inspectedAt`, `notes`.
- **Filters:** status, orderId. **No date filter.** **Totals:** count per status.
- **Drill-down:** → order detail; → the `RETURN` movement per line (via `reference_type =
  'sales_return_item'` on `inventory_movements` — needs the movement reference filter, currently
  missing).
- **State: A** (list + detail). `REP-RET-BY-DISPOSITION` (aggregation) is now its own report below —
  **A** as of F18-04.

### `REP-RET-BY-DISPOSITION`

- **Permission:** `sales.returns.view` (no `reports.*` permission — F18-01's ratified decision) ·
  **Endpoint:** `GET /reports/returns-summary` (F18-04).
- **Grouping:** `day` | `week` | `month` | `product` | `customer` | `disposition` (default `day`).
- **Filters:** `from`/`to` (both required, half-open `[from, to)` on `sales_returns.created_at` —
  see [`GAP-RETURN-RESOLVED-AT`](data-gaps.md#gap-return-resolved-at)), `status` (default
  `resolved` — the return's inventory effect is only committed once `resolve` runs, the direct
  analogue of `sales-summary`'s `status=confirmed` default).
- **Metrics:** `returnCount` (`COUNT(DISTINCT sales_returns.id)`), `orderCount`
  (`COUNT(DISTINCT sales_returns.order_id)`), `lineCount`, `quantity` (Σ `quantity_returned`),
  `returnedValue` (Σ `quantity_returned × order_items.unit_price_snapshot`), `avgReturnValue`
  (period/customer only). The `disposition` grouping omits `returnCount` — a return with lines in
  more than one disposition legitimately appears in more than one bucket (ADR-0021 fixes one
  disposition per *line*, not per return).
- **Not available:** return rate vs. confirmed orders (`RET-RATE`) — a frontend combination of this
  endpoint's `orderCount` and `sales-summary`'s confirmed-order count for the same period, the same
  "2 calls" pattern already used for `RET-PENDING-COUNT`; no costing/margin (unit_cost_snapshot is
  never read, per FASE 18's `NO COSTING` rule).
- **State: A** (day/week/month/product/customer/disposition, real SUM/COUNT aggregation in
  PostgreSQL). See [`GAP-RETURN-AGGREGATE`](data-gaps.md#gap-return-aggregate) for what remains
  open.

### `REP-IMP-JOBS` / `REP-IMP-ROWS` / `REP-IMP-ERRORS`

- **Permission:** `import.execute` · **Endpoints:** `GET /imports` (params `page`, `pageSize`,
  `status`), `GET /imports/:id/rows`, `GET /imports/:id/errors`.
- **Job columns:** originalFilename, status, `total_rows`, `valid_rows`, `invalid_rows`,
  `warning_rows`, `imported_rows`, duplicateHandlingMode, createdBy, startedAt, completedAt.
  **Calculated:** error rate = `invalid_rows / total_rows` (both on the row).
- **Row columns:** rowNumber, status, matchAction, errors[], warnings[].
- **Errors:** the sanitized, formula-injection-safe downloadable report already exists
  (`/:id/errors`).
- **State: A.** A cross-job "rows imported this month" rollup is **B**.

### `REP-ADMIN-USERS` — Users & roles

- **Permission:** `core.users.read` (+ `core.roles.read`) · **Endpoints:** `GET /users` (params
  `page`, `pageSize`, `status`), `GET /users/:id`, `GET /roles`.
- **Columns:** email, fullName, status, roleNames[], lastLoginAt, createdAt.
- **Filters:** status. **No role filter, no date filter, no name search.**
- **State: A** for the list; role distribution / dormant-user views are **B** (client aggregate).

### `REP-ADMIN-LOCATION-ACCESS` — User → location access

- `GET /users/:id/locations` (`core.users.locations.manage`). Per-user. A full "user × location"
  matrix across the tenant is **B** (page every user).

### `REP-PLAT-TENANTS` — Companies (SuperAdmin)

- **Permission:** `@PlatformOnly()` · **Endpoint:** `GET /platform/tenants` (whole array,
  **unpaginated**), `GET /platform/tenants/:id`.
- **Columns:** id, name, slug, status, isDemo, createdAt.
- **Filters/sort/grouping:** none server-side — all client-side over the array.
- **Actions:** suspend / activate (`POST /platform/tenants/:id/suspend|activate`).
- **State: A** (for exactly these six fields). Any per-tenant usage/user-count column is **C**.

---

## Reports explicitly NOT included (and why)

| Would-be report | Why not |
| --- | --- |
| Inventory valuation / COGS / gross margin from the ledger | No cost on `inventory_movements`; no costing method. `order_items.unit_cost_snapshot` exists → **per-order margin is possible** but is a Sales report, not an inventory one, and the field is not exposed. |
| Purchasing / supplier receiving / PO reports | No PURCHASING context exists (ADR-0019, roadmap "Suppliers and Purchasing"). `suppliers` is attribution-only. |
| Aged stock / slow movers / dead stock | Needs last-movement-date per variant/location — derivable from the ledger but no endpoint, and no "age" concept. → FASE 18. |
| Fiscal / tax / e-invoicing reports | `tax_total` always 0; the platform never issues a fiscal document (ADR-0023). `invoice_status` never leaves `pending`. |
| Serial/lot traceability report | `product_serials` / `product_lots` have no read endpoint; `inventory_movements` has no serial/lot column (a known deferred design). |
| Cash / payments / accounts-receivable | No payment, invoice-ledger, or AR model exists. Orders record a sale, not a collection. |
| Forecasting / demand planning / ABC analysis | Analytical; needs history + cost + a forecasting method. FASE 18 at the earliest. |
