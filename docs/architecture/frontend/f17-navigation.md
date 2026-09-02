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
| | QR | `/qr` | `qr` | `catalog.qr.manage` | **A** | `S-QR-LIST` |
| | Importación | `/imports` | `upload` | `import.execute` | **A** | `S-IMP-LIST` |
| **Inventario** | Existencias | `/inventory` | `layers` | `inventory.view` | **A** (raw) / **B** (enriched) | `S-INV-BALANCES` |
| | Movimientos | `/inventory/movements` | `activity` | `inventory.view` | **A** / **B** (period) | `S-INV-MOVEMENTS` |
| | Transferencias | `/transfers` | `arrow-left-right` | `inventory.view` | **A** | `S-TRF-LIST` |
| | Almacenes | `/warehouses` | `warehouse` | `warehouses.view` | **A** | `S-WH-LIST` |
| | Ubicaciones | `/locations` | `map-pin` | `locations.view` | **A** | `S-LOC-LIST` |
| **Ventas** | Nueva venta | `/sales/new` | `shopping-cart` | `sales.orders.create` | **A** | `S-SALE-NEW` |
| | Historial | `/sales` | `receipt` | `sales.orders.view` | **A** (list) / **F18** (KPIs) | `S-SALES-HISTORY` |
| | Clientes | `/customers` | `users-round` | `sales.customers.view` | **A** | `S-CUST-LIST` |
| | Aprobaciones | `/approvals` | `badge-check` | *(GET undeclared — see gap)* | **A** | `S-APPROVALS-LIST` |
| | Devoluciones | `/returns` | `undo` | `sales.returns.view` | **A** | `S-RET-LIST` |
| **Administración** | Usuarios | `/users` | `users` | `core.users.read` | **A** | `S-USERS-LIST` |
| | Roles | `/roles` | `shield` | `core.roles.read` | **A** (read-only) | `S-ROLES-LIST` |
| | Configuración | `/settings` | `settings` | — (any; edit gated) | **A** | `S-SETTINGS` |

Notes:
- **`Aprobaciones`** visibility: because `GET /price-approvals` declares no permission, the nav
  item needs a client-side gate decision — recommend showing it when the user holds
  `pricing.discount.approve` **or** `pricing.discount.request` (see
  [f17-gaps.md](f17-gaps.md#gap-approvals-permission)); the backend must still be corrected.
- **`Atributos`** could instead live as a tab inside `/categories` — layout decision for F17, not
  a contract question.
- **`Roles`** could be a tab of `/users`. It is read-only regardless (`GAP-ROLE-CRUD`).
- Location-access management is **not** a top-level nav item — it is a section of `S-USER-DETAIL`.
- **No** nav item for: brands, suppliers, serials, lots, price history, audit, reports/dashboards,
  notifications — none have F17 routes.

## Super-Admin navigation (`(superadmin)/`)

| Label | Route | Permission | Support | Screen |
| --- | --- | --- | --- | --- |
| Empresas | `(superadmin)/tenants` | `@PlatformOnly()` | **A** | `S-SA-TENANTS` |
| *(company detail)* | `(superadmin)/tenants/[id]` | `@PlatformOnly()` | **A** | `S-SA-TENANT-DETAIL` |

That is the **entire** supported Super-Admin surface today. A platform dashboard, platform-admin
management, and platform-initiated tenant creation are **GAPs** (see
[f17-super-admin.md](f17-super-admin.md)) — no nav entry until a backend contract exists.

## Route protection summary

| Route group | Unauthenticated | Wrong session type | Missing permission |
| --- | --- | --- | --- |
| `(public)/` | allowed | — | — |
| `(tenant)/` | `middleware.ts` presence check → `/login?returnTo=`; layout `getSession()` → `/login` on 401 | a platform session has no tenant `/auth/me` → treated as unauthenticated → `/login` | screen renders a **403 error state**, never a redirect; nav item was hidden but that is not the boundary |
| `(superadmin)/` | → platform login | a tenant session is not a platform principal → `403`/redirect to platform login | n/a (no tenant RBAC on platform routes) |

See [f17-security-and-scope.md](f17-security-and-scope.md) for the full model.
