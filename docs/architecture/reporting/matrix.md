# Master Matrix — Dashboard → KPI → Report → Operational Screen → Drill-down

> One row per validated information path. **State** is the weakest link in the row. Rows whose
> KPI/metric is **C** are shown in the last table (gaps), never mixed into the operational matrix.
> Screen names refer to `docs/design/canvas/` artboards.

## Operational (F17-relevant) matrix

| # | Dashboard tile | KPI | Report | Operational screen | Drill-down target | State | Permission |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Home · Pending price approvals | `KPI-OPS-APPROVALS-PENDING` | `REP-SALES-APPROVALS` | `ReturnsDesktop` (Approvals master-detail) | Approval → order (`REP-SALES-ORDER-DETAIL`) | **A** | *(GET undeclared)* / `pricing.discount.approve` to act |
| 2 | Home · Imports needing attention | `KPI-OPS-IMPORTS-ATTENTION` | `REP-IMP-JOBS` / `REP-IMP-SUMMARY` | `ImportDesktop` | Job → `REP-IMP-ROWS` / `REP-IMP-ERRORS` | **A** | `import.execute` |
| 3 | Home · Imports running | `KPI-OPS-IMPORTS-RUNNING` | `REP-IMP-JOBS` | `ImportDesktop` | Job detail | **B** (live queue over non-terminal jobs — not F18-09, which anchors on `completed_at`) | `import.execute` |
| 3b | Imports · Row/job throughput by period | `IMP-ROWS-PERIOD` | `REP-IMP-SUMMARY` | `ImportDesktop` (report section) | Job list filtered by status | **A** (F18-09) | `import.execute` |
| 4 | Home · Orders today | `KPI-SALES-ORDERS` | `REP-SALES-ORDERS` | `SalesHistoryDesktop` | Order → `REP-SALES-ORDER-DETAIL` | **A** | `sales.orders.view` |
| 5 | Home · Order status mix (period) | `KPI-SALES-CONFIRM-RATE` | `REP-SALES-ORDERS` | `SalesHistoryDesktop` | Order list filtered by status | **A** | `sales.orders.view` |
| 6 | Home · Returns to process | `KPI-OPS-RETURNS-PENDING` | `REP-RET-LIST` | `ReturnsDesktop` | Return → `REP-RET-DETAIL` → order | **B** | `sales.returns.view` |
| 7 | Home · Transfers awaiting receipt | `KPI-OPS-TRANSFERS-TO-RECEIVE` | `REP-INV-TRANSFERS-SUMMARY` | `TransfersDesktop/Tablet/Mobile` | Transfer detail (items, receipts) | **A** (F18-08) | `inventory.view` (see) / `inventory.transfers.receive` (act) |
| 8 | Home · Open transfers | `KPI-OPS-TRANSFERS-OPEN` | `REP-INV-TRANSFERS-SUMMARY` | `TransfersDesktop` | Transfer detail | **A** (F18-08) | `inventory.view` |
| 9 | Home · Draft products | `CAT-DRAFT-PRODUCTS` | `REP-CAT-PRODUCTS` | `ProductsDesktop/Tablet/Mobile` | Product → `ProductForm` | **A** | `products.view` |
| 10 | Home · Out-of-stock SKUs | `KPI-INV-OOS-SKUS` | `REP-INV-STOCK` | `InventoryDesktop/Tablet/Mobile` | Balance → `REP-INV-KARDEX` | **B** | `inventory.view` |
| 11 | Inventory · Stock on hand | `KPI-INV-ONHAND` | `REP-INV-STOCK` | `InventoryDesktop/Tablet/Mobile` | Row → kardex / adjust drawer | **B** | `inventory.view` |
| 12 | Inventory · Units in transit | `KPI-INV-INTRANSIT` | `REP-INV-INTRANSIT` / `REP-INV-TRANSFERS-SUMMARY` | `InventoryDesktop` (column) / `TransfersDesktop` | Transfer detail | **A** (F18-08) | `inventory.view` |
| 13 | Inventory · Movement history | `KPI-INV-MOVEMENTS` | `REP-INV-MOVEMENTS` / `REP-INV-KARDEX` / `REP-INV-MOV-SUMMARY` | `InventoryDesktop` (Movimientos) | Reference → source doc | **A** (list + F18-07 aggregate) | `inventory.view` |
| 14 | Inventory · Adjustments audit | — | `REP-INV-ADJUSTMENTS` / `REP-INV-MOV-SUMMARY?groupBy=type` | `InventoryDesktop` | Movement detail | **A** (list + F18-07 aggregate) | `inventory.view` |
| 15 | Catalog · Product catalogue | `CAT-PRODUCT-COUNT` | `REP-CAT-PRODUCTS` | `ProductsDesktop/Tablet/Mobile` | Product → variants → stock | **A** | `products.view` |
| 16 | Catalog · QR codes | — | `REP-CAT-QR` | *(no dedicated artboard)* | QR → target (product/location) | **A** | `catalog.qr.manage` |
| 17 | Sales · Orders list | `KPI-SALES-ORDERS` | `REP-SALES-ORDERS` | `SalesHistoryDesktop` | Order detail; exceptional line → approval; order → return | **A** | `sales.orders.view` |
| 18 | Sales · Price-approval queue | `KPI-OPS-APPROVALS-PENDING` | `REP-SALES-APPROVALS` | `ReturnsDesktop` (Approvals) | Approval → order | **A** | *(GET undeclared)* |
| 19 | Sales · Customers | `CUST-COUNT` | `REP-CUST-LIST` | *(no dedicated artboard — "Clientes" in nav)* | Customer → their orders (`?customerId=`) | **A** (list) / **B** (history) | `sales.customers.view` |
| 20 | Sales · Returns | `RET-COUNT-STATUS` | `REP-RET-LIST` / `REP-RET-DETAIL` | `ReturnsDesktop` | Return → order; line → RETURN movement | **A** | `sales.returns.view` |
| 21 | Admin · Users & roles | `USR-COUNT-STATUS` | `REP-ADMIN-USERS` | `/users`, `/users/[id]` (built, FASE 16) | User → roles / locations | **A** | `core.users.read` |
| 22 | Admin · Location access | — | `REP-ADMIN-LOCATION-ACCESS` | `/users/[id]` | — | **A** (per user) | `core.users.locations.manage` |
| 23 | Platform · Companies | `KPI-PLAT-TENANTS` / `-STATUS` | `REP-PLAT-TENANTS` | *(SuperAdmin area — no artboard)* | Company → suspend/activate | **A** | `@PlatformOnly()` |
| 23b | Platform · Metrics (count / status / demo / new-in-period) | `KPI-PLAT-TENANTS` / `-STATUS` / `-NEW` | `REP-PLAT-SUMMARY` | `(superadmin)/platform` (KPI-tile row, F18-10) | Company list | **A** (F18-10) | `@PlatformOnly()` |

## Deferred (FASE 18) matrix — validated need, not buildable in F17

| # | Dashboard tile | KPI | Report | Screen | State | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Executive · Revenue MTD + comparison | `KPI-SALES-REVENUE` | `REP-SALES-BY-PERIOD` | `Main` (KPI row — PROTOTYPE ONLY) | **B** | no server-side Σ; FASE 18 sales-summary read |
| D2 | Executive · Average ticket | `KPI-SALES-AVG-TICKET` | `REP-SALES-BY-PERIOD` | `Main` | **B** | as D1 |
| D3 | Executive · Top products | `KPI-SALES-TOP-PRODUCTS` | `REP-SALES-BY-PRODUCT` | `Main` / analytical | **B** | grouping over `order_items` |
| D4 | Executive · Top customers | `SALES-BY-CUSTOMER` (ranked) | `REP-SALES-BY-CUSTOMER` | analytical | **B** | grouping over `orders` |
| D5 | Executive · Sales by branch | `KPI-SALES-BY-LOCATION` | `REP-SALES-BY-LOCATION` | analytical | **C** | `locationId` not a filter + no grouping |
| D6 | Analytical · Movement volume chart | `KPI-INV-MOVEMENTS` | `REP-INV-MOV-SUMMARY` | `Main` (chart — PROTOTYPE ONLY) | **A** | F18-07 — `GET /reports/movements-summary` (count + signed Σ quantity by day/week/month/type); the *chart* rendering itself stays a frontend concern |
| D7 | Executive · Return rate | `RET-RATE` | `REP-RET-BY-DISPOSITION` | analytical | **B** | `REP-RET-BY-DISPOSITION` itself is **A** (F18-04, `GET /reports/returns-summary`); the rate (returns ÷ confirmed orders) is a frontend division across this endpoint + `sales-summary`, not computed server-side |
| D8 | Executive · Exceptional-discount leakage | `KPI-SALES-EXCEPTIONAL` | `REP-SALES-EXCEPTIONAL` | analytical | **B** | F18-06 — `exceptional=only\|exclude` on `GET /reports/sales-summary` filters/aggregates below-min sales & discount value (over the frozen `order_items` flag, not `price_approvals`); only the per-period line-count *rate* stays **C** |
| D9 | Executive · Inventory value | `KPI-INV-VALUE` | `REP-INV-VALUATION` | `Main` | **C** | no historical/as-of cost; no costing method |
| D10 | Any · Trend line for a point-in-time KPI | — | — | dashboards | **C** | no snapshot/rollup table |

## Blocked (C) — need a schema/contract change first (see [data-gaps.md](data-gaps.md))

| Information | Gap ID | Recommended phase |
| --- | --- | --- |
| Low-stock / reorder alerts | `GAP-REORDER` | FASE 18 (needs a per-variant/location threshold field — schema change) |
| Inventory valuation / COGS | `GAP-COST` | FASE 18+ (costing method + cost-at-movement — schema change) |
| Notification status on an order | `GAP-NOTIF-STATUS` | FASE 17 (narrow `event_outbox` read — already on the roadmap) |
| Audit trail report | `GAP-AUDIT-READ` | FASE 19/20 (read endpoint + permission) |
| Sales by location | `GAP-ORDERS-LOCATION-FILTER` | FASE 18 (add `locationId` filter + aggregate) |
| Serial/lot traceability | `GAP-SERIAL-LOT-READ` | after the deferred serial/lot sale design |
| Per-tenant platform metrics (over tenant-scoped tables) | `GAP-PLATFORM-AGGREGATE` | future — company counts are done (F18-10); the tenant-data part needs an ADR + a dedicated audited read path |
| Platform billing / MRR / plans | `GAP-SA-BILLING` | future — no billing model exists; a bounded context of its own, ADR first |
| Movements by period / kardex date range | `GAP-MOVEMENTS-DATE-FILTER` | FASE 17 (small filter add) or FASE 18 |
| Multi-status count filters (pending returns, running imports) | `GAP-MULTI-STATUS` | FASE 17 (cheap `status` array) or FASE 18 — the *transfer* status rollup is resolved by `GAP-TRANSFER-AGGREGATE` (F18-08); the *completed* import outcome mix by `GAP-IMPORT-ROWS-PERIOD` (F18-09) |
| Transfer cycle-time aggregation | `GAP-TRANSFER-CYCLE-TIME` | FASE 18 — needs a metric definition (aggregation fn + period anchor), not just a query |
| Period-level import error rate | `GAP-IMPORT-ERROR-RATE-PERIOD` | FASE 18 — needs a metric definition (numerator/denominator/`0÷0`); the raw Σ components are already returned by `REP-IMP-SUMMARY` (F18-09) |
| New customers by period | `GAP-CUSTOMER-DATE-FILTER` | FASE 18 |
