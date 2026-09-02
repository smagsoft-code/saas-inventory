# F17 — Recommended Implementation Order

> Dependency-justified sequence for FASE 17, with a sub-prompt breakdown. Ordered by the real
> dependency graph ([f17-dependencies.md](f17-dependencies.md)), **not** by screen number. Each
> sub-prompt is independently testable (unit + integration + pg-verify regression, per the roadmap
> testing rule) and ends with its own review/commit.

## Guiding constraints

- **Foundation first:** everything renders inside `S-SHELL`; every date computation needs
  `tenant_settings.timezone`; every stock concept needs warehouses + locations.
- **Read before write:** a create form needs its selector sources (categories before products,
  locations before transfers, customers before sales).
- **Sales is the deepest chain:** customer + variant + price + location + approval + order +
  notification — build its prerequisites before New Sale.
- **Resolve F17-blocking gaps before the screen that needs them** (see the "backend prerequisite"
  column). Non-blocking gaps ship degraded and are revisited.
- **Super-Admin is independent** — can be built any time after the shell; placed last only because
  its value is lowest and its gaps are largest.

## Order

| # | Sub-prompt | Screens | Depends on | Backend prerequisite (from [f17-gaps.md](f17-gaps.md)) |
| --- | --- | --- | --- | --- |
| **F17-01** | **App Shell + Auth polish + Home skeleton** | `S-SHELL`, `S-AUTH-*` (polish), `S-HOME` (frame + quick actions; tiles stubbed) | FASE 16 | — |
| **F17-02** | **Tenant administration** | `S-SETTINGS` (incl. timezone — unblocks all date logic), `S-USERS-LIST/NEW/DETAIL/EDIT`, `S-ROLES-LIST` (read-only), location-access editor | F17-01, `S-LOC-LIST` for the location editor (so do F17-02 users *after* F17-04 locations, or ship the editor in F17-04) | — (`GAP-USER-FILTERS` non-blocking; `GAP-ROLE-CRUD` → read-only) |
| **F17-03** | **Catalog base** | `S-CAT-CATEGORIES` (+ tree + category-attributes), `S-CAT-ATTR-DEFS` (+ options), `measurement-units` | F17-01 | — |
| **F17-04** | **Warehouses & Locations** | `S-WH-LIST/EDIT`, `S-LOC-LIST/EDIT` | F17-01 | `GAP-NAME-ENRICHMENT` (warehouse name on locations — non-blocking) |
| **F17-05** | **Products & variants & QR** | `S-CAT-PRODUCTS`, `S-CAT-PRODUCT-NEW/EDIT/DETAIL`, `S-CAT-VARIANT-EDIT`, `S-QR-LIST/NEW` | F17-03 (categories/attributes) | **decide `GAP-BRAND-SUPPLIER-LIST` (A4)**; `GAP-SEARCH`/`GAP-SORT` (non-blocking); `GAP-VARIANT-LIST` (needed for F17-08, decide here) |
| **F17-06** | **Inventory: balances + movements + adjustments** | `S-INV-BALANCES`, `S-INV-BALANCE-DETAIL`, `S-INV-MOVEMENTS`, `S-INV-ADJUST` | F17-04, F17-05 | **`GAP-NAME-ENRICHMENT`** (strongly recommended before this), `GAP-INV-LOCATION-SCOPE` (A3 decision), `GAP-MOVEMENTS-DATE-FILTER` (kardex — additive) |
| **F17-07** | **Inventory transfers** | `S-TRF-LIST/NEW/DETAIL/RECEIVE` | F17-04, F17-05, F17-06 | `GAP-NAME-ENRICHMENT`, `GAP-MULTI-STATUS` (tabs), `GAP-TRANSFER-CODE` (A21 cosmetic) |
| **F17-08** | **Customers + New Sale + cart** | `S-CUST-LIST/NEW/EDIT/DETAIL`, `S-SALE-NEW` | F17-05 (variants+prices), F17-04 (location) | **`GAP-VARIANT-LIST`** (SKU search — F17-blocking; interim: product→variant picker) |
| **F17-09** | **Orders + approvals + returns** | `S-SALES-HISTORY`, `S-ORDER-DETAIL`, `S-APPROVALS-LIST/DETAIL`, `S-APPROVAL-NEW`, `S-RET-LIST/NEW/DETAIL` | F17-08 | **`GAP-APPROVALS-PERMISSION`** (fix before Approvals ships), `GAP-ORDERS-LOCATION` (A2), `GAP-DATE-SEMANTICS` (A8), `GAP-SEARCH` (non-blocking) |
| **F17-10** | **Notification status on orders** | badge + retry on `S-ORDER-DETAIL` / `S-SALES-HISTORY` | F17-09 | **`GAP-NOTIF-STATUS`** (new read + guarded requeue — design first) |
| **F17-11** | **Import pipeline** | `S-IMP-NEW`, `S-IMP-LIST/DETAIL/ROWS`, `S-IMP-TEMPLATES` | F17-03, F17-04, F17-05 | `GAP-IMPORT-PROGRESS` (A9 polling decision) |
| **F17-12** | **Home tiles wired + operational KPIs** | fill `S-HOME` tiles with real reads | F17-06…F17-11 | `GAP-MULTI-STATUS`, `GAP-HOME-DATE-TZ` (both before this) |
| **F17-13** | **Super-Admin** | `(superadmin)/` group, `S-SA-LOGIN`, `S-SA-TENANTS`, `S-SA-TENANT-DETAIL` | F17-01 | none for the supported set; the rest is `GAP-SA-*` (future) |

## Deviations from the prompt's example order (justified)

- **Settings moved up (into F17-02):** `tenant_settings.timezone` is a hard dependency for every
  date computation (Home "today", Sales history filter). It must exist before F17-09/F17-12.
- **Warehouses/Locations (F17-04) before Products (F17-05):** the prompt's example has "catálogo
  base → productos → inventario"; but the Product form has no location dependency, while Inventory
  and the location-access editor (F17-02) both need locations. Locations are cheap and unblock more.
  Either order works for categories vs locations; the sequence above keeps F17-02's editor honest.
- **Notification status as its own sub-prompt (F17-10):** it is a roadmap FASE 17 item but depends
  on a **new backend read + a guarded requeue** (`GAP-NOTIF-STATUS`) — isolating it prevents it
  from blocking F17-09.
- **Home tiles wired last (F17-12):** the tiles read from modules F17-06…F17-11; wiring them
  earlier means stubbing, then rework.
- **Super-Admin last (F17-13):** independent of the tenant chain; lowest value, largest gap
  surface — no reason to interleave it.

## Per-sub-prompt definition of done (roadmap testing rule)

Each F17-NN: implemented within its catalogue rows only · unit tests · integration tests (real
Postgres) · tenant-isolation + RBAC + location-auth tests where the screen touches those ·
`pg-verify` regression green · lint · typecheck · `apps/web` build (the known Windows EPERM at
*Collecting build traces* is environmental, not a failure) · security review · docs updated · diff
reviewed · explicit review/commit.

## What does NOT start in F17

FASE 18 (dashboards/reporting/analytics), and every `future` gap (reorder point, costing, role
CRUD, audit read, platform aggregate, platform-admin CRUD, platform-initiated tenant creation).
See [f17-f18-boundary.md](f17-f18-boundary.md).
