# F17 / F18 Boundary

> The precise line between **operational information F17 needs to run the modules** and
> **information reserved for F18 dashboards / reporting / analytics**. 017-A defines the boundary;
> `F17-00` implements the F17 side against the real backend, `FASE 18` builds the read-side.

## The rule

**An operational datum that a screen needs to function is F17 — even if the same number also
appears as a KPI on a dashboard.** Reserved-for-F18 means *aggregation, trend, comparison,
cross-domain rollup, ranking, chart, advanced export* — not "any number".

> Example: the Inventory screen must show current available stock to be usable → that read is
> **F17**. "Total inventory value, month over month" is aggregation + trend + cost → **F18**.

## F17 — in scope (operational)

For each module, F17 delivers: **list + explicit filters + pagination + detail + the state
transitions the backend already exposes + create/edit forms** — nothing that needs a new
aggregate endpoint.

| Module | F17 operational scope | Backing (state) | F17 backend adjustments recommended (small, additive) |
| --- | --- | --- | --- |
| **Auth** | login (016-C), tenant selection, session, logout | A | — |
| **Home** | attention list (approvals / imports-attention / orders-today / draft-products / returns-pending / transfers-to-receive) + quick actions | A / B | `GAP-MULTI-STATUS` (B→A for queue tiles) |
| **Users / Roles** | user list (status filter) + detail + create/edit + role view + location assignment | A | — |
| **Tenant settings** | view/edit timezone + business hours | A | — |
| **Categories** | list (status) + tree + create/edit + category attributes | A | — |
| **Attributes** | definitions + options CRUD | A | — |
| **Products** | list (status, category) + detail + variants (prices, gated) + create/edit + attribute validation | A | `GAP-NAME-ENRICHMENT` (category name), `GAP-SEARCH` (name/SKU), `GAP-SORT`, `GAP-VARIANT-LIST` (for New Sale + flat variant view), `GAP-BRAND-SUPPLIER-LIST` (or drop the fields) |
| **Warehouses / Locations** | list + create/edit; default "General" location | A | — |
| **Inventory / Existencias** | balance list (variant/location filter) + adjust (RECEIPT / ADJUSTMENT_IN/OUT) | A (numbers) / B (view) | `GAP-NAME-ENRICHMENT` (balances/movements rows are still id-only); `GAP-INV-AGGREGATE` and `GAP-MOVEMENTS-DATE-FILTER` **resolved — F18-03** |
| **Transfers** | list (status/source/dest) + detail + full lifecycle (request→approve→prepare→dispatch→receive / cancel) + in-transit per transfer | A | `GAP-NAME-ENRICHMENT` (route names), `GAP-MULTI-STATUS` |
| **QR** | code list + create + resolve | A | — |
| **Import** | staged pipeline (upload→map→validate→preview→confirm), job list, rows, error report download, templates | A | — |
| **Customers** | list (status/type/search) + detail + create/edit | A | `GAP-CUSTOMER-HISTORY` (single-customer order list on the detail — via `?customerId=`, acceptable) |
| **New Sale / Cart** | product search, cart lines, negotiated price, customer, document type, server totals, checkout → `pending`, request price approval | A | `GAP-VARIANT-LIST` (SKU search) |
| **Sales / Orders history** | order list (status/customer/documentType/**date range**) + detail | A | `GAP-SEARCH` (order number / customer), `GAP-SORT` |
| **Price approvals** | queue (status/order) + detail + approve/reject | A | `GAP-APPROVALS-PERMISSION` (add the missing `@RequirePermissions`) |
| **Returns** | list (status/order) + detail + request/inspect/resolve/cancel + disposition | A | — |
| **Notification status on an order** | `sent` / `pending` / `failed` badge + authorized "retry" | C | `GAP-NOTIF-STATUS` — **explicitly a FASE 17 roadmap item**; needs a small new read + a guarded requeue |
| **Platform (SuperAdmin)** | company list + detail + suspend/activate | A | — |

### F17 operational reads that *look* like KPIs but belong to F17

| Datum | Screen it powers | Why F17 |
| --- | --- | --- |
| Current available/reserved stock per variant/location | Inventory, New Sale (stock check) | Cannot operate without it |
| Order/cart totals | New Sale, order detail | Server-computed at the point of sale |
| Pending price-approval count/queue | Approvals screen, Home tile | It *is* the work queue |
| Returns / transfers in each status | Returns / Transfers screens (tabs) | The list, not a metric |
| Import row counts (total/valid/invalid) per job | Import wizard | Stored on the job; drives the UI |
| Order count for a filter (`meta.total`) | any paginated list footer | Pagination, not analytics |
| `last_login_at` per user | Users list | A column, not a KPI |

## F18 — reserved (dashboards, KPIs, reporting, analytics)

| Capability | Examples | Blocking gap(s) |
| --- | --- | --- |
| **Sales aggregation** | revenue / avg ticket / order count **summed and grouped** by day/week/month/product/customer — **built, F18-02** (`GET /reports/sales-summary`, integrated into `/sales`); by **location** still blocked | `GAP-ORDERS-LOCATION-FILTER` (location grouping only), `GAP-ORDER-CONFIRMED-AT`, `GAP-ORDER-MARGIN` |
| **Inventory aggregation** | total available/reserved by warehouse or category; out-of-stock SKU count — **built, F18-03** (`GET /reports/inventory-summary`, integrated into `/inventory`); valuation, low-stock, aged stock, in-transit aggregate still blocked | `GAP-COST`, `GAP-REORDER`, `GAP-SNAPSHOTS` |
| **Trends & comparisons** | any "vs last period", any line chart over time for a point-in-time metric | `GAP-SNAPSHOTS` |
| **Rankings / top-N** | best-selling products (**built, F18-02** — server-ranked `groupBy=product`), top customers (**built, F18-02** — server-ranked `groupBy=customer`), most-adjusted items | `GAP-CUSTOMER-HISTORY` (last-order-date / zero-order view only) |
| **Pricing governance analytics** | approval rate over time + approved discount value by period/status — **built, F18-05** (`GET /reports/approvals-summary`, integrated into `/approvals`); discount *leakage* across the full `is_exceptional_discount` set (lines confirmed without a filed request) still blocked | `GAP-EXCEPTIONAL-FILTER` (the broader set only) |
| **Returns analytics** | returns by disposition/period/product/customer, returned value — **built, F18-04** (`GET /reports/returns-summary`, integrated into `/returns`); return rate vs. confirmed orders is a frontend 2-call combination, not built | `GAP-RETURN-AGGREGATE` (mostly resolved), `GAP-RETURN-RESOLVED-AT` |
| **Movement analytics** | movement volume charts, throughput by location, receipt/adjustment trends — the date-range filter itself is **resolved, F18-03**; grouped/charted aggregation over it is not built | (aggregation still open) |
| **Advanced / scheduled exports** | full-dataset CSV/XLSX, scheduled report delivery | `GAP-EXPORT` |
| **Audit / activity reporting** | who-changed-what dashboards | `GAP-AUDIT-READ` |
| **Serial / lot traceability** | unit history, expiry dashboards | `GAP-SERIAL-LOT-READ` |
| **Price history** | price-change timeline per variant | `GAP-PRICE-HISTORY-READ` |
| **Platform analytics** | per-tenant usage, activity, health, billing | `GAP-PLATFORM-AGGREGATE`, billing model |

### F18 architectural constraints (from modules.md / roadmap)

- REPORTS is a **separate read-side** — read-optimized queries, later materialized views / a read
  replica. **Never** reuse the transactional write-path repositories.
- Reporting reads obey the same tenant / location / permission / field-gate rules as everything
  else ([filters-periods-and-scope.md §3](filters-periods-and-scope.md#3-security--multi-tenancy-model--non-negotiable-for-all-reporting)).
- Cross-tenant (platform) reporting is a **separate, explicit, audited** aggregate path — not a
  tenant query with the filter removed.
- A `reports.*` permission family (and per-dashboard gating) is an F18 decision.

## The dividing questions (checklist for F17-00)

For any piece of information on an F17 screen, if the answer to **any** of these is "yes", it is
**F18**, not F17:

1. Does it require **summing / averaging / counting across many rows on the server**? (`meta.total`
   for one filter does not count.)
2. Does it require **grouping** by a dimension (day, product, customer, location, disposition,
   role)?
3. Does it require **comparing two time periods** or a **trend line**?
4. Does it require a **rank / top-N**?
5. Does it require **data the schema does not hold** (cost, reorder point, snapshots, confirmed-at)?
6. Does it require **joining across bounded contexts** for a rollup (sales × inventory × customer)?

Otherwise it is operational → **F17** (possibly with a small additive backend adjustment listed
above).
