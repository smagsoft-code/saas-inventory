# KPI Catalogue

> KPIs are indicators built from [metrics](metrics.md) that answer a specific business question.
> Each carries a period, an optional temporal comparison, the filters it accepts, its scope, its
> permission, and an **A/B/C** state. A KPI is never higher than the lowest state of the metrics
> it depends on. **No KPI is marked A on invented data** — if the underlying concept does not
> exist in the backend, the KPI is C with the reason.

**Temporal comparison** — "prior period" means the immediately preceding window of the same
length. Where a KPI's metric is date-filterable (`orders` only, today), the comparison is the same
state as the base value. Where it is not, comparison is C.

**Point-in-time KPIs** (stock on hand, queue depths) have no history: there is no snapshot table,
so "on hand 30 days ago" cannot be reconstructed — trend lines for these are **C** until a
FASE 18 snapshot/rollup exists.

---

## 1. Inventory

| ID | Name | Business question | Metric(s) | Formula | Period | Comparison | Filters | Scope | Permission | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `KPI-INV-ONHAND` | Stock on hand | *How much stock do I have right now?* | `INV-AVAILABLE`, `INV-PHYSICAL` | `Σ quantity_available` (and `Σ physical`) over the balance rows in scope | point-in-time | **C** (no history) | warehouse, location, category, variant | tenant / location | `inventory.view` | **B** — rows exist, no server-side Σ, no warehouse filter, no name join |
| `KPI-INV-INTRANSIT` | Units in transit | *How much stock is moving between locations?* | `TRF-INTRANSIT-QTY` | `Σ (dispatched − received)` over items of transfers in `dispatched`/`partially_received` | point-in-time | **C** | destination, variant | tenant / location | `inventory.view` | **B** — only per-transfer today; no cross-transfer aggregate |
| `KPI-INV-OOS-SKUS` | Out-of-stock SKUs | *How many products can I not sell?* | `INV-OUT-OF-STOCK-SKUS` | `count(variants where Σ available = 0)` | point-in-time | **C** | category, warehouse | tenant / location | `inventory.view` | **B** — needs grouped read + zero-row handling |
| `KPI-INV-LOW-STOCK` | Low-stock alerts | *What do I need to reorder?* | — | *(would need a reorder threshold)* | — | — | — | — | `inventory.view` | **C** — **no reorder-point / min / par-level field exists**. Cannot be defined without inventing a threshold. → [data-gaps.md](data-gaps.md#gap-reorder) |
| `KPI-INV-MOVEMENTS` | Movements in the period | *How much inventory activity happened?* | `MOV-COUNT`, `MOV-QTY-BY-TYPE` | `count` / `Σ quantity` by type, in range | day / week / month / custom | **C** | type, location, variant | tenant / location | `inventory.view` | **B** — `GET /inventory/movements` has **no date-range filter** and no aggregation |
| `KPI-INV-VALUE` | Inventory value | *What is my stock worth?* | `INV-VALUE` | `Σ physical × cost` | point-in-time | **C** | warehouse, category | tenant | `pricing.cost.view` | **C** — no historical/as-of cost in the ledger; `variant.cost` is current, nullable, mutable; no costing method defined. → [data-gaps.md](data-gaps.md#gap-cost) |

## 2. Sales

| ID | Name | Business question | Metric(s) | Formula | Period | Comparison | Filters | Scope | Permission | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `KPI-SALES-ORDERS` | Orders in the period | *How many sales did we make?* | `SALES-ORDER-COUNT` | `count(orders)` where `status='confirmed'` (or any status) and `created_at` in range | day / week / month / custom | **A** | status, documentType, customerId, date range | tenant | `sales.orders.view` | **A** — `GET /orders?status=confirmed&createdFrom&createdTo` → `meta.total`; prior period = a second call |
| `KPI-SALES-REVENUE` | Revenue in the period | *How much did we sell (money)?* | `SALES-REVENUE` | `Σ orders.total` where `status='confirmed'` and `created_at` in range | day / week / month / custom | **A** | status, date range, groupBy | tenant | `sales.orders.view` | **A** — F18-02, `GET /reports/sales-summary` — real server-side `SUM`, tenant timezone-aware day/week/month buckets |
| `KPI-SALES-AVG-TICKET` | Average ticket | *What is the average sale size?* | `SALES-REVENUE`, `SALES-ORDER-COUNT` | `revenue ÷ count` (confirmed, period) | period | **A** | date range | tenant | `sales.orders.view` | **A** — F18-02, `avgTicket` on each `day`/`week`/`month`/`customer` bucket (half-up 2dp, `roundMoney`) |
| `KPI-SALES-CONFIRM-RATE` | Confirmation rate | *What share of orders complete?* | `SALES-ORDER-COUNT` (per status) | `confirmed ÷ (confirmed + pending + cancelled)` created in range | period | **A** | date range | tenant | `sales.orders.view` | **A** — three `meta.total` calls (status filter + date filter both exist) |
| `KPI-SALES-DOCTYPE-MIX` | Invoice vs sales-note mix | *How many sales need a fiscal document?* | `SALES-BY-DOCTYPE` | count per `document_type`, period | period | **A** (count) | date range | tenant | `sales.orders.view` | **A** (count) / **B** (revenue split) |
| `KPI-SALES-EXCEPTIONAL` | Exceptional-discount rate | *How often do vendors sell below floor?* | `SALES-EXCEPTIONAL-LINES` | `exceptional lines ÷ total lines`, period | period | **C** | date range | tenant | `sales.orders.view` (+ `pricing.floor.view`) | **C** — `is_exceptional_discount` is not filterable or aggregated; visible only per-order |
| `KPI-SALES-TOP-PRODUCTS` | Best-selling products | *What sells the most?* | `SALES-BY-PRODUCT` | rank variants by `Σ quantity` / `Σ line_total`, period | period | **A** | date range | tenant | `sales.orders.view` | **A** — F18-02, `GET /reports/sales-summary?groupBy=product`, server-ordered by `Σ line_total DESC`; no `category` filter yet (not in scope) |
| `KPI-SALES-BY-LOCATION` | Sales by sales point | *Which branch sells the most?* | `SALES-BY-LOCATION` | `Σ total` grouped by `orders.location_id`, period | period | **C** | date range | tenant / location | `sales.orders.view` | **C** — `orders.location_id` is **not a filter** on `GET /orders`; no grouping |

## 3. Operations — attention queues

| ID | Name | Business question | Metric(s) | Formula | Period | Comparison | Filters | Scope | Permission | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `KPI-OPS-APPROVALS-PENDING` | Pending price approvals | *What is waiting for my approval?* | `APPR-PENDING-COUNT` | `count(price_approvals where status='pending')` | point-in-time | n/a | orderId | tenant | *(GET has no permission declared — see [metrics.md](metrics.md#5-sales--price-approvals))* | **A** — dedicated partial index; `meta.total` |
| `KPI-OPS-APPROVALS-AGE` | Oldest pending approval | *How stale is the queue?* | `APPR-AGE` | `max(now − requested_at)` over pending | point-in-time | n/a | — | tenant | *(as above)* | **B** — per-row `requested_at` available; no server aggregate |
| `KPI-OPS-RETURNS-PENDING` | Returns to process | *What returns need handling?* | `RET-PENDING-COUNT` | `count(sales_returns where status IN ('requested','inspecting'))` | point-in-time | n/a | — | tenant | `sales.returns.view` | **B** — two calls (`requested`, `inspecting`); or one aggregate |
| `KPI-OPS-TRANSFERS-OPEN` | Open transfers | *What transfers are in flight?* | `TRF-OPEN-COUNT` | `count(transfers where status NOT IN ('received','cancelled'))` | point-in-time | n/a | source, destination | tenant / location | `inventory.view` | **B** — filter takes one status; "open" = 5 calls or an aggregate |
| `KPI-OPS-TRANSFERS-TO-RECEIVE` | Transfers awaiting receipt | *What is arriving at my location?* | `TRF-INTRANSIT-COUNT` | `count(transfers where status IN ('dispatched','partially_received'))` | point-in-time | n/a | destination | tenant / location | `inventory.transfers.receive` (to act) / `inventory.view` (to see) | **B** — two calls |
| `KPI-OPS-IMPORTS-ATTENTION` | Imports needing attention | *Did any import fail?* | `IMP-JOBS-STATUS` | `count` where `status IN ('completed_with_errors','failed')` | point-in-time | n/a | — | tenant | `import.execute` | **A** — two `meta.total` calls |
| `KPI-OPS-IMPORTS-RUNNING` | Imports in progress | *Is anything still processing?* | `IMP-JOBS-PENDING` | `count` where `status IN ('validating','importing', …)` | point-in-time | n/a | — | tenant | `import.execute` | **B** — multi-status |

## 4. Administration

| ID | Name | Business question | Metric(s) | Formula | Period | Comparison | Filters | Scope | Permission | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `KPI-USR-ACTIVE` | Active users | *How many people can use the system?* | `USR-COUNT-STATUS` | `count(users where status='active')` | point-in-time | n/a | — | tenant | `core.users.read` | **A** |
| `KPI-USR-DORMANT` | Dormant users | *Who has stopped using the system?* | `USR-RECENT-LOGIN`, `USR-NEVER-LOGGED-IN` | `count(users where last_login_at IS NULL OR < now − N days)` | point-in-time | n/a | N (days) | tenant | `core.users.read` | **B** — `lastLoginAt` is per-row; computed client-side over the paged list; no date filter |
| `KPI-USR-ROLE-MIX` | Role distribution | *How are permissions spread?* | `ROLE-DISTRIBUTION` | `count(users)` grouped by role | point-in-time | n/a | — | tenant | `core.users.read` + `core.roles.read` | **B** — client aggregate over `roleNames[]` |
| `KPI-ADMIN-ACTIVITY` | Admin activity | *Who changed what?* | `AUDIT-ACTIVITY` | — | period | — | actor, entity type, action | tenant | *(no route, no permission)* | **C** — `audit_log` has no read endpoint. → [data-gaps.md](data-gaps.md#gap-audit-read) |

## 5. Platform (SuperAdmin)

| ID | Name | Business question | Metric(s) | Formula | Period | Comparison | Filters | Scope | Permission | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `KPI-PLAT-TENANTS` | Total companies | *How many companies use the platform?* | `PLAT-TENANT-COUNT` | `count(tenants)` | point-in-time | n/a | — | platform | `@PlatformOnly()` | **A** |
| `KPI-PLAT-TENANTS-STATUS` | Companies by status | *How many are active / suspended / archived?* | `PLAT-TENANT-BY-STATUS` | group by `status` | point-in-time | n/a | — | platform | `@PlatformOnly()` | **A** — group the unpaginated array client-side |
| `KPI-PLAT-TENANTS-NEW` | New companies in the period | *Is the platform growing?* | `PLAT-TENANT-CREATED` | `count(tenants where created_at in range)` | period | **B** | date range | platform | `@PlatformOnly()` | **B** — no filter; group the array by `created_at` client-side |
| `KPI-PLAT-ACTIVITY` | Per-tenant usage / activity / health | *Which tenants are active or at risk?* | `PLAT-USERS-PER-TENANT` | any tenant-scoped aggregate | period | — | tenant | platform | — | **C** — SuperAdmin must not read tenant-scoped data; no cross-tenant aggregate endpoint exists (multi-tenancy.md#superadmin-vs-tenant / #administrative--cross-tenant-queries) |
| `KPI-PLAT-BILLING` | Revenue / plan / churn | *Platform business health* | `PLAT-BILLING` | — | — | — | platform | — | **C** — no billing/plan/subscription model in the schema |

---

## Summary — KPIs that are honestly usable today (state A)

Compute correctly against the real backend **now**, with no new endpoint:

- `KPI-SALES-ORDERS` — order count for {status, document type, customer, date range} + prior-period comparison.
- `KPI-SALES-CONFIRM-RATE` — order status mix over a period.
- `KPI-SALES-DOCTYPE-MIX` — invoice vs sales-note **counts** over a period.
- `KPI-OPS-APPROVALS-PENDING` — pending price-approval count.
- `KPI-OPS-IMPORTS-ATTENTION` — failed / completed-with-errors import count.
- `KPI-USR-ACTIVE` — active user count.
- `KPI-PLAT-TENANTS`, `KPI-PLAT-TENANTS-STATUS` — company counts (SuperAdmin).

**Added by F18-02** (`GET /reports/sales-summary`, real server-side aggregation):

- `KPI-SALES-REVENUE` — Σ total, tenant-timezone-aware day/week/month/customer grouping.
- `KPI-SALES-AVG-TICKET` — total ÷ orderCount per bucket.
- `KPI-SALES-TOP-PRODUCTS` — Σ line_total by variant, server-ranked descending.

Everything else is **B** (needs a FASE 18 aggregate / a filter / a join) or **C** (needs a schema
or contract change first — see [data-gaps.md](data-gaps.md)).
