# F17 — Security & Scope

> Per-persona and per-screen: authentication, tenant context, permissions, location scope,
> platform scope, route protection, sensitive data, and what must never be trusted to the
> frontend. Audited from the guard chain, RLS policies, ADR-0024/0028/0030/0031/0032/0033.

## 0. First principle

**The frontend is never a security boundary.** Hiding a button, filtering a list client-side, or
gating a nav item is **UX only**. Every request is independently authorised by the backend:

```
JwtAuthGuard  → verify token, reject 401
TenantGuard   → resolve tenant from token; live-check tenant + membership + identity + user active
                (011-A/011-B/016-C); @PlatformOnly branch requires a platform principal, no tenant
PermissionsGuard → @RequirePermissions(code) against the user's effective permissions
Controller     → DTO validation (ValidationPipe whitelist)
Service        → tenant-filtered query + RLS backstop + LocationAuthorizationService where a write
                 targets a specific location
```

A 403 from any layer is a **normal, expected outcome** the UI renders in place.

## 1. Session model (FASE 16 + 016-C)

- **Tenant session:** httpOnly `access_token` (path `/`, `SameSite=Lax`, `Secure` outside dev),
  path-restricted httpOnly `refresh_token` (`/api/v1/auth`), non-httpOnly `csrf_token`
  (double-submit). JS never reads the session tokens.
- **Selection token (016-C):** httpOnly `tenant_selection` cookie, ~5 min, **no business
  permissions**, rejected anywhere a session is expected. The frontend never reads, stores, or
  forwards it.
- **Platform session:** distinct cookie names (`platform_*`), `context: 'global'` claim, no
  `tenantId`.
- **A session always represents exactly one active tenant.** No in-session tenant switch (016-C).
- **401 handling:** one silent `POST /auth/refresh` + one retry (browser only); never on
  403/400/404/409/422/429/5xx, never the refresh call itself, never twice. Failure → one
  `session-expired` event → `/login?returnTo=<safeReturnTo>`.

## 2. Personas → scope

| Persona | Auth | Tenant context | Permissions | Location scope | Platform |
| --- | --- | --- | --- | --- | --- |
| **Unauthenticated** | none | none | none | — | — |
| **Platform Admin** | platform session | **none** (never resolves a tenant) | none (no tenant RBAC on platform routes) | — | `@PlatformOnly()` |
| **Tenant Admin** | tenant session | the one active tenant from the token | typically all `DEFAULT_ROLE_TEMPLATES.Administrador` codes | usually unrestricted (zero `user_location_assignments` rows) | — |
| **Operational user** | tenant session | the one active tenant | subset per role (Supervisor / Vendedor / Bodega) | restricted to assigned locations if any rows exist (ADR-0024) | — |
| **Multi-tenant identity** | tenant session **for the selected tenant only** | the selected tenant | the roles that identity's `users` row has *in that tenant* | as above, per tenant | — |

## 3. Location scope (ADR-0024) — which screens honour it

A **business-authorization** control (which of the tenant's *own* locations a user may act on) —
**not** tenant isolation. Zero assignment rows = unrestricted. Enforced by
`LocationAuthorizationService` at the point a write targets a specific location.

| Screen | Location-scoped? | Enforcement point |
| --- | --- | --- |
| `S-INV-BALANCES`, `S-INV-MOVEMENTS` | **Yes** (should show only assigned locations) | read: **the endpoints do not filter by assignment today** — [`GAP-INV-LOCATION-SCOPE`](f17-gaps.md#gap-inv-location-scope) |
| `S-INV-ADJUST` | **Yes** | write: `403` if `locationId` not authorised |
| `S-TRF-*` | **Yes** | prepare/dispatch on source, receive on destination → `403` if not authorised |
| `S-RET-DETAIL` inspect/resolve | **Yes** | each `dispositionLocationId` checked → `403` |
| `S-SALE-NEW` | **Yes** (cart `location_id`) | cart operations + checkout location-checked |
| `S-IMP-NEW` | **Partial** | `default_location_id` + per-row target location checked at validation |
| `S-SALES-HISTORY` / `S-ORDER-DETAIL` | **`orders.location_id` exists but the list is NOT location-scoped** | [`GAP-ORDERS-LOCATION`](f17-gaps.md#gap-orders-location) — **decision needed:** should order visibility be location-scoped? |
| Catalog, Customers, Users, Settings, QR, Approvals | **No** | tenant-scoped only |

## 4. Permission matrix (per screen)

| Screen | View permission | Mutate permission(s) |
| --- | --- | --- |
| `S-HOME` | — (tiles individually gated) | — |
| `S-SETTINGS` | — (`GET /tenant` has none) | `core.tenant.update`, `administration.settings.view`/`.manage` |
| `S-USERS-LIST` / `S-USER-DETAIL` | `core.users.read` | `core.users.create`, `core.users.update`, `core.users.locations.manage` |
| `S-ROLES-LIST` | `core.roles.read` | *(none — no CRUD)* |
| `S-CAT-PRODUCTS` / detail | `products.view` | `products.manage` |
| `S-CAT-CATEGORIES` | `categories.view` | `categories.manage`, `catalog.attributes.manage` (category attrs) |
| `S-CAT-ATTR-DEFS` | `products.view` | `catalog.attributes.manage` |
| `S-QR-*` | `catalog.qr.manage` (all routes) | `catalog.qr.manage` |
| `S-INV-BALANCES` / `S-INV-MOVEMENTS` | `inventory.view` | — |
| `S-INV-ADJUST` | `inventory.view` | `inventory.adjust` + location auth |
| `S-WH-*` | `warehouses.view` | `warehouses.manage` |
| `S-LOC-*` | `locations.view` | `locations.manage` |
| `S-TRF-LIST` / `S-TRF-DETAIL` | `inventory.view` | `inventory.transfers.request` (create), `.approve` (approve/cancel), `.dispatch` (prepare/dispatch), `.receive` (receive) + location auth |
| `S-SALE-NEW` | `sales.carts.manage` | `sales.carts.manage`, `sales.orders.create` (checkout), `pricing.discount.request` (approval) |
| `S-CUST-*` | `sales.customers.view` | `sales.customers.manage` |
| `S-SALES-HISTORY` / `S-ORDER-DETAIL` | `sales.orders.view` | `sales.orders.create` (confirm), `sales.orders.cancel` (cancel) |
| `S-APPROVALS-LIST` / detail | **none declared** ([`GAP-APPROVALS-PERMISSION`](f17-gaps.md#gap-approvals-permission)) | `pricing.discount.approve` (approve/reject) |
| `S-RET-LIST` / `S-RET-DETAIL` | `sales.returns.view` | `sales.returns.create` (create/cancel), `inventory.returns.manage` (inspect/resolve) + location auth |
| `S-IMP-*` | `import.execute` | `import.execute`, `import.inventory` (for `update_catalog_and_inventory`) |
| `S-SA-*` | `@PlatformOnly()` | `@PlatformOnly()` |

**Field gates (ADR-0028):** `pricing.floor.view` → `min_price*`; `pricing.cost.view` → `cost` /
`unit_cost_snapshot`. Absent field ⇒ not authorised (never returned-then-hidden).

## 5. What must NEVER be trusted to the frontend

| Must not | Enforced by |
| --- | --- |
| A client-supplied `tenantId` / `tenantSlug` / `userId` | tenant + user come only from the verified token; `@CurrentTenant()` / `@CurrentUser()` |
| A client claim of "I have permission" | `PermissionsGuard` re-checks every request |
| A client-computed "price is below floor / requires approval" | `SalesPricingService` classifies server-side; UI never computes `price < minPrice`, never holds a hidden `minPrice` |
| A client-chosen role above its own | ADR-0031 self-escalation rule, server-enforced |
| A client claim of returnable quantity | checked under a row lock server-side |
| A client-chosen disposition location bypassing sellable rules | ADR-0021, server-enforced |
| A client bypassing an unapproved exceptional line at confirm | `OrdersService.confirm` gate → `409` |
| Hiding a UI element = authorisation | it is UX; the API is the authority |
| Reading gated fields the response omitted | they are simply not present |

## 6. Sensitive data handling

- **Never rendered:** password hashes (never in any DTO), raw session/selection tokens (httpOnly),
  refresh tokens, `event_outbox` internals.
- **Gated:** `min_price`, `cost` — only for holders of the respective permission.
- **Frozen snapshots:** order/return screens display the **frozen** customer snapshot
  (`customer_*_snapshot`), not the live customer record — a later edit to the customer must not
  change a historical document.
- **Correlation IDs:** shown in error states for support; safe to display.
- **Audit `before_state`/`after_state`:** not exposed (no read endpoint) — if
  [`GAP-AUDIT-READ`](f17-gaps.md#gap-audit-read) is ever built, these JSONB blobs need redaction
  rules.
- **Demo data:** `tenant.isDemo` — the shell may show a "demo" pill; demo content is never carried
  into F17 as fixtures.
