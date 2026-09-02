# F17 — Master Screen Catalogue

> Every screen FASE 17 must build. Each entry: **id · module · persona · route · objective ·
> scope · permission · endpoint(s) · request DTO · response DTO · fields/columns · filters · sort ·
> pagination · actions · domain states · transitions · validation · errors · loading/empty/error/
> forbidden · responsive · dependencies · gaps · F17/F18**.
>
> **Routes** follow the FASE 16 convention (`docs/architecture/frontend.md`): `(public)/…` (no
> session), `(tenant)/…` flat routes (`/`, `/settings`, `/users`, …), future `(superadmin)/…`
> group. All API paths are under `/api/v1/` (Fastify global prefix + URI versioning); the browser
> calls them same-origin via the `next.config.ts` rewrite.
>
> **Standard states** (defined once in [f17-functional-contract.md §1](f17-functional-contract.md#1-standard-screen-state-model)):
> initial-loading · skeleton · loaded · empty · error · forbidden(403) · unauthorized(401→refresh→login)
> · session-expired · validation-error · mutation-pending · mutation-success · mutation-failure.
> Screens list only *deviations* from the standard.
>
> **Personas** (see [f17-security-and-scope.md](f17-security-and-scope.md)): **PA** Platform Admin ·
> **TA** Tenant Admin · **OP** operational user (tenant + authorized locations) · **any** any
> authenticated tenant member.

Legend for support: **A** fully supported · **B** additive backend change recommended (small) ·
**GAP** blocked pending a backend decision · **F18** deferred.

---

## MODULE: AUTH  (`(public)/`)

### `S-AUTH-LOGIN` — Sign in
- **Persona:** unauthenticated · **Route:** `/login` · **Scope:** none (pre-session).
- **Objective:** authenticate an identity by email + password (016-C).
- **Endpoint:** `POST /api/v1/auth/login` · **Request:** `{ email, password }` (no `tenantSlug`) ·
  **Response:** `LoginResponseDto` — `{ status: 'authenticated', user, accessTokenExpiresAt }` **or**
  `{ status: 'tenant_selection_required', availableTenants:[{tenantId,name}], selectionTokenExpiresAt }`.
- **Fields:** email, password, "Sign in". Also `POST /auth/refresh` once silently on mount
  (FASE 16 behaviour) before showing the form.
- **Actions:** submit → on `authenticated` redirect to `returnTo` (open-redirect-safe); on
  `tenant_selection_required` → in-place transition to `S-AUTH-SELECT-TENANT`.
- **Validation:** email format + non-empty password (client hint only); backend is authority.
- **Errors:** generic `401 "Invalid email or password."` for wrong password / unknown email /
  disabled identity / pending_credential / no active membership (never distinguished — security.md
  §6). Stray field → `400` (DTO whitelist). `429` rate limited (`AuthThrottlerGuard`).
- **State deviations:** no empty state; "checking session" spinner during the silent refresh.
- **Responsive:** design `LoginDesktop` (split brand panel) / `LoginMobile` (single column).
- **Deps:** none. **Gaps:** "Recordarme" / "reset password" = **no backend** → not built
  ([017-DESIGN](../../design/frontend-screen-specs.md) already marks PROTOTYPE ONLY).
- **F17.** *(already implemented in 016-D — F17 owns any further polish only.)*

### `S-AUTH-SELECT-TENANT` — Choose a company
- **Persona:** credential-verified identity with >1 active membership · **Route:** rendered within
  `/login` (state 2, not a distinct route) · **Scope:** none yet.
- **Objective:** pick which tenant to open; complete login.
- **Endpoint:** `POST /api/v1/auth/select-tenant` · **Request:** `{ tenantId }` (selection token
  travels in the httpOnly `tenant_selection` cookie — never read/stored/forwarded by JS) ·
  **Response:** `AuthSessionResponseDto` `{ user, accessTokenExpiresAt }`.
- **Fields/columns:** list of `availableTenants[].name` as selectable rows (name + chevron).
- **Actions:** pick a company → session cookies set → redirect to `returnTo`. "Back to sign in"
  → reset to state 1.
- **Validation:** `tenantId` must be one of `availableTenants` (the only ids the form can send).
- **Errors:** generic `401 "Invalid or expired selection."` (expired token / membership no longer
  active / tenant not active / identity not active) → show alert + "back to sign in". `429`.
- **State deviations:** `selecting` lock disables all rows while one is in flight.
- **Responsive:** list of full-width buttons desktop & mobile; "back" ghost button.
- **Deps:** `S-AUTH-LOGIN`. **Gaps:** none. **F17.** *(implemented 016-D.)*

### `S-AUTH-REGISTER` — Create your company
- **Persona:** unauthenticated · **Route:** `/register` · **Scope:** none.
- **Objective:** self-service tenant provisioning + first admin user.
- **Endpoint:** `POST /api/v1/auth/register` · **Request:** `{ companyName, email, password, fullName }`
  · **Response:** `AuthSessionResponseDto` (always a direct session — the new identity has exactly
  one membership).
- **Actions:** submit → session → redirect `/`.
- **Errors:** `409` email already registered; `400` validation.
- **F17** (exists since FASE 16; F17 renders it through the shell primitives, no scope change).

### Auth cross-cutting screens/states (not routes)
- **Unauthorized (401):** the API client does **one** silent `POST /auth/refresh` + one retry
  (browser only); a failed refresh emits `session-expired` → single listener → `/login?returnTo=…`.
- **Forbidden (403):** rendered as a normal error state on the screen — **never** a redirect to
  login, never treated as "logged out". The user is authenticated but lacks the permission.
- **Session expired mid-session:** as Unauthorized.
- **Tenant suspended mid-session (011-A):** every tenant-scoped request starts returning `403`
  (TenantGuard live check) — the shell should surface a clear "this company is suspended" state
  rather than a raw 403 per screen. **Deviation to design:** not in the prototypes → **decision
  needed** ([f17-gaps.md](f17-gaps.md#gap-suspended-tenant-ux)).

---

## MODULE: APP SHELL & HOME  (`(tenant)/`)

### `S-SHELL` — Authenticated app shell
- **Persona:** any (tenant) · **Route:** `(tenant)/layout.tsx` wrapping every tenant route ·
  **Scope:** tenant.
- **Objective:** the frame — sidebar (permission-filtered nav), header (tenant name, account menu),
  content region; route-level `loading` / `error` / `not-found`.
- **Endpoints:** `GET /api/v1/auth/me` (`getSession()`, React-cache-deduped) → `CurrentUserResponseDto`
  `{ id, identityId, tenantId, tenantSlug, email, fullName, status, permissions[] }`;
  `GET /api/v1/tenant` → `TenantResponseDto` `{ id, name, slug, status, isDemo, createdAt }` for the
  header name (falls back to slug on transient failure).
- **Actions:** navigate; account menu → `POST /api/v1/auth/logout`.
- **Nav:** from `lib/navigation.ts` registry, filtered by `createPermissionChecker(session.permissions)`
  server-side — see [f17-navigation.md](f17-navigation.md). Only routes that exist are listed.
- **State deviations:** a non-401 `/auth/me` failure → `error.tsx` (not `/login`); 401 → `/login`.
- **Responsive:** desktop 68px rail (hover/focus expand overlay, no layout shift) · tablet
  permanent rail + pin toggle + scrim · mobile hamburger → drawer (Esc/overlay/route-change close,
  focus trap, safe-area). **No bottom-tab nav.**
- **Deps:** Auth. **Gaps:** header global search + notifications bell = **PROTOTYPE ONLY** (no
  endpoint). **F17.**

### `S-HOME` — Operational Home / Dashboard
- **Persona:** any (tenant); tiles permission-filtered · **Route:** `/` · **Scope:** tenant,
  location-narrowed for location-aware tiles.
- **Objective:** *what needs attention now + jump to it.* Not analytics.
- **Endpoints (per tile — all reads):**
  - Pending price approvals: `GET /api/v1/price-approvals?status=pending` → `meta.total` — **A**
  - Imports needing attention: `GET /api/v1/imports?status=failed` + `?status=completed_with_errors`
    → `meta.total` — **A** (2 calls)
  - Orders today: `GET /api/v1/orders?status=confirmed&createdFrom=<tenant-tz start of day>` →
    `meta.total` — **A** (see date/timezone rule below)
  - Draft products: `GET /api/v1/products?status=draft` → `meta.total` — **A**
  - Returns to process: `GET /api/v1/sales-returns?status=requested` (+ `?status=inspecting`) — **B**
  - Transfers to receive: `GET /api/v1/inventory/transfers?status=dispatched` (+ `partially_received`) — **B**
  - Open transfers: 5 status calls **or** defer — **B**
  - Out-of-stock SKUs: **B** (no aggregate — see [017-A](../reporting/data-gaps.md#gap-inv-aggregate))
- **Actions:** quick-action links (permission-gated): Nueva venta (`sales.orders.create`),
  Ajuste/Recibir (`inventory.adjust`), Nueva transferencia (`inventory.transfers.request`),
  Importar (`import.execute`), Nuevo producto (`products.manage`).
- **State deviations:** each tile has its **own** loading/empty/error (one failing tile must not
  blank the page); a tile the user can't see is omitted, not shown disabled.
- **Not built (F18 / PROTOTYPE ONLY):** revenue/ticket KPI numerals, inventory-movement chart,
  "Exportar", low-stock section (no reorder point).
- **Responsive:** tiles grid → 2-up tablet → 1-up mobile; quick actions as cards.
- **Deps:** most modules' list endpoints. **Gaps:** [`GAP-MULTI-STATUS`](f17-gaps.md#gap-multi-status)
  (B→A for queue tiles), [`GAP-HOME-DATE-TZ`](f17-gaps.md#gap-home-date-tz). **F17** (operational
  tiles only).

---

## MODULE: TENANT ADMINISTRATION  (`(tenant)/`)

### `S-SETTINGS` — Company settings
- **Persona:** TA · **Route:** `/settings` · **Scope:** tenant.
- **Objective:** view company info + edit operational settings.
- **Endpoints:**
  - `GET /api/v1/tenant` (no permission — any member) → `{ id, name, slug, status, isDemo, createdAt }`;
    `PATCH /api/v1/tenant` (`core.tenant.update`) → `UpdateTenantDto` (name only; `slug`/`status`/
    `isDemo` are read-only, never accepted).
  - `GET /api/v1/administration/tenant-settings` (`administration.settings.view`) →
    `{ timezone, businessHours[] }`; `PATCH` (`administration.settings.manage`) — `timezone` (IANA,
    validated against `Intl.supportedValuesOf`), `businessHours` (one governed entry per weekday:
    `{ dayOfWeek 0-6, isClosed, opensAt "HH:mm", closesAt "HH:mm" }`).
- **Fields:** name (editable), slug (read-only), status, isDemo, createdAt; timezone (select),
  business hours (7-row editor).
- **Actions:** save name; save settings.
- **Validation:** name minLength; timezone must be a valid IANA name; hours `opensAt < closesAt`
  when not closed.
- **Errors:** `403` if lacking `core.tenant.update` / `administration.settings.manage` (view still
  allowed) — show read-only.
- **Responsive:** two cards desktop; stacked mobile.
- **Deps:** none. **Gaps:** branding / notification preferences = **not built** (FASE 15 resolved
  notif routing into n8n; branding "later"). **F17.**

### `S-USERS-LIST` — Users
- **Persona:** TA · **Route:** `/users` · **Scope:** tenant · **Permission:** `core.users.read`.
- **Endpoint:** `GET /api/v1/users` — query `{ page, pageSize, status? }` → `PaginatedResult<UserResponseDto>`;
  each `{ id, email, fullName, status, roleNames[], lastLoginAt?, createdAt }`.
- **Columns:** fullName, email, status badge (`invited`/`active`/`disabled`), roleNames, lastLoginAt.
- **Filters:** status (single). **No role filter, no name search, no date filter** →
  [`GAP-USER-FILTERS`](f17-gaps.md#gap-user-filters) (F18/additive).
- **Sort:** none exposed → [`GAP-SORT`](f17-gaps.md#gap-sort).
- **Pagination:** offset (`meta`).
- **Actions:** New user (`core.users.create`); row → `S-USER-DETAIL`.
- **Responsive:** table → cards mobile (name + status + roles line).
- **F17** (exists FASE 16 — F17 = through-the-shell + filter/pagination polish).

### `S-USER-NEW` — Create user
- **Persona:** TA · **Route:** `/users/new` · **Permission:** `core.users.create`.
- **Endpoint:** `POST /api/v1/users` → `CreateUserDto` (email, fullName, password, roleId) → `UserResponseDto`.
  (Also provisions the global `identities` + `tenant_memberships` rows — 016-C — transparent to the UI.)
- **Role selector source:** `GET /api/v1/roles` (`core.roles.read`).
- **Validation:** email format, password minLength 10, role required. Self-escalation rule
  (ADR-0031) is enforced **server-side** — `core.roles.assign` never lets a user grant a role
  above their own; the UI reflects the resulting 403, never re-implements the rule.
- **Errors:** `409` duplicate email in tenant; `403` escalation attempt.
- **F17** (exists FASE 16).

### `S-USER-DETAIL` / `S-USER-EDIT` — User detail & edit
- **Route:** `/users/[id]` · **Permission:** `core.users.read` (view) / `core.users.update` (edit).
- **Endpoints:** `GET /api/v1/users/:id` → `UserResponseDto`; `PATCH /api/v1/users/:id` →
  `UpdateUserDto` (fullName, status, roleIds) — status transitions `invited`/`active`/`disabled`;
  `GET /api/v1/users/:id/locations` + `PUT /api/v1/users/:id/locations` (`core.users.locations.manage`)
  → `{ locationIds[] }` (zero rows = unrestricted, ADR-0024).
- **Fields:** profile + role assignment + **location access editor** (multi-select of the tenant's
  locations; "unrestricted" when empty).
- **Actions:** save profile/roles; save location access; disable/enable user.
- **Validation:** a user cannot change **their own** role or status (ADR-0031) — server-enforced;
  UI disables those controls for self as a courtesy.
- **Errors:** `403` self-escalation / self-status-change.
- **Deps:** `S-LOC-LIST` (for the location picker source: `GET /locations`).
- **F17** (partial in FASE 16 — location editor is new F17 work).

### `S-ROLES-LIST` — Roles & permissions (read-only)
- **Persona:** TA · **Route:** `/roles` (or a tab of `/users`) · **Permission:** `core.roles.read`.
- **Endpoint:** `GET /api/v1/roles` → roles with their `permissionCodes[]`.
- **Columns:** role name, description, isSystemDefault, permission count / list.
- **Actions:** **none** — role/permission CRUD does **not exist** (fixed `DEFAULT_ROLE_TEMPLATES`,
  editable only via direct DB). Display only.
- **Gaps:** [`GAP-ROLE-CRUD`](f17-gaps.md#gap-role-crud) — the design/nav mention "Roles/Permisos"
  as manageable; the backend has no endpoint. F17 = **read-only view**; management is **future**.
- **F17** (read-only).

---

## MODULE: CATALOG  (`(tenant)/`)

### `S-CAT-PRODUCTS` — Products list
- **Persona:** OP/TA · **Route:** `/products` · **Scope:** tenant · **Permission:** `products.view`.
- **Endpoint:** `GET /api/v1/products` — query `{ page, pageSize, status?, categoryId? }` →
  `PaginatedResult<ProductResponseDto>` — `{ id, categoryId?, brandId?, supplierId?, name,
  description?, status, warrantyMonths?, attributes, createdAt, updatedAt }`.
- **Columns:** name, status badge (`draft`/`active`/`discontinued`), category **(name needs a
  join — B)**, warrantyMonths, createdAt.
- **NOT on the list:** stock, price, image, brand/supplier name, variant count → all **B**
  ([`GAP-PRODUCT-LIST-ENRICH`](f17-gaps.md#gap-name-enrichment) / [`GAP-VARIANT-LIST`](f17-gaps.md#gap-variant-list)).
- **Filters:** status, categoryId. **No free-text search** → [`GAP-SEARCH`](f17-gaps.md#gap-search).
- **Sort:** none → [`GAP-SORT`](f17-gaps.md#gap-sort).
- **Actions:** New product (`products.manage`); Import (`import.execute`); row → `S-CAT-PRODUCT-DETAIL`.
- **Responsive:** table → stacked cards mobile; FAB "Nuevo producto".
- **Deps:** `S-CAT-CATEGORIES` (filter source). **F17.**

### `S-CAT-PRODUCT-NEW` — Create product
- **Route:** `/products/new` · **Permission:** `products.manage`.
- **Endpoint:** `POST /api/v1/products` → `CreateProductDto` — `{ name, description?, categoryId?,
  brandId?, supplierId?, warrantyMonths?, attributes?, defaultVariant: VariantFieldsDto }`.
  `VariantFieldsDto` = `{ sku, barcode?, unit?, maxPrice, basePrice, minPrice, cost?, isSerialized?,
  isLotTracked?, attributes? }`. Every product gets exactly one default variant (ADR-0017).
- **Category selector:** `GET /categories`. **Brand/supplier selectors:** **no `GET /brands` /
  `GET /suppliers` endpoint** (ADR-0019) → [`GAP-BRAND-SUPPLIER-LIST`](f17-gaps.md#gap-brand-supplier-list)
  — **decision needed:** add read-only lists, or omit the fields in F17.
- **Attributes:** dynamic, category-driven — `GET /categories/:id/attributes` returns the required
  set; `AttributeValidationService` (ADR-0026) validates server-side; the form re-renders the
  attribute group when the category changes.
- **Pricing:** `minPrice ≤ basePrice ≤ maxPrice` (DB CHECK); `cost` write-only unless
  `pricing.cost.view`. `isSerialized` XOR `isLotTracked`.
- **Validation:** SKU unique per tenant (`409`); price tier; attribute rules → per-field `400`
  from the DTO + a summary alert.
- **Responsive:** two-column (sections + sticky "Publish" aside) desktop; single column + sticky
  bottom save mobile.
- **Deps:** `S-CAT-CATEGORIES`, `S-CAT-ATTR-DEFS`. **F17.**

### `S-CAT-PRODUCT-DETAIL` / `S-CAT-PRODUCT-EDIT` — Product detail & edit
- **Route:** `/products/[id]` · **Permission:** `products.view` / `products.manage`.
- **Endpoints:** `GET /api/v1/products/:id` → `ProductResponseDto`; `PATCH /api/v1/products/:id` →
  `UpdateProductDto`; `GET /api/v1/products/:id/variants` → `VariantResponseDto[]`
  (`{ id, sku, barcode?, unit, basePrice, maxPrice, minPrice? *(gated pricing.floor.view)*, cost?
  *(gated pricing.cost.view)*, status, isSerialized, isLotTracked, attributes }`).
- **Sections:** product fields, variant list, per-variant edit, attributes, price (history is
  **not** exposed → [`GAP-PRICE-HISTORY-READ`](f17-gaps.md#gap-price-history-read)), images
  (`storage_key` only, no list endpoint → **B**), QR (link to `S-QR-LIST` filtered by target).
- **Drill:** variant → `S-INV-BALANCES?productVariantId=` for stock.
- **F17** (product + variant CRUD). Price history, image gallery = **B**.

### `S-CAT-VARIANT-EDIT` — Variant create / edit
- **Route:** modal/drawer on `/products/[id]` · **Permission:** `products.manage`.
- **Endpoints:** `POST /api/v1/products/:id/variants`, `PATCH /api/v1/products/:id/variants/:variantId`
  → `VariantFieldsDto`.
- **F17.**

### `S-CAT-CATEGORIES` — Categories
- **Route:** `/categories` · **Permission:** `categories.view` (list) / `categories.manage` (edit).
- **Endpoints:** `GET /api/v1/categories` — query `{ page, pageSize, status? }` (**no parent
  filter** — build the tree client-side from `parentCategoryId`); `GET /:id`; `POST`; `PATCH /:id`.
- **Columns:** name, slug, parent, status. Tree view (hierarchical, `parentCategoryId` self-FK).
- **Sub-screen `S-CAT-CATEGORY-ATTRS`:** `GET/PUT /api/v1/categories/:id/attributes`
  (`categories.view` / `catalog.attributes.manage`) — which attribute definitions apply and
  whether required.
- **Validation:** slug unique per tenant; a category cannot be its own parent; parent must exist.
- **F17.**

### `S-CAT-ATTR-DEFS` — Attribute definitions
- **Route:** `/attributes` (or nested under categories) · **Permission:** `products.view` (read) /
  `catalog.attributes.manage` (write).
- **Endpoints:** `GET/POST /api/v1/attribute-definitions`, `PATCH /attribute-definitions/:id`,
  `GET/POST /attribute-definitions/:id/options`, `PATCH /attribute-definitions/:id/options/:optionId`;
  `GET /api/v1/measurement-units` (platform data, for `number`/`decimal` types).
- **Fields:** code, name, dataType (`text`/`number`/`decimal`/`boolean`/`date`/`datetime`/`select`/
  `multi_select`), appliesTo (`product`/`variant`), unit, min/max, isRequiredDefault, displayOrder,
  status; options for select types.
- **F17.**

### `S-QR-LIST` / `S-QR-NEW` — QR codes
- **Route:** `/qr` · **Permission:** `catalog.qr.manage` (all management routes).
- **Endpoints:** `GET /api/v1/qr-codes` (query per `list-qr-codes-query.dto.ts`), `GET /:id`,
  `POST` (`{ targetType: 'product_variant'|'location', targetId, expiresAt? }`), `PATCH /:id`
  (status → `active`/`revoked`); `GET /api/v1/qr-codes/resolve/:code` (authenticated, **no
  permission** — identity resolution only).
- **Columns:** code, targetType, target (**name needs a join — B**), status, expiresAt, createdAt.
- **Actions:** generate, revoke, print/download the code image (client-side render — `qr_codes.code`
  is the opaque token; the printable URL is `/q/:code`).
- **Note:** QR resolves identity only, never pricing (public resolver uses `max_price`; the
  authed resolver returns `{productId, productVariantId}` / `{locationId}` and the caller then
  hits the normal variant/location endpoint — no pricing logic duplicated).
- **F17.**

---

## MODULE: INVENTORY  (`(tenant)/`)

### `S-INV-BALANCES` — Existencias (stock on hand)
- **Persona:** OP (Bodega/Supervisor) · **Route:** `/inventory` · **Scope:** tenant + authorized
  locations (ADR-0024) · **Permission:** `inventory.view`.
- **Endpoint:** `GET /api/v1/inventory/balances` — query `{ page, pageSize, productVariantId?,
  locationId? }` → `PaginatedResult<BalanceResponseDto>` — `{ id, productVariantId, locationId,
  quantityPhysical, quantityReserved, quantityCommitted, quantityAvailable (DB GENERATED), version,
  updatedAt }`.
- **Columns (desired):** Producto, SKU, Almacén, Ubicación, Disponible, Reservado, Comprometido,
  En tránsito, Físico. **Reality:** endpoint returns **IDs only** → product/location/warehouse
  names, the "En tránsito" column, warehouse/category filters, quantity totals, and the
  low/zero-stock tabs are all **B** ([`GAP-INV-AGGREGATE`](f17-gaps.md#gap-inv-aggregate),
  [`GAP-NAME-ENRICHMENT`](f17-gaps.md#gap-name-enrichment)).
- **Filters (today):** productVariantId, locationId. **Sort:** none (repo: `updated_at`).
- **Actions:** Ajuste (`inventory.adjust`) → `S-INV-ADJUST`; row → `S-INV-BALANCE-DETAIL` /
  `S-INV-MOVEMENTS?productVariantId=&locationId=` (kardex).
- **Empty state:** "Sin existencias en esta ubicación".
- **Responsive:** dense table desktop; reduced columns + row detail tablet; stacked cards
  (Disponible prominent, disclosure for reserved/in-transit) mobile.
- **F17** (raw list). Enriched/aggregated view = **B**. "Stock bajo" tab = **GAP** (no reorder
  point — [`GAP-REORDER`](f17-gaps.md#gap-reorder)) → not built.

### `S-INV-BALANCE-DETAIL` — Stock detail for a (variant, location)
- **Route:** `/inventory/[balanceId]` or a drawer · **Permission:** `inventory.view`.
- **Endpoint:** `GET /api/v1/inventory/balances/:id`. Shows the four quantities + link to the
  movement history filtered to this variant+location.
- **F17.**

### `S-INV-MOVEMENTS` — Movement history / kardex
- **Route:** `/inventory/movements` (feed) or `/inventory/movements?productVariantId=&locationId=`
  (kardex) · **Permission:** `inventory.view` · **Scope:** location-narrowed.
- **Endpoint:** `GET /api/v1/inventory/movements` — query `{ page, pageSize, productVariantId?,
  locationId?, movementType? }` → `PaginatedResult<MovementResponseDto>` — `{ id, productVariantId,
  locationId, movementType, quantity (signed), balanceAfter, referenceType?, referenceId?, reason?,
  actorType, actorId?, occurredAt, createdAt }`.
- **Columns:** Fecha (`occurredAt`), Tipo (12 types), Cantidad, Saldo después (`balanceAfter`),
  Motivo, Referencia, Actor. Names/actor-names, **date-range filter**, chronological-sort
  guarantee, and reference drill-down are **B** ([`GAP-MOVEMENTS-DATE-FILTER`](f17-gaps.md#gap-movements-date-filter)).
- **Filters:** productVariantId, locationId, movementType. **No date range.**
- **F17** for the kardex-by-variant+location and the filtered feed; period views = **B**.

### `S-INV-ADJUST` — Stock adjustment
- **Route:** drawer/dialog on `/inventory` · **Permission:** `inventory.adjust` + location
  authorization on `locationId`.
- **Endpoint:** `POST /api/v1/inventory/adjustments` → `CreateAdjustmentDto` — `{ productVariantId,
  locationId, movementType: 'RECEIPT'|'ADJUSTMENT_IN'|'ADJUSTMENT_OUT', quantity (>0), reason,
  occurredAt? (backdatable) }` → `MovementResponseDto`.
- **Validation:** quantity positive; reason required; `ADJUSTMENT_OUT` cannot drive available < 0
  (server CHECK / convoy) → `409`/`422`; location must be authorized (`403`).
- **F17.**

### `S-WH-LIST` / `S-WH-EDIT` — Warehouses
- **Route:** `/warehouses` · **Permission:** `warehouses.view` / `warehouses.manage`.
- **Endpoints:** `GET /api/v1/warehouses` (query `{ page, pageSize, status? }`), `GET /:id`,
  `POST` (`{ name, code, address? }` — creating a warehouse auto-creates its "General" location),
  `PATCH /:id`.
- **Columns:** name, code, status, address. **F17.**

### `S-LOC-LIST` / `S-LOC-EDIT` — Locations
- **Route:** `/locations` · **Permission:** `locations.view` / `locations.manage`.
- **Endpoints:** `GET /api/v1/locations` (query `{ page, pageSize, warehouseId?, status? }`),
  `GET /:id`, `POST` (`{ warehouseId, name, code, parentLocationId?, isSellable? }`), `PATCH /:id`.
- **Columns:** name, code, warehouse (**name join — B**), isSellable, parent, status.
- **Deps:** `S-WH-LIST`. **F17.**

### `S-TRF-LIST` — Transfers
- **Persona:** OP · **Route:** `/transfers` · **Scope:** tenant + authorized locations ·
  **Permission:** `inventory.view` (list/detail).
- **Endpoint:** `GET /api/v1/inventory/transfers` — query `{ page, pageSize, status?,
  sourceLocationId?, destinationLocationId? }` → `PaginatedResult<TransferResponseDto>` —
  `{ id, sourceLocationId, destinationLocationId, status, requestedBy, approvedBy?, dispatchedBy?,
  notes?, createdAt, updatedAt, approvedAt?, dispatchedAt?, receivedAt?, cancelledAt?,
  items:[{ id, productVariantId, quantityRequested, quantityDispatched, quantityReceived,
  quantityInTransit }] }`.
- **Columns:** code *(no human code — display a short id or derived label —
  [`GAP-TRANSFER-CODE`](f17-gaps.md#gap-transfer-code))*, route (source→destination **names — B**),
  item count, status badge (7 states), createdAt, updatedAt.
- **Filters:** status (single), source, destination. **Tabs by state** = one `?status=` call each.
- **Sort:** none.
- **Actions (contextual, one per state):** `draft`→Aprobar (`inventory.transfers.approve`) ·
  `approved`→Preparar (`inventory.transfers.dispatch`) · `preparing`→Despachar
  (`inventory.transfers.dispatch`) · `dispatched`/`partially_received`→Recibir → `S-TRF-RECEIVE`
  (`inventory.transfers.receive`) · Cancelar (`inventory.transfers.approve`).
- **F17.**

### `S-TRF-NEW` — Create transfer
- **Route:** `/transfers/new` · **Permission:** `inventory.transfers.request`.
- **Endpoint:** `POST /api/v1/inventory/transfers` → `CreateTransferDto` — `{ sourceLocationId,
  destinationLocationId, items:[{ productVariantId, quantityRequested }], notes? }`.
- **Validation:** source ≠ destination (DB CHECK); both locations authorized for the user; each
  quantity > 0; source has stock (validated at prepare/dispatch, not creation).
- **F17.**

### `S-TRF-DETAIL` — Transfer detail
- **Route:** `/transfers/[id]` · **Permission:** `inventory.view`.
- **Endpoint:** `GET /api/v1/inventory/transfers/:id` → full `TransferResponseDto`.
- **Shows:** item list (requested/dispatched/received/in-transit), lifecycle timeline (from the
  stage timestamps), notes, incidents (`incident_type` on receipt items — **only via the received
  quantities; receipt-item detail is not exposed** → **B**).
- **Actions:** the current transition (as `S-TRF-LIST`).
- **F17.**

### `S-TRF-RECEIVE` — Receive a transfer
- **Route:** `/transfers/[id]/receive` (or drawer) · **Permission:** `inventory.transfers.receive`
  + location authorization on the **destination**.
- **Endpoint:** `POST /api/v1/inventory/transfers/:id/receive` → `ReceiveTransferDto` —
  `{ items:[{ transferItemId, quantityReceived (>0), incidentType? ('shortage'|'damage'|'excess'),
  incidentNotes? }], notes? }`. **Requires an `Idempotency-Key` header** (two legitimate receiving
  events can have identical shape — `database.md#idempotency`).
- **Validation:** `quantityReceived ≤ quantityDispatched − alreadyReceived` per line (server CHECK).
- **F17.**

---

## MODULE: SALES  (`(tenant)/`)

### `S-SALE-NEW` — Nueva venta / Carrito
- **Persona:** OP (Vendedor) · **Route:** `/sales/new` · **Scope:** tenant + the cart's
  `location_id` (location-authorized) · **Permission:** `sales.carts.manage` (cart),
  `sales.orders.create` (checkout).
- **Endpoints:**
  - `GET /api/v1/cart` → `CartResponseDto` `{ id, status, locationId, customerId?, orderId?,
    items:[{ id, productVariantId, sku, productName, quantity, negotiatedUnitPrice?, unitPrice,
    lineSubtotal, maxPrice, basePrice, minPrice? *(gated pricing.floor.view)*, sellable,
    availableAtLocation }], subtotal, createdAt, updatedAt }`.
  - `POST /api/v1/cart` `{ locationId, customerId? }` (creates the vendor's single open cart);
    `PATCH /api/v1/cart` (set customer/location);
  - `POST /api/v1/cart/items` `AddCartItemDto` `{ productVariantId, quantity (>0),
    negotiatedUnitPrice? }`; `PATCH /api/v1/cart/items/:itemId`; `DELETE /api/v1/cart/items/:itemId`.
  - Product/variant search: `GET /api/v1/products` + `GET /api/v1/products/:id/variants` —
    **there is no SKU/variant search endpoint** → [`GAP-VARIANT-LIST`](f17-gaps.md#gap-variant-list)
    (F17-blocking for the "instant SKU search" interaction).
  - Customer: `GET /api/v1/customers?q=` (search), attach via `PATCH /cart`.
  - Checkout: `POST /api/v1/orders` → `CreateOrderDto` `{ cartId, documentType: 'invoice'|'sales_note' }`
    — **`Idempotency-Key` header required** (`scope = 'orders.create'`) → `OrderResponseDto`, order
    `pending`.
- **Fields:** search box, line items (product, qty stepper, unit price / negotiated-price chip,
  line total), customer card, document-type segmented control, summary (Subtotal / Descuento
  informativo / Total). **`availableAtLocation`** on each line is the real-time stock check —
  **A** (already in the cart response).
- **"Requires approval":** **backend-derived only** — a below-`min_price` `negotiatedUnitPrice` is
  accepted into the cart (`SalesPricingService` only rejects above-`max_price` early); at checkout
  the server sets `order_items.is_exceptional_discount` and keeps the order `pending`. The UI
  **never** computes `price < minPrice` and **never** holds a hidden `minPrice` (ADR-0028). It may
  surface the flag from the order response and offer `S-APPROVAL-NEW`.
- **Not shown:** "Guardar como borrador" (cart auto-persists); **impuestos line — PROTOTYPE ONLY**
  (`tax_total` always 0).
- **Validation:** qty > 0; `negotiatedUnitPrice ≥ 0` and `≤ max_price` (early); customer with full
  commercial data (`tax_id`/`email`/`phone`/non-empty `address` + `display_name`) required for
  **both** document types (012-A) → `422` naming missing fields; stock available → `409` on the
  offending line.
- **Errors:** `409` last-unit race / stock conflict (highlight the line); `422` missing customer
  data; `409` below-hard-floor (more than `max_discount_below_min_percent` under the floor —
  rejected outright, no order).
- **Empty cart:** search prominent, summary $0, Confirmar disabled.
- **Responsive:** two-pane (lines + sticky summary aside) desktop; single column + price chip →
  sheet + sticky bottom total tablet/mobile (safe-area).
- **Deps:** `S-CUST-LIST`, catalog, `S-LOC-LIST`, `S-APPROVAL-NEW`. **F17.**

### `S-CUST-LIST` — Customers
- **Route:** `/customers` · **Permission:** `sales.customers.view` (list) / `sales.customers.manage`
  (create/edit).
- **Endpoint:** `GET /api/v1/customers` — query `{ page, pageSize, status?, type?, q? }`
  (`q` = free-text on displayName/taxId/email/phone) → `PaginatedResult<CustomerResponseDto>`.
- **Columns:** type, displayName, taxId, email, phone, status. **No order count / last order /
  LTV** → [`GAP-CUSTOMER-HISTORY`](f17-gaps.md#gap-customer-history).
- **Actions:** New customer; row → `S-CUST-DETAIL`.
- **F17.**

### `S-CUST-NEW` / `S-CUST-EDIT` / `S-CUST-DETAIL` — Customer form & detail
- **Route:** `/customers/new`, `/customers/[id]` · **Permission:** `sales.customers.manage` / `.view`.
- **Endpoints:** `POST /api/v1/customers` (`{ type, displayName, taxId?, email?, phone?, address?,
  notes? }`), `PATCH /api/v1/customers/:id`, `GET /api/v1/customers/:id`.
- **Detail:** the customer record + (F17) a single-customer order list via
  `GET /api/v1/orders?customerId=` (state **B** — client-side, one customer at a time).
- **Validation:** `taxId` unique per tenant (`409`); `type` ∈ `individual`/`business`.
- **F17** (form + detail). LTV / ranking = **F18**.

### `S-SALES-HISTORY` — Historial de ventas
- **Persona:** OP/TA · **Route:** `/sales` · **Scope:** tenant (the endpoint does **not**
  location-scope orders — [`GAP-ORDERS-LOCATION`](f17-gaps.md#gap-orders-location)) ·
  **Permission:** `sales.orders.view`.
- **Endpoint:** `GET /api/v1/orders` — query `{ page, pageSize, status?, customerId?, documentType?,
  createdFrom?, createdTo? }` → `PaginatedResult<OrderResponseDto>` — **each row is the full order
  incl. `items[]`** (no separate list DTO), `{ id, orderNumber, status, documentType, invoiceStatus?,
  locationId, customerId?, customer (frozen snapshot), items[], subtotal, discountTotal,
  taxTotal (0), total, currency, placedByUserId?, createdAt, updatedAt }`.
- **Columns:** orderNumber, createdAt, customer snapshot name, documentType, status badge
  (`draft`/`pending`/`confirmed`/`fulfilled`/`cancelled`), total.
- **Filters:** status, customerId, documentType, **date range** (the only date-filterable list).
  **No text search** (order number / customer) → [`GAP-SEARCH`](f17-gaps.md#gap-search).
- **Sort:** none.
- **NOT built (F18 / PROTOTYPE ONLY):** 4 KPI tiles (ventas del mes, ticket promedio — **B**;
  órdenes, pendientes — **A** counts), "Exportar".
- **Notification-status column + "retry"** on the row/detail = **GAP**
  ([`GAP-NOTIF-STATUS`](f17-gaps.md#gap-notif-status)) — roadmap FASE 17 item, needs a new
  `event_outbox` read + a guarded requeue. Decision needed on the exact contract before build.
- **Responsive:** table → row cards → stacked cards.
- **F17** (list + filters + detail). KPI tiles / export = **F18**.

### `S-ORDER-DETAIL` — Order detail
- **Route:** `/sales/[id]` · **Permission:** `sales.orders.view`.
- **Endpoint:** `GET /api/v1/orders/:id` → `OrderResponseDto` (lines carry `minPrice` only with
  `pricing.floor.view`; `unit_cost_snapshot` is **not** in the DTO → [`GAP-ORDER-MARGIN`](f17-gaps.md#gap-order-margin)).
- **Actions:** `POST /api/v1/orders/:id/confirm` (`sales.orders.create`) — `pending → confirmed`,
  **gated** on every exceptional line having an `approved` `price_approvals` row (else `409`);
  `POST /api/v1/orders/:id/cancel` (`sales.orders.cancel`) — releases a still-`pending`
  reservation, `pending → cancelled` (a `confirmed` order can **only** be reversed by a return).
- **Domain states:** `draft`(unreachable) · `pending` · `confirmed` · `fulfilled`(unreachable) ·
  `cancelled`. Transitions: `pending→confirmed`, `pending→cancelled`.
- **F17.**

### `S-APPROVALS-LIST` / `S-APPROVAL-DETAIL` — Price-approval queue
- **Persona:** Supervisor/TA (to resolve) · **Route:** `/approvals` (+ `/approvals/[id]`) ·
  **Scope:** tenant · **Permission:** GET (list + detail) requires
  `pricing.discount.request` **or** `pricing.discount.approve`
  (`@RequireAnyPermission`, F17-09 — [`GAP-APPROVALS-PERMISSION`](f17-gaps.md#gap-approvals-permission)
  resolved); resolve requires `pricing.discount.approve`.
- **Endpoint:** `GET /api/v1/price-approvals` — query `{ page, pageSize, status?, orderId? }` →
  `PaginatedResult<PriceApprovalResponseDto>` (`{ orderNumber, variant/sku/name, requestedPrice,
  maxPriceAtRequest, minPriceAtRequest *(gated pricing.floor.view)*, discountAmount, reason,
  requestedBy, status, requestedAt, resolvedAt, approvedBy }`); `GET /:id`.
- **Columns:** order, product, requestedPrice, discountAmount, requestedBy, requestedAt, status
  badge (`pending`/`approved`/`rejected`/`cancelled`).
- **Filters:** status, orderId. **No date filter.**
- **Actions:** `POST /api/v1/price-approvals/:id/approve` / `/reject` (`pricing.discount.approve`) —
  conditional `WHERE status = 'pending'`; **the requester can never resolve their own request**
  (`403`, server-enforced — UI hides the action for own requests as courtesy).
- **Drill:** → `S-ORDER-DETAIL`.
- **Design note:** the `ReturnsDesktop` master-detail layout is reused for approvals.
- **F17.**

### `S-APPROVAL-NEW` — Request a price approval
- **Route:** action from `S-SALE-NEW` / `S-ORDER-DETAIL` · **Permission:** `pricing.discount.request`.
- **Endpoint:** `POST /api/v1/price-approvals` → `CreatePriceApprovalDto` `{ orderItemId, reason,
  requestedPrice? (cross-check only, must equal the frozen line price if given — `422` on mismatch) }`.
  Requires the parent order `pending` + the line `is_exceptional_discount`.
- **F17.**

---

## MODULE: RETURNS  (`(tenant)/`)

### `S-RET-LIST` — Devoluciones
- **Persona:** OP (Vendedor/Bodega)/TA · **Route:** `/returns` · **Permission:** `sales.returns.view`.
- **Endpoint:** `GET /api/v1/sales-returns` — query `{ page, pageSize, status?, orderId? }` →
  `PaginatedResult<ReturnResponseDto>` (`{ id, orderId, orderNumber, locationId, status, reason,
  requestedBy, receivedBy?, createdAt, updatedAt, items:[...] }`).
- **Columns:** id, order, customer *(from the order snapshot)*, line count, status badge
  (`requested`/`inspecting`/`resolved`/`cancelled`), createdAt.
- **Filters:** status, orderId. **No date filter.** **Sort:** none.
- **Actions:** New return; row → `S-RET-DETAIL`.
- **F17.**

### `S-RET-NEW` — Create a return
- **Route:** `/returns/new` (or from `S-ORDER-DETAIL`) · **Permission:** `sales.returns.create` ·
  **`Idempotency-Key`** (`scope = 'sales_return.create'`).
- **Endpoint:** `POST /api/v1/sales-returns` → `CreateReturnDto` `{ orderId, locationId, reason,
  items:[{ orderItemId, quantity (>0) }] }`.
- **Validation:** order must be `confirmed`; per line `quantity ≤ returnable`
  (`= sold − Σ already-returned`, checked under a row lock — `409` if two concurrent requests
  over-return).
- **F17.**

### `S-RET-DETAIL` — Return detail + inspect + resolve
- **Route:** `/returns/[id]` · **Permission:** `sales.returns.view` (view) /
  `inventory.returns.manage` (inspect/resolve) + location authorization on each
  `dispositionLocationId`.
- **Endpoint:** `GET /api/v1/sales-returns/:id`. Lines: `{ orderItemId, variant, sku,
  quantityReturned, disposition?, dispositionLocationId?, inspectedBy?, inspectedAt?, notes? }`.
- **Actions:**
  - `POST /api/v1/sales-returns/:id/inspect` → `InspectReturnDto` `{ items:[{ returnItemId,
    disposition: 'restock'|'quarantine'|'damaged'|'scrap', dispositionLocationId, notes? }] }` —
    `restock` → an `is_sellable = true` location; the others → non-sellable (ADR-0021,
    server-enforced) → `requested → inspecting`.
  - `POST /api/v1/sales-returns/:id/resolve` (**`Idempotency-Key`**, `scope =
    'sales_return.disposition'`) — requires every line inspected; writes one `RETURN` movement per
    line at its disposition location → `inspecting → resolved`.
  - `POST /api/v1/sales-returns/:id/cancel` (`sales.returns.create`) — `requested`/`inspecting` →
    `cancelled` (a `resolved` return cannot be cancelled).
- **Domain states / transitions:** `requested → inspecting → resolved`; `requested`/`inspecting`
  → `cancelled`.
- **F17.**

---

## MODULE: IMPORT  (`(tenant)/`)

### `S-IMP-NEW` — Import wizard
- **Persona:** TA/OP · **Route:** `/imports/new` · **Permission:** `import.execute`
  (+ `import.inventory` for `update_catalog_and_inventory` mode).
- **Steps (state machine on `import_jobs.status`):** Archivo → Validación → Revisión → Importación
  → Resultado.
- **Endpoints (staged):** `GET /api/v1/imports/template` (dynamic `.xlsx`); `POST /api/v1/imports`
  (multipart upload; `{ defaultLocationId?, mappingTemplateId?, duplicateHandlingMode }`);
  `POST /:id/mapping`; `POST /:id/validate`; `GET /:id/preview`; `GET /:id/rows`; `POST /:id/confirm`;
  `POST /:id/cancel`; `GET /:id/errors` (sanitized report download).
- **Job fields:** `originalFilename`, `status` (9 states), `totalRows`, `validRows`, `invalidRows`,
  `warningRows`, `importedRows`, `duplicateHandlingMode` (4 modes), `startedAt`, `completedAt`.
- **Row fields:** `rowNumber`, `status` (`pending`/`valid`/`warning`/`invalid`/`imported`/`skipped`),
  `matchAction` (`create`/`update`/`skip`), `errors[]`, `warnings[]`.
- **Actions:** "Importar N filas válidas" (partial import supported — invalid rows left behind),
  "Descargar plantilla", "Cambiar archivo", "Descargar reporte de errores".
- **Async note:** small files run synchronously; large files are claimed by the Import Worker —
  the UI polls `GET /:id` for status. **Decision needed:** polling interval / long-poll —
  [`GAP-IMPORT-PROGRESS`](f17-gaps.md#gap-import-progress).
- **F17.**

### `S-IMP-LIST` / `S-IMP-DETAIL` / `S-IMP-ROWS` — Import history
- **Route:** `/imports`, `/imports/[id]` · **Permission:** `import.execute`.
- **Endpoints:** `GET /api/v1/imports` (query `{ page, pageSize, status? }`), `GET /:id`,
  `GET /:id/rows`, `GET /:id/errors`.
- **Columns:** filename, status badge, row counts, mode, createdAt, completedAt. **Calculated:**
  error rate = `invalidRows / totalRows`.
- **F17.**

### `S-IMP-TEMPLATES` — Mapping templates
- **Route:** `/imports/templates` · **Permission:** `import.execute`.
- **Endpoints:** full CRUD `GET/POST/PATCH/DELETE /api/v1/import-mapping-templates[/:id]`
  (`{ name, categoryId?, columnMapping }`).
- **F17.**

---

## MODULE: SUPER-ADMIN  (`(superadmin)/` — new route group)

See [f17-super-admin.md](f17-super-admin.md) for the full analysis. Summary of screens:

### `S-SA-LOGIN` — Platform admin sign in
- **Persona:** PA · **Route:** `(public)` `/platform/login` (or a dedicated host) · **Scope:** platform.
- **Endpoint:** `POST /api/v1/platform/auth/login` (`@Public`) → distinct session cookies
  (`platform_access_token` / `platform_refresh_token` / `platform_csrf_token`).
- **`GET /api/v1/platform/auth/me`** (`@PlatformOnly`) for the platform session.
- **No self-registration** — the first platform admin is provisioned out-of-band
  (`pnpm --filter @saas-inventory/database seed:platform-admin`).
- **F17.**

### `S-SA-TENANTS` — Companies
- **Persona:** PA · **Route:** `(superadmin)/tenants` · **Scope:** platform (`tenants` table only).
- **Endpoint:** `GET /api/v1/platform/tenants` (`@PlatformOnly`) → `PlatformTenantResponseDto[]`
  **(whole array, NOT paginated)** — `{ id, name, slug, status, isDemo, createdAt }`.
- **Columns:** name, slug, status badge (`active`/`suspended`/`archived`), isDemo, createdAt.
- **Filters/sort/grouping:** **all client-side** over the array (no server params).
- **Actions:** row → `S-SA-TENANT-DETAIL`.
- **Gaps:** no user counts / activity / any tenant-scoped data (isolation — **C**); no create-tenant
  (platform-initiated) → [`GAP-SA-CREATE-TENANT`](f17-gaps.md#gap-sa-create-tenant).
- **F17** (for exactly these 6 fields + suspend/activate).

### `S-SA-TENANT-DETAIL` — Company detail
- **Persona:** PA · **Route:** `(superadmin)/tenants/[id]` · **Scope:** platform.
- **Endpoint:** `GET /api/v1/platform/tenants/:tenantId` → `PlatformTenantResponseDto`.
- **Actions:** `POST /api/v1/platform/tenants/:tenantId/suspend` / `/activate` (`@PlatformOnly`,
  audited) — the only tenant-lifecycle actions that exist. `archived` status exists in the DB
  CHECK but **no action sets it** → not offered.
- **Gaps:** cannot list/manage the tenant's admins/users/memberships (no endpoint —
  [`GAP-SA-TENANT-ADMINS`](f17-gaps.md#gap-sa-tenant-admins)); cannot see login activity,
  storage, plan, billing (none exist).
- **F17** (view + suspend/activate).

### Not built in F17 Super-Admin (GAP / future)
- Platform dashboard with real per-tenant metrics — [`GAP-PLATFORM-AGGREGATE`](../reporting/data-gaps.md#gap-platform-aggregate).
- Platform-admin management (list/create/disable other platform admins) —
  [`GAP-SA-ADMIN-CRUD`](f17-gaps.md#gap-sa-admin-crud) — only the seed script exists.
- Create/provision a tenant from the platform side — [`GAP-SA-CREATE-TENANT`](f17-gaps.md#gap-sa-create-tenant).

---

## Screens the design implies but that are **not** F17 (no route / no contract)

| Implied screen | Why not F17 |
| --- | --- |
| Executive / analytical dashboard | F18 — see [f17-f18-boundary.md](f17-f18-boundary.md) |
| Brands CRUD, Suppliers CRUD | No endpoint (ADR-0019). `S-CAT-PRODUCT-NEW` selectors are a **GAP decision**. |
| Serial / lot browser | No read endpoint; no serial/lot column on movements (deferred design) |
| Price-history timeline | No read endpoint — **B** |
| Audit trail viewer | No read endpoint — **future** |
| Notification centre / bell | No per-user notifications endpoint |
| Global search results | No cross-entity search endpoint |
| In-session tenant switcher | Not a defined feature (016-C: switch = re-login) — **not built** |
