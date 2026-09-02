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
| **date / period** | orders (`createdFrom`/`createdTo`), — | **Orders only.** Movements, transfers, returns, approvals, imports, customers, users, price history have **no date filter**. | The single date-filterable list in the whole API. |
| **free-text search (`q`)** | customers (`displayName` / `taxId` / `email` / `phone`) | **Customers only.** No search on products, orders, movements, transfers, users. | api.md: "search is a distinct documented parameter … decided per-endpoint". |
| **is_exceptional_discount** | order lines | **Absent** — flag on `order_items`, no filter, no aggregate. |
| **is_demo** | tenants (SuperAdmin) | Client-side over the unpaginated array. |

### Sorting

**No list endpoint exposes a `sort` parameter.** Each repository has a fixed order (`updated_at`,
`created_at`, or an index). api.md specifies an allow-listed `sort` param per endpoint "for the
same reason" as filtering — **none is implemented**. Any sortable-column UI in a prototype is
`PROTOTYPE ONLY`.

### Grouping

**No endpoint groups/aggregates.** All grouping (by day, by product, by customer, by disposition,
by role) is a FASE 18 read-side concern.

---

## 2. Periods, timezone, currency, precision

### Period boundaries

- **`orders` is filterable by `createdFrom` / `createdTo`** (`IsDateString` — ISO-8601). The
  service comparison semantics (inclusive/exclusive of the bounds) are **not documented in
  api.md**; F17-00 / FASE 18 must pin them (recommend: `from` inclusive, `to` exclusive,
  half-open `[from, to)`).
- `orders` has **only `created_at`** — no `confirmed_at`. "Revenue for June" therefore means
  "orders *created* in June that are now `confirmed`", which is a small but real semantic caveat
  (an order created 30 June, confirmed 2 July, counts in June). If "confirmed in period" is
  required, that is a **gap** — no timestamp supports it (`GAP-ORDER-CONFIRMED-AT`).
- Point-in-time KPIs (stock, queue depth) have **no history** — no snapshot table
  (`GAP-SNAPSHOTS`). "as of last month" is not reconstructable.

### Timezone

- The **only** tenant timezone source is `tenant_settings.timezone` (IANA name, e.g.
  `America/Bogota`), via `GET /administration/tenant-settings` (`administration.settings.view`).
  Default `'UTC'` when unset.
- All DB timestamps are `timestamptz` (stored UTC). "Today" / "this month" for a tenant must be
  computed against `tenant_settings.timezone`, then converted to a UTC range for the
  `createdFrom`/`createdTo` query. No endpoint does this conversion today — the client (or the
  FASE 18 read-side) must.
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
| Inventory balances / movements / adjustments | tenant | **yes** — a location-restricted user sees only assigned locations | `inventory.view` / `inventory.adjust` |
| Transfers | tenant | **yes** — source/destination location authorization | `inventory.view` / `inventory.transfers.*` |
| Customers | tenant | none | `sales.customers.view` |
| Orders / order lines | tenant | **`orders.location_id` exists but the list endpoint does not scope by it** — F17-00 must decide whether order visibility is location-scoped | `sales.orders.view` |
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

**No reporting-specific permission exists.** Reporting reuses the domain `*.view` permissions. A
`reports.*` family (and whether `KPI-INV-VALUE` needs `pricing.cost.view`, whether a dashboard
needs its own gate) is a FASE 18 decision.
