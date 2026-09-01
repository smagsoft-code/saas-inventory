# Frontend Screen Specs — SaaS Inventory (PROMPT 017-DESIGN)

> **017-DESIGN CLOSED — visual reference, not a functional spec.** Each screen below is *one
> possible visual organisation*, not the definitive list of its fields / columns / filters / actions
> / states. The exact functionality of every screen is defined later, in the FASE 17 functional
> phase, audited against the real backend, endpoints, DTOs, permissions and business rules. Where an
> `audited` contract note appears it reflects the DTO **at the time of the 017-DESIGN audit** and is
> still re-checked before implementation. Anything that looks functional but has no backing contract
> is marked **PROTOTYPE ONLY** / **FASE 18** / **pending functional validation** — see
> [frontend-visual-system.md §12](frontend-visual-system.md#12-functional-specification-boundary).
> Prototype sources: [`design/canvas/`](canvas/). System: [frontend-visual-system.md](frontend-visual-system.md).
> Responsive rules: [responsive-guidelines.md](responsive-guidelines.md).

Each screen: **Purpose · Primary info · Primary action · Secondary actions · Layout (desktop /
tablet / mobile) · Components · Interaction notes · Empty / loading / error.**

All data-driven views render the three states (FASE 16 primitives: `loading.tsx` skeleton,
`error.tsx` `<ErrorState>` with `correlationId` + retry, `<EmptyState>` with an optional
permission-gated CTA).

---

## 1. Login  ·  `LoginDesktop`, `LoginMobile`

- **Contract (audited — `POST /api/v1/auth/login` + 016-C `login-form.tsx`)** — body
  `{ email, password }` **only**; no `tenantSlug` (login belongs to the global identity, ADR-0033 —
  a stray field is a 400). One active membership → `status: 'authenticated'` + session cookies.
  Several → `status: 'tenant_selection_required'` + `availableTenants: [{ tenantId, name }]` and the
  httpOnly `tenant_selection` cookie, **no session yet**; caller finishes with `POST /auth/select-tenant`
  `{ tenantId }`. No remember-me param; no password-reset route; `POST /auth/register` + `/register`
  page exist; failure is deliberately generic (never says which credential, never the company count).
- **Purpose** — authenticate a person, then (only if needed) choose which company to open.
- **Primary info** — **State 1:** email, password. **State 2 (only after valid credentials + more
  than one company):** a list of company names to pick from.
- **Primary action** — *Entrar* (state 1) / picking a company (state 2).
- **Secondary** — *Crear organización* (→ `/register`); *Volver a iniciar sesión* from state 2.
  **Removed from V1:** "Recordarme" and "restablecer contraseña" — no backend contract.
- **No pre-authenticated tenant, no enumeration** — the frontend never asks for a company before
  credentials, and never lists a person's companies by email alone; `availableTenants` is only ever
  the post-authentication list the backend returns. The `selectionToken` is never shown, never in
  the URL, never stored (localStorage/sessionStorage/IndexedDB) — the browser carries the httpOnly
  cookie.
- **Layout** — Desktop: split — left brand panel (`primary` fill), right centered form (max 360),
  field order Email → Contraseña. Tablet: same split. Mobile: single column, logo → title → fields
  → full-width button. State 2 replaces the fields with a vertical list of full-width company
  buttons + a "back to sign in" ghost button.
- **Components** — Input (44 px) ×2, Button `primary` full-width, Alert; state 2: bordered list
  buttons (name + chevron, spinner while selecting), Button `ghost`.
- **Interaction** — one silent `POST /auth/refresh` attempt before showing the form on an
  expired-access/valid-refresh hard nav (FASE 16 already does this). Login button disables while
  submitting (no double submit); in state 2 all company buttons disable while one selection is in
  flight. Error = inline Alert, values kept.
- **States** — error: bad credentials / network / rate-limited / 5xx (Alert copy differs, never
  echoes 5xx); expired/invalid selection → Alert + "back to sign in". Loading: button spinner +
  `aria-busy`; state 2 loading spinner on the chosen row. No empty state.

---

## 2. App Shell / Home  ·  `Main` (interactive), `AppShellTablet`, `AppShellMobile`

- **Purpose** — the frame every module renders in; Home is a simple operational landing.
- **FASE 18, PROTOTYPE ONLY** — the KPI row, the inventory-movement chart, "Exportar", the header
  global search and the notifications bell have **no backend contract**. They stay on the canvas as
  future reference (marked "Analítica → FASE 18"). FASE 17 keeps Home simple: it does **not** build
  aggregate endpoints, does **not** compute KPIs client-side, does **not** load all sales for
  metrics. What FASE 17's Home can show: low-stock alerts and quick-action links to real routes.
- **Primary info (FASE 17)** — low-stock alerts, quick actions. (KPIs/chart = FASE 18.)
- **Primary action** — *Nueva venta* (header, → `/sales/new`).
- **Secondary** — quick-action cards (Recibir stock, Nueva transferencia, Importar).
- **Navigation surface** — rail / tablet panel / drawer on `--nav-bg = primary` (visual-system §6).
- **Layout** — Desktop: 68 px rail + 56 px header + content (KPI grid 4-up, 2-col panel row,
  quick-actions 4-up). Tablet: rail + header, KPI 2-up, panels stacked. Mobile: header + drawer,
  KPI 2-up, sections stacked, no chart (or sparkline only).
- **Components** — Sidebar, Header (search, notifications, account menu), PageHeader, Card/KPI,
  bar chart (CSS only), list rows with status dots + badges, quick-action cards.
- **Interaction** — **Sidebar rail**: `:hover` / `:focus-within` expand 68→232 px, overlay, no
  layout shift, 160 ms, auto-collapse, `prefers-reduced-motion` aware (see visual-system §6).
  Tablet: pin toggle → overlay panel + scrim. Mobile: menu button → drawer (Esc / overlay /
  route-change close, focus trap).
- **States** — KPI skeletons on load; each panel has its own empty ("Sin alertas de stock bajo")
  and error (inline retry) so one failing panel doesn't blank the page.

---

## 3. Productos — Listado  ·  `ProductsDesktop`, `ProductsTablet`, `ProductsMobile`

- **Purpose** — find and manage products/variants.
- **Primary info** — Producto (thumb + name + variant count), SKU, Categoría, Precio base, Stock,
  Estado.
- **Primary action** — *Nuevo producto*.
- **Secondary** — *Importar*, row menu (Editar, Ver variantes, Archivar), bulk select.
- **Layout** — Desktop: PageHeader + TableToolbar (search, `Categoría`, `Estado`, `Almacén`,
  `Más filtros`) + full table + Pagination. Tablet: 4 columns (Producto[+cat+precio inline], SKU,
  Stock, Estado); Categoría/Almacén move to filters + detail. Mobile: stacked rows (thumb + name +
  SKU·precio·stock line + status badge + chevron), horizontal filter chip strip, FAB *Nuevo
  producto*.
- **Components** — PageHeader, TableToolbar, FilterChip, Table, Badge (`En stock` / `Stock bajo`
  / `Agotado` / `Borrador`), Pagination, row-action menu.
- **Interaction** — filter chips reflect active state (`primarySubtle`); search is debounced;
  sort on Precio/Stock headers; row click → detail.
- **States** — loading: table skeleton (header + ~8 rows). Empty (no products): `<EmptyState>` +
  *Nuevo producto* / *Importar*. Empty (filtered): "Sin resultados para estos filtros" + *Limpiar
  filtros*. Error: `<ErrorState>` replacing the table body.

---

## 4. Producto — Crear / Editar  ·  `ProductForm`

- **Purpose** — organise the product record into scannable groups (not one endless form).
- **Primary info** — grouped: **Información general** (nombre, SKU, código de barras, descripción)
  · **Clasificación** (categoría, marca, unidad, seguimiento) · **Precios** (base, costo, mínimo,
  máximo — `min` visibility gated on `pricing.floor.view`) · **Atributos** (category-driven) ·
  **Información adicional** (peso, proveedor).
- **Primary action** — *Guardar producto*.
- **Secondary** — *Guardar y crear otro*, estado (Borrador/Activo), image upload.
- **Layout** — Desktop: two columns — form sections (left) + sticky aside (publish card + image
  card). Tablet: single column, aside becomes a top card. Mobile: single column, sticky bottom
  *Guardar* bar, image field collapsed.
- **Components** — Card/Section, Field, Input, Select, Textarea, currency-affix Input, attribute
  rows, image dropzone, Button.
- **Interaction** — changing Categoría re-renders the Atributos group; validation errors surface
  per-field from the API DTO (FASE 16 pattern), a summary Alert on submit failure. No invented
  fields — this is a *layout* proposal, not a contract change.
- **States** — loading (edit): field skeletons. Error: field-level + top Alert. Save: button
  spinner. No empty state.

---

## 5. Inventario — Existencias  ·  `InventoryDesktop`, `InventoryTablet`, `InventoryMobile`

- **Purpose** — fast scan of stock by product / warehouse / location.
- **Primary info** — Producto, SKU, Almacén, Ubicación, Disponible, Reservado, En tránsito, Estado.
- **Primary action** — *Ajuste* (RECEIPT / ADJUSTMENT_IN / ADJUSTMENT_OUT).
- **Secondary** — *Recibir stock*, per-row *Ajustar*, tabs (Todo / Stock bajo / Agotado / En
  tránsito).
- **Layout** — Desktop: tabs + toolbar (Almacén, Ubicación, Categoría) + dense table (compact rows,
  right-aligned numerics). Tablet: 4 columns (Producto, Ubicación, Disponible[+res/tr as sub-line],
  Estado), row-tap opens detail + adjust. Mobile: stacked cards, `Disponible` prominent, tap to
  expand the reservado/tránsito breakdown + *Ajustar existencias*.
- **Components** — Tabs, TableToolbar, Table (data-dense, not a card per row), Badge, disclosure
  row (mobile), Pagination.
- **Interaction** — Ajuste opens a Drawer (desktop/tablet) / bottom-sheet Dialog (mobile) with
  location authorization respected in the picker; deliberate horizontal scroll is acceptable on
  tablet if a column set must stay (documented choice, not accidental).
- **States** — loading: table skeleton. Empty: "Sin existencias en este almacén". Error:
  `<ErrorState>`.

---

## 6. Transferencias  ·  `TransfersDesktop`, `TransfersTablet`, `TransfersMobile`

- **Purpose** — understand and act on stock moves between warehouses at a glance.
- **Primary info** — Código, Ruta (origen → destino), Ítems, Estado, Creada, Actualizada.
- **Contract (audited — `list-transfers-query.dto.ts` + CLAUDE.md FASE 8)** — status enum
  `draft · approved · preparing · dispatched · partially_received · received · cancelled`;
  transitions **approve → prepare → dispatch → receive** (+ cancel); list filters `status`,
  `sourceLocationId`, `destinationLocationId`, pagination (no text search). Labels/actions in the
  prototype map **1:1** to these — FASE 17 does not invent state names.
- **Primary action** — *Nueva transferencia*.
- **Secondary** — contextual per-row action = the single next transition for that state
  (draft→*Aprobar*, approved→*Preparar*, preparing→*Despachar*, dispatched/partially_received→
  *Recibir*, terminal→*Ver*); tabs by state.
- **Layout** — Desktop: tabs + table + Pagination. Tablet: tabs (pill strip) + row cards (code,
  route, meta, badge, action button). Mobile: filter chips + stacked cards + sticky/safe-area CTA.
- **Components** — Tabs, Table / row-card, **StatusBadge** — `Borrador` (neutral), `Aprobada` /
  `En preparación` / `Despachada` (info), `Parcialmente recibida` (warning), `Recibida` (success),
  `Cancelada` (danger). **Semantic badges only — no per-module colour.**
- **Interaction** — the row action is the next transition; opening a transfer shows the item list
  + lifecycle timeline (detail screen, FASE 17).
- **States** — loading: skeleton rows. Empty: "No hay transferencias" + *Nueva transferencia*.
  Error: `<ErrorState>`.

---

## 7. Nueva venta / Carrito  ·  `NewSaleDesktop`, `NewSaleTablet`, `NewSaleMobile`  *(priority screen)*

- **Contract (audited — `cart-response.dto.ts`, `add-cart-item.dto.ts`, `create-order.dto.ts`,
  `order-response.dto.ts`, `create-price-approval.dto.ts`)**
  - The **cart is the draft**: one open cart per vendor, server-persisted; `POST /cart`,
    `PATCH /cart/items`. There is **no "draft order"** — checkout (`POST /orders`, `Idempotency-Key`)
    creates the order **`pending`**; a later `POST /orders/:id/confirm` is the real commit.
  - Negotiated price = the cart line's optional `negotiatedUnitPrice` (validated server-side at
    checkout). `minPrice` is returned **only** to callers with `pricing.floor.view`.
  - "Requires approval" is **backend-derived**: at checkout the server sets
    `order_items.isExceptionalDiscount = true` and keeps the order `pending`; `confirm` is blocked
    until an approved `price_approvals` row exists. The **frontend never computes
    `price < minPrice`** and never holds a hidden `minPrice` in the DOM.
  - **No tax engine**: `taxTotal` is always `0`. `discountTotal` is informational (not
    re-subtracted). `total = subtotal + taxTotal`.
- **Purpose** — the fastest possible path to a completed sale. Feels like a tool, not a form.
- **Primary info** — product search, line items (producto, cantidad, precio unitario, total línea),
  cliente, tipo de documento, **Subtotal / Descuento (informativo) / Total**.
- **Primary action** — *Confirmar orden* (→ `POST /orders`, order `pending`).
- **Secondary** — *Solicitar aprobación de precio*, edit negotiated price, remove line, change
  customer. **Removed:** "Guardar como borrador" — the cart auto-persists; a hint says so.
- **Layout** — Desktop: two panes — search + line-item table (left), sticky summary aside
  (Cliente card, Documento segmented control, Resumen, Confirmar). Tablet: single column, line rows
  with steppers + a **price chip → sheet** for negotiated price / approval, **sticky bottom bar**
  (safe-area). Mobile: mirrors the user's *Carrito* reference — search, customer card, segmented
  control, line-item cards (thumb, price + "Editar precio" chip, stepper, trash), *Solicitar
  aprobación* row, **sticky bottom total sheet + Confirmar orden** (safe-area).
- **Components** — Search with instant results dropdown (↑/↓/Enter), Stepper, inline price Input
  (desktop) / price chip → Sheet (tablet/mobile), a neutral "negociado" tag on a line the backend
  flags, Cliente selector, SegmentedControl (Factura / Nota de venta), summary rows, Button
  `primary`.
- **Interaction** — add product = one keystroke (Enter on the highlighted result); qty via stepper;
  a below-suggested price is kept and, once checked out, the order line carries the server's
  `isExceptionalDiscount` flag and routes to the approval flow (never blocked at cart time); totals
  recompute client-side for feedback, the server is the authority on confirm. **No "impuestos"
  line** — a one-line note says tax / e-invoicing are not in this phase.
- **States** — empty cart: search prominent, summary $0, disabled Confirmar + "Añade productos
  para comenzar". Loading (search): inline spinner in the dropdown. Error (confirm): Alert above
  the summary, cart preserved; stock/price conflict highlights the offending line.

---

## 8. Historial de ventas  ·  `SalesHistoryDesktop`

- **Contract (audited — `list-orders-query.dto.ts`)** — `GET /orders` is a **transactional list,
  not a report**: no aggregation, **no free-text search**. Filters: `status` (`draft·pending·
  confirmed·fulfilled·cancelled`), `documentType` (`invoice·sales_note`), `customerId`,
  `createdFrom`/`createdTo`, `page`/`pageSize`.
- **Purpose** — find an order, filter, open detail.
- **Primary info** — Número, Fecha, Cliente, Documento, Estado, Total.
- **FASE 18, PROTOTYPE ONLY** — the 4 KPI tiles ("ventas del mes", "órdenes", "pendientes",
  "ticket promedio") and any "Exportar" belong to REPORTS/FASE 18. FASE 17 must not add aggregate
  endpoints or compute metrics client-side.
- **Primary action** — row → *Abrir* (order detail).
- **Secondary (FASE 17)** — the contract filters above (Estado, Documento, Cliente, Rango de
  fechas). No número/cliente text search until a contract exists.
- **Layout** — Desktop: toolbar + table + Pagination. Tablet: table → row cards. Mobile: chips +
  stacked cards (número + badge, cliente, fecha, total), pager.
- **Components** — TableToolbar (contract filters), Table, StatusBadge (`Pendiente` info,
  `Confirmada` success, `Cancelada` danger, `Aprob. de precio pendiente` warning), Pagination.
- **Interaction** — row → order detail (FASE 17). **Not designed yet** (no approved contract):
  Telegram button, retry-notification control — a *notification status* indicator on the order
  detail is a recorded FASE 15 → FASE 17 note but out of 017-DESIGN scope.
- **States** — loading: table skeleton. Empty: "Sin ventas para estos filtros". Error:
  `<ErrorState>`.

---

## 9. Importación Excel  ·  `ImportDesktop`

- **Purpose** — staged bulk catalog/inventory onboarding, errors visible per row.
- **Primary info** — 5-step process (**Archivo → Validación → Revisión → Importación → Resultado**),
  file summary (filas totales / listas / con errores / modo), row table with per-row error messages.
- **Contract (audited — `import-execution.service.ts`)** — commit **processes every valid/warning
  row not yet imported; invalid rows are left behind** → **partial import is supported**. The job
  ends `completed` or `completed_with_errors`. So "Importar N filas válidas" (with invalid rows
  present) is the correct CTA — FASE 17 does not force fixing every error first.
- **Primary action** — *Importar N filas válidas* (step 3) / *Confirmar* (step 4).
- **Secondary** — *Descargar plantilla*, *Cambiar archivo*, *Descargar reporte de errores*, *Volver*.
- **Layout** — Desktop: single column, step rail on top, one big card (file row + summary grid +
  review table + action bar). Tablet: same, table scrolls horizontally if needed. Mobile: step
  rail becomes a compact "Paso 3 de 5" indicator, rows stacked, errors inline.
- **Components** — Wizard/step rail (done ✓ / current / pending), file row, summary metrics,
  Table with `err` row styling (`danger-bg`) + inline error text, Button.
- **Interaction** — no wizard-for-its-own-sake: the template download and file picker are both
  visible up front; validation errors are per-row with plain messages ("SKU vacío", "Categoría
  «X» no existe", "Precio debe ser mayor que 0"); the error report is a sanitized,
  formula-injection-safe download (matches the existing IMPORT module).
- **States** — step 1 empty: dropzone + *Descargar plantilla*. Validating: progress. Step 5:
  success summary (creados / actualizados / omitidos) or partial with the error report.

---

## 10. Devoluciones / Disposición  ·  `ReturnsDesktop`  *(covers Devoluciones; Price Approvals reuses the pattern)*

- **Contract (audited — `inspect-return.dto.ts`, `return-response.dto.ts`,
  `price-approval-response.dto.ts`)** — return status `requested · inspecting · resolved ·
  cancelled`; dispositions `restock · quarantine · damaged · scrap` (restock → sellable location;
  the others → non-sellable); resolve writes one `RETURN` movement per line (ADR-0021). Price
  approval status `pending · approved · rejected · cancelled`; it is **order-first** (the below-min
  line already exists, frozen); the requester **cannot resolve their own request**;
  `minPriceAtRequest` is returned only with `pricing.floor.view`. Prototype labels map 1:1.
- **Purpose** — process a return traced to a confirmed order; set per-line disposition; apply to
  stock.
- **Primary info** — request list (DEV-nnnn, order, customer, line count, status) + selected
  request detail (orden original, cliente, motivo, líneas with cantidad + disposición + ubicación).
- **Primary action** — *Resolver y aplicar al stock*.
- **Secondary** — *Guardar inspección*, *Cancelar devolución*, per-line disposition + location
  selectors.
- **Layout** — Desktop: master-detail split (list 340 px + detail). Tablet: list → detail as a
  full-width push view. Mobile: list only → detail screen.
- **Components** — list rows with StatusBadge (`Solicitada` info, `Inspeccionando` warning,
  `Resuelta` success, `Cancelada` neutral), detail header, meta grid, line table, disposition
  Select (colour-hinted: restock→success, quarantine/damaged/scrap→warning), location Select
  (sellable vs non-sellable enforced), Button.
- **Interaction** — restock requires a sellable location; quarantine/damaged/scrap require a
  non-sellable one; *Resolver* writes one `RETURN` movement per line (matches the SALES returns
  model). **Price Approvals** (`sales.price_approval.*`) uses the identical master-detail +
  line-review layout: request list → detail with the frozen order-item snapshot, *Aprobar* /
  *Rechazar*, requester-cannot-self-approve enforced in the UI affordance and the API.
- **States** — list empty: "Sin devoluciones pendientes". Detail loading: skeleton. Resolve error:
  Alert in the detail footer, nothing applied to stock.

---

## Cross-screen consistency checklist

Same rail, header, page-header pattern, table style, card treatment, button hierarchy, badge
semantics, icon style, spacing rhythm and empty/loading/error handling on every screen. Reviewed
side-by-side in the canvas — see [responsive-guidelines.md](responsive-guidelines.md) §7.
