# Responsive Guidelines — SaaS Inventory (PROMPT 017-DESIGN)

> **017-DESIGN CLOSED — visual/responsive reference.** Concrete breakpoints are finalised during
> FASE 17 implementation; the values below are prototype references, **not rigid hard-codes**. These
> are layout patterns (table → card, toolbar reflow, drawer, sticky actions) — they do **not** decide
> which concrete data or actions a screen carries; that is the FASE 17 functional phase (see
> [frontend-visual-system.md §12](frontend-visual-system.md#12-functional-specification-boundary)).
> System: [frontend-visual-system.md](frontend-visual-system.md) · Screens:
> [frontend-screen-specs.md](frontend-screen-specs.md) · Prototypes: [`design/canvas/`](canvas/).

## 0. Reference widths (prototype)

| Format | Prototype width | Notes |
| --- | --- | --- |
| Desktop | 1440 | Content column max-width ~1180; rail overlays, never pushes |
| Tablet | 834–1024 | Portrait 834 prototyped; **not** a squashed desktop |
| Mobile | 375–430 | 390 prototyped |

Three formats are designed explicitly — desktop is **not** drawn and left for CSS to "sort out".

---

## 1. Sidebar / navigation

| | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Surface | **`--nav-bg` = primary** | same | same (drawer) |
| Default | 68 px icon rail | 68 px icon rail (permanent) | hidden; header menu button |
| Expand | `:hover` / `:focus-within` → 232 px **overlay**, 160 ms, auto-collapse | **pin toggle** → 232 px overlay + scrim; tap icon navigates, scrim/✕ closes | menu button → 284 px **drawer** + overlay |
| Layout shift | none (rail column stays 68 px, panel is `position:absolute`) | none (overlay + scrim) | n/a (drawer over content) |
| Close | mouse-leave / focus-out | scrim tap · ✕ · navigate | overlay tap · ✕ · route change · `Escape` |
| Active item | `nav.active` surface + 3 px **white** left bar + white icon — visible collapsed | same | same, with label |
| Inactive / hover | `nav.foreground` (on-primary, reduced) / `nav.hover` translucent light | same | same |
| Keyboard | `Tab` in → expands; labels always in DOM; focus ring (`nav.focus`, white) | `Tab` + explicit toggle | focus trap in drawer, return to trigger |
| Motion | CSS `width`/`opacity`/`transform`; `prefers-reduced-motion` → instant | same | drawer slide 160 ms; reduced-motion → instant |
| Safe area | — | — | drawer `padding-bottom: env(safe-area-inset-bottom)` |

Never hover-only (touch devices get an explicit toggle / drawer). Never a mouse-move listener / rAF
/ continuously-updated React state for the rail. The blue is a token (`--nav-bg`), never hard-coded
per screen — change `--color-primary` and the whole navigation re-themes.

---

## 2. Tables

| | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Form | Full table, all columns, 48 px rows (40 px compact toggle) | Reduced to 3–5 columns; secondary data folded into a sub-line under the primary cell; the rest moves to filters + row detail | Stacked rows / cards; primary value prominent; disclosure reveals the breakdown |
| Numerics | right-aligned, `tabular-nums` | same | inline in the meta line |
| Row actions | inline link (`Ajustar`) or `⋮` menu | single primary action button per row | tap row → detail; swipe not required |
| Horizontal scroll | avoid | **allowed as a deliberate choice** for genuinely dense sets (Inventario), inside an `overflow-x:auto` container — never accidental page overflow | avoid; use stacking |
| Pagination | numbered pager + "Mostrando 1–N de M" | numbered pager | pager or infinite scroll |
| Header | sticky, `surfaceSubtle`, caption-style | same | omitted (labels inline) |

Products, Inventario and Transferencias each prototype all three.

---

## 3. Forms

| | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Columns | 2-col within a section where fields pair naturally; page 2-col (form + sticky aside) | single column; aside → top card | single column, always |
| Section grouping | Card per logical group (General / Clasificación / Precios / Atributos / Adicional) | same | same, collapsible if long |
| Control height | 38 px | 44 px | 44–48 px |
| Submit | aside "Publicar" card, sticky at `top:80px` | top card | **sticky bottom bar** |
| Validation | field-level (API DTO errors) + summary Alert on submit | same | same; scroll-to-first-error |

---

## 4. Filters

| | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Presentation | inline chip row above the table (`Categoría ▾`, `Estado ▾`, `Más filtros`) | inline chips, fewer; overflow into `Más filtros` sheet | horizontal-scroll chip strip; tap → bottom-sheet with the full set |
| Active state | chip `primarySubtle` + `primary` text/border | same | same |
| Search | **only where a contract exists** — Productos/Inventario have scoped search; `GET /orders` has none, so Historial filters only | same | same |
| Clear | "Limpiar filtros" appears when any is active | same | in the sheet |

Filters reflect the **real query DTO** for each list (status / documentType / customerId / date
range for orders; status / location for transfers; etc.). No free-text search is drawn where the
contract has none. The header "global search" is PROTOTYPE ONLY (no endpoint).

---

## 4b. Sticky bottom actions & iOS safe area

A persistent bottom CTA (New Sale summary/Confirmar, Product form Save, Products/Transfers mobile
"Nuevo") must:

- be a **sticky footer** within the scroll container — not `position: absolute` covering content;
- carry `padding-bottom: env(safe-area-inset-bottom)` so it clears the iOS home indicator;
- leave the list/form able to scroll **fully clear** of it (bottom spacer ≥ bar height);
- never draw a fake status bar or fake keyboard inside a device frame.

The prototypes pin these bars for layout convenience and carry a comment to this effect; FASE 17
implements the sticky + safe-area pattern. Applies to: New Sale (mobile + tablet), Product form
(mobile), Products mobile, Transfers mobile.

---

## 5. Dialogs / drawers

| | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Adjust stock / quick create | right-side **Drawer** (`surfaceElevated` + `shadow-md`) | Drawer (wider) or centered Dialog | **bottom sheet** (Dialog variant), drag handle, no fake status bar |
| Confirm / destructive | centered Dialog, max 480 | centered Dialog | bottom sheet |
| Close | ✕ · overlay · `Escape` | same | ✕ · overlay · `Escape` (with keyboard) · swipe-down |
| Focus | trapped, returned to trigger | same | same |
| Body scroll | locked while open | locked | locked |

---

## 6. Navigation chrome (header)

| | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Height | 56 px | 56 px | 56 px |
| Contents (FASE 17) | account menu (+ scoped search where a list supports it) | rail pin toggle · account menu | menu button · screen title · account avatar |
| Contents (PROTOTYPE ONLY) | global search · notifications bell — no backend, not built in FASE 17 | same | same |
| Page title | in content `PageHeader` (28/34) | in `PageHeader` (23/28) | in header bar + `h1` in content (24/30) |
| Primary action | `PageHeader` top-right | `PageHeader` top-right (may shorten label) | sticky bottom button (safe-area) |

---

## 7. Side-by-side visual review

All 22 artboards use one token set, one type ramp, one spacing rhythm, one rail, one header
pattern, one table style, one badge vocabulary, one icon style. Checked on the canvas:

- **Navigation** — `--nav-bg = primary` propagated to every desktop rail, the tablet pinned panel
  and the mobile drawer; inactive `nav.foreground`, hover `nav.hover`, active `nav.active` + white
  bar; logo inverts. Identical treatment on every screen. ✓
- **Colour** — single `primary`; semantic badges identical across Productos / Inventario /
  Transferencias / Historial / Devoluciones; no module has its own hue. ✓
- **Typography** — Display/Section/Body/Secondary/Caption/Numeric consistent; mobile bumps body
  only. ✓
- **Spacing** — 4-base scale; 24 px content padding desktop, 20 tablet, 16 mobile. ✓
- **Sidebar** — same rail, same active treatment, same icons in every desktop artboard;
  tablet/mobile patterns consistent between screens. ✓
- **Header** — 56 px, same affordances, everywhere. ✓
- **Tables** — same header style, row height, hover, numeric alignment, pager. ✓
- **Cards** — same border/radius/shadow; no nested-card stacking. ✓
- **Buttons** — one `primary` per view; `secondary`/`ghost`/`danger` consistent. ✓
- **Density** — desktop dense, tablet comfortable-dense, mobile stacked — consistent per format. ✓
- **Responsiveness** — App Shell, Products, Inventory, New Sale, Transfers each exist in all three
  formats; Login in two; Product Form / Sales History / Import / Returns desktop + documented
  responsive rules above. ✓

Inconsistencies found and corrected during the pass are tracked in the 017-DESIGN report.
