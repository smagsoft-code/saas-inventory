# F17 / F18 Boundary — screen level

> Complements [017-A's boundary](../reporting/f17-f18-boundary.md) (data/metric level). This file
> is the **screen/feature** matrix: what FASE 17 builds, what FASE 18 owns, what is blocked.
>
> **Rule:** a visual element in a 017-DESIGN prototype does **not** automatically become F17 scope.
> Anything that is aggregation, trend, comparison, ranking, chart, cross-domain rollup, or advanced
> export is F18 — even if the mockup shows it on an F17 screen.

## Matrix

| Feature / screen element | F17 | F18 | GAP / blocker |
| --- | --- | --- | --- |
| App shell, sidebar, header, account menu | ✅ | | |
| Login + company selection + session/refresh | ✅ | | (done 016-D) |
| Register (self-service tenant) | ✅ | | |
| Operational Home — attention queues + quick actions | ✅ | | `GAP-MULTI-STATUS`, `GAP-HOME-DATE-TZ` |
| Home — revenue / ticket KPI numerals | | ✅ | `GAP-SALES-AGGREGATE` (017-A) |
| Home — inventory-movement chart | | ✅ | `GAP-MOVEMENTS-DATE-FILTER` + aggregation |
| Home — "Exportar" | | ✅ | `GAP-EXPORT` (017-A) |
| Home — low-stock section | | | ❌ `GAP-REORDER` (future/ADR) |
| Home — out-of-stock count tile | ~ | ✅ | `GAP-INV-AGGREGATE` (small read) |
| Products list + detail + create/edit + variants | ✅ | | `GAP-SEARCH`, `GAP-SORT`, `GAP-BRAND-SUPPLIER-LIST` |
| Products list — stock / price columns | | ✅ | no join on `GET /products` |
| Categories + attributes + category-attribute mapping | ✅ | | |
| Brands / Suppliers management | | | ❌ no endpoint (ADR-0019) |
| Product price-history timeline | | ✅ | `GAP-PRICE-HISTORY-READ` |
| Serial / lot browser | | | ❌ no read endpoint (deferred design) |
| QR list + generate + revoke | ✅ built F17-14 | | `GAP-NAME-ENRICHMENT` (target name) |
| QR print / bitmap render | | | ❌ `GAP-QR-PRINT` — no image lib; printable URL `/q/:code` is a proxy concern |
| Inventory balances list + adjust | ✅ | | `GAP-NAME-ENRICHMENT`, `GAP-INV-LOCATION-SCOPE` |
| Inventory — Σ on hand / by warehouse / valuation | | ✅ | `GAP-INV-AGGREGATE`, `GAP-COST` (017-A) |
| Inventory — "Stock bajo" tab | | | ❌ `GAP-REORDER` |
| Inventory — "En tránsito" column (cross-transfer) | | ✅ | `GAP-INV-AGGREGATE` |
| Movements feed + kardex (by variant+location) | ✅ | | `GAP-MOVEMENTS-DATE-FILTER` |
| Movements — by period / by actor / grouped | | ✅ | date filter + aggregation |
| Warehouses + Locations CRUD | ✅ | | |
| Transfers list + detail + full lifecycle + receive | ✅ | | `GAP-NAME-ENRICHMENT`, `GAP-MULTI-STATUS`, `GAP-TRANSFER-CODE` |
| Transfers — cycle-time / throughput analytics | | ✅ | aggregation |
| Transfer receipt-incident report | | ✅ | receipt items not exposed |
| New Sale / cart / checkout | ✅ | | `GAP-VARIANT-LIST` (SKU search) |
| Customers list + form + detail | ✅ | | |
| Customer — order history (single customer) | ✅ | | via `?customerId=` (client-side) |
| Customer — LTV / ranking / "no orders" | | ✅ | `GAP-CUSTOMER-HISTORY` |
| Sales history list + filters (status/customer/docType/date) + detail | ✅ | | `GAP-SEARCH`, `GAP-DATE-SEMANTICS` |
| Sales history — KPI tiles (ventas del mes, ticket) | | ✅ | `GAP-SALES-AGGREGATE` |
| Sales history — order-count / pending tiles | ✅ | | `meta.total` (state A) |
| Sales history — "Exportar" | | ✅ | `GAP-EXPORT` |
| Sales by product / customer / location / period | | ✅ | `GAP-SALES-AGGREGATE`, `GAP-ORDERS-LOCATION` |
| Order confirm / cancel | ✅ | | |
| Order notification status + retry | ✅ (feature) | | `GAP-NOTIF-STATUS` — new read + guarded requeue first |
| Order margin display | | ✅ | `GAP-ORDER-MARGIN` |
| Price approvals queue + approve/reject + request | ✅ | | `GAP-APPROVALS-PERMISSION` (fix first) |
| Approvals — approval-rate / discount-value over time | | ✅ | no date filter + aggregation |
| Returns list + detail + create + inspect + resolve + cancel | ✅ | | |
| Returns — by disposition / returned value / return rate | | ✅ | `GAP-RETURN-AGGREGATE` (017-A) |
| Import wizard + history + rows + error report + templates | ✅ | | `GAP-IMPORT-PROGRESS` (polling decision) |
| Import — rows-imported rollup over a period | | ✅ | aggregation |
| Users list + create/edit + status | ✅ | | `GAP-USER-FILTERS` |
| Location-access editor (per user) | ✅ built F17-14 | | |
| Roles view (read-only) | ✅ built F17-14 | | `GAP-ROLE-CRUD` (management = future) |
| Role/permission CRUD | | | ❌ future (no endpoint) |
| Audit trail viewer | | | ❌ future `GAP-AUDIT-READ` |
| Tenant settings (timezone, business hours) + company info | ✅ | | |
| Branding / notification preferences | | | ❌ branding "later"; notif routing lives in n8n |
| Super-Admin: company list + detail + suspend/activate | ✅ | | |
| Super-Admin: platform dashboard / metrics | | | ❌ `GAP-PLATFORM-AGGREGATE` (future) |
| Super-Admin: create tenant / manage admins | | | ❌ `GAP-SA-CREATE-TENANT`, `GAP-SA-ADMIN-CRUD` (future) |
| Executive / analytical dashboards | | ✅ | 017-A `dashboards.md` |
| Global search, notifications bell | | | ❌ no endpoint (PROTOTYPE ONLY) |
| Dark mode toggle | | | ❌ deferred (017-DESIGN §24) |
| In-session tenant switcher | | | ❌ not a defined feature (016-C) |

## The F17 decision test (per screen element)

Element is **F18** (not F17) if **any** is true:
1. Requires server-side sum / average / count-across-rows (`meta.total` for one filter is fine).
2. Requires grouping by a dimension (day, product, customer, location, disposition, role).
3. Requires comparing two periods or a trend line.
4. Requires a rank / top-N.
5. Requires data the schema does not hold (cost, reorder point, snapshots, confirmed-at).
6. Requires joining bounded contexts for a rollup.

Otherwise it is **F17** — possibly with a small additive backend adjustment (see
[f17-gaps.md](f17-gaps.md)).
