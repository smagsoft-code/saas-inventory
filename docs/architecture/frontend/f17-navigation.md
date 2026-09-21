# F17 — Navigation Catalogue

> Per-persona navigation. Aligned to the existing registry `apps/web/src/lib/navigation.ts`
> (FASE 16): a single source, pages never hand-roll nav, **only routes that exist are listed**,
> items are permission-filtered server-side in the `(tenant)` layout, and the backend still
> authorizes every resulting request. Routes follow the FASE 16 flat `(tenant)/…` convention.
>
> This catalogue is the *target* registry for the end of FASE 17 — each module's sub-prompt adds
> its own entries when its routes are built (§13/§56 of Prompt 016).

## Personas & their navigation context

| Persona | Route group | Layout / guard | Nav model |
| --- | --- | --- | --- |
| **Platform Admin (Super-Admin)** | `(superadmin)/` (**new** — structurally separate, own layout + platform-session guard) | platform session (`GET /platform/auth/me`); never the tenant `getSession()` | its own minimal nav — **not** the tenant sidebar |
| **Tenant Admin** | `(tenant)/` | `getSession()` → `<AppShell>` | full sidebar, permission-filtered — sees admin sections |
| **Operational user** | `(tenant)/` | same | same sidebar, fewer items (permission-filtered); location-scoped data inside screens |
| **Multi-tenant identity** | `(public)` login → select company → `(tenant)/` for the chosen tenant | — | after selection, identical to any tenant user; **no in-session switcher** (016-C) — switching = sign out / sign in |
| **No active memberships** | stays in `(public)` | login returns generic `401` (no membership is not distinguished from bad credentials — security.md §6) | none |

## Tenant navigation (`(tenant)/`) — target registry

Grouping mirrors `docs/design/frontend-visual-system.md §6.7`. `icon` is a conceptual key (the
Sidebar resolves it; FASE 16 has `home`/`users`/`settings`, F17 adds the rest as inline SVGs).

| Group | Label | Route | Icon | Permission (to show) | Support | Screen |
| --- | --- | --- | --- | --- | --- | --- |
| — | Inicio | `/` | `home` | — (any) | **A** (operational tiles) | `S-HOME` |
| **Catálogo** | Productos | `/products` | `box` | `products.view` | **A** | `S-CAT-PRODUCTS` |
| | Categorías | `/categories` | `folder-tree` | `categories.view` | **A** | `S-CAT-CATEGORIES` |
| | Atributos | `/attributes` | `sliders` | `products.view` | **A** | `S-CAT-ATTR-DEFS` |
| | QR codes | `/qr` | `qr` | `catalog.qr.manage` | **A** — built F17-14 | `S-QR-LIST` |
| | Importación | `/imports` | `upload` | `import.execute` | **A** — built F17-11 | `S-IMP-LIST` |
| **Inventario** | Existencias | `/inventory` | `layers` | `inventory.view` | **A** (raw) / **B** (enriched) | `S-INV-BALANCES` |
| | Movimientos | `/inventory/movements` | `activity` | `inventory.view` | **A** / **B** (period) | `S-INV-MOVEMENTS` |
| | Transferencias | `/transfers` | `arrow-left-right` | `inventory.view` | **A** | `S-TRF-LIST` |
| | Almacenes | `/warehouses` | `warehouse` | `warehouses.view` | **A** | `S-WH-LIST` |
| | Ubicaciones | `/locations` | `map-pin` | `locations.view` | **A** | `S-LOC-LIST` |
| **Ventas** | Nueva venta | `/sales/new` | `shopping-cart` | `sales.orders.create` | **A** | `S-SALE-NEW` |
| | Historial | `/sales` | `receipt` | `sales.orders.view` | **A** (list) / **F18** (KPIs) | `S-SALES-HISTORY` |
| | Clientes | `/customers` | `users-round` | `sales.customers.view` | **A** | `S-CUST-LIST` |
| | Aprobaciones | `/approvals` | `badge-check` | `pricing.discount.request` **or** `pricing.discount.approve` (`NavItem.anyPermission`) | **A** | `S-APPROVALS-LIST` |
| | Devoluciones | `/returns` | `undo` | `sales.returns.view` | **A** — built F17-10 | `S-RET-LIST` |
| **Administración** | Usuarios | `/users` | `users` | `core.users.read` | **A** | `S-USERS-LIST` |
| | Roles | `/roles` | `shield` | `core.roles.read` | **A** (read-only) — built F17-14 | `S-ROLES-LIST` |
| | Configuración | `/settings` | `settings` | — (any; edit gated) | **A** | `S-SETTINGS` |

Notes:
- **`Aprobaciones`** visibility: `GET /price-approvals` now declares
  `@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')` (F17-09 —
  `GAP-APPROVALS-PERMISSION` resolved). The nav item mirrors that OR via the new
  `NavItem.anyPermission` field (`filterNavigation` checks `checker.canAny`).
- **`Historial`** (`/sales`) and **`Nueva venta`** (`/sales/new`) share a prefix — `isNavItemActive`
  uses the sibling-href rule so `/sales/new` lights up "Nueva venta" and every other `/sales/*`
  (incl. the order detail) lights up "Historial".
- **`Devoluciones`** (`/returns`, `/returns/new`, `/returns/[id]`) is built in **F17-10**
  (`sales.returns.view` to see it; `sales.returns.create` for New return + cancel;
  `inventory.returns.manage` for inspect/resolve). `isNavItemActive` keeps it independent of
  `/sales` via the same sibling-href rule.
- **`Importación`** (`/imports`, `/imports/new`, `/imports/[id]`, `/imports/templates`) is built in
  **F17-11** — one `import.execute` gate for the whole pipeline; `import.inventory` is checked
  server-side only at confirm for `update_catalog_and_inventory`. `isNavItemActive` keeps it under
  Catálogo, independent of `/inventory`.
- **Notification status** is not a nav item — it is a card on the order detail (`/sales/[id]`),
  reading `GET /orders/:id/notifications` (`sales.orders.view`). No retry control
  (`GAP-NOTIF-RETRY-BACKEND`).
- **`Atributos`** could instead live as a tab inside `/categories` — layout decision for F17, not
  a contract question.
- **`Roles`** could be a tab of `/users`. Full CRUD now (ROLES/PERMISSIONS block, `GAP-ROLE-CRUD`
  closed) — kept as its own top-level nav item, unchanged, rather than folded into `/users`.
- Location-access management is **not** a top-level nav item — it is a section of `S-USER-DETAIL`
  (`/users/[id]`), built F17-14 (`GET/PUT /users/:userId/locations`, `core.users.locations.manage`).
- **No** nav item for: brands, suppliers, serials, lots, price history, audit, reports/dashboards,
  notifications — none have F17 routes.

## Super-Admin navigation (`(superadmin)/`)

| Label | Route | Permission | Support | Screen |
| --- | --- | --- | --- | --- |
| Home | `/platform` | `@PlatformOnly()` | **A** — built FASE 16 | — |
| Companies | `/platform/tenants` | `@PlatformOnly()` | **A** — built F17-13 | `S-SA-TENANTS` |
| *(company detail)* | `/platform/tenants/[id]` | `@PlatformOnly()` | **A** — built F17-13 | `S-SA-TENANT-DETAIL` |

Every platform route lives under the `/platform/*` URL prefix (the `(superadmin)` route group
contains a `platform/` segment) so `middleware.ts`'s `platform_access_token` presence-gate and the
`/platform/login?returnTo=` flow apply uniformly. That is the **entire** supported Super-Admin
surface today. A platform dashboard, platform-admin management, and platform-initiated tenant
creation are **GAPs** (see [f17-super-admin.md](f17-super-admin.md)) — no nav entry until a backend
contract exists.

## Route protection summary

| Route group | Unauthenticated | Wrong session type | Missing permission |
| --- | --- | --- | --- |
| `(public)/` | allowed | — | — |
| `(tenant)/` | `middleware.ts` presence check → `/login?returnTo=`; layout `getSession()` → `/login` on 401 | a platform session has no tenant `/auth/me` → treated as unauthenticated → `/login` | screen renders a **403 error state**, never a redirect; nav item was hidden but that is not the boundary |
| `(superadmin)/` | → platform login | a tenant session is not a platform principal → `403`/redirect to platform login | n/a (no tenant RBAC on platform routes) |

See [f17-security-and-scope.md](f17-security-and-scope.md) for the full model.
