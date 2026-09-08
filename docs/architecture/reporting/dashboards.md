# Dashboard Catalogue

> Dashboards are defined **after** metrics and reports, and built **only** from validated (A/B)
> elements. A dashboard tile whose metric is C is not drawn — it is listed as a gap. 017-A does
> not build any dashboard; it defines what each one *would* contain and how much of it is
> supported today.

## Which dashboards are actually needed

| Dashboard | Needed? | Rationale |
| --- | --- | --- |
| **Tenant operational (Home)** | **Yes** | Daily operators need to see what requires attention (approvals, returns, transfers, imports) and jump to it. Most of this is supported today (A/B). |
| **Tenant executive** | **Deferred (FASE 18)** | "How is the business doing" needs revenue sums, trends and comparisons — all **B/C** today. There is no honest executive dashboard to build in F17. |
| **Tenant analytical** | **Deferred (FASE 18)** | Trends, top-N, cohorts, by-location, by-product — all **B/C**, plus needs history/cost the schema lacks. |
| **SuperAdmin platform** | **Yes, minimal** | Company count + status breakdown + the suspend/activate action. Nothing tenant-scoped. |

---

## 1. Tenant Operational Dashboard — "Home"

**Audience:** any authenticated tenant user (content permission-filtered). **Scope:** tenant,
narrowed by `user_location_assignments` where a tile is location-aware. **Question it answers:**
*What needs my attention right now, and where do I go?*

**Design note:** `Main` / `AppShellMobile` / `AppShellTablet` prototypes show a KPI row + an
inventory-movement chart + global search + a notifications bell. The inventory-movement chart now
has a backing endpoint (`GET /reports/movements-summary`, F18-07 — count + signed quantity by
day/week/month/type); **global search and the bell remain `PROTOTYPE ONLY` / FASE 18** (no
endpoint). F17's Home is the attention list + quick actions below.

### Tiles (built only from A/B metrics)

| Tile | Metric / KPI | State | Permission (to see) | Drill-down |
| --- | --- | --- | --- | --- |
| Pending price approvals | `KPI-OPS-APPROVALS-PENDING` | **A** | *(none on the GET)* | → `REP-SALES-APPROVALS?status=pending` |
| Returns to process | `KPI-OPS-RETURNS-PENDING` | **B** (2 calls) | `sales.returns.view` | → `REP-RET-LIST?status=requested` |
| Transfers awaiting receipt | `KPI-OPS-TRANSFERS-TO-RECEIVE` | **A** (F18-08 — `GET /reports/transfers-summary` `totals.openTransferCount`) | `inventory.view` | → `REP-INV-TRANSFERS?status=dispatched` |
| Open transfers | `KPI-OPS-TRANSFERS-OPEN` | **A** (F18-08 — `?groupBy=status`, sum the open buckets) | `inventory.view` | → `REP-INV-TRANSFERS` |
| Imports needing attention | `KPI-OPS-IMPORTS-ATTENTION` | **A** (2 `meta.total` calls, or one `GET /reports/imports-summary?groupBy=status` for a period — F18-09) | `import.execute` | → `REP-IMP-JOBS?status=failed` |
| Imports running | `KPI-OPS-IMPORTS-RUNNING` | **B** (live count of non-terminal jobs — not F18-09) | `import.execute` | → `REP-IMP-JOBS` |
| Orders today | `KPI-SALES-ORDERS` (status=confirmed, today) | **A** | `sales.orders.view` | → `REP-SALES-ORDERS?createdFrom=today` |
| Draft products | `CAT-DRAFT-PRODUCTS` | **A** | `products.view` | → `REP-CAT-PRODUCTS?status=draft` |
| Out-of-stock SKUs | `KPI-INV-OOS-SKUS` | **B** | `inventory.view` | → `REP-INV-STOCK` (filtered) |
| **Low-stock alerts** | `KPI-INV-LOW-STOCK` | **C** | — | *(not drawn — no reorder point)* |
| **Revenue today / this month** | `KPI-SALES-REVENUE` | **B** | `sales.orders.view` | *(F17: show only if the client-side sum over the day's confirmed orders is acceptable; otherwise defer to FASE 18)* |
| **Inventory value** | `KPI-INV-VALUE` | **C** | — | *(not drawn)* |
| Notification failures (my orders) | `NOTIF-ORDER-STATUS` | **C** | — | *(not drawn — no `event_outbox` read path)* |

### Quick actions (links to real routes, permission-gated)

Nueva venta (`sales.orders.create`) · Recibir stock / Ajuste (`inventory.adjust`) · Nueva
transferencia (`inventory.transfers.request`) · Importar (`import.execute`) · Nuevo producto
(`products.manage`).

### F17 recommendation

Home in F17 = the **attention tiles that are A or cheap-B** (approvals, imports-attention,
orders-today, draft-products, returns-pending, transfers-to-receive) + quick actions + a
low-stock/out-of-stock section **only if** `KPI-INV-OOS-SKUS` is delivered as a small FASE-18-style
read (or accept a client-side scan on small tenants). Everything money/trend/chart is FASE 18.

---

## 2. Tenant Executive Dashboard — DEFERRED to FASE 18

**Would answer:** revenue this month vs last, average ticket trend, top products, top customers,
sales by branch, discount leakage, return rate.

**Why deferred:** every tile is **B or C**:

| Would-be tile | Metric | State |
| --- | --- | --- |
| Revenue MTD + vs last month | `KPI-SALES-REVENUE` | B (no server sum) |
| Average ticket trend | `KPI-SALES-AVG-TICKET` | B |
| Orders MTD + trend | `KPI-SALES-ORDERS` | A (value) / C (trend — no snapshot) |
| Top 10 products | `KPI-SALES-TOP-PRODUCTS` | B |
| Top 10 customers | `SALES-BY-CUSTOMER` (ranked) | B |
| Sales by branch | `KPI-SALES-BY-LOCATION` | C (no filter) |
| Exceptional-discount value | `KPI-SALES-EXCEPTIONAL` | B — F18-06 (`GET /reports/sales-summary?exceptional=only`); rate still C |
| Return rate | `RET-RATE` | B |
| Inventory value | `KPI-INV-VALUE` | C |

**FASE 18 contract (from this catalogue):** a read-side `GET /reports/sales-summary` accepting
`{ from, to, groupBy: day|week|month|product|customer|location, status }` returning grouped
`{ orderCount, subtotal, discountTotal, total, avgTicket }`; plus a snapshot/rollup job for
point-in-time trends. Reporting reads must not touch the transactional repositories (modules.md,
roadmap FASE 18).

---

## 3. Tenant Analytical Dashboard — DEFERRED to FASE 18

Trends, cohorts, forecasting, ABC analysis, aged stock, margin analysis. Needs, at minimum:
historical snapshots (none exist), a costing method (none), and the FASE 18 read-side. Not
scoped by 017-A beyond noting the dependency.

---

## 4. SuperAdmin Platform Dashboard — minimal, supported

**Audience:** `platform_admins` (`@PlatformOnly()`). **Scope:** `platform` — **`tenants` table
only**. A SuperAdmin **must not** see tenant-scoped data (multi-tenancy.md#superadmin-vs-tenant);
any tile needing it is C.

### Tiles

| Tile | Metric | State | Source |
| --- | --- | --- | --- |
| Total companies | `KPI-PLAT-TENANTS` | **A** | `GET /platform/tenants` (array length) |
| Active / suspended / archived | `KPI-PLAT-TENANTS-STATUS` | **A** | group the array by `status` |
| Demo tenants | `PLAT-DEMO-COUNT` | **A** | `is_demo` on the array |
| New companies this month | `KPI-PLAT-TENANTS-NEW` | **B** | `created_at` on the array, client-side (no filter) |
| **Users / activity per tenant** | `KPI-PLAT-ACTIVITY` | **C** | *(not drawn — no cross-tenant aggregate; would violate isolation if done naively)* |
| **MRR / plan / churn** | `KPI-PLAT-BILLING` | **C** | *(not drawn — no billing model)* |

### Actions

List companies · open a company · **suspend** · **activate** (all already exist and audited).

### FASE 18+ note

Real platform metrics (per-tenant user counts, activity, health, billing) require an **explicit,
audited, SuperAdmin-scoped cross-tenant aggregate path** (multi-tenancy.md#administrative--cross-tenant-queries)
and, for billing, a subscription/plan model that does not exist. Not in F17, not in 017-A.

---

## Dashboard → data-source summary

| Dashboard | Fully supported today? | New backend needed |
| --- | --- | --- |
| Operational Home | Partially — attention queues yes, money/trend no | multi-status count filters (B→A), `KPI-INV-OOS-SKUS` read, `NOTIF-ORDER-STATUS` read |
| Executive | No | FASE 18 sales-summary read-side + snapshot job |
| Analytical | No | FASE 18 read-side + historical snapshots + costing method |
| SuperAdmin | Yes (minimal) | none for the minimal set; cross-tenant aggregate + billing model for more |
