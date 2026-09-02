# F17 — Global Functional Contract

Cross-cutting rules every F17 screen obeys. Defined once here; the
[screen catalogue](f17-screen-catalog.md) lists only per-screen deviations. Built on the FASE 16
foundation (`apps/web/src/lib/*`) — nothing here is new infrastructure, it is the contract for
using what exists.

## 1. Standard screen-state model

Every data-driven screen renders these states explicitly (CLAUDE.md §7.6):

| State | Trigger | Rendering |
| --- | --- | --- |
| **initial-loading** | first render, data in flight | route-level `loading.tsx` skeleton (never a blank screen) |
| **skeleton** | list/detail re-fetch | inline skeleton matching the final layout |
| **loaded** | data present | the screen |
| **empty** | request OK, zero rows | `<EmptyState>` + a permission-gated primary CTA where one applies ("Nuevo…"); distinct copy for *no data* vs *no results for these filters* |
| **error** | non-401/403 failure | `<ErrorState>` with `correlationId` + retry; **never** a stack trace or raw 5xx body |
| **forbidden (403)** | authenticated, lacks permission | `<ErrorState>` "no tienes permiso" — **stays on the screen**, never redirects to login, never treated as logged-out |
| **unauthorized (401)** | no/expired session | API client does **one** silent `POST /auth/refresh` + one retry (browser only); failure → `session-expired` event → single listener → `/login?returnTo=<safe>` |
| **session-expired** | as 401 mid-session | same |
| **validation-error (400/422)** | bad input on a mutation | per-field messages from the DTO + a summary `<Alert>`; values kept; scroll-to-first-error on mobile |
| **mutation-pending** | submit in flight | button `loading` + `aria-busy`, form disabled, **no double submit** |
| **mutation-success** | 2xx | redirect / toast / in-place update per screen; `router.refresh()` when a Server Component must re-read |
| **mutation-failure** | 409/422/5xx | `<Alert>` above the form; state preserved; the offending row/field highlighted where the error identifies one |

**Message rule:** where the backend sends a user-safe `message` (4xx), show it. Never invent a
business message for a case the backend already names. Never surface a 5xx `message`.

## 2. Error envelope

Every non-2xx response is `{ statusCode, code, message, correlationId }`
(`http-exception.filter.ts` / `packages/types` `ApiErrorShape`), normalised by the FASE 16 client
into `ApiError { status, code, message, correlationId, details? }`. Branch on `status`/`code`,
never on `message` text.

| Status | Meaning in F17 | Handling |
| --- | --- | --- |
| 400 | DTO validation / whitelist | field + summary; `code` may be `VALIDATION_ERROR` |
| 401 | no/expired session | refresh-retry then `/login` (client-owned) |
| 403 | authenticated, not allowed (permission, self-escalation, location auth, suspended tenant, `@PlatformOnly` mismatch) | forbidden state on the screen |
| 404 | not found / not visible | generic not-found — **never reveals whether a protected resource exists** |
| 409 | conflict (duplicate, stock race, invalid transition, unapproved exceptional line) | alert; highlight the cause; offer a sensible retry |
| 422 | business rule (missing customer data, hard-floor breach, requestedPrice mismatch) | alert naming the rule from the `message` |
| 429 | rate limited (auth routes) | "espera un momento" |
| 5xx | server error | generic "algo salió mal", show `correlationId`, offer retry |
| 0 | network / DNS / TLS / abort | "no se pudo conectar" |

## 3. Lists — pagination, filtering, sorting, search

- **Pagination:** offset only — `?page=1&pageSize=20` (max 100). Response
  `PaginatedResult<T> = { data: T[], meta: { page, pageSize, total, totalPages } }`. Render
  "Mostrando X–Y de N" + a numbered pager. `meta.total` is also the count used for Home tiles.
- **Filtering:** only the explicit, documented query params of that endpoint (see the screen
  catalogue). **No generic filter passthrough.** A filter the prototype shows but the DTO lacks is
  a **GAP**, not a client-side filter over a page.
- **Single-value status filter everywhere** — multi-status queue counts fan out into N calls
  ([`GAP-MULTI-STATUS`](f17-gaps.md#gap-multi-status)).
- **Sorting:** **no endpoint exposes `sort`.** Sortable-header UI is a **GAP**
  ([`GAP-SORT`](f17-gaps.md#gap-sort)) — F17 tables render in the backend's fixed order and do not
  offer sort until the param exists.
- **Search:** only `GET /customers` has `?q=` (displayName/taxId/email/phone). Products / orders
  search is a **GAP** ([`GAP-SEARCH`](f17-gaps.md#gap-search)).
- **Client-side filtering is never a security control** — the server returns only rows the caller
  may see (RLS + tenant filter + location auth). Hiding rows in the UI is UX only.

## 4. Forms, validation & mutations

- **DTOs are the contract.** Send exactly the documented request DTO; the global
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` rejects unknown props with
  `400`. Never send a field "just in case".
- **Client validation is a hint**, never a re-implementation of a business rule. Examples that
  stay **server-only**: role self-escalation (ADR-0031), price floor / exceptional-discount
  classification (ADR-0028/0022), returnable quantity, location authorization, customer
  commercial-data completeness (012-A), stock availability.
- **Idempotency:** mutations that can duplicate an effect send an `Idempotency-Key` header
  (a fresh UUID per user-initiated attempt, **reused verbatim on retry of the same attempt**):
  `POST /orders` (`orders.create`), `POST /inventory/transfers/:id/receive`,
  `POST /sales-returns` (`sales_return.create`), `POST /sales-returns/:id/resolve`
  (`sales_return.disposition`). One-time transitions (transfer dispatch, order confirm/cancel,
  approval approve/reject) use server-side deterministic keys / CAS — the client just POSTs once.
- **CSRF:** every state-changing request carries the double-submit `X-CSRF-Token` header from the
  non-httpOnly `csrf_token` cookie (FASE 16 client does this automatically).
- **Optimistic UI:** allowed for cheap reversible toggles; **not** for stock, orders, transfers,
  approvals, returns — those show `mutation-pending` and re-fetch on success.

## 5. Field-level authorization (ADR-0028)

Gated fields are **absent** from the response when the caller lacks the permission — they are
**never** returned-then-hidden. The UI must treat "absent" as "not authorised", not "null":

| Field(s) | Gate |
| --- | --- |
| `product_variants.min_price`, `order_items.min_price_snapshot`, `cart_items.minPrice`, `price_approvals.min_price_at_request` | `pricing.floor.view` |
| `product_variants.cost`, variant `cost` write-back | `pricing.cost.view` |

A screen must render correctly with these fields missing (e.g. Vendedor sees floor but not cost;
an OP without `pricing.floor.view` sees neither).

## 6. Money, quantities, dates, timezone

- **Money:** single currency `'USD'` (no per-tenant currency). `tax_total` always `0` — **no tax
  line** anywhere. `discount_total` is informational (never re-subtracted). Display 2dp; compute
  with decimal-safe arithmetic, never float. Totals shown to the user are the server's — the
  client may recompute for immediate feedback only (New Sale).
- **Quantities:** may be fractional (numeric columns). Steppers respect the variant `unit`.
- **Dates:** all API timestamps are UTC ISO-8601. The **only** date-filterable list is
  `GET /orders` (`createdFrom`/`createdTo`). Boundary semantics are **not documented** — F17-00
  recommends half-open `[from, to)` and this must be confirmed before build
  ([`GAP-DATE-SEMANTICS`](f17-gaps.md#gap-date-semantics)).
- **Timezone:** the tenant's timezone is `tenant_settings.timezone` (IANA, default `UTC`), read
  from `GET /administration/tenant-settings`. "Hoy" / "esta semana" / "este mes" on Home and any
  date picker are computed in that timezone, then converted to a UTC range for the query. **No
  endpoint does this** — the client (F17) or the F18 read-side must
  ([`GAP-HOME-DATE-TZ`](f17-gaps.md#gap-home-date-tz)).
- **"Revenue in a period"** means *orders created in the period that are now `confirmed`* — there
  is no `confirmed_at` ([017-A `GAP-ORDER-CONFIRMED-AT`](../reporting/data-gaps.md#gap-order-confirmed-at)).
  F17 does not show revenue KPIs anyway (F18).

## 7. Reusable functional components (identify only — not implemented here)

Extends `apps/web/src/components/ui/` (FASE 16: Button/ButtonLink, Input/Select/Textarea, Field,
Card, Alert, Badge, Spinner, Skeleton, EmptyState, ErrorState, PageHeader, PageContainer).

| Component | Purpose | Screens |
| --- | --- | --- |
| `DataTable` | column defs, row actions, `meta` pager, loading/empty/error slots, responsive table→cards | every list screen |
| `TableToolbar` + `FilterChip` | the explicit filters of one endpoint as chips + "Limpiar" | Products, Inventory, Transfers, Sales, Returns, Approvals, Imports, Users |
| `SearchInput` | debounced `?q=` (only where a contract exists = Customers; elsewhere disabled) | Customers |
| `Pagination` | "Mostrando X–Y de N" + numbered pager | every list |
| `StatusBadge` | the semantic tone map (`success`/`warning`/`danger`/`info`/neutral) for every domain enum | everywhere |
| `Drawer` / `Dialog` | adjust stock, quick create, confirm/destructive; bottom-sheet on mobile; focus trap, Esc/overlay close | Inventory, Transfers, Returns, Sales |
| `EntityForm` | Field wiring + DTO-error mapping + summary Alert + submit lifecycle | every create/edit |
| `EntitySelect` / `Combobox` | pick an existing entity by id (category, location, customer, role, variant) — needs a list endpoint; **Combobox with search only where the endpoint has `?q=`** | Product form, New Sale, Transfer form, Return form, User form |
| `QuantityStepper` | `−` / value / `+`, unit-aware | New Sale, Transfer form, Adjust, Return form |
| `PriceDisplay` | tabular-nums, currency, gated-field-aware (renders "—" when a gated price is absent) | Products, New Sale, Orders, Approvals |
| `ApprovalAction` | approve / reject with the self-approval guard reflected | Approvals |
| `DispositionSelect` | `restock`/`quarantine`/`damaged`/`scrap` + a location picker filtered by `is_sellable` per rule | Return detail |
| `FileUpload` | multipart for the import upload + product images (client size/type checks; server is authority) | Import, Product form |
| `WizardRail` | done ✓ / current / pending steps | Import |
| `LifecycleTimeline` | render stage timestamps as a vertical timeline | Transfer detail, Return detail, Order detail |
| `PermissionGate` | render children only if `can(code)` — **UX only**, the backend authorises | everywhere |
| `SessionExpiryListener` / `SessionProvider` | FASE 16 — reused as-is | shell |

No component library is added. Tailwind + semantic HTML + inline SVG, per FASE 16 / 017-DESIGN.
