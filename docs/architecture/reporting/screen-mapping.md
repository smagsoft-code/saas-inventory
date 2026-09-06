# Screen Mapping — 017-DESIGN artboards → information

> Each `docs/design/canvas/` artboard mapped to the information it would carry: primary /
> secondary data, KPIs that could appear, the associated report, operational actions, filters,
> permission and scope. **`PROTOTYPE ONLY`** marks anything on the artboard with no backing
> contract — it is future visual reference, never a FASE 17 requirement.
>
> The artboards are a *visual* proposal (017-DESIGN §12 Functional Specification Boundary). The
> concrete field/column/filter list per screen is decided in `F17-00`, audited against the
> backend. This file records what the backend *can* feed each screen today.

Legend: **A/B/C** = support state of that specific piece (see [README](README.md)).

---

## Login — `LoginDesktop`, `LoginMobile`

| Aspect | Content | State |
| --- | --- | --- |
| Primary | State 1: email + password. State 2 (multi-membership only): `availableTenants[].name` | A |
| Actions | `POST /auth/login`, `POST /auth/select-tenant` | A |
| Not shown | company field / `tenantSlug` (removed 016-C); "Recordarme", "restablecer contraseña" (**PROTOTYPE ONLY** — no backend) | — |
| Scope / permission | pre-auth; none | — |

## App Shell / Home — `Main` (interactive), `AppShellTablet`, `AppShellMobile`

| Aspect | Content | State |
| --- | --- | --- |
| Navigation | permission-filtered nav registry (`GET /auth/me.permissions`) | A |
| Header · tenant name | `GET /tenant.name` | A |
| Header · account menu | `GET /auth/me` (fullName, email, tenantSlug); `POST /auth/logout` | A |
| **Header · global search** | — | **C — PROTOTYPE ONLY** (no cross-entity search endpoint) |
| **Header · notifications bell** | — | **C — PROTOTYPE ONLY** (no notifications-for-user endpoint) |
| Home · attention tiles | see [dashboards.md §1](dashboards.md#1-tenant-operational-dashboard--home) — approvals (A), imports-attention (A), orders-today (A), draft-products (A), returns-pending (B), transfers-to-receive (B), open-transfers (B), OOS SKUs (B) | A/B |
| **Home · KPI numerals (revenue, etc.)** | `KPI-SALES-REVENUE` etc. | **B** — client-side sum acceptable only on small tenants; otherwise **FASE 18** |
| **Home · inventory-movement chart** | `KPI-INV-MOVEMENTS` | **B / FASE 18** — no date filter, no aggregation on `GET /inventory/movements` |
| **Home · "Exportar"** | — | **C — PROTOTYPE ONLY** (no export infra) |
| Home · low-stock section | `KPI-INV-LOW-STOCK` | **C** — no reorder point; render "out of stock" (B) instead, or omit |
| Quick actions | links to `/sales/new`, adjustments, transfers, import, new product — permission-gated | A |
| Scope | tenant; location-aware tiles narrowed by `user_location_assignments` | — |

## Products — `ProductsDesktop`, `ProductsTablet`, `ProductsMobile`

| Aspect | Content | State |
| --- | --- | --- |
| Primary (list) | `GET /products`: name, status, category **id** (name needs a join → B), warrantyMonths, createdAt | A / B (category name) |
| Secondary | per-product variants via `GET /products/:id/variants`: SKU, barcode, `basePrice`, `maxPrice`, `minPrice` *(gated `pricing.floor.view`)*, `cost` *(gated `pricing.cost.view`)*, isSerialized, isLotTracked | A |
| **"Stock" column on the list** | aggregate available per product across locations | **B** — no stock join on `GET /products`; separate `GET /inventory/balances` per variant |
| **"Precio base" column on the list** | the default variant's `base_price` | **B** — list row has no price; would need the variant call |
| KPIs that could appear | `CAT-PRODUCT-COUNT` (A, `meta.total`), `CAT-DRAFT-PRODUCTS` (A) | A |
| Report | `REP-CAT-PRODUCTS` | A |
| Filters | status, categoryId (**exist**); **`Almacén` filter, free-text search — PROTOTYPE ONLY** (not in `list-products-query.dto.ts`) | A / C |
| Sort | Precio / Stock header sort — **PROTOTYPE ONLY** (no `sort` param) | C |
| Actions | Nuevo producto (`products.manage`), Editar, Archivar (status change), Importar | A |
| Scope / permission | tenant; `products.view` | — |

## Producto — Crear / Editar — `ProductForm`

| Aspect | Content | State |
| --- | --- | --- |
| Groups | General, Clasificación (category / brand / supplier / unit / tracking), Precios (`base`/`cost`/`min`/`max` — `min`/`cost` gated), Atributos (category-driven, ADR-0026), Adicional (warranty, supplier) | A |
| Brand / supplier selectors | `products.brand_id` / `supplier_id` exist — **but there is no `GET /brands` or `GET /suppliers` list endpoint** (ADR-0019) | **B/C** — the selector has no source; F17 must confirm how brand/supplier are chosen (or drop the fields) |
| Image upload | `product_images.storage_key` (S3) — no list endpoint | B |
| Actions | `POST` / `PATCH /products`, variant create/update | A |
| Scope / permission | tenant; `products.manage` | — |

## Inventory / Existencias — `InventoryDesktop`, `InventoryTablet`, `InventoryMobile`

| Aspect | Content | State |
| --- | --- | --- |
| Primary | `GET /inventory/balances`: `quantityPhysical/Reserved/Committed/Available`, `productVariantId`, `locationId` | A (numbers) |
| **Producto / SKU / Almacén / Ubicación columns** | names | **B** — `GET /inventory/balances` returns **IDs only**, no joins |
| **"En tránsito" column** | `TRF-INTRANSIT-QTY` per variant/location | **B** — no cross-transfer aggregate endpoint |
| **"Estado" (En stock / Stock bajo / Agotado) badge** | derived | **B** ("agotado" = available 0, needs the row) / **C** ("stock bajo" — no threshold) |
| Tabs (Todo / Stock bajo / Agotado / En tránsito) | — | **Stock bajo tab = C**; Agotado / En tránsito = **B** |
| KPIs | `KPI-INV-ONHAND` (B), `KPI-INV-OOS-SKUS` (B) | B |
| Report | `REP-INV-STOCK`, drill → `REP-INV-KARDEX` | B |
| Filters | `productVariantId`, `locationId` (**exist**); **Almacén, Categoría — PROTOTYPE ONLY** | A / C |
| Actions | Ajuste (`inventory.adjust`) → `POST /inventory/adjustments` (RECEIPT / ADJUSTMENT_IN / ADJUSTMENT_OUT), Recibir stock | A |
| Scope / permission | tenant, narrowed by `user_location_assignments`; `inventory.view` | — |

## Transferencias — `TransfersDesktop`, `TransfersTablet`, `TransfersMobile`

| Aspect | Content | State |
| --- | --- | --- |
| Primary | `GET /inventory/transfers`: status, source/destination **id**, item count, createdAt/updatedAt, stage timestamps | A |
| **"Código" column** | a human transfer code | **C** — the schema has only the UUID `id`; any label is derived |
| **Ruta (origen → destino) as names** | — | **B** — location IDs only, no join |
| **"Ítems" count** | length of `items[]` in the detail | A (detail) / B (on the list — list row shape unconfirmed to include items) |
| Contextual row action | next transition per state (draft→Aprobar, approved→Preparar, preparing→Despachar, dispatched/partially_received→Recibir) | A — maps 1:1 to command routes |
| KPIs | `KPI-OPS-TRANSFERS-OPEN` (B), `KPI-OPS-TRANSFERS-TO-RECEIVE` (B), `TRF-COUNT-STATUS` (A per status) | A/B |
| Report | `REP-INV-TRANSFERS`; drill → transfer detail (items, receipts, `incident_type`) | A / B |
| Filters | status, sourceLocationId, destinationLocationId (**exist**) | A |
| Sort / grouping | none exposed | C |
| Scope / permission | tenant, location-aware; `inventory.view` (see), `inventory.transfers.*` (act) | — |

## Nueva venta / Carrito — `NewSaleDesktop`, `NewSaleTablet`, `NewSaleMobile`

| Aspect | Content | State |
| --- | --- | --- |
| Product search | `GET /products` + `GET /products/:id/variants` — **there is no dedicated variant/SKU search endpoint** | **B** — instant-search-by-SKU as drawn needs a search contract |
| Line items | cart (`GET/POST/PATCH /cart`, `/cart/items`): variant, quantity, `negotiatedUnitPrice` | A |
| Customer selector | `GET /customers` (search `q`), attach to cart | A |
| Document type | segmented control `invoice` / `sales_note` | A |
| Totals (Subtotal / Descuento informativo / Total) | server-computed at checkout; client recompute for feedback | A |
| "Requires approval" tag on a line | **backend-derived** — `order_items.is_exceptional_discount` set at checkout; the UI never computes `price < minPrice` and never holds a hidden `minPrice` (ADR-0028) | A |
| Primary action | `POST /orders` (`Idempotency-Key`) → order `pending` | A |
| Secondary | `POST /price-approvals` (`pricing.discount.request`) | A |
| Not shown | "Guardar como borrador" (removed — cart auto-persists); **impuestos line — PROTOTYPE ONLY** (`tax_total` always 0) | — |
| Scope / permission | tenant + the cart's `location_id` (location-authorized); `sales.carts.manage`, `sales.orders.create` | — |

## Historial de ventas — `SalesHistoryDesktop`

| Aspect | Content | State |
| --- | --- | --- |
| Primary | `GET /orders`: orderNumber, createdAt, customer snapshot name, documentType, status, total | A |
| **4 KPI tiles ("ventas del mes", "órdenes", "pendientes", "ticket promedio")** | `SALES-REVENUE`, `SALES-ORDER-COUNT`, count(status=pending), `SALES-AVG-TICKET` | **órdenes / pendientes = A; ventas del mes / ticket promedio = B — FASE 18** |
| **"Exportar"** | — | **C — PROTOTYPE ONLY** |
| **Notification-status indicator on the row/detail** | `NOTIF-ORDER-STATUS` | **C** — roadmap FASE 17 item; needs `GAP-NOTIF-STATUS` |
| **"Reintentar notificación" action** | re-enqueue the `event_outbox` row | **C** — `GAP-NOTIF-STATUS` |
| Report | `REP-SALES-ORDERS`; drill → `REP-SALES-ORDER-DETAIL` | A |
| Filters | status, documentType, customerId, `createdFrom`/`createdTo` (**all exist**); **número/cliente text search — PROTOTYPE ONLY** | A / C |
| Sort / grouping | none exposed | C |
| Scope / permission | tenant; `sales.orders.view` | — |

## Importación Excel — `ImportDesktop`

| Aspect | Content | State |
| --- | --- | --- |
| 5-step rail (Archivo → Validación → Revisión → Importación → Resultado) | `import_jobs.status` machine | A |
| File summary | `total_rows` / `valid_rows` / `invalid_rows` / `warning_rows` / `imported_rows` — **stored columns** | A |
| Row table + per-row errors | `GET /imports/:id/rows` (`errors[]`, `warnings[]`, `matchAction`) | A |
| Error report download | `GET /imports/:id/errors` (sanitized, formula-injection-safe) — **already exists** | A |
| Actions | staged pipeline commands; `POST /imports/:id/confirm`; `Descargar plantilla` | A |
| KPIs | `IMP-JOBS-STATUS` (A), `IMP-ERROR-RATE` (A per job) | A |
| Report | `REP-IMP-JOBS` / `REP-IMP-ROWS` / `REP-IMP-ERRORS` | A |
| Scope / permission | tenant; `import.execute` (+ `import.inventory` for `update_catalog_and_inventory`) | — |

## Devoluciones / Disposición — `ReturnsDesktop` (also hosts Price Approvals)

| Aspect | Content | State |
| --- | --- | --- |
| Request list | `GET /sales-returns`: id, order (id + number), customer *(from order snapshot)*, line count, status | A |
| Detail | `GET /sales-returns/:id`: original order, reason, lines (qty returned, disposition, disposition location, inspected by/at, notes) | A |
| Disposition selectors | `restock` / `quarantine` / `damaged` / `scrap`; restock → sellable location, others → non-sellable (enforced server-side, ADR-0021) | A |
| Actions | `POST /sales-returns` (`sales.returns.create`, `Idempotency-Key`), `/:id/inspect` + `/:id/resolve` (`inventory.returns.manage`), `/:id/cancel` | A |
| Price Approvals (same layout) | `GET /price-approvals` (list), `/:id`, `POST` (`pricing.discount.request`), `/:id/approve` + `/:id/reject` (`pricing.discount.approve`) | A — **GET has no permission declared** |
| KPIs | `RET-COUNT-STATUS` (A), `KPI-OPS-APPROVALS-PENDING` (A) | A |
| **"Returns by disposition" / returned value** | `RET-BY-DISPOSITION` / `RET-VALUE` — `GET /reports/returns-summary`, integrated into `/returns` (F18-04) | **A** |
| Filters | returns list: status, orderId; approvals: status, orderId (**exist**), **no date filter**; returns *report*: `from`/`to` (required, half-open), `groupBy`, `status` (**exist**, F18-04) | A / A |
| Scope / permission | tenant, location-aware for disposition; `sales.returns.view` / `inventory.returns.manage` | — |

## Visual System — `VisualSystem`

Design reference only — no information mapping. The **Tema (dark) toggle** it demonstrates is a
token-extensibility proof, **not** a FASE 17 feature (017-DESIGN §3.4 / §24).

---

## Screens implied by the nav registry but with no artboard

`Categorías`, `Almacenes`, `Ubicaciones`, `Clientes`, `Movimientos`, `Aprobaciones`, `QR`,
`Usuarios`, `Configuración` — all backed by existing CRUD/list endpoints (state A for their
lists), to be specified in `F17-00`. `Usuarios` / `Configuración` already have F16 pages.

## `PROTOTYPE ONLY` register (consolidated)

| Element | Screen(s) | Why |
| --- | --- | --- |
| Global search (header) | App Shell (all) | No cross-entity search endpoint |
| Notifications bell | App Shell (all) | No per-user notifications endpoint |
| KPI numerals / charts on Home | `Main`, `AppShellTablet/Mobile` | Revenue/movement aggregation is B/FASE 18 |
| "Exportar" | `Main`, `SalesHistoryDesktop` | No export infrastructure |
| Sales-history KPI tiles (ventas del mes, ticket promedio) | `SalesHistoryDesktop` | `SALES-REVENUE`/`AVG-TICKET` = B |
| Notification status + retry on order | `SalesHistoryDesktop` | `GAP-NOTIF-STATUS` (roadmap FASE 17, needs new read) |
| "Stock" / "Precio base" columns on Products list | `ProductsDesktop/Tablet/Mobile` | No stock/price join on `GET /products` |
| Products list: `Almacén` filter, free-text search, column sort | `ProductsDesktop/Tablet/Mobile` | Not in `list-products-query.dto.ts` |
| Inventory: `Almacén`/`Categoría` filters, "Stock bajo" tab, En-tránsito & status columns | `InventoryDesktop/Tablet/Mobile` | Filters not in DTO; no reorder point; no name join; no cross-transfer aggregate |
| Transfers: human "Código", route as names, sort | `TransfersDesktop/Tablet/Mobile` | No transfer code column; IDs only; no sort param |
| Sales history: order-number / customer text search | `SalesHistoryDesktop` | Not in `list-orders-query.dto.ts` |
| "Impuestos" line | `NewSale*` | `tax_total` always 0 (ADR-0023) |
| Instant SKU search in New Sale | `NewSale*` | No variant/SKU search endpoint |
| Brand / supplier selectors in Product form | `ProductForm` | No `GET /brands` / `GET /suppliers` (ADR-0019) |
| "Recordarme" / "restablecer contraseña" | `LoginDesktop/Mobile` | No backend contract |
