# Frontend Visual System — SaaS Inventory

> **Status:** PROMPT 017-DESIGN — CLOSED. This document + the design canvas are the **visual
> reference** for FASE 17: the design system (tokens, colour, type, spacing, radii, shadows),
> navigation / App Shell, responsive patterns, components, accessibility, interaction patterns and
> reference prototypes. **It is NOT the functional specification of any module** — see
> [§12 Functional Specification Boundary](#12-functional-specification-boundary). 017-DESIGN touches
> no product code, backend, database, migration, n8n, Event Processor or Import Worker.

Related: [../architecture/frontend.md](../architecture/frontend.md) (FASE 16 foundation), ADR-0006 (Next.js),
[frontend-screen-specs.md](frontend-screen-specs.md), [responsive-guidelines.md](responsive-guidelines.md).

Design canvas (multi-artboard, interactive sidebar): produced with `/design`, working sources in
[`design/canvas/`](canvas/). Dark mode is **prepared as a token map only** (§3.4, §24 of the
017-DESIGN prompt) — not a FASE 17 feature.

---

## 1. Principles

The look is derived from the **reference screenshots supplied by the user** — a modern administrative
SaaS: white surfaces on a cool-grey page, a single blue accent, restrained cards, big tabular
numbers, lean line icons, generous spacing, an iOS-like calm. It is **reference, not copy**: no
measurement, string, logo, brand colour or fictional datum is reproduced. The product stays its own.

### 1.1 What the references told us

| Aspect | Observed in references | Adopted as |
| --- | --- | --- |
| Composition | Left icon/label sidebar (desktop), sticky top header, single scrolling content column | AppShell: 68 px icon rail + header, max-width content |
| Density | Admin screens are data-dense tables; mobile is card/list | Desktop = tables; tablet = reduced tables; mobile = stacked rows/disclosure |
| Hierarchy | One bold page title, large KPI numerals, quiet secondary text | Display / Section / Body / Secondary / Caption / Numeric scale (§4) |
| Surfaces | Flat white cards, hairline borders, barely-there shadow | `surface` on `background`, 1 px `border`, 2 shadows only (§8) |
| Colour | Blue primary, green/amber "In Stock / Low Stock" chips | 1 accent + neutral scale + semantic states (§3) |
| Controls | Pill quantity steppers, rounded search field, toggle switches, segmented control | Stepper (radius-full), Input (radius-sm), Segmented control, Switch |
| Iconography | Simple single-weight line icons | One stroke set, 1.75 weight, 24 grid (§7) |
| Primary action | One filled blue button per view, top-right on desktop / bottom on mobile | Button `primary`, one per view |
| Navigation panel | Reference dashboards use a dark / tinted sidebar distinct from the content | **Navigation background = `primary`** (`--nav-bg`), one token, propagated to rail + tablet panel + mobile drawer (§3.2, §6) |
| Mobile nav | Reference app uses a bottom tab bar | **Rejected** — see §6.5; we use hamburger → drawer to keep one nav model |

### 1.2 Apple HIG adaptation (not "make it an iPhone app")

- **Clarity** — legible type ramp, tabular numerals for money/quantities, the primary action always
  identifiable by colour + position.
- **Deference** — neutral grey, one accent, no ornament; tables are the subject, chrome recedes.
- **Depth** — two shadows total; separation by border/background first. Depth only communicates
  navigation/context (rail expansion, drawer, dialog).
- **Consistency** — one navigation registry, the same semantic badges in every module, the same
  control for the same action everywhere.
- **Feedback** — every control has hover / pressed / focus / disabled / loading; states combine
  colour + icon + text, never colour alone.
- **Direct manipulation** — steppers, inline price editing, instant search results in New Sale.
- **Progressive disclosure** — essentials first; detail on row-tap, drawer, or rail expansion.
- **Touch** — ≥ 44×44 targets on tablet/mobile; controls 44–48 px tall off-desktop.

### 1.3 Visual goal

Modern, professional, clean, sober, fast, light, organised, premium-without-ostentation,
data-dense but legible, fit for daily business use. Aesthetics never trade against speed, clarity,
accessibility, maintenance or performance. Avoid: dated-corporate, busy, over-colourful,
decorative, experimental.

---

## 2. Token architecture (future-proofing appearance)

Every visual value is a **token**, surfaced as a CSS custom property and (in FASE 17) mapped into
the Tailwind theme. **No functional page ever hard-codes a colour, radius or spacing value.**
Changing the accent, background, surface, radius scale or switching light/dark is a token edit —
never a component edit.

```
:root {                      /* light — the primary experience (FASE 17) */
  --color-background   --color-surface   --color-surface-subtle   --color-surface-elevated
  --color-text  --color-text-secondary  --color-text-muted
  --color-border  --color-divider
  --color-primary  --color-primary-hover  --color-primary-pressed  --color-primary-subtle  --color-on-primary
  --color-success  --color-warning  --color-danger  --color-info
  --color-focus
  /* navigation — semantic, derived from primary, never hard-coded per screen */
  --nav-bg            /* = var(--color-primary) */
  --nav-fg            /* inactive icon/label — on-primary, reduced emphasis */
  --nav-fg-strong     /* active — max legibility */
  --nav-hover         /* translucent light surface */
  --nav-active        /* translucent light surface, higher emphasis */
  --nav-divider  --nav-focus
  --nav-logo-bg  --nav-logo-fg   /* logo inverts on the primary panel: light chip, primary "S" */
  --radius-sm --radius-md --radius-lg
  --space-xs --space-sm --space-md --space-lg --space-xl --space-2xl --space-3xl
  --shadow-sm --shadow-md
  --font-sans
}
:root[data-theme="dark"] { /* only the token values are redefined — including every --nav-* — no component knows */ }
```

If `--color-primary` changes, the entire navigation surface changes centrally. No artboard/component
hard-codes the blue.

Tailwind mapping (FASE 17): `theme.extend.colors.primary = 'var(--color-primary)'`, etc., so both
`bg-primary` utilities and raw `var(--color-*)` resolve to the same source.

The prototypes demonstrate this: `VisualSystem` and `Main` carry a **Tema** (dark) toggle that
only flips `data-theme` — every artboard element re-themes with zero markup change.

---

## 3. Colour

**Principle: the minimum number of colours.** One accent + a neutral scale + semantic states.
**Modules do not get their own colours** — no "Productos = azul, Ventas = verde". Identity comes
from hierarchy, iconography, text, navigation and structure.

### 3.1 Neutrals (light)

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#F6F7F9` | Page canvas |
| `surface` | `#FFFFFF` | Cards, header, rail, table body |
| `surfaceSubtle` | `#F1F3F5` | Input fill, table header, hover row, inset panels |
| `surfaceElevated` | `#FFFFFF` + `shadow-md` | Dialog, drawer, expanded rail, dropdown |
| `border` | `#E3E6EA` | Card/control borders, table outer |
| `divider` | `#ECEEF1` | Row separators, section rules |
| `text` | `#1A1D21` | Primary text (near-black, not pure) |
| `textSecondary` | `#5B6470` | Supporting text, meta |
| `textMuted` | `#8A929E` | SKU, timestamps, placeholders, captions |

### 3.2 Accent (single brand colour)

| Token | Value |
| --- | --- |
| `primary` | `#2F6FED` (V1 value — changeable later via tokens; not worth re-deriving now) |
| `primaryHover` | `#2A63D4` |
| `primaryPressed` | `#2557BC` |
| `primarySubtle` | `#EAF1FE` (selected row, info bg) |
| `onPrimary` | `#FFFFFF` |
| `focus` | `#2F6FED`, rendered as a 2 px outline, 2 px offset |

#### Navigation tokens (derived from `primary`)

The navigation panel — desktop rail, tablet pinned panel, mobile drawer — sits on **`--nav-bg = var(--primary)`**.

| Token | Light value | Role |
| --- | --- | --- |
| `nav.background` | `var(--primary)` | Rail / panel / drawer fill |
| `nav.foreground` | `rgba(255,255,255,.72)` | Inactive icon + label |
| `nav.foreground-strong` | `#FFFFFF` | Active icon + label, brand text |
| `nav.hover` | `rgba(255,255,255,.12)` | Hover surface (discreet translucent light) |
| `nav.active` | `rgba(255,255,255,.20)` | Active-item surface |
| `nav.divider` | `rgba(255,255,255,.16)` | Section rule / brand underline |
| `nav.focus` | `#FFFFFF` | Focus ring on the primary field |
| `nav.logo-bg` / `nav.logo-fg` | `#FFFFFF` / `var(--primary)` | Logo inverts on primary: light chip, primary "S" |

No second brand colour. No per-module colour. Active section is legible even collapsed:
`nav.active` surface + a **3 px white** left indicator + white icon. Dark theme redefines every
`--nav-*` (a deep desk-blue panel), same roles.

### 3.3 Semantic states (status only — never module identity)

| Token | Fg | Bg | Meaning |
| --- | --- | --- | --- |
| `success` | `#1E874B` | `#E5F4EC` | En stock, Confirmada, Recibida, OK |
| `warning` | `#B7791F` | `#FBF0DD` | Stock bajo, Parcial, Aprobación pendiente, demo-data pill |
| `danger` | `#D0453B` | `#FBE9E7` | Agotado, Cancelada, error, destructive |
| `info` | `#2F6FED` | `#EAF1FE` | Pendiente, Despachada, En preparación (= primary family) |

### 3.4 Dark — DEFERRED / FUTURE (not FASE 17)

**FASE 17 ships light mode only.** The token map is *prepared* for dark (only
`:root[data-theme="dark"]` values change, `--nav-*` included) and `VisualSystem` + `Main`
demonstrate it via the **Tema** toggle — but the theme switcher, theme persistence and full
dark-mode QA are **out of FASE 17 scope**. The tokens stay as a proof of extensibility, not a
committed feature.

Derived from the same map — only `:root[data-theme="dark"]` values change. Roles stay identical.

| Token | Value |
| --- | --- |
| `background` `#14161A` · `surface` `#1B1E24` · `surfaceSubtle` `#23272E` · `border` `#2C313A` · `divider` `#242832` |
| `text` `#F2F4F7` · `textSecondary` `#A7B0BD` · `textMuted` `#79828F` |
| `primary` `#5B93F5` · `primaryHover` `#6E9FF6` · `primaryPressed` `#4A83E8` · `primarySubtle` `#1E2A44` |
| `success` `#3DBB78`/`#16281F` · `warning` `#D9A441`/`#2A2213` · `danger` `#E9695F`/`#2C1A19` |

The Settings toggle + persistence mechanism are a FUTURE item, not FASE 17.

---

## 4. Typography

`--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
No webfont is added for aesthetics. Money and quantities use `font-variant-numeric: tabular-nums`.

| Role | Size / line | Weight | Notes |
| --- | --- | --- | --- |
| Display / page title | 28 / 34 | 700 | `letter-spacing: -0.02em` |
| Section title | 17 / 24 | 600 | Card headers, dialog titles |
| Body | 14 / 20 | 400 | Default |
| Body strong | 14 / 20 | 600 | Names, key cells |
| Secondary | 13 / 18 | 400 | `textSecondary` |
| Caption / overline | 11 / 14 | 600 | `0.06em`, uppercase, `textMuted` — section labels, table headers |
| Numeric (KPI) | 26 | 700 | tabular-nums, `-0.01em` |

Mobile bumps body to 15 / 22 and controls to 44–48 px; the ramp is otherwise unchanged.

---

## 5. Spacing, radius, surfaces, shadows

**Spacing** — base 4: `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48`. One rhythm across
all screens.

**Radius** — `sm 6` (inputs, buttons, rectangular badges) · `md 10` (cards, menus, dialogs on
desktop) · `lg 14` (drawers, mobile sheets/cards) · `full` (pills, steppers, avatar, status badges).
Deliberately restrained — not pill-shaped everything.

**Surfaces** — cards only where they add structure. No "card inside card inside card". A dashboard
panel, a table container, a form section = a card. A KPI = a card. A paragraph is not a card.

**Shadows** — two only:
- `shadow-sm` — `0 1px 2px rgba(16,24,40,.05), 0 1px 1px rgba(16,24,40,.03)`
- `shadow-md` — `0 6px 20px rgba(16,24,40,.10), 0 2px 6px rgba(16,24,40,.05)` — reserved for
  things that float over content (expanded rail, drawer, dropdown, dialog).
Everything else separates with `border` + `background`.

---

## 6. Navigation — the Sidebar (distinctive feature)

### 6.0 Surface

The navigation panel — rail, tablet pinned panel, mobile drawer — uses **`--nav-bg = var(--primary)`**
and the `--nav-*` token set (§3.2). Inactive icons/labels: `nav.foreground` (`on-primary`, reduced
emphasis). Hover: `nav.hover` (discreet translucent light surface). Active: `nav.active` surface +
white icon/label + **3 px white** left bar. Captions/dividers: translucent white, enough contrast
without dominating. Logo inverts (light chip, primary "S"). Focus ring: `nav.focus` (white),
clearly visible. The header stays on `surface` (white) — only the navigation field is primary.
Nothing hard-codes the blue; changing `--color-primary` re-themes the whole navigation.

### 6.1 Desktop — compact icon rail, hover/focus expansion

- **Default: 68 px rail**, module icons only, grouped by section with thin gaps. Brand mark at top.
- **Active section is visible even when collapsed**: `nav.active` surface + a 3 px **white**
  left indicator + white icon. Never text-only.
- **On `:hover` of the rail *or* `:focus-within`** → the rail expands to **232 px**, revealing
  section captions and item labels. Transition: `width` + `opacity` (+ small `translateX` on
  labels), **160 ms ease**. UI responds immediately.
- **On mouse-leave / focus-out** → collapses back automatically; labels hidden, icons kept.
- **No layout shift.** The rail's *structural* column stays 68 px (`grid-template-columns: 68px 1fr`);
  the expanded panel is `position: absolute` and **overlays** the content with `shadow-md`. Tables,
  forms and the New Sale cart never move horizontally.

### 6.2 Performance (design constraint)

CSS-only: `:hover` / `:focus-within` + `width` / `opacity` / `transform` transitions. **No** Framer
Motion for the rail, no animation library, no `mousemove` listeners, no intervals, no rAF loops, no
observers, no React state updated continuously by hover. Duration 120–180 ms.
`@media (prefers-reduced-motion: reduce)` removes the transition (instant).

### 6.3 Accessibility

- Works with keyboard: `Tab` into the rail → `:focus-within` expands it; every item is a real
  `<a>` with its label in the DOM at all times (visually clipped when collapsed), so the accessible
  name is always present. Optional `title` tooltip on the icon.
- Focus ring always visible (`--color-focus`, 2 px, 2 px offset).
- Active item carries `aria-current="page"`.
- Not hover-only — focus and (tablet) explicit tap both reveal labels.

### 6.4 Tablet

Hover is unreliable, so navigation must not depend on the mouse. **Decision (prototyped in
`AppShellTablet`):** a **permanent 68 px icon rail** + a **pin/expand toggle** at the top of the
rail that opens the 232 px panel as an **overlay with a scrim** (tap an icon to navigate directly;
tap the scrim or the ✕ to close). This preserves horizontal space for dense tables better than a
full-width drawer and keeps every module one tap away. A bottom tab bar was rejected — it would
force a second, divergent navigation model and only fits ~5 destinations (we have 17).

### 6.5 Mobile

No hover. Header **menu button → slide-over drawer** (284 px, **`--nav-bg` = primary**, icon +
label, section captions). Closes on: ✕ button, overlay tap, route change, `Escape` (when a keyboard
is present). Focus is trapped while open and returned to the menu button on close. Body scroll
locked; drawer respects `env(safe-area-inset-bottom)`. No bottom tab bar. (This matches the FASE 16
`app-shell.tsx` drawer behaviour already built.)

### 6.6 Icon set

One stroke style, `stroke-width` 1.75, 24 grid, round caps/joins. Modules covered:
Inicio, Productos, Categorías, Inventario/Existencias, Movimientos, Transferencias, Almacenes,
Ubicaciones, QR, Importación, Clientes, Ventas, Aprobaciones, Devoluciones, Usuarios, Configuración
(full grid in `VisualSystem`). FASE 17: inline SVG components with tree-shaking — **not** a full
icon library import.

### 6.7 Navigation grouping

`Inicio` · **Catálogo**: Productos, Categorías, Importación · **Inventario**: Existencias,
Movimientos, Transferencias, Almacenes, Ubicaciones, QR · **Ventas**: Nueva venta, Historial,
Clientes, Aprobaciones, Devoluciones · **Administración**: Usuarios, Configuración.
Server-side permission-filtered (extends the existing `lib/navigation.ts` registry).

---

## 7. Components (only what FASE 17 needs)

Extends the FASE 16 `components/ui/` set; no component library, Tailwind as-is.

- **AppShell** — rail + header + content (`max-width` ~1180). **Sidebar** (§6). **Header** —
  56 px, search, notifications, account menu (existing `UserMenu`). **PageContainer** /
  **PageHeader** (title + subtitle + primary action + optional demo-data pill).
- **Button** — `primary` / `secondary` / `ghost` / `danger`; sizes `sm 32` / `md 38` / `lg 44`
  (touch); states hover / pressed / focus / disabled / loading (spinner + `aria-busy`). **IconButton**
  38 px square. **ButtonLink** (real `<a>`).
- **Input / Search / Select / Textarea / Checkbox / Radio** — 38 px desktop, 44 px touch; `Field`
  wires label + hint + error id (FASE 16 has this). Prefix/suffix affix for currency.
- **Card / Section / Divider**.
- **Table** — sticky caption-style header (`surfaceSubtle`), 48 px rows (40 px compact toggle),
  hover row, right-aligned tabular numerics, row-action menu (`⋮`), inline row link actions.
  **TableToolbar** — search + filter chips + `Más filtros`.
- **Badge / StatusBadge** — the four semantic tones + neutral; icon + text, never colour alone.
- **Alert** — info / success / warning / danger, icon + message + optional action.
- **Dropdown / Dialog / Drawer** — `surfaceElevated` + `shadow-md`, `Escape` + overlay close,
  focus trap + return. Dialog centered on desktop, bottom-sheet on mobile.
- **Pagination** — "Mostrando 1–N de M" + numbered pager.
- **Stepper** — pill, `−` / value / `+`, 30 px (desktop) / 40 px (mobile) tap targets.
- **SegmentedControl** — Factura / Nota de venta, tabs.
- **EmptyState / ErrorState (correlationId, retry, no stack) / Skeleton** — FASE 16 has these;
  every data view shows loading + empty + error.
- **Stepper/Wizard rail** — Importación's 5 steps (done ✓ / current / pending).

---

## 8. Performance as a design requirement

Every visual effect is asked: *does it add operational value?* and *can CSS alone do it?* If CSS
can, CSS wins. **Deliberately excluded:** animated/particle/parallax/video backgrounds, animated
gradients, 3D/canvas/WebGL decoration, scroll-driven animation, large-area `backdrop-filter` /
generalised glassmorphism, heavy repeated shadows, per-row/per-card entrance animations, motion
libraries. Micro-interactions only where they aid understanding (button, focus, rail, dropdown,
drawer, dialog, selection, skeleton), 100–200 ms.

**Server-Component-friendly:** the layout patterns keep Server Components the default. Client
interactivity is confined to: forms, dialogs, drawers, filters, the cart, the rail toggle,
explicit actions — never a whole page turned client just for looks.

**No heavy dependencies:** the design is reproducible with the existing Next.js + React +
Tailwind + semantic HTML + inline SVG. No Redux / MobX / Framer Motion / Three.js / data-grid /
component framework required. If a proposed element needs a large dependency, the element is
reconsidered.

---

## 9. Accessibility baseline

Contrast (text ≥ 4.5:1, large text / UI ≥ 3:1 — the palette is chosen for this in both themes),
visible focus everywhere, ≥ 44 px touch targets off-desktop, labelled controls, semantic headings,
keyboard-operable menus/drawer/dialog, state never by colour alone (colour + icon + text),
`prefers-reduced-motion` respected. Aspires to an accessible implementation from day one, not a
final-pass audit.

---

## 10. Demo / design data

All prototype content is fictional and marked **"Datos de demostración"**. No PII, no real
credentials. None of it is to be carried into FASE 17 as productive data or mock fixtures.
Non-contractual demo strings (e.g. "crédito 30 d") were removed where they implied a backend field
that does not exist — Customers has `type / displayName / taxId / email / phone / address / notes`,
nothing about credit terms.

## 11. Contract alignment (audit — FASE 16 code + FASE 12/13 DTOs)

The prototypes are a *visual* proposal; FASE 17 re-audits every contract before implementing. What
the 017-DESIGN audit already fixed:

| Area | Finding | Applied |
| --- | --- | --- |
| Login | 016-C: `LoginDto` is `{ email, password }` only — no `tenantSlug` | "Empresa" field removed; state 1 is email + password |
| Login | 016-C: several active memberships → `tenant_selection_required` + `availableTenants` | state 2 "Elegir empresa" — a company list shown *only after* valid credentials; `selectionToken` never shown/stored/in URL |
| Login | no remember-me / password-reset route | removed from V1, marked out-of-FASE-17 |
| Login | `POST /auth/register` + `/register` page exist | "Crear organización" link kept |
| Login | tenant not resolved pre-auth; no enumeration by email | no company field, no company name before auth; neutral copy "Accede con tu correo y contraseña" |
| New Sale | `order_items.isExceptionalDiscount` is server-set; `minPrice` gated on `pricing.floor.view` | "requires approval" state is **backend-derived**; the UI never computes `price < minPrice`, never stores a hidden `minPrice` |
| New Sale | `taxTotal` always `0`, no tax engine | summary shows Subtotal / Descuento (informativo) / Total — no "%", no "calculado al confirmar" |
| New Sale | checkout creates order `pending`; the cart is the draft (one open cart per vendor, auto-persisted) | "Guardar como borrador" removed; hint "el carrito se guarda automáticamente"; "Confirmar orden" → creates `pending` (final confirm is a later step) |
| New Sale tablet/mobile | negotiated price = `negotiatedUnitPrice` cart-line field | price chip → sheet for negotiated price / approval request (parity, not the desktop inline input) |
| Import | execution processes valid + warning rows, leaves invalid behind → **partial import supported** | "Importar N filas válidas" CTA kept |
| Transfers | enum `draft·approved·preparing·dispatched·partially_received·received·cancelled` | labels + row actions mapped 1:1 (approve/prepare/dispatch/receive/cancel) |
| Returns | dispositions `restock·quarantine·damaged·scrap`; status `requested·inspecting·resolved·cancelled` | prototype already matched; note added; Price Approvals reuses the master-detail pattern |
| History / Home | `GET /orders` is transactional (no aggregation, no text search) | KPIs / charts / global search / bell / Export marked **FASE 18 / PROTOTYPE ONLY**; FASE 17 = list + contract filters + pagination + detail |

### Sticky bottom actions / iOS safe area

Prototype bottom bars use a pinned position for layout convenience. **FASE 17 rule:** a persistent
bottom CTA is a sticky footer, `padding-bottom: env(safe-area-inset-bottom)`, and the scroll
container must be able to scroll its content **fully clear** of the CTA — never an absolute bar
covering list rows. Applies to New Sale (mobile/tablet), Products mobile, Transfers mobile, and any
similar persistent action.

---

## 12. Functional Specification Boundary

**The 017-DESIGN prototypes are not the definitive functional specification of the modules.** The
exact functionality of each module — its data, actions, endpoints, permissions, business states,
rules and validations — is defined later, in a dedicated frontend functional-analysis phase run
against the **real backend, real endpoints, real DTOs, real permission codes, real states and the
existing architecture / ADRs**.

What 017-DESIGN **does** define (authoritative):

- appearance, hierarchy, composition, layout;
- the design token system (colour, type, spacing, radii, shadows, breakpoints);
- navigation model and App Shell (rail / tablet panel / mobile drawer);
- responsive patterns (table → card, toolbar reflow, sticky actions, safe-area);
- the component inventory and each component's variants, **visual** states, responsive behaviour
  and accessibility;
- interaction patterns (focus, keyboard, drawer/dialog behaviour, reduced motion);
- the reference prototypes as *one possible visual organisation* of each screen.

What 017-DESIGN **does not** define (deferred to the functional phase):

- which fields, columns, filters, tabs, badges or row actions a screen actually has;
- which endpoints a screen calls and with what query/body;
- which permission gates which control;
- domain/business states and the transitions between them;
- validation rules, totals math, rounding, idempotency, concurrency;
- anything a mockup shows that is not backed by an approved contract.

**A visual state is not a domain state.** `disabled` / `hover` / `loading` are visual. `approved`,
`pending`, `dispatched`, `restock` are domain states and appear here only as already-existing
references from audited DTOs, never as new invention.

Where a prototype shows something that *looks* functional but has no backing contract, it is marked
**PROTOTYPE ONLY** / **FASE 18** / **pending functional validation** (see the audit table in §11 and
the per-screen notes in [frontend-screen-specs.md](frontend-screen-specs.md)). Such elements are
kept as future visual reference and are explicitly **not** FASE 17 requirements.

## 13. Source of truth

| Question is about… | Authority |
| --- | --- |
| Business / domain (data model, states, rules, permissions, endpoints) | Backend + database + ADRs + current architecture (`docs/architecture/`, `docs/decisions/`) |
| Visual (appearance, layout, tokens, navigation, components, responsive, a11y) | 017-DESIGN — this document + `frontend-screen-specs.md` + `responsive-guidelines.md` + `design/canvas/` |
| Concrete frontend behaviour of a FASE 17 screen (fields, calls, gating) | The future FASE 17 functional specification (audited against the backend) |

A mockup is **never** the authority for inventing backend behaviour. If a prototype and the backend
disagree on anything functional, the backend wins and the prototype is a note to reconcile during
the functional phase.

### F17 / F18 separation

**FASE 17** = operational modules: CRUD, lists, forms, operational actions (create/edit/archive,
list + contract filters + pagination + detail, lifecycle transitions the backend already exposes).
**FASE 18** = advanced dashboards, KPIs, charts, analytics, exports, advanced reporting. A prototype
may show dashboard *structure*, but FASE 18 functionality is **not** a FASE 17 requirement — Home,
Sales History KPIs, header global search, the notifications bell and "Exportar" are all marked
PROTOTYPE ONLY / FASE 18 in the screen specs.
