# Filters, Periods & Scope

Reusable filter definitions, period/timezone/currency/precision rules, and the security model
every metric, KPI, report and dashboard must obey. Everything here is audited from the real
schema/DTOs; where the architecture does not pin a value, it says so.

---

## 1. Reusable filters

A filter is "supported" only if a real query parameter accepts it today. "Derivable" = the column
exists but no endpoint filters on it. "Absent" = not modelled.

| Filter | Applies to | Supported today (endpoint param) | Notes |
| --- | --- | --- | --- |
| **tenant** | everything tenant-scoped | Implicit — never a parameter. Resolved from the verified session (`TenantGuard`), enforced by RLS. **Never** accepted from the client (multi-tenancy.md, CLAUDE.md §7.3). | A client-supplied `tenantId` is ignored/rejected everywhere. |
| **warehouse** | inventory balances, locations, movements, transfers | `GET /locations?warehouseId=` only. **Not** on balances / movements / transfers. | Derivable via location → warehouse. |
| **location** | balances, movements, transfers, adjustments, orders, returns, carts | balances/movements: `locationId`. transfers: `sourceLocationId` / `destinationLocationId`. **Orders: NOT filterable by location** (`orders.location_id` exists, no param). returns: no location filter. | |
| **user / actor** | movements (`actor_id`), orders (`placed_by_user_id`), transfers (`requested_by` etc.), approvals, returns, audit | **None** — no endpoint filters by user. | All these columns exist. |
| **product / variant** | balances, movements, order lines, transfer lines, price history | balances/movements: `productVariantId`. products list: none (no SKU/name search). | |
| **category** | products | `GET /products?categoryId=`. | Single category, no subtree. |
| **brand / supplier** | products | **Absent** — no filter, no list endpoint for brands/suppliers (ADR-0019). | |
| **customer** | orders | `GET /orders?customerId=`. | |
| **status** | every list (products, categories, warehouses, locations, transfers, orders, returns, approvals, imports, users) | Yes — one value per call (`?status=X`). **No multi-status / array.** | See `GAP-MULTI-STATUS`. |
| **document type** | orders | `GET /orders?documentType=invoice|sales_note`. | |
| **invoice status** | orders | **Derivable** — `invoice_status` on the row, no param. Moot: never leaves `pending`. |
| **movement type** | movements | `GET /inventory/movements?movementType=X`. | One value per call. |
| **disposition** | return items | **Absent** — return items not filterable/listable outside a return. |
| **date / period** | orders (`createdFrom`/`createdTo`), movements (`occurredFrom`/`occurredTo`, F18-03) | **Orders and movements.** Transfers, returns, approvals, imports, customers, users, price history still have **no date filter**. | Movements' filter is half-open `[occurredFrom, occurredTo)` on `occurred_at` (F18-01's new-endpoint convention) — deliberately *not* orders' inclusive-both-bounds `createdFrom`/`createdTo` on `created_at`, since movements already carries the semantically-correct `occurred_at` column orders never had. |
| **free-text search (`q`)** | customers (`displayName` / `taxId` / `email` / `phone`) | **Customers only.** No search on products, orders, movements, transfers, users. | api.md: "search is a distinct documented parameter … decided per-endpoint". |
| **is_exceptional_discount** | order lines | **Absent** — flag on `order_items`, no filter, no aggregate. |
| **is_demo** | tenants (SuperAdmin) | Client-side over the unpaginated array. |

### Sorting

**No list endpoint exposes a `sort` parameter.** Each repository has a fixed order (`updated_at`,
`created_at`, or an index). api.md specifies an allow-listed `sort` param per endpoint "for the
same reason" as filtering — **none is implemented**. Any sortable-column UI in a prototype is
`PROTOTYPE ONLY`.

### Grouping

**No *operational* endpoint groups/aggregates** — every list above stays a flat, filtered,
paginated row set. Grouping/aggregation is a FASE 18 read-side concern, built as its own dedicated
endpoint per domain: `GET /reports/sales-summary` (F18-02, `groupBy: day|week|month|product|
customer`) and `GET /reports/inventory-summary` (F18-03, `groupBy: warehouse|category`). Grouping
by disposition, role, or any other still-open dimension remains unbuilt.

---

## 2. Periods, timezone, currency, precision

### Period boundaries

**RATIFIED — F18-01.** Every new FASE 18 reporting endpoint uses half-open **`[from, to)`**: `from`
is an inclusive lower bound, `to` is an exclusive upper bound. Enforced in exactly one place —
`toHalfOpenRange()` (`apps/api/src/common/reporting/date-range.ts`), which returns `{ gte, lt }`
(never `lte`) for a repository query to apply — and paired with the reusable
`ReportDateRangeQueryDto` (`from?`/`to?`, `@IsDateString()`) new report DTOs extend. Unit-tested
(`date-range.spec.ts`) against the exact boundary cases: a row at `to` is excluded, a row at `from`
is included.

**Explicit, deliberate exception:** `GET /orders` (`apps/api/src/sales/repositories/orders.repository.ts`)
keeps its pre-existing, already-shipped **inclusive-both-bounds** semantics (`gte`/`lte` on
`createdFrom`/`createdTo`) — it is a FASE 12 SALES operational filter, not a FASE 18 reporting
endpoint, and the F17-09 Sales History screen already compensates for it (sending an explicit
`...T23:59:59.999Z` upper bound). Retroactively changing `GET /orders`'s comparison operators would
be a breaking change to an already-tested F17 screen — out of scope for a foundations-only phase.
New FASE 18 endpoints never inherit this exception; they use the half-open contract above.

- `orders` has **only `created_at`** — no `confirmed_at`. "Revenue for June" therefore means
  "orders *created* in June that are now `confirmed`", which is a small but real semantic caveat
  (an order created 30 June, confirmed 2 July, counts in June). If "confirmed in period" is
  required, that is a **gap** — no timestamp supports it (`GAP-ORDER-CONFIRMED-AT`, still open,
  deferred to the sub-prompt that first needs it — no backfill in F18-01).
- Point-in-time KPIs (stock, queue depth) have **no history** — no snapshot table
  (`GAP-SNAPSHOTS`). "as of last month" is not reconstructable.
- **Missing `from`/`to`:** `ReportDateRangeQueryDto` leaves both optional; each report's own DTO
  decides whether either is required and what its default means (e.g. "all time", "start of the
  current month") — not centrally mandated, matching api.md's "no generic passthrough" convention.
- **Max range:** not imposed centrally — no evidence yet of a real performance need to cap it. Each
  F18-0X sub-prompt evaluates a limit against that specific report's actual query cost when it is
  built, rather than inventing an arbitrary number here.

### Timezone

**RESOLVED (visibility) — F18-01.** `GET /auth/me` (and every other session-issuing response —
login, select-tenant, refresh) now carries `timezone` (`tenant_settings.timezone`, `'UTC'` default),
resolved server-side from the caller's own authenticated tenant, **never permission-gated** —
closes `GAP-TZ-VISIBILITY`. `GET /administration/tenant-settings` (`administration.settings.view`)
remains the only way to *write* the timezone or read business hours; it is unchanged.

- The source of truth is still, and only, `tenant_settings.timezone` (IANA name, e.g.
  `America/Bogota`). Default `'UTC'` when unset — unchanged, no migration, no backfill.
- All DB timestamps are `timestamptz` (stored UTC). "Today" / "this month" for a tenant is computed
  against the tenant's IANA zone, then converted to a UTC range for the query. The conversion
  algorithm (DST-safe, `Intl`-only, two-pass midnight correction) now has one shared, tested source
  — `tenantStartOfDayUtc()` in `@saas-inventory/shared` (`packages/shared/src/index.ts`) — ported
  from `apps/web/src/lib/home/tenant-day.ts` (F17-12, left untouched and still the one `apps/web`
  imports, since `apps/web` does not otherwise depend on `@saas-inventory/shared` at runtime) so
  `apps/api` and any future backend reporting endpoint use the exact same algorithm rather than a
  second, potentially-drifting implementation. Only "start of day" exists so far — "start of week" /
  "start of month" are added by whichever F18-0X sub-prompt first needs them, not invented ahead of
  that need.
- `pg-verify` runs in `America/Bogota` locale; production timezone is deployment config, not a
  reporting input.

### Currency

- `orders.currency` is `char(3)`, **always `'USD'`** in code (documented FASE 12 assumption). No
  per-tenant currency configuration exists. All money is single-currency; no FX, no conversion.
- Multi-currency reporting is **out of scope** until a currency model exists.

### Monetary precision

- All money columns are Postgres `numeric` with **no scale pinned in the schema** (unbounded).
- `OrdersService` applies **half-up rounding to 2 decimal places** in application code
  (`line_total = unit_price × qty`, `subtotal = Σ line_total`, `total = subtotal + tax_total`,
  `tax_total = 0`). This is **not** enforced by a DB constraint.
- `discount_total` is informational (never re-subtracted from `total`).
- Reporting sums must use `numeric` arithmetic (never float) and present at 2dp for USD.

### Quantities

- `numeric` columns; fractional quantities are permitted by the column type. Per-table checks:
  `> 0` (order/cart/transfer/return items, movements `<> 0`), `>= 0` (balances, dispatched/received).

---

## 3. Security & multi-tenancy model — non-negotiable for all reporting

Every metric / KPI / report / dashboard query MUST resolve, in order:

```
Identity → active Membership → active Tenant → active User → (if location-sensitive) Location authorization
```

(ADR-0033 / ADR-0030 / ADR-0031 / ADR-0024, enforced by `JwtAuthGuard` → `TenantGuard` →
`PermissionsGuard` + `LocationAuthorizationService`.)

**Forbidden — a reporting feature that does any of these is rejected:**

| Anti-pattern | Rule |
| --- | --- |
| Cross-tenant aggregation on a tenant endpoint | A tenant query is **always** `tenant_id`-filtered **and** RLS-backed. No "just don't filter this time". Cross-tenant is SuperAdmin-only, via an explicit audited aggregate path (multi-tenancy.md#administrative--cross-tenant-queries). |
| Trusting `tenantId` from the client | The tenant comes only from the verified session. Never a header/body/query param taken at face value. |
| Client-side filtering as a security mechanism | The server must return only rows the caller may see. Hiding rows in the UI is never the boundary. |
| Permission as UI-only hiding | Every reporting endpoint declares `@RequirePermissions(...)`. The gate is server-side; a 403 is a normal outcome. **Exception found:** `GET /price-approvals` + `/:id` declare **none** — flagged for F17-00 / FASE 19, not fixed by 017-A. |
| Showing another tenant's data | RLS `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy on every tenant-owned table is the backstop; the query filter is the primary control. |
| SuperAdmin reading tenant data because "they're admin" | `platform_admins` is structurally separate; a platform token carries no `tenant_id` and never reaches tenant RBAC. SuperAdmin dashboards use `tenants` only. |

### Scope of each reporting subject

| Subject | Tenant scope | Location scope (ADR-0024) | Permission |
| --- | --- | --- | --- |
| Products / categories / attributes / QR | tenant | none | `products.view` / `categories.view` / `catalog.*` |
| Inventory balances / movements / adjustments | tenant | **writes only** — `LocationAuthorizationService.assertAccess` gates `inventory.adjust` and every transfer state transition that targets a specific location; `GET /inventory/balances` and `GET /inventory/movements` are **not** location-scoped — a location-restricted user with read access sees every location's rows, same as an unrestricted user (verified against the real code, F18-03 — corrects this row's previous "yes" for reads) | `inventory.view` / `inventory.adjust` |
| Inventory summary (`GET /reports/inventory-summary`, F18-03) | tenant | **no** — reuses the exact, real, current read scope of `GET /inventory/balances` above (tenant-wide); ADR-0024's guard is a write-action check, never a read filter, so this report does not invent a location-scoping policy the existing reads themselves don't have | `inventory.view` |
| Transfers | tenant | **yes** — source/destination location authorization | `inventory.view` / `inventory.transfers.*` |
| Customers | tenant | none | `sales.customers.view` |
| Orders / order lines | tenant | **`orders.location_id` exists but the list endpoint does not scope by it** — deferred by F18-01 (see below), `GAP-ORDERS-LOCATION` still open | `sales.orders.view` |
| Price approvals | tenant | none | *(GET undeclared)* / `pricing.discount.approve` to act |
| Returns | tenant | **yes** for disposition location | `sales.returns.view` / `inventory.returns.manage` |
| Imports | tenant | `default_location_id` is authorized at validation; the job list is not location-scoped | `import.execute` |
| Users / roles / audit | tenant | none | `core.users.read` / `core.roles.read` |
| Companies | platform | n/a | `@PlatformOnly()` |

### Field-level authorization (ADR-0028)

Even within an allowed row, some fields are gated and must be built **by inclusion**, never
stripped after the fact:

| Field | Gate |
| --- | --- |
| `product_variants.min_price`, `order_items.min_price_snapshot`, `price_approvals.min_price_at_request` | `pricing.floor.view` |
| `product_variants.cost`, `order_items.unit_cost_snapshot` | `pricing.cost.view` |

A report that would expose a gated field to a caller without the permission is a **defect**, not a
"filter it in the UI" situation.

### `GAP-ORDERS-LOCATION` — deferred by F18-01, not resolved

F18-01 does **not** implement `locationId` filtering/scoping on `GET /orders` — that decision
(should order visibility respect `user_location_assignments` like the rest of INVENTORY, or stay
tenant-wide) is left open, per its own no-implementation mandate. Consequence for F18-02+:

- General sales reports (revenue/ticket/by-product/by-customer, grouped by day/week/month) stay
  **tenant-wide** — they do not need `locationId` and are not blocked by this gap.
- `REP-SALES-BY-LOCATION` specifically **stays blocked** until the decision above is made — it
  cannot correctly exist without first deciding whether it is TENANT-WIDE (grouping visible orders
  by their `location_id`, no scoping change) or LOCATION-SCOPED (also restricting *which* orders a
  location-restricted caller can even see, extending ADR-0024 to reads).

---

## 4. Permission catalogue (41 codes)

For reference — the fixed catalogue (`permissions` table, migrations `0001`/`0014`–`0017`/`0023`/
`0026`/`0027`) and the default role→permission matrix
(`packages/shared/src/index.ts` `DEFAULT_ROLE_TEMPLATES`).

`administration.settings.view`/`.manage` · `catalog.attributes.manage` · `catalog.qr.manage` ·
`categories.view`/`.manage` · `core.roles.read`/`.assign` · `core.tenant.update` ·
`core.users.read`/`.create`/`.update` · `core.users.locations.manage` ·
`import.execute`/`.inventory` · `inventory.view`/`.adjust` · `inventory.returns.manage` ·
`inventory.transfers.request`/`.approve`/`.dispatch`/`.receive` · `locations.view`/`.manage` ·
`pricing.cost.view`/`.floor.view` · `pricing.discount.request`/`.approve` · `pricing.policy.manage`
*(no endpoint yet)* · `products.view`/`.manage` · `sales.carts.manage` ·
`sales.customers.view`/`.manage` · `sales.orders.view`/`.create`/`.cancel` ·
`sales.returns.view`/`.create` · `warehouses.view`/`.manage`.

Default roles: **Administrador** (all), **Supervisor** (approvals, transfers, cost/floor
visibility, sales, returns), **Vendedor** (sell + request discounts, floor visibility, no cost),
**Bodega** (transfers, adjustments, returns processing, view catalog/inventory).

**RATIFIED — F18-01.** No `reports.*`/`analytics.*` permission family is introduced. A report
endpoint reuses the `*.view` permission of the domain it reports on — e.g. a future
`GET /reports/sales-summary` gates on `sales.orders.view`, exactly like `GET /orders` — the same
"module.resource.action" catalogue every migration since `0014` has followed, no new code. This is
confirmed against the real, current 39-entry catalogue in `packages/shared/src/index.ts`
`DEFAULT_ROLE_TEMPLATES` (not just this doc) — no `reports.*`/`analytics.*` code exists there.

A dashboard that combines **multiple** domains in one screen (e.g. a future executive Home mixing
sales + inventory + returns tiles) is the one case where reusing a single domain permission would
be wrong — that dashboard's own sub-prompt decides then whether it needs a dedicated gate
(documented, justified by the specific mixing, never invented speculatively here). No such
dashboard is built in F18-01.

`pricing.cost.view`/`pricing.floor.view` continue to gate the specific gated fields
(`min_price`/`unit_cost_snapshot` and anything derived from them, e.g. a future margin report)
exactly as they do today — unchanged by this decision.
