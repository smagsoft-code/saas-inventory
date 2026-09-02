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
| `REP-INV-STOCK` | Existencias (stock on hand) | Inventory | `GET /inventory/balances` (raw) | **B** | F17 operational list (raw) + FASE 18 (enriched/grouped) |
| `REP-INV-KARDEX` | Stock card / kardex | Inventory | `GET /inventory/movements` (partial) | **B** | FASE 18 (needs date range + sort + enrich) |
| `REP-INV-MOVEMENTS` | Movement history | Inventory | `GET /inventory/movements` | **B** | F17 raw list; FASE 18 for period/enrichment |
| `REP-INV-ADJUSTMENTS` | Adjustments | Inventory | `GET /inventory/movements?movementType=ADJUSTMENT_*` | **B** | F17 (filtered list) / FASE 18 (period, grouping) |
| `REP-INV-TRANSFERS` | Transfers | Inventory | `GET /inventory/transfers` | **A** (list) / **B** (names, cycle time) | F17 |
| `REP-INV-INTRANSIT` | In-transit stock | Inventory | — | **B** | FASE 18 |
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
| `REP-SALES-BY-PERIOD` | Sales by period (day/week/month) | Sales | — | **B** | FASE 18 |
| `REP-SALES-BY-PRODUCT` | Sales by product | Sales | — | **B** | FASE 18 |
| `REP-SALES-BY-CUSTOMER` | Sales by customer / customer history | Sales | `GET /orders?customerId=` (one at a time) | **B** | F17 (single customer) / FASE 18 (ranking) |
| `REP-SALES-BY-LOCATION` | Sales by sales point | Sales | — | **C** (no `locationId` filter) | FASE 18 (+ contract change) |
| `REP-SALES-APPROVALS` | Price-approval queue & history | Sales | `GET /price-approvals` | **A** | F17 |
| `REP-SALES-EXCEPTIONAL` | Exceptional-discount lines | Sales | — | **C** | No filter/aggregate on `is_exceptional_discount` |
| `REP-CUST-LIST` | Customers | Sales | `GET /customers` | **A** | F17 |
| `REP-RET-LIST` | Returns list | Sales | `GET /sales-returns` | **A** | F17 |
| `REP-RET-DETAIL` | Return detail (lines + disposition) | Sales | `GET /sales-returns/:id` | **A** | F17 |
| `REP-RET-BY-DISPOSITION` | Returns by disposition / value | Sales | — | **C** | Return items unaggregated; value needs a price join |
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
- **Query params (today):** `page`, `pageSize`, `productVariantId`, `locationId`, `movementType`.
- **Columns:** Fecha (`occurred_at`), Tipo, Cantidad (signed), Saldo después (`balance_after`),
  Motivo, Referencia (`reference_type`/`reference_id`), Actor.
- **Filters (desired):** **date range** (missing), reference type. **Sort:** chronological —
  **no explicit sort param** (repo default). **Grouping:** none. **Totals:** period net movement.
- **Export:** none. **Drill-down:** reference → the order/transfer/adjustment that caused it
  (needs `reference_type` → route mapping).
- **Related screen:** Inventory (row → detail).
- **State: B.** The ledger fully supports a kardex; the endpoint lacks a date-range filter, an
  explicit chronological sort guarantee, name enrichment, and reference resolution.

### `REP-INV-MOVEMENTS` — Movement history

- As `REP-INV-KARDEX` but not scoped to a single variant/location — a tenant/location-wide
  movement feed. Same endpoint, same gaps. **State: B** (raw list is A for the 3 existing filters;
  "movements this month" / by-actor / grouped is B).

### `REP-INV-ADJUSTMENTS` — Adjustments

- **Objective:** audit manual stock corrections (`RECEIPT` / `ADJUSTMENT_IN` / `ADJUSTMENT_OUT`),
  who made them and why.
- **Endpoint:** `GET /inventory/movements?movementType=ADJUSTMENT_IN` (one type per call).
- **Columns:** Fecha, Tipo, Producto, Ubicación, Cantidad, Motivo (`reason`), Usuario (`actor_id`).
- **Filters (desired):** date range (missing), user, reason. **State: B** — subset of movements;
  same limitations; `actor_id`/product/location not name-resolved.

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
- **State: A** for the list with the 3 filters; **B** for source/destination **names**, cycle-time
  aggregates, and a human transfer code.

### `REP-INV-INTRANSIT` — In-transit stock

- **Objective:** units currently between locations, by destination / variant.
- **Source:** open `inventory_transfers` + `inventory_transfer_items` (`dispatched − received`).
- **Endpoint:** none (per-transfer `quantityInTransit` only).
- **State: B** — a cross-transfer aggregate query is a FASE 18 read-side item.

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

- **Objective:** sales rolled up by calendar bucket / by variant / by customer.
- **Source:** `orders` / `order_items`.
- **Endpoint:** none for grouping. `REP-SALES-BY-CUSTOMER` for **one** customer is doable via
  `?customerId=` + client-side sum.
- **Totals / grouping:** the whole point — server-side.
- **State: B** — FASE 18 read-side queries (`Σ total` / `Σ line_total` grouped by
  `date_trunc(...)` / `product_variant_id` / `customer_id`, `status='confirmed'`, date range).
  Not blocked by the schema — blocked by the absence of an aggregate endpoint.

### `REP-SALES-BY-LOCATION` — Sales by sales point

- **State: C** — `orders.location_id` is on the row but is **not a query parameter** on
  `GET /orders`, and there is no grouped endpoint. Needs a contract addition (a filter) **and** a
  FASE 18 aggregate.

### `REP-SALES-APPROVALS` — Price-approval queue & history

- **Permission:** `pricing.discount.approve` to resolve; **the GET currently has no permission
  declared** (any tenant member can list) — flagged, not changed.
- **Endpoint:** `GET /price-approvals` — params `page`, `pageSize`, `status`, `orderId`.
- **Columns:** order number, variant/sku/name, requestedPrice, `maxPriceAtRequest`,
  `minPriceAtRequest` *(gated `pricing.floor.view`)*, discountAmount, reason, requestedBy, status,
  requestedAt, resolvedAt, approvedBy.
- **Filters:** status, orderId. **No date filter.** **Sort:** none exposed (pending queue is
  index-backed by `requested_at`). **Totals:** count per status (`meta.total`).
- **Drill-down:** → order detail.
- **Related screen:** `ReturnsDesktop` (master-detail pattern reused for Approvals) /
  `SalesHistoryDesktop`.
- **State: A** for the queue (`status=pending`) and per-status counts; **B** for
  time-bounded rates and discount-value sums.

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
- **State: A** (list + detail). `REP-RET-BY-DISPOSITION` and returned-value are **C**.

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
