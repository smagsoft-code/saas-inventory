# UI-UX-SPEC-001 — Auditoría y Especificación Integral de UI/UX

> **Estado del documento (2026-10-26):** `CERRADO PARCIALMENTE — LOTE 1 de 3 entregado; Lotes 2 y 3
> no se escribieron; la implementación quedó parcial`. Ver **§0 — Cierre (2026-10-26)** más abajo
> (decisión del owner: opción B — cerrar la spec con una tabla entregado/aplazado y programar el
> bloque de tokens + azul antes de FASE 22). El texto de abajo describe la fase **tal como estaba
> el 2026-09-10** y se conserva como historial.
>
> Esta fase **audita, inventaría, especifica y prioriza** los cambios de UI/UX antes de
> implementarlos. **No** implementa UI. **No** modifica API, base de datos, migraciones, auth,
> RLS, RBAC ni lógica de negocio. **No** hace commits de implementación.
>
> **Fuente de verdad de la implementación actual = el código** (`apps/web/`), no la
> documentación de diseño. La documentación de diseño (`docs/design/*`) es la referencia del
> **objetivo visual**, y buena parte de ella **no está implementada** (ver §5, §6).
>
> | | |
> | --- | --- |
> | Rama | `develop` |
> | HEAD al iniciar | `6fcfb79` |
> | Working tree | limpio |
> | Fases previas | F17 (43/43 pantallas) · F18 (10/10 bloques) · QA 5A–5S · todas cerradas, no pusheadas |
> | Herramienta de navegador / screenshots (lado del auditor) | **no disponible en este entorno** — la verificación responsive de §12 se hace por inspección de código (breakpoints Tailwind reales) + `responsive-guidelines.md` |
> | Entorno local en vivo (lado del owner) | **RESTAURADO Y CORRIENDO** (2026-09-10) — web http://localhost:3000, API :4000, Postgres efímero :55432 (`saas_inventory_dev`). Tenant `qa-tenant` con datos reales en todos los módulos. Login: `qa.admin@dev.local` / `UiuxReview2026!` (admin total) + roles supervisor/vendedor/bodega. El owner verifica visualmente cada solicitud contra este entorno. |

### Progreso por lotes

| Lote | Contenido | Estado |
| --- | --- | --- |
| **Lote 1** | §1 Objetivo · §2 Alcance · §3 Estado actual · §4 Principios UX · §5 Design system (definido vs implementado) · §6 Navegación · §7 Arquitectura visual · §8 Auditoría F17 (primera pasada) · §9 Auditoría F18 (primera pasada) · §11 OWNER UI CHANGE REQUESTS (contenedor vacío) · §12 Responsive (primera pasada) · §21 Priority matrix (parcial) · §22 Dependencies · §23 Out of scope · **decisiones DECISION-LANG / DECISION-NAV-RAIL / DECISION-PRIMARY resueltas** | **ESTE DOCUMENTO** |
| Lote 2 | §13 Components · §14 Forms · §15 Tables · §16 Dashboard/report (+ `DECISION-CHARTS` por reporte) · §17 Loading/empty/error · §18 Accessibility · §10 Hallazgos 5A–5S (detalle) + incorporación de las OWNER UI CHANGE REQUESTS que el owner entregue | pendiente |
| Lote 3 | §19 Page-by-page · §20 Critical flows · §24 Acceptance criteria · §25 Implementation roadmap · §19-matriz maestra completa · Reporte final (Parte 24) · Auditoría final (Parte 23) | pendiente |

### §0 — Cierre (2026-10-26) · decisión del owner: opción B

El owner declaró terminado el rediseño de UI. Verificado contra el código el 2026-10-26 (HEAD
`2215f5d`), **no** todo lo aprobado en esta spec se entregó. Esta tabla cierra la spec sin
declarar completo lo que no lo está:

| Decisión / entregable de la spec | Estado verificado | Resolución |
| --- | --- | --- |
| `DECISION-LANG` — UI en español | **Entregado** (login, shell y pantallas en español) | Cerrado |
| `DECISION-NAV-RAIL` — rail compacto (68 px, hover/`:focus-within` → 232 px, panel tablet + pin, drawer móvil) | **Parcial**: rail de 64 px que se expande con hover a 256 px; sin tratamiento tablet/pin; `:focus-within` no verificado; no usa `--nav-bg = primary` | Entregado parcial; resto **aplazado** al bloque de tokens |
| `DECISION-PRIMARY` — azul `#2F6FED` y estados | **No entregado** (cero coincidencias en `apps/web`) | **Aplazado** al bloque de tokens |
| `DS-01/02` — tokens `:root` + mapeo Tailwind | **No entregado** (`globals.css` sin variables; `tailwind.config.ts` con `extend` vacío) | **Aplazado** al bloque de tokens |
| Componentes DS sin construir (Tabs, SegmentedControl, Stepper, Wizard, Badge con icono…) | No auditado en esta pasada | **Aplazado** (reevaluar en el bloque de tokens) |
| Lote 2 (§13–§18, §10) y Lote 3 (§19, §20, §24, §25, matriz maestra) | **Nunca escritos** | **Descartados como documento**: no se escribirán; los hallazgos pendientes viven en `roadmap/pending-register.md` |
| Layouts de teléfono, barra inferior móvil (≈35 commits, 2026-10-22…26) | **Entregado**, **no** estaba en la spec (surgió de las solicitudes del owner) | Registrado como entregado |
| `5S-UI-05` — interacciones reales / regresión visual | **Nunca ejecutada** | Pasa a FASE 23 (`QA-VISUAL-REGRESSION`) |
| `PROP-01…PROP-04` (propuestas del auditor) | Sin decisión del owner registrada | **Abiertas** |

**Bloque programado (no iniciado):** *UI tokens + azul primario* — variables `:root`, mapeo Tailwind,
`#2F6FED`, navegación sobre `--nav-bg`, retirar los colores hard-codeados. Riesgo bajo (no toca
lógica). Se ejecuta **antes de FASE 22** (la demo es visual) y **después de FASE 19**. Hasta
entonces esta spec NO debe leerse como "UI terminada".

---

## 1. Objetivo

Producir la especificación oficial de UI/UX que guiará la implementación posterior. Al cerrar
esta fase debemos poder revisar juntos:

> "Esta es la interfaz actual, estas son todas las correcciones que el owner quiere, estas son
> las inconsistencias detectadas, estas son las propuestas adicionales, y esta es exactamente
> la interfaz que vamos a implementar."

La implementación de UI/UX **no empieza** hasta que esa especificación esté aprobada.

Objetivos concretos:

1. Inventariar qué existe hoy en `apps/web` (rutas, layouts, componentes, estados).
2. Contrastar la implementación con el design system definido (`docs/design/*`) y registrar cada
   brecha.
3. Auditar F17 (módulos operativos) y F18 (reportes) pantalla por pantalla.
4. Incorporar los hallazgos con impacto UI/UX de la campaña QA 5A–5S.
5. Abrir un apartado formal para las correcciones del owner (`OWNER UI CHANGE REQUESTS`).
6. Especificar responsive, estados, accesibilidad, formularios, tablas y navegación como
   patrones reutilizables.
7. Priorizar todo (P0–P3) y separar limpiamente UI / backend / seguridad / producto /
   infraestructura.
8. Proponer una secuencia de implementación.

---

## 2. Alcance

### En alcance

- `apps/web/**` completo: App Router, layouts, páginas, componentes compartidos y por módulo,
  shell, navegación, estados, tokens/estilos, tipografía, spacing, color, iconografía.
- Las tres áreas de ruta: `(public)`, `(tenant)`, `(superadmin)`.
- Contraste contra: `docs/design/frontend-visual-system.md`, `docs/design/frontend-screen-specs.md`,
  `docs/design/responsive-guidelines.md`, `docs/architecture/frontend/*`, hallazgos 5A–5S.
- Representación visual de los datos de F18 (no la API de F18).

### Fuera de alcance (§23 lo detalla)

- Cualquier cambio de API, DB, migración, auth, RLS, RBAC, lógica de negocio, permisos, roles,
  reglas de inventario, reportes nuevos, integraciones.
- Funcionalidad nueva de negocio. Si una mejora de UX necesita backend inexistente → se registra
  como **dependencia**, no se implementa (ej. `GAP-NOTIF-RETRY-BACKEND`).
- F19 (Security Hardening): esta fase **no** es F19 y no se mezcla con ella.
- Implementación de la UI: se hace después, en fases `UI-UX-IMPLEMENTATION-*`.
- Modo oscuro: `frontend-visual-system.md §3.4` lo deja explícitamente como FUTURO; esta fase solo
  registra si el mapa de tokens está preparado.

---

## 3. Estado actual

### 3.1 Stack

| Pieza | Valor |
| --- | --- |
| Framework | Next.js `^15.1` (App Router), React `^19` |
| Estilos | Tailwind CSS `^3.4.17` |
| Config Tailwind | `apps/web/tailwind.config.ts` — **`theme.extend` vacío**, sin plugins |
| CSS global | `apps/web/src/app/globals.css` — **solo las 3 directivas `@tailwind`**, sin `:root`, sin custom properties |
| Componentes UI | `apps/web/src/components/ui/` — el set de primitivas de FASE 16 (16 archivos) |
| Shell | `apps/web/src/components/shell/` — `ShellLayout` + `AppShell` (tenant) + `PlatformShell` (superadmin) |
| Registro de navegación | `apps/web/src/lib/navigation.ts` (tenant) + `apps/web/src/lib/platform-navigation.ts` |
| Iconos | `apps/web/src/components/shell/nav-icon.tsx` — SVGs inline, tree-shakeable (solo para navegación) |
| Idioma de la UI | **Inglés** en todo el frontend implementado (labels, botones, mensajes, títulos) |
| Dependencias runtime | `next`, `react`, `react-dom` **únicamente** — sin librería de componentes, sin librería de iconos, sin librería de animación |

### 3.2 Números

- **~52 rutas** bajo `(tenant)` + `(superadmin)` + `(public)` (inventario completo en §19; matriz base más abajo).
- **43/43 pantallas F17** entregadas (F17-01…F17-14).
- **10/10 bloques F18** entregados; las secciones de reporte se renderizan **embebidas** en
  `/sales`, `/inventory`, `/inventory/movements`, `/inventory/transfers`, `/returns`, `/approvals`,
  `/imports` y en la home `/` — **no existe** un hub `/reports` (decisión existente, no defecto).
- **16 componentes** en `components/ui/` + shell.
- Tests unit web ≈ 442 (post-5S).

### 3.3 Lo que funciona bien (base sólida heredada de FASE 16)

- Separación de estados **loading / error / empty** con primitivas dedicadas (`loading.tsx`
  skeleton, `error.tsx` → `<ErrorState>` con `correlationId` + retry, `<EmptyState>`,
  `<NoAccess>`).
- `apiFetch` centralizado, `ApiError` normalizado, refresh 401 single-flight, CSRF en mutaciones.
- Navegación filtrada por permisos **en el servidor** (`filterNavigation` en el layout `(tenant)`),
  con el backend como autoridad real (403 se maneja como error normal, nunca redirect).
- `Field` cablea `label` + `hint` + `error id` + `aria-invalid` + `aria-describedby` de forma
  consistente.
- Un `PageContainer` + `PageHeader` compartidos: las páginas no definen sus propios márgenes.
- Botones y enlaces son `<button>` / `<a>` reales (nunca divs clicables); `ButtonLink` para
  navegación.
- Casi todas las rutas exportan `metadata.title` (excepciones en §10 / §3.4).
- Superadmin es un contexto **estructuralmente separado** (`(superadmin)/`, sesión de plataforma,
  shell propio) — correcto por `f17-navigation.md`.

### 3.4 Lo que está mal / incompleto (resumen — el detalle está en §5–§12)

| # | Hallazgo | Severidad propuesta | Sección |
| --- | --- | --- | --- |
| A | **El sistema de tokens de diseño NO existe en el código.** `globals.css` no define ninguna custom property; `tailwind.config.ts` no mapea ningún token. Todo el color/spacing/radio/sombra está hard-codeado con utilidades Tailwind por defecto (`slate-*`, `red-*`, etc.). | P1 (fundacional) | §5 |
| B | **No hay color de acento (`primary` azul).** El design system define un único acento `#2F6FED`. La implementación es escala de grises + rojo/verde/ámbar semántico. El botón `primary` es `bg-slate-900` (casi negro). El focus ring es `outline-slate-900`. | P1 | §5 |
| C | **La navegación no usa la superficie `primary`.** `frontend-visual-system.md §3.2/§6.0` exige `--nav-bg = var(--primary)` propagado a rail + panel tablet + drawer. La sidebar implementada es blanca (`bg-white`), ítem activo `bg-slate-900 text-white`. | P1 | §6 |
| D | **No existe el rail de iconos compacto** (la "distinctive feature" de `§6.1`). La sidebar es una columna fija de `16rem` (256 px) con labels siempre visibles. Sin colapso a 68 px, sin expansión hover/focus a 232 px, sin estado activo con barra blanca de 3 px. Ya señalado como brecha estable en F17-AUDIT-01. | P1 | §6 |
| E | **No hay tratamiento de tablet.** El shell salta directo de drawer móvil a sidebar completa en `lg:` (1024 px). El rango 768–1024 recibe el drawer móvil. `§6.4` pide rail permanente de 68 px + pin toggle. | P2 | §6, §12 |
| F | **La UI está en inglés; toda la documentación de diseño, specs y comunicación del owner está en español.** Decisión de producto pendiente + inconsistencia. | P1 (decisión) | §4, DECISION-LANG |
| G | **Componentes del design system sin construir:** Dialog/Modal, Drawer, Tabs, SegmentedControl, Stepper, TableToolbar, FilterChip, IconButton, Wizard/step rail, Badge con icono. Las confirmaciones destructivas son paneles inline, no modales. | P1/P2 | §7, §13 |
| H | **Patrones re-implementados a mano por página** en vez de componentes: los "filter chips" (`rounded-full border ...`) están copiados literalmente en `/products`, `/inventory`, etc.; el error de reporte (`SalesReportError`, `InventoryReportError`, `ReturnsReportError`, …) está duplicado ~7 veces; `/users` usa un `<table>` crudo en lugar del componente `Table`. | P2 | §7, §9, §13 |
| I | **Tablas sin responsive.** No hay transformación tabla→tarjeta en ningún sitio; el único mecanismo es `overflow-x-auto` en el contenedor. `/inventory` (8 columnas), `/locations`, `/sales` desbordan a 390 px (ya documentado en CLAUDE.md, F18-03). | P2 | §12, §15 |
| J | **Tipografía fuera de escala.** `PageHeader` h1 = `text-xl` (20 px) `font-semibold` (600). El design system define Display = 28/34/700. Sin ramp de tipos, sin `tabular-nums` fuera de las tiles de KPI. | P2 | §5, §7 |
| K | **`/users`, `/users/[id]`, `/users/new` sin `metadata.title`** (hallazgo 5S). Separador de título `·` (el ejemplo de la Parte 10 usa `|`). Títulos en inglés. | P3 | §10 |
| L | **Sin breadcrumbs** en ninguna pantalla, incluidas jerarquías profundas (`/products/[id]/variants/[variantId]`). | P3 | §6 |
| M | **Skeletons genéricos.** `loading.tsx` de `(tenant)` es un bloque título+línea+caja para todas las pantallas; los screen specs piden skeleton con forma de tabla en listados. | P3 | §17 |
| N | **`New Sale` no es la pantalla prioritaria del spec.** Es una secuencia de cards apiladas con `<select>` producto→variante, inputs numéricos planos, radios; sin panel-resumen sticky, sin búsqueda instantánea, sin steppers, sin segmented control. | P2 | §8, §19 |
| O | **Fechas renderizadas en locale del navegador** (`new Date(x).toLocaleString()`) en el detalle de orden y otras vistas — no en la timezone del tenant (`session.timezone` ya está disponible desde F18-01). | P2 | §8 |

---

## 4. Principios UX

Se **ratifican** los principios de `frontend-visual-system.md §1` como objetivo (no están todos
implementados; §5 mide la brecha):

1. **Claridad** — un título de página, números tabulares para dinero/cantidades, la acción
   primaria identificable por color + posición.
2. **Deferencia** — gris neutro, un acento, sin ornamento; las tablas son el sujeto.
3. **Profundidad** — dos sombras en total; separación por borde/fondo primero.
4. **Consistencia** — un registro de navegación, los mismos badges semánticos en cada módulo, el
   mismo control para la misma acción en todas partes.
5. **Feedback** — cada control con hover / pressed / focus / disabled / loading; los estados
   combinan color + icono + texto, **nunca solo color**.
6. **Manipulación directa** — steppers, edición de precio inline, resultados de búsqueda
   instantáneos.
7. **Divulgación progresiva** — lo esencial primero; el detalle en tap de fila, drawer o
   expansión del rail.
8. **Táctil** — objetivos ≥ 44×44 en tablet/móvil.

### Decisiones de principio — RESUELTAS por el owner (2026-09-10)

| ID | Decisión | Resolución del owner | Consecuencia |
| --- | --- | --- | --- |
| `DECISION-LANG` | Idioma de la UI | **Español.** La UI se alinea con la documentación. El código actual permite reemplazo de strings; sin i18n para el MVP. | Todo el frontend (labels, botones, mensajes, `metadata.title`, empty/error copy) se traduce a español en `UI-UX-IMPLEMENTATION-*`. `PT-6` pasa a acción confirmada. |
| `DECISION-NAV-RAIL` | ¿Construir el rail compacto de `§6.1`? | **Sí — construir el rail compacto** (68 px iconos, hover/`:focus-within` → 232 px overlay, panel tablet permanente + pin, drawer móvil), todo sobre `--nav-bg = primary`. | `NAV-01..NAV-06` pasan de `DECISION REQUIRED` a `APPROVED`. `UI-UX-IMPLEMENTATION-02` implementa el rail completo. |
| `DECISION-PRIMARY` | ¿Adoptar el acento azul `#2F6FED`? | **Sí — adoptar el azul** `#2F6FED` + `primaryHover`/`primaryPressed`/`primarySubtle` + focus ring azul + navegación activa + tono `info`. | `DS-03`, `DS-05` pasan a `APPROVED`. Se aplica en `UI-UX-IMPLEMENTATION-01` junto con los tokens. |
| `DECISION-CHARTS` | ¿Visualización gráfica en F18? | **Decidir por reporte en Lote 2** — el auditor evalúa caso por caso en §16 y propone dónde aporta valor (solo-CSS, sin librería). | `F18-09` queda `DECISION REQUIRED` hasta §16 (Lote 2). |

---

## 5. Design System — Definido vs Implementado

> **Hallazgo central de esta fase.** El design system está bien documentado
> (`frontend-visual-system.md`) pero **su capa de tokens no está implementada**. Cada valor visual
> hoy es una utilidad Tailwind por defecto hard-codeada en un componente o página.

### 5.1 Arquitectura de tokens

| Elemento | Especificación (`§2`) | Actual | Gap | Acción propuesta |
| --- | --- | --- | --- | --- |
| Custom properties `:root` | Set completo: `--color-*`, `--nav-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--font-sans` | **Ninguna** en `globals.css` | Total | `UI-UX-IMPLEMENTATION-01`: definir el bloque `:root` completo con los valores de `§3`–`§5` |
| Mapeo Tailwind | `theme.extend.colors.primary = 'var(--color-primary)'`, etc. | `theme.extend` vacío | Total | `UI-UX-IMPLEMENTATION-01`: mapear tokens → theme para que `bg-primary` y `var(--color-*)` resuelvan a la misma fuente |
| Modo oscuro | Preparado como mapa de tokens (`:root[data-theme="dark"]`), no como feature | No preparado (no hay tokens) | Total (pero es FUTURO) | Registrar; el bloque dark se añade junto al bloque light en `UI-UX-IMPLEMENTATION-01` como mapa, sin switcher |
| "Ninguna página funcional hard-codea un color/radio/spacing" | Regla del `§2` | **Violada en todas partes** | — | El objetivo de `UI-UX-IMPLEMENTATION-01..04` es eliminar los hard-codes |

### 5.2 Color

| Token | Especificación (`§3.1`–`§3.3`) | Actual en el código | Gap |
| --- | --- | --- | --- |
| `background` | `#F6F7F9` | `bg-slate-50` (`#F8FAFC`) en `body` y shell | Aproximado, sin token |
| `surface` | `#FFFFFF` | `bg-white` literal | Sin token |
| `surfaceSubtle` | `#F1F3F5` (input fill, header de tabla, hover) | `bg-slate-50` en headers de tabla; inputs son `bg-white` | Divergente |
| `border` | `#E3E6EA` | `border-slate-200` / `border-slate-300` mezclados | Sin token, inconsistente entre 200 y 300 |
| `text` / `textSecondary` / `textMuted` | `#1A1D21` / `#5B6470` / `#8A929E` | `text-slate-900` / `text-slate-500` / `text-slate-400` | Aproximado, sin token |
| **`primary` (acento único)** | `#2F6FED` + `primaryHover` `#2A63D4` + `primaryPressed` `#2557BC` + `primarySubtle` `#EAF1FE` | **No existe.** Botón primario = `bg-slate-900`; no hay uso de azul en ningún componente | **Total — hallazgo B** |
| `focus` | `#2F6FED`, outline 2 px, offset 2 px | `outline-slate-900` en todos los controles | Divergente (color) |
| `success` / `warning` / `danger` | fg+bg definidos (`#1E874B`/`#E5F4EC`, etc.) | `green-100/800`, `amber-100/800`, `red-100/700` (Tailwind) | Aproximado, sin token |
| **`info`** (= familia primary, para "Pendiente/Despachada/En preparación") | 4º tono semántico | **No existe** — `Badge` solo tiene `neutral/success/warning/danger` | Falta el tono `info` |
| Color por módulo | **Prohibido** ("no Productos = azul") | Cumplido (no hay color por módulo) | OK ✓ |

### 5.3 Tipografía

| Rol | Especificación (`§4`) | Actual | Gap |
| --- | --- | --- | --- |
| `--font-sans` | stack sistema (`-apple-system, …`) sin webfont | Sin token; se usa el default de Tailwind (stack similar) | Menor — sin token, resultado parecido |
| Display / título de página | 28 / 34, peso 700, `letter-spacing -0.02em` | `PageHeader` h1 = `text-xl` (20/28), peso 600, sin tracking | **Divergente — hallazgo J** |
| Section title | 17 / 24, peso 600 | `text-sm font-semibold` (14) para los `<h2>` de card | Divergente (más pequeño) |
| Body | 14 / 20 | 14 (`text-sm`) | OK ✓ |
| Caption / overline | 11 / 14, `0.06em`, uppercase, muted | Headers de tabla: `text-xs uppercase tracking-wide text-slate-500` | Cercano ✓ |
| Numeric (KPI) | 26, peso 700, `tabular-nums`, `-0.01em` | Tiles de reporte: `text-2xl font-semibold tabular-nums` (≈24) | Cercano ✓ |
| `tabular-nums` en dinero/cantidades de tabla | Sí | **No** — solo en las tiles de KPI; las celdas numéricas de tabla no lo usan | Gap |
| Bump móvil de body a 15 / 22 | Sí | No | Gap |

### 5.4 Spacing / radius / sombras

| Elemento | Especificación (`§5`) | Actual | Gap |
| --- | --- | --- | --- |
| Escala de spacing | base 4: `xs4 sm8 md12 lg16 xl24 2xl32 3xl48` | Utilidades Tailwind por defecto (que son base 4) sin tokens con nombre | Menor — escala compatible, sin tokens |
| Padding de contenido | 24 desktop / 20 tablet / 16 móvil (`responsive-guidelines §7`) | `main` = `px-4 py-6 sm:px-6 lg:px-8` (16/24/32) | Divergente en desktop (32 vs 24) y sin escalón tablet |
| Radius | `sm 6` (inputs/botones) · `md 10` (cards) · `lg 14` (drawers/sheets) · `full` (pills) | `rounded-md` (6, botones/inputs) · `rounded-lg` (8, cards) · `rounded-full` (pills) | Cards a 8 en vez de 10; sin `lg`/drawers |
| Sombras | **dos**: `shadow-sm` y `shadow-md` (valores exactos definidos) | Cards sin sombra (solo borde — permitido); drawer usa `shadow-xl` (default Tailwind), no el `shadow-md` definido | Sin tokens de sombra; drawer usa la sombra equivocada |
| Ancho de contenido | `max-width ~1180` | `PageContainer` = `max-w-5xl` (1024) | Divergente |

### 5.5 Matriz de brechas del design system (resumen accionable)

| ID | Elemento | Especificación | Actual | Acción |
| --- | --- | --- | --- | --- |
| `DS-01` | Bloque `:root` de tokens | Completo | Ausente | Crear en `UI-UX-IMPLEMENTATION-01` |
| `DS-02` | Mapeo Tailwind de tokens | Requerido | Ausente | Crear en `UI-UX-IMPLEMENTATION-01` |
| `DS-03` | Acento `primary` azul | `#2F6FED` + estados | Ausente (`slate-900`) | **APROBADO** (`DECISION-PRIMARY`) — aplicar en `IMPLEMENTATION-01` |
| `DS-04` | Tono semántico `info` | 4º tono | Ausente | Añadir a `Badge`/`Alert` (incluido con `DS-03`) |
| `DS-05` | Focus ring azul | `--color-focus` | `slate-900` | **APROBADO** — aplicar tras `DS-01` |
| `DS-06` | Ramp tipográfico (Display 28/700, Section 17/600) | Definido | h1 a 20/600 | Aplicar en `PageHeader` + tokens de tipo |
| `DS-07` | `tabular-nums` en celdas numéricas de tabla | Sí | Solo en KPI tiles | Aplicar en `Table`/`TD` numérico |
| `DS-08` | Radius de card a 10 | `md 10` | 8 | Token `--radius-md` |
| `DS-09` | Tokens de sombra + sombra correcta en drawer | 2 sombras | `shadow-xl` default | Token `--shadow-md`, aplicar |
| `DS-10` | Ancho de contenido ~1180 | Sí | 1024 | `PageContainer` `max-w` |
| `DS-11` | Padding de contenido 24/20/16 | Sí | 16/24/32 | `main` padding |
| `DS-12` | Bump móvil de tipografía de body | 15/22 | No | Media query / token |

---

## 6. Navegación

### 6.1 Modelo actual (código)

- **Registro único** `apps/web/src/lib/navigation.ts` — `NAVIGATION: NavSection[]`, filtrado por
  permisos en el layout servidor. `SidebarNav` decide el ítem activo con `isNavItemActive`
  (regla de href-hermano para rutas anidadas). Correcto en concepto ✓.
- **Shell** `ShellLayout`:
  - Desktop (`lg:` ≥ 1024 px): grid `[16rem_1fr]`, `<aside>` blanco fijo con brand (texto
    "SaaS Inventory") + `<nav>` con labels siempre visibles.
  - Móvil/tablet (< 1024 px): `<aside>` oculto; botón hamburguesa en el header abre un drawer
    (`w-72 max-w-[80%]`, `bg-white`, `shadow-xl`). Cierra con Esc, overlay, cambio de ruta.
    Bloqueo de scroll del body. `role="dialog" aria-modal="true"`.
  - Header: 56 px (`h-14`), `sticky top-0`, borde inferior, botón menú (solo `lg:hidden`) +
    slot izquierdo (nombre del tenant, `hidden sm:block`) + slot derecho (`UserMenu`).
- **Grupos actuales** (`navigation.ts`):
  `Dashboard` · **Catalog** {Products, Categories, Attributes, QR codes, Imports} ·
  **Inventory** {Stock on hand, Movements, Transfers, Warehouses, Locations} ·
  **Sales** {New sale, Sales history, Customers, Approvals, Returns} ·
  **Administration** {Users, Roles, Company settings}.
- **Superadmin**: `PlatformShell` (mismo `ShellLayout`), navegación propia `PLATFORM_NAVIGATION`
  {Home, Companies}, brand con chip "Platform". Correcto que sea separado ✓.

### 6.2 Brechas vs `frontend-visual-system.md §6` y `responsive-guidelines.md §1`

| ID | Aspecto | Especificación | Actual | Severidad |
| --- | --- | --- | --- | --- |
| `NAV-01` | Superficie de navegación | `--nav-bg = primary` (rail + panel tablet + drawer), tokens `--nav-*` | Blanca (`bg-white`), activo `bg-slate-900` | P1 — hallazgo C |
| `NAV-02` | Rail compacto desktop | 68 px iconos, expansión hover/`:focus-within` → 232 px overlay, 160 ms, auto-colapso, sin layout shift | Columna fija 256 px con labels; sin colapso | P1 — hallazgo D |
| `NAV-03` | Estado activo colapsado | Superficie `nav.active` + barra blanca de 3 px + icono blanco | `bg-slate-900 text-white` (relleno completo negro) | P1 |
| `NAV-04` | Tablet | Rail permanente 68 px + pin toggle → panel 232 px con scrim | Recibe el drawer móvil | P2 — hallazgo E |
| `NAV-05` | Drawer móvil | 284 px, `--nav-bg` primary, `env(safe-area-inset-bottom)`, focus trap, retorno de foco al trigger | 288 px (`w-72`), blanco, sin safe-area, **sin focus trap** (solo Esc/overlay/route-change) | P2 |
| `NAV-06` | Logo | Chip claro + "S" en primary, invierte sobre primary | Texto plano "SaaS Inventory" | P3 |
| `NAV-07` | Agrupación | `Catálogo`: Productos, Categorías, Importación · `Inventario`: …, **QR** · (Atributos/Roles como sub-tabs opcionales) | QR bajo Catalog; Attributes y Roles como ítems top-level de su grupo | P3 — decisión menor |
| `NAV-08` | Breadcrumbs | Mencionados en la Parte 1 del prompt como elemento a auditar | **No existen** en ninguna pantalla | P3 — decisión (¿se quieren?) |
| `NAV-09` | `prefers-reduced-motion` en transición del rail | Requerido | N/A (no hay rail) — pero el drawer tampoco lo respeta | P3 |
| `NAV-10` | Iconos | set de trazo único, `stroke-width` 1.75, grid 24 | `nav-icon.tsx` SVGs inline; hay que verificar consistencia de trazo (Lote 2) | P3 |
| `NAV-11` | Deriva de rutas doc↔código | `f17-navigation.md` lista `/transfers`, `/inventory/movements` | Código: `/inventory/transfers`, `/inventory/movements` (coherente entre sí); la doc está desalineada | P3 — corrección doc |

### 6.3 Decisión — RESUELTA

`DECISION-NAV-RAIL` = **construir el rail compacto** (owner, 2026-09-10). `NAV-01..NAV-06` pasan a
`APPROVED`: rail 68 px sobre `--nav-bg = primary`, expansión hover/`:focus-within` → 232 px
overlay sin layout shift, estado activo con barra blanca de 3 px, panel tablet permanente + pin,
drawer móvil 284 px con `env(safe-area-inset-bottom)` + focus trap + retorno de foco. Implementa
`UI-UX-IMPLEMENTATION-02`.

---

## 7. Arquitectura visual

### 7.1 Composición actual

```
┌────────────────────────────────────────────────────────┐
│ Header 56px  [menu(móvil)] [tenant name]      [UserMenu]│  sticky, blanco, borde inferior
├───────────────┬────────────────────────────────────────┤
│ Sidebar 256px │  main: px-4 py-6 sm:px-6 lg:px-8        │
│ (blanca,      │  ┌──────────────────────────────────┐  │
│  labels       │  │ PageContainer  max-w-5xl gap-6    │  │
│  visibles,    │  │  ┌────────────────────────────┐  │  │
│  activo negro)│  │  │ PageHeader (h1 20px + desc  │  │  │
│               │  │  │  + actions)                │  │  │
│               │  │  ├────────────────────────────┤  │  │
│               │  │  │ [filtros ad-hoc]           │  │  │
│               │  │  │ [Table | EmptyState |      │  │  │
│               │  │  │  ErrorState | Cards]       │  │  │
│               │  │  │ [Pagination]               │  │  │
│               │  │  └────────────────────────────┘  │  │
│               │  └──────────────────────────────────┘  │
└───────────────┴────────────────────────────────────────┘
```

- **Patrón de página**: `PageContainer` → `PageHeader` → contenido. Consistente ✓.
- **Patrón de listado**: `PageHeader` + fila de filtros (hecha a mano) + `Table` o `EmptyState` +
  `Pagination`. Consistente en estructura, inconsistente en implementación de los filtros.
- **Patrón de detalle**: `PageHeader` con badge de estado en `actions` + varias `Card` con `<h2>`
  pequeño + `<dl>` grid + `Table` de líneas + componente `*Actions` (cliente) para transiciones.
- **Patrón de formulario**: una `<form>` de columna única `max-w-xl`/`max-w-sm` con `Field` +
  primitivas + `Alert` de error/éxito + fila de botones. **Sin** el layout 2-columnas con aside
  sticky de `screen-specs §4` / `responsive-guidelines §3`.
- **Patrón de reporte F18**: `<section id="report">` con `<h2>` + `*ReportFilters` (cliente) +
  `*ReportSection` (tiles KPI en grid + `Table`) o `*ReportError` local — **encima** del listado
  operativo de la misma página.

### 7.2 Inventario de componentes (estado)

| Componente del design system (`§7`) | ¿Existe? | Archivo / nota |
| --- | --- | --- |
| AppShell / ShellLayout | ✓ | `components/shell/` — sin rail, sin tokens |
| PageHeader / PageContainer | ✓ | `components/ui/` — h1 fuera de escala |
| Button (`primary/secondary/ghost/danger`) | ✓ parcial | `sm 32` / `md 40`; **falta `lg 44`** (touch), **falta estado pressed** distinto, primary negro |
| ButtonLink | ✓ | — |
| IconButton (38 px cuadrado) | ✗ | no existe |
| Input / Select / Textarea | ✓ | 38→ en realidad `py-2` ≈ 38; sin variante táctil 44; sin affix prefix/suffix (moneda) |
| Field | ✓ | bien cableado |
| Checkbox / Radio (componentes) | ✗ | se usan `<input type=...>` crudos inline en cada form |
| Card / CardBody | ✓ | radius 8; sin `Section`/`Divider` |
| Alert (`info/success/warning/error`) | ✓ | sin icono, sin slot de acción |
| Badge / StatusBadge | ✓ parcial | `neutral/success/warning/danger`; **sin `info`**, **sin icono** (solo color+texto → hallazgo a11y) |
| Table + THead/TBody/TR/TH/TD | ✓ | filas ≈ 32–36 px (spec: 48/40); header no sticky; sin toggle compacto |
| TableToolbar | ✗ | filtros ad-hoc por página |
| FilterChip | ✗ | `rounded-full border ...` copiado a mano en cada listado |
| Pagination | ✓ | "Showing X–Y of N" + prev/next; sin pager numerado |
| Tabs | ✗ | los "tabs por estado" de transferencias/devoluciones/imports son chips a mano |
| SegmentedControl (Factura/Nota) | ✗ | radios en `New Sale` |
| Stepper (cantidad, pill −/valor/+) | ✗ | `<input type=number>` |
| Dropdown / menú `⋮` de fila | ✗ | acción de fila = enlace de texto en la última celda |
| Dialog / Modal | ✗ | confirmaciones destructivas = panel inline expandible |
| Drawer | ✗ | "ajuste de stock", "inspección" = secciones inline |
| Wizard / step rail (Importación 5 pasos) | ✗ (verificar en Lote 2) | `import-pipeline.tsx` |
| EmptyState / ErrorState / Skeleton / Spinner | ✓ | de FASE 16 |
| NoAccess | ✓ | 403 en sitio |
| KpiTile / KpiCard | ✓ parcial | re-declarado local en `sales-report-section`, `home-dashboard`, etc. — no compartido |
| `*ReportError` | ✗ (anti-patrón) | duplicado ~7 veces; debería ser un componente |

### 7.3 Consistencia entre módulos (primera pasada — el detalle es §13)

| Área | Inconsistencia observada |
| --- | --- |
| Tablas | `/users` usa `<table>` crudo (`px-4 py-3`, header con borde) vs. el componente `Table` (`px-3 py-2`, header `bg-slate-50`) en el resto |
| Filtros | cada listado re-implementa los chips; el activo a veces es `bg-slate-900`, la lógica de "limpiar" varía |
| Errores | `<ErrorState>` (rojo, "Try again" botón) vs `SalesReportError`/`InventoryReportError`/… (rojo, "Try again" enlace `#report`) vs `<NoAccess>` (gris) vs `<Alert tone="error">` inline en forms |
| Confirmación destructiva | `/returns` panel `bg-slate-50` para resolve + panel `bg-red-50` para cancel; sin patrón de modal centralizado |
| Botón "atrás/cancelar" | a veces `ButtonLink`, a veces `Button variant="ghost" onClick={router.push}` |
| CTA que parece botón | `new-sale.tsx` usa `<Link className="bg-slate-900 ...">` en vez de `ButtonLink` |
| Títulos de sección | `<h2 className="text-sm font-semibold">` en unas, `text-sm font-semibold text-slate-900` en otras, tamaños distintos en reportes |
| Fechas | `toLocaleString()` (navegador) en order detail; otras vistas usan helpers de tenant-tz |

---

## 8. Auditoría F17 (primera pasada)

> Metodología: lectura del código de cada módulo (páginas server + componentes cliente) contra
> `frontend-screen-specs.md`, `f17-screen-catalog.md`, `f17-gaps.md`. Esta pasada identifica los
> hallazgos de UI/UX estructurales por módulo; la especificación pantalla-por-pantalla con
> criterios de aceptación es §19 (Lote 3).

**Patrones transversales F17** (aplican a casi todos los módulos, no se repiten abajo):

- `PT-1` Sin responsive real: tablas con `overflow-x-auto`, sin tabla→tarjeta, sin layout tablet.
- `PT-2` Filtros re-implementados a mano (no `TableToolbar`/`FilterChip`).
- `PT-3` Acción de fila = enlace de texto (`Edit`/`View`/`Detail`), no menú `⋮`.
- `PT-4` Formularios de columna única, sin aside sticky, sin "guardar y crear otro", sin bottom
  bar sticky móvil.
- `PT-5` Confirmaciones destructivas inline, no modal.
- `PT-6` Idioma inglés.
- `PT-7` Sin breadcrumbs.
- `PT-8` `EmptyState` presente y correcto; `loading.tsx` genérico (no con forma de la pantalla).
- `PT-9` Badges sin icono (solo color + texto).

### 8.1 Navegación / Shell

Ver §6. Hallazgos `NAV-01..NAV-11`. Adicional: el header no muestra el título de la pantalla en
móvil (`responsive-guidelines §6` lo pide: "menu button · screen title · account avatar").

### 8.2 Catálogo — Productos / Variantes / Categorías / Atributos

| ID | Pantalla | Hallazgo | Sev. |
| --- | --- | --- | --- |
| `F17-CAT-01` | Products list | Columnas: Name / Category / **Warranty** / Status / (acción). El spec pide thumb + variant count + SKU + Precio base + Stock; nada de eso está en el contrato (`GAP-NAME-ENRICHMENT`, `GAP-VARIANT-LIST`, sin precio/stock en el endpoint). La tabla actual es honesta con el contrato pero pobre en información. | P2 (mayormente dependencia backend) |
| `F17-CAT-02` | Products list | Sin búsqueda (`GAP-SEARCH`), sin orden (`GAP-SORT`) — correcto no inventarlo; registrar como dependencia. | P2 dep. |
| `F17-CAT-03` | Product form | Columna única `max-w-xl`; sin las 5 secciones-card del spec (General / Clasificación / Precios / Atributos / Adicional), sin aside sticky de publicación, sin dropzone de imagen, sin "Guardar y crear otro". | P2 |
| `F17-CAT-04` | Product form | Marca / proveedor **omitidos** (`GAP-BRAND-SUPPLIER-LIST`, opción b) — decisión ya tomada; re-registrar como dependencia. | — |
| `F17-CAT-05` | Product form | Checkboxes "Serialized" / "Lot tracked" son `<input>` crudos; atributos dinámicos ✓ (bien resuelto por F17-03). | P3 |
| `F17-CAT-06` | Categories / Attributes | Editores de set (`PUT`) funcionales; verificar en Lote 3 el patrón de edición (¿inline? ¿modal?). | P3 |

### 8.3 Inventario — Existencias / Movimientos / Transferencias / Almacenes / Ubicaciones

| ID | Pantalla | Hallazgo | Sev. |
| --- | --- | --- | --- |
| `F17-INV-01` | Stock on hand | Tabla de **8 columnas** (Variant / Location / Warehouse / Available / Reserved / Committed / Physical / acción) — **desborda horizontalmente a 390 px** (documentado en CLAUDE.md F18-03). Necesita tabla→tarjeta móvil con "Available" prominente + disclosure. | P2 |
| `F17-INV-02` | Stock on hand | El variante se muestra como `shortId` (`<code>`) porque no hay lista tenant-wide de variantes (`GAP-VARIANT-LIST`); nombre solo en el drill-in del producto. Dependencia backend. | P2 dep. |
| `F17-INV-03` | Stock on hand | La **sección de reporte F18-03** se renderiza **encima** del listado, con su propio `#report`, filtros cliente y `InventoryReportError`. Mezcla "reporte" y "operación" en una sola página larga (decisión F18, no defecto — pero la jerarquía visual necesita revisión en §16). | P2 |
| `F17-INV-04` | Movimientos | Filtro de fecha `occurredFrom/occurredTo` (F18-03) + filtro de reporte separado. Sin orden por columna, sin filtro por referencia (`GAP-MOVEMENTS-DATE-FILTER` parcialmente resuelto). | P2 dep. |
| `F17-INV-05` | Transferencias | "Tabs por estado" = chips a mano (un valor a la vez, `GAP-MULTI-STATUS`). Código de transferencia = `shortId` (`GAP-TRANSFER-CODE`). Ruta del transfer (origen→destino) y timeline del ciclo de vida: verificar render en Lote 3. | P2 |
| `F17-INV-06` | Transferencias detalle | Acción contextual por estado (approve/prepare/dispatch/receive/cancel) ✓ mapeada 1:1. `receive` requiere `Idempotency-Key` (manejado). Sin visualización clara de **stock en tránsito** (el owner pidió ver TRANSFER OUT → EN TRÁNSITO → TRANSFER IN). | P2 |
| `F17-INV-07` | Almacenes / Ubicaciones | CRUD simple; tablas anchas (`/locations` desborda a móvil, doc F18-03). | P2 |

**Bloque Inventario/Kardex — RESUELTO (2026-09-23).** Implementado (no solo especificado) tras
rondas iterativas de revisión visual directa del owner contra el entorno local:
- `F17-INV-01`/`F17-INV-03`: `/inventory` ("Stock on hand" → **Inventario**, `GL-2`) reemplazado
  por completo — ya no carga el listado plano de existencias ni el bloque de reporte F18-03 encima;
  ahora es un flujo búsqueda → fechas → producto/variante (o "Ver todos") → **Kardex** (Fecha del
  movimiento · Movimiento · Entrada · Costo U · Salida · Costo K · Stock · V.Total) → Stock por
  sucursal, sin cargar catálogo ni historial completo al entrar (§1/§22). Costeo por promedio
  ponderado, calculado en lectura, nunca almacenado — `ADR-0037`. Exportación a Excel/PDF con
  iconos junto al título de la tabla.
- `F17-INV-02`: variante ahora resuelta a nombre de producto + SKU en el Kardex (`getVariantDisplayInfo`)
  en vez de `shortId` — cerrado dentro de este bloque, sin depender de un listado tenant-wide de
  variantes.
- `F17-INV-04`: `/inventory/movements` ("Historial de movimientos") rediseñado — los chips de
  almacén/tipo se agruparon en dos `<select>` a la misma altura que el filtro de fechas; formato de
  tabla igualado al del Kardex (encabezado oscuro, bordes horizontales); columna "Actor" → **"Usuario"**
  con el nombre resuelto (`GET /users`, gateado en `core.users.read`); "Motivo" muestra el número real
  de la orden en ventas (`Venta #ORD-000123`) y un identificador corto de transferencia (no hay número
  secuencial de transferencia en el esquema — `GAP-TRANSFER-CODE` sigue abierto, ver `F17-INV-05`); el
  bloque de reporte F18-07 (KPIs Período/Movimientos/Cantidad neta) se eliminó de esta pantalla por
  pedido del owner.
- `F17-INV-05`/`GAP-TRANSFER-CODE`: **no tocado** en este bloque — sigue sin número secuencial de
  transferencia; el identificador corto usado en Motivo es el mismo formato ya usado en el Kardex, no
  una solución nueva.
- Verificado: `apps/web` 647/647 tests, `apps/api` 644/644 tests, `tsc`/`eslint` limpios en ambos,
  confirmado en vivo en `localhost:3000` en cada ronda de cambios. Sin commit de implementación hasta
  la aprobación explícita del owner (cumplido — ver historial de commits `feat(inventory)`).

### 8.4 QR

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-QR-01` | Muestra el token `code` opaco pero **no renderiza bitmap QR ni enlace imprimible** (`GAP-QR-PRINT` — el resolver público `/q/:code` no está bajo `/api/v1`, no lo proxya el rewrite de Next; sin librería de imagen QR). El owner pidió "Crear QR → imprimir/visualizar → escanear". Dependencia (proxy o endpoint backend) + librería cliente. | P2 dep. |

### 8.5 Importación

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-IMP-01` | Pipeline por pasos; el mapeo se pide **por adelantado** (template guardado o layout estándar) porque no hay endpoint de headers del archivo (`GAP-IMPORT-FILE-HEADERS`). | P2 dep. |
| `F17-IMP-02` | **Sin barra de progreso / porcentaje** (`GAP-IMPORT-PROGRESS` — no hay `processedRows`/progreso en el contrato). Auto-refresh ~4 s + botón manual. El owner pidió "subir → procesar → revisar resultados". El estado + contadores están; el progreso no. | P2 dep. |
| `F17-IMP-03` | Verificar en Lote 2 si el "step rail" visual (done ✓ / current / pending) existe o es texto "Paso 3 de 5". | P3 |

### 8.6 Clientes

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-CUST-01` | Búsqueda `?q=` real ✓ (único listado con search server-side). CRUD simple. Customer detail muestra el listado de órdenes del cliente (`GET /orders?customerId=`), sin rollup/LTV (`GAP-CUSTOMER-HISTORY`, F18). | P3 |

### 8.7 Ventas — Nueva venta / Historial / Detalle de orden

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-SALE-01` | **New Sale no es la pantalla prioritaria del spec.** Flujo real: "Start sale" (elegir ubicación) → card cliente (panel de búsqueda que se despliega) → card líneas (tabla + form de alta con `<select>` producto → `<select>` variante → `<input>` qty → `<input>` precio) → card "Create order" (radios de tipo de documento) → estado de éxito. **Falta:** panel-resumen sticky, búsqueda instantánea con dropdown (↑/↓/Enter), steppers de cantidad, `SegmentedControl`, edición de precio inline como chip, layout 2-paneles desktop, bottom bar sticky móvil/tablet. | P2 — hallazgo N |
| `F17-SALE-02` | New Sale: CTA "Create order" es `<Button>` pero "View order" en el éxito es `<Link className="bg-slate-900 ...">` (bypassa `ButtonLink`). Copy: "Create order" (spec: "Confirmar orden"). | P3 |
| `F17-SALE-03` | New Sale: la búsqueda de variante es Product→Variant en dos `<select>` (workaround de `GAP-VARIANT-LIST`) — clunky pero honesto. Dependencia backend `GET /variants?q=`. | P2 dep. |
| `F17-SALE-04` | Sales history: filtros de contrato (status / documentType / customerId / rango fechas); sin KPIs (correcto, son F18/PROTOTYPE); el rango de fechas envía límites UTC crudos con hint "UTC day start/end" (no tenant-tz — `GAP-DATE-SEMANTICS`). | P2 dep. |
| `F17-SALE-05` | Order detail: fechas con `new Date(order.createdAt).toLocaleString()` — **locale del navegador, no tenant-tz** (hallazgo O). `session.timezone` disponible desde F18-01. | P2 |
| `F17-SALE-06` | Order detail: card de "Notification" (F17-10) con badge de estado + lista de eventos; la retry no existe (`GAP-NOTIF-RETRY-BACKEND`) y se explica honestamente. ✓ | — |
| `F17-SALE-07` | Order detail: dirección aplanada a `join(', ')`; `<dl>` grid `[9rem_1fr]` sin responsive; múltiples cards apiladas (Customer / Lines / Actions / Approvals / Notification / Returns / enlaces) → página muy larga sin navegación interna. | P3 |

### 8.8 Aprobaciones de precio

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-APR-01` | `GET /price-approvals` ahora con `@RequireAnyPermission` (F17-09, `GAP-APPROVALS-PERMISSION` resuelto); nav item con `anyPermission` ✓. Patrón master-detail (`/approvals` lista + `/approvals/[id]` detalle con aprobar/rechazar); "requester no puede auto-aprobar" reflejado en UI + API. Verificar layout master-detail en Lote 3. | P3 |

### 8.9 Devoluciones

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-RET-01` | Construido en F17-10 (`GAP-RETURNS-UI-DEFERRED` resuelto). `ReturnActions`: inspect / resolve / cancel mapeados 1:1 a endpoint + permiso + estado; `resolve` con `Idempotency-Key` ✓. | — |
| `F17-RET-02` | **Inspect** abre una **sección inline** con un bloque por línea (disposición + ubicación + notas) — no un Drawer como pide el spec. **Resolve** y **cancel** son paneles de confirmación inline `bg-slate-50` / `bg-red-50` — no modales. | P2 — hallazgo G/PT-5 |
| `F17-RET-03` | Disposición: `<Select>` sin pista de color (spec: restock→success, quarantine/damaged/scrap→warning). La restricción sellable/non-sellable se refleja deshabilitando el select y mostrando error de campo ✓. | P3 |
| `F17-RET-04` | Las líneas del return muestran `shortId` porque el DTO no trae `orderNumber`/SKU salvo que el caller tenga `sales.orders.view` (`GAP-NAME-ENRICHMENT`). | P2 dep. |

### 8.10 Administración — Usuarios / Roles / Configuración

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-ADM-01` | `/users`, `/users/[id]`, `/users/new` **sin `metadata.title`** (5S). | P3 — hallazgo K |
| `F17-ADM-02` | `/users` usa un `<table>` **crudo** en vez del componente `Table` — inconsistencia de padding, header y hover. | P2 — hallazgo H |
| `F17-ADM-03` | `/users` sin paginación visible (fija `pageSize: 50`), sin filtros (`GAP-USER-FILTERS`: sin filtro por rol, sin `?q=`). | P2 dep. |
| `F17-ADM-04` | `/users/[id]` incluye el editor de acceso por ubicación (F17-14) — verificar UX en Lote 3. | P3 |
| `F17-ADM-05` | `/roles` es solo-lectura (`GAP-ROLE-CRUD` es FUTURO) — correcto; verificar que comunica claramente que no es editable. | P3 |
| `F17-ADM-06` | `/settings` (timezone + business hours) — verificar en Lote 3 el patrón de formulario de settings (varios sub-forms). | P3 |

### 8.11 Home / Dashboard

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-HOME-01` | Home operativa (F17-12): grid de KPI tiles (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`) + digest "Needs attention" + quick actions. Degradación por tile (`unavailable` ≠ `0`) ✓. Sin gráfico (correcto, es F18/PROTOTYPE). | — |
| `F17-HOME-02` | "Orders confirmed today" ahora real para todo rol (F18-01 puso `timezone` en `/auth/me`). ✓ | — |
| `F17-HOME-03` | Quick actions son `<Link>` con estilo de botón secundario a mano (no `ButtonLink`). KPI tiles re-declaran `KpiValue`/`HomeKpiCard` local. | P3 |
| `F17-HOME-04` | Sin tile de inventario (`GAP-INV-AGGREGATE` / `GAP-REORDER` — "low stock" indefinible). El owner querrá revisar qué muestra la Home tras generar datos (F23). | P2 dep. |

### 8.12 Superadmin

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F17-SA-01` | `/platform` + `/platform/tenants` + `/platform/tenants/[id]` (suspend/activate). `PlatformShell` con la misma sidebar blanca (misma brecha `NAV-*`). | P2 |
| `F17-SA-02` | `GAP-SA-PLATFORM-401`: un 401 durante una mutación de plataforma aparece como "session expired" en el panel de acción (el `(superadmin)` shell no monta `SessionExpiryListener`). Dependencia F17-additive. | P3 dep. |
| `F17-SA-03` | `/platform` muestra la fila de KPIs de `GET /platform/summary` (F18-10); ventana "new" = mes calendario UTC, etiquetada "(UTC)". ✓ | — |

---

## 9. Auditoría F18 (primera pasada)

> F18 **no** tiene un hub `/reports` (confirmado por 5S y `f17-navigation.md`). Cada reporte es
> una `<section id="report">` embebida en la página operativa del dominio. La auditoría UI mira
> **cómo se representan los datos**, no la API.

### 9.1 Endpoints y su superficie UI

| Endpoint | Página anfitriona | Componentes |
| --- | --- | --- |
| `GET /reports/sales-summary` | `/sales` | `SalesReportFilters` + `SalesReportSection` + `SalesReportError` |
| `GET /reports/inventory-summary` | `/inventory` | `InventoryReportFilters` + `InventoryReportSection` + `InventoryReportError` |
| `GET /reports/movements-summary` | `/inventory/movements` | `MovementsReportFilters` + `MovementsReportSection` + `MovementsReportError` |
| `GET /reports/transfers-summary` | `/inventory/transfers` | `TransfersReportFilters` + `TransfersReportSection` + `TransfersReportError` |
| `GET /reports/returns-summary` | `/returns` | `ReturnsReportFilters` + `ReturnsReportSection` + `ReturnsReportError` |
| `GET /reports/approvals-summary` | `/approvals` | `ApprovalsReportFilters` + `ApprovalsReportSection` + `ApprovalsReportError` |
| `GET /reports/imports-summary` | `/imports` | `ImportsReportFilters` + `ImportsReportSection` + `ImportsReportError` |
| `GET /platform/summary` | `/platform` | `PlatformSummarySection` + `PlatformSummaryError` |

### 9.2 Hallazgos F18

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `F18-01` | **8 componentes `*ReportSection` + 8 `*ReportFilters` + 8 `*ReportError` casi idénticos**, cada uno con su propio `KpiTile` local, su propia lógica de "sumar buckets con seguridad", su propio manejo de 403 local. Debería ser 1 `ReportSection` + 1 `ReportFilters` + 1 `ReportError` parametrizados. **Máxima deuda de consistencia de F18.** | P2 — hallazgo H |
| `F18-02` | Los `*ReportError` son un **cuarto patrón de error** (rojo, "Try again" = enlace `#report`) distinto de `<ErrorState>` (rojo, botón), `<NoAccess>` (gris), `<Alert tone=error>` (inline form). Unificar. | P2 |
| `F18-03` | Jerarquía visual: el reporte va **encima** del listado operativo con solo un `<hr>` y un `<h2 text-sm>` de separación. En páginas como `/inventory` el usuario ve KPIs + tabla de reporte + `<hr>` + chips + tabla de balances → mucho scroll, dos "tablas" que compiten. Necesita separación clara (¿tab? ¿colapsable? ¿card con fondo distinto?). Decisión de §16. | P2 |
| `F18-04` | KPI tiles: `text-2xl font-semibold tabular-nums` ✓ cerca del spec numeric. Pero el label es `text-xs uppercase tracking-wide` sin el peso 600 del overline. Grid responsive `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` ✓. | P3 |
| `F18-05` | Tablas de reporte: mismas limitaciones que las operativas (sin tabla→tarjeta; `overflow-x-auto`). Los comentarios del código dicen "mobile gets an inner overflow-x-auto, not a page-wide one" — aceptado como scroll horizontal deliberado, pero hay que confirmarlo visualmente (Lote 2). | P2 |
| `F18-06` | Filtros de reporte (`*ReportFilters`, cliente) usan `useSearchParams`/`usePathname` y navegan a `#report`. Cada uno es un `<form>` a mano con `<Select>` nativos. Sin `TableToolbar`. Fechas: dos `<input type=date>` con semántica `[from, to)` — verificar hints y validación (Lote 2). | P2 |
| `F18-07` | Estados vacíos de reporte: `<EmptyState>` con copy específico ("No sales in this period", nombra el filtro activo cuando aplica) ✓ bien hecho. | — |
| `F18-08` | `/platform` KPI row: `PlatformSummarySection` — 4 tiles; etiqueta "(UTC)" honesta ✓. Misma familia de componentes duplicados. | P3 |
| `F18-09` | Ningún reporte tiene gráfico (bar chart CSS del prototipo = PROTOTYPE ONLY). Decisión: ¿el owner quiere alguna visualización gráfica mínima en F18 o se queda todo tabular? Registrar como `DECISION-CHARTS`. | P2 — decisión |

---

## 10. Hallazgos 5A–5S con impacto UI/UX

> Detalle completo en Lote 2. Registro inicial:

| ID | Hallazgo 5S | Clase | Acción UI-UX-SPEC |
| --- | --- | --- | --- |
| `5S-UI-01` | `/users` y `/users/:id` sin `<title>` específico | UI/UX | `F17-ADM-01` → convención de títulos §10-conv (Lote 2) + P3 |
| `5S-UI-02` | La sidebar no coincide del todo con `visual-system` (rail compacto §6.1) | UI/UX | `NAV-02` / `DECISION-NAV-RAIL` |
| `5S-UI-03` | Regresión visual real no ejecutada | UI/UX (proceso) | §12: se hace por código; screenshots pendientes de entorno con navegador |
| `5S-UI-04` | Responsive real no verificado (desktop/tablet/móvil) | UI/UX (proceso) | §12 primera pasada por breakpoints de código |
| `5S-UI-05` | Interacciones reales no ejecutadas | UI/UX (proceso) | §20 (Lote 3) especifica los flujos; verificación en F23 |
| `GAP-IMPORT-PROGRESS` | Sin señal de progreso de importación | dependencia backend | `F17-IMP-02` — registrar como dependencia, no implementar |
| `GAP-QR-PRINT` | Sin bitmap / enlace imprimible de QR | dependencia (proxy/endpoint) + UI (librería cliente) | `F17-QR-01` |
| `GAP-TZ-VISIBILITY` | timezone del tenant no legible por todo rol | **RESUELTO F18-01** | solo consumir `session.timezone` (hallazgo O) |
| `GAP-NOTIF-RETRY-BACKEND` | reintento de notificación sin contrato | dependencia backend (migración + permiso + ADR) | `F17-SALE-06` — NO implementar en esta fase |
| `DEFECT-TZ-DEFAULT-UNSETTABLE` | (a clasificar en Lote 2 — ¿backend o UI?) | pendiente | Lote 2 |

**Regla de clasificación:** un GAP de backend **no** se convierte automáticamente en trabajo de
UI. Se separa: UI/UX vs Backend vs Seguridad vs Producto vs Infraestructura.

---

## 11. OWNER UI CHANGE REQUESTS

> **Contenedor abierto y vacío.** Aquí se registran las correcciones y cambios de interfaz del
> owner. **Tus correcciones tienen prioridad sobre cualquier recomendación cosmética de este
> documento.** No se reemplaza una solicitud tuya por una alternativa "más bonita".

Cuando entregues cada cambio se registrará con esta ficha y se clasificará:

```
OUI-NNN
Clasificación:  A Corrección funcional de UI · B Corrección visual · C UX/flujo ·
                D Responsive · E Navegación · F Accesibilidad ·
                G Consistencia del design system · H Cambio estructural ·
                I Cambio de comportamiento · J Fuera de alcance
Pantalla:
Elemento:
Problema actual:
Cambio solicitado:
Motivo:
Impacto (UI / backend / DB / seguridad):
Dependencias:
Prioridad (P0–P3):
Criterio de aceptación (Given/When/Then):
Estado: OWNER REQUEST
```

Si una solicitud tuya tiene impacto técnico o contradice una decisión arquitectónica:
**no se implementa, no se descarta — se registra como `CONFLICT` / `DECISION REQUIRED`** y lo
revisamos juntos.

### OUI-001 — Toda la interfaz en español

| Campo | Valor |
| --- | --- |
| **Clasificación** | `I` (cambio de contenido/comportamiento) + `G` (consistencia) — localización completa de la UI |
| **Pantalla** | Todas — shell, navegación, las ~141 `.tsx` con copy, ~49 `metadata.title`, mapas de labels en `lib/types/*.ts`, estados vacío/error/validación, `<html lang>`, formato de fechas/números |
| **Elemento** | Todo el texto visible al usuario |
| **Problema actual** | La UI está **100 % en inglés** ("Products", "New sale", "Something went wrong", "Showing X–Y of N", `PRODUCT_STATUS_LABELS = {draft:'Draft'…}`, `<html lang="en">`, fechas con `toLocaleString()` sin locale). |
| **Cambio solicitado** | Toda la interfaz en **español**. |
| **¿Ya viene incorporada?** | **Parcial.** La **decisión** ya estaba tomada en esta fase (`DECISION-LANG = español`, §4). La **implementación NO existe** — no hay una sola cadena traducida, no hay librería i18n, `<html lang="en">`. Los datos de dominio sí están en español (seed: "Muebles", "Silla de Comedor", "Bodega Principal"). |
| **Motivo (owner)** | El producto se dirige a un mercado hispanohablante; la documentación, los specs y la comunicación ya están en español. |
| **Impacto** | **UI únicamente.** Sin backend, sin DB, sin migración, sin seguridad. Efectos colaterales: (1) muchos tests unit de `apps/web` afirman sobre strings en inglés (`getByText('New product')`) → hay que actualizarlos; (2) `<html lang="es">`; (3) `toLocaleString()` → pasar `'es'` + timezone del tenant (se cruza con el hallazgo `O` / `PROP-03`); (4) `metadata.title` (se cruza con `PROP-04`). |
| **Dependencias** | Ninguna bloqueante. Depende de `UI-UX-IMPLEMENTATION-01` solo por orden (el glosario y los mapas de labels compartidos primero). Sin i18n para el MVP — reemplazo directo de cadenas (`DECISION-LANG`). |
| **Enfoque propuesto** | (1) `IMPLEMENTATION-01`: glosario canónico + traducir shell, navegación, primitivas (`components/ui/*`), mapas de `lib/types/*.ts`, boundaries (`error`/`not-found`/`loading`), convención de `metadata.title` en español. (2) Cada `IMPLEMENTATION-05..11` traduce el copy de sus propias pantallas al aplicar los demás cambios (una sola pasada por módulo, no dos). (3) `IMPLEMENTATION-13`: barrido final + revisión de tests. |
| **Prioridad** | **P1** |
| **Estado** | `EN IMPLEMENTACIÓN` — Bloque 1a (fundacional) completo 2026-09-10: `<html lang>`, boundaries (error/loading/not-found en `(tenant)`/`(superadmin)`/raíz), `httpErrorMessage`, primitivas (`Pagination`, `ErrorState`, `NoAccess`), shell (aria-labels, menú de cuenta, marca de plataforma), **ambos registros de navegación** (tenant + superadmin, con el glosario aplicado) y **todos los mapas de estado/label de dominio** (`lib/types/*.ts` — productos, variantes, órdenes, documentos, aprobaciones, devoluciones, disposiciones, notificaciones, clientes, movimientos, transferencias, incidentes, atributos, importación, QR, estado de tenant, agrupaciones de reportes). Verificado: `pnpm typecheck` limpio, `pnpm lint` limpio, `pnpm vitest run` 442/442 en verde, confirmado en vivo en `localhost:3000` (sidebar en español). **Módulo Inventario completo (2026-09-23):** dentro del bloque Inventario/Kardex (`/inventory` —
reemplazo de "Existencias" por un Kardex cronológico, `GL-2`; y `/inventory/movements` — "Historial
de movimientos") se tradujo también todo el copy propio de ambas pantallas al construir la
funcionalidad (títulos, botones, encabezados de tabla, badges de tipo de movimiento, estados
vacíos/error) — no queda pendiente para un bloque posterior. **Pendiente:** el copy propio del
resto de pantallas (~125 archivos restantes — títulos, botones, columnas de tabla, labels de
formulario, mensajes de estado vacío específicos, `metadata.title`) se traduce módulo por módulo en
los próximos bloques. Ver `GAP-BACKEND-MESSAGES-EN` (nuevo, abajo). |
| **Criterio de aceptación** | Ver `UI-UX-ACC-OUI-001` abajo. |

**Glosario canónico — RESUELTO por el owner (2026-09-10).**

> ⚠️ **Inversión de jerarquía respecto a `frontend-visual-system.md §6.7` — leer con cuidado.**
> El owner define el concepto de negocio así: **una empresa tiene Sucursales; cada Sucursal
> contiene uno o más Almacenes.** Esto es una **relabeling de UI únicamente** — no crea un nivel
> jerárquico nuevo, no toca el schema ni la API:
>
> | Entidad real (DB/API, sin cambios) | Label en inglés (actual) | Label en español (nuevo) |
> | --- | --- | --- |
> | `warehouses` (tabla superior; código, ≥1 ubicación por defecto) | "Warehouse" | **"Sucursal"** / "Sucursales" |
> | `locations` (tabla hija de `warehouses`; ubicación física, sellable/no-sellable) | "Location" | **"Almacén"** / "Almacenes" |
>
> Esto es lo **contrario** de lo que decía `§6.7` (que llamaba "Almacenes" a `warehouses` y
> "Ubicaciones" a `locations`) — ese documento de diseño queda desalineado y se corrige en Lote 2
> (`PROP-06`, nuevo). **Cada ocurrencia** de "Warehouse"/"Almacén" (viejo sentido) y
> "Location"/"Ubicación" en el código actual debe revisarse una por una contra esta tabla al
> traducir — es la trampa más fácil de invertir por error. Afecta como mínimo: nav (`/warehouses`,
> `/locations`), columnas de tabla (Inventario: "Warehouse"/"Location"), formularios de
> almacén/ubicación, selector de ubicación en ventas/ajustes/transferencias/devoluciones (incl.
> sellable/no-sellable), acceso por ubicación de usuario (`S-USER-DETAIL`), y el rol "Bodega" del
> `DEFAULT_ROLE_TEMPLATES` (el nombre del rol **no se traduce en esta fase** — es dato de
> configuración de roles, no UI estática; se registra como nota para `GAP-ROLE-CRUD`/futuro, no se
> renombra sin ADR).

| Inglés actual | Español final | Resolución |
| --- | --- | --- |
| Home / Dashboard | **Inicio** | — |
| Products | **Productos** | — |
| Categories | **Categorías** | — |
| Attributes | **Atributos** | — |
| QR codes | **Códigos QR** | — |
| Imports | **Importación** | — |
| **Warehouses** (`warehouses`) | **Sucursales** | `GL-1` — owner: jerarquía Sucursal ⊃ Almacén |
| **Locations** (`locations`) | **Almacenes** | `GL-1` |
| **Stock on hand** | **Inventario** | `GL-2` — owner, no "Existencias" |
| Movements | **Movimientos** | — |
| Transfers | **Transferencias** | — |
| New sale | **Nueva venta** | — |
| Sales history | **Historial de ventas** | — |
| Customers | **Clientes** | — |
| Approvals | **Aprobaciones** | (de precio) |
| Returns | **Devoluciones** | — |
| Users | **Usuarios** | — |
| Roles | **Roles** | — |
| Company settings | **Configuración** | `GL-4` — owner confirmó |
| **Order** | **Pedido** | `GL-3` — owner: "Pedido", no "Orden". Prefijo de número: revisar si `order_number` sigue mostrándose como `ORD-######` o se relabela a `PED-` (es un valor real del backend, formato fijo — ver nota abajo) |
| Invoice / Sales note | **Factura / Nota de venta** | (ya en `frontend-visual-system.md §11`) |
| Something went wrong | **Algo salió mal** | — |
| Try again | **Reintentar** | — |
| Showing X–Y of N | **Mostrando X–Y de N** | — |
| Access denied | **Acceso denegado** | — |
| Not found | **No encontrado** | — |
| Tratamiento | **Impersonal / infinitivo** | `GL-5` — owner confirmó ("Añadir productos", no "Añade"/"Añada") |

**Nota sobre `order_number` ("Pedido"):** el backend genera `orders.order_number` como
`'ORD-' + secuencia de 6 dígitos` (FASE 12, ya implementado — **no se cambia en esta fase**, es
dato real, no copy). La UI puede seguir mostrando el valor tal cual (`Pedido ORD-000123`) o generar
un cambio de prefijo requeriría una migración/ADR fuera de alcance. **Se registra como
`GAP-ORDER-PREFIX-ES`** (decisión pendiente, no bloqueante): mantener `ORD-` (dato real) vs pedir
un cambio de prefijo a `PED-` como trabajo de backend futuro. Por ahora, la etiqueta ("Pedido")
cambia; el código (`ORD-######`) no.

Todos los `GL-1..GL-5` quedan `APPROVED`.

### `GAP-BACKEND-MESSAGES-EN` (nuevo — descubierto implementando OUI-001)

`httpErrorMessage()` (`lib/api/errors.ts`) prefiere el `message` que manda el backend para 400/409/422
("es seguro y específico, escrito para el usuario final"). **Ese mensaje lo genera `apps/api`, que
hoy responde en inglés** (validaciones de DTO, conflictos de negocio, etc.). Traducirlo está **fuera
de alcance** de esta fase (no se toca `apps/api`). Efecto: aunque todo el frontend quede en español,
algunos mensajes de error puntuales (validación 400/422, conflicto 409) seguirán apareciendo en
inglés hasta que una fase de backend los traduzca o el frontend deje de reenviarlos tal cual.
**Clase:** decisión/backend, no bloqueante. **Recomendación:** registrar como ítem de una fase de
backend futura (fuera de UI-UX-SPEC-001 y de UI-UX-IMPLEMENTATION-*).

### OUI-002
_[Pendiente de registrar]_

### OUI-003
_[Pendiente de registrar]_

> El owner ya adelantó (fuera de esta ficha) intención de revisar visualmente el flujo
> **TRANSFER OUT → EN TRÁNSITO → TRANSFER IN** (relacionado con `F17-INV-06`) durante F23. Se
> registrará formalmente como OUI cuando lo entregue como solicitud concreta.

---

## 12. Responsive specification (primera pasada — por inspección de código)

> **Sin herramienta de navegador en este entorno**: no hay screenshots. Esta sección se basa en
> los prefijos de breakpoint Tailwind **realmente presentes** en el código + `responsive-guidelines.md`.
> La verificación visual en 1440 / 1280 / 1024 / 834 / 768 / 430 / 390 / 375 px queda **pendiente**
> de un entorno con navegador (o de F23).

### 12.1 Breakpoints en uso (hecho medido)

- **55 ocurrencias** de prefijos responsive en **38 archivos** (de ~340). Densidad muy baja.
- Prefijos usados: casi todo `sm:` (640) y `lg:` (1024). `md:` (768) y `xl:` (1280) apenas.
- **No hay un rango "tablet" tratado explícitamente.** El shell conmuta en `lg:` (1024): por
  debajo → drawer + una sola columna; por encima → sidebar 256 px + contenido.
- Consecuencia: **768–1023 px (tablet portrait, iPad) recibe la experiencia móvil** (drawer,
  una columna), contra `responsive-guidelines.md §1` que define tablet como formato propio
  ("**not** a squashed desktop").

### 12.2 Matriz responsive — objetivo vs actual

| Componente | Desktop (objetivo) | Tablet (objetivo) | Móvil (objetivo) | Actual |
| --- | --- | --- | --- | --- |
| Sidebar/nav | rail 68 px, hover→232 overlay | rail 68 px permanente + pin | drawer 284 px, safe-area, focus trap | sidebar 256 px fija (≥1024) / drawer 288 px blanco sin focus trap (<1024) |
| Header | account menu (+ search donde hay contrato) | pin toggle + account | menu button + **título de pantalla** + avatar | 56 px, menu(móvil) + tenant name (`hidden sm:block`) + UserMenu; **sin título de pantalla en móvil** |
| Tablas | tabla completa, filas 48 (40 compacto) | 3–5 columnas, resto a sub-línea + detalle | filas apiladas / tarjetas, valor primario prominente, disclosure | tabla completa siempre + `overflow-x-auto`; **sin reducción de columnas, sin tabla→tarjeta** |
| Filtros | fila de chips inline | menos chips + "Más filtros" sheet | strip de chips scroll-x → bottom-sheet | fila `flex flex-wrap` de chips a mano; **sin sheet, sin scroll-x deliberado** |
| Formularios | 2-col dentro de sección + aside sticky | 1-col, aside→card superior | 1-col, **bottom bar sticky** (safe-area) | 1-col `max-w-xl` siempre; **sin aside, sin bottom bar** (algunos forms usan `sm:grid-cols-2/3` en sub-grupos) |
| Dialog/Drawer | Drawer derecho / Dialog centrado | Drawer ancho / Dialog | **bottom sheet**, drag handle | **no existen** — todo inline |
| Dashboard/KPI | grid 4-up | 2-up | 2-up, secciones apiladas | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` ✓ razonable |
| Reportes (tiles) | grid 5-up | 3-up | 2-up | `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` ✓ razonable |
| Acción primaria | `PageHeader` top-right | top-right (label corto) | **bottom sticky** (safe-area) | siempre en `PageHeader` (se apila bajo el título con `flex-col sm:flex-row`); **nunca bottom sticky** |
| Padding de contenido | 24 | 20 | 16 | 16 / `sm:`24 / `lg:`32 |

### 12.3 Hallazgos responsive

| ID | Hallazgo | Sev. |
| --- | --- | --- |
| `RSP-01` | Tablet portrait (768–1023) cae en modo móvil; no hay formato tablet. | P2 |
| `RSP-02` | Ninguna tabla se transforma en tarjetas; las de ≥6 columnas (`/inventory`, `/sales/[id]`, order lines, `/locations`, reportes) desbordan a 390 px. | P2 |
| `RSP-03` | Sin bottom bar sticky para la acción primaria en móvil (New Sale, Product form, listados). | P2 |
| `RSP-04` | Sin `env(safe-area-inset-bottom)` en drawer ni en ningún elemento pinneado. | P3 |
| `RSP-05` | Header móvil no muestra el título de la pantalla. | P3 |
| `RSP-06` | Filtros no colapsan a sheet en móvil; el `flex-wrap` de chips puede crecer mucho verticalmente. | P3 |
| `RSP-07` | Padding de contenido desktop 32 px (spec: 24). | P3 |
| `RSP-08` | Sin `prefers-reduced-motion` (drawer slide, `animate-pulse` de skeleton, `transition-colors`). | P3 |

### 12.4 Recomendación de verificación

En cuanto haya un entorno con navegador (o en F23): levantar API+web con Postgres desechable
(mecanismo `tools/pg-verify`), sembrar por HTTP, y capturar cada pantalla en 1440 / 1024 / 834 /
390. Adjuntar como anexo de screenshots a este documento (`docs/ui-ux/screenshots/`).

---

## 13. Component specification

_Lote 2._ Especificará cada componente (variantes, estados visuales, comportamiento responsive,
accesibilidad) y el plan para: crear los tokens, crear los componentes faltantes (Dialog, Drawer,
Tabs, SegmentedControl, Stepper, TableToolbar, FilterChip, IconButton), y unificar los duplicados
(`*ReportError` → `ReportError`; `KpiTile` → componente compartido; `/users` → `Table`).

## 14. Forms specification

_Lote 2._ Patrón de formulario objetivo: secciones-card, aside de publicación sticky (desktop),
bottom bar sticky (móvil), validación field-level + Alert resumen, scroll-to-first-error,
"guardar y crear otro" donde aplique.

## 15. Tables specification

_Lote 2._ Patrón de tabla objetivo: filas 48/40, header sticky caption-style, `tabular-nums` en
numéricos, menú `⋮` de fila, `TableToolbar` (search donde hay contrato + FilterChips + "Más
filtros"), y las tres formas responsive (completa / reducida / tarjetas) por tabla concreta.

## 16. Dashboard / report specification

_Lote 2._ Resolver `F18-03` (jerarquía reporte vs listado en la misma página), `DECISION-CHARTS`,
unificar `*ReportSection`/`*ReportFilters`/`*ReportError`, y la representación por reporte
(qué tiles, qué tabla, empty/sin-datos/error).

## 17. Loading / empty / error states

_Lote 2._ Para cada pantalla crítica: Loading · Empty · Success · Error · Forbidden · Not Found ·
Saving · Saved · Validation error · Network error. Patrones reutilizables (skeletons con forma de
la pantalla; un único `ErrorState`; `NoAccess` para 403; convención de "saved"). Pantallas foco:
Productos, Inventario, Transferencias, Ventas, Clientes, Devoluciones, Aprobaciones, Importaciones,
Usuarios, Reportes.

## 18. Accessibility

_Lote 2._ Baseline: contraste (texto ≥ 4.5:1), focus visible en todo, ≥ 44 px táctil off-desktop,
controles etiquetados, headings semánticos, drawer/dialog/menús operables por teclado + focus
trap + retorno, **estado nunca solo por color** (color + icono + texto — hoy `Badge` falla esto),
`prefers-reduced-motion`. Auditoría por pantalla.

## 19. Page-by-page specification

_Lote 3._ Ficha por ruta: Propósito · Info primaria · Acción primaria · Acciones secundarias ·
Layout (desktop/tablet/móvil) · Componentes · Notas de interacción · Estados · Criterios de
aceptación. Inventario de rutas base en §3 / la matriz maestra.

## 20. Critical flows

_Lote 3._ UX end-to-end de: Producto (crear→variante→atributos→guardar→visualizar) · Inventario
(stock→ajuste→movimiento) · Transferencia (crear→aprobar→preparar→despachar→**EN TRÁNSITO**→
recibir) · Venta (carrito→orden→confirmación→reserva→venta→notificación) · Devolución
(solicitar→inspeccionar→resolver→reingreso) · Price approval (solicitud→aprobación/rechazo→
impacto en venta) · Importación (crear→subir→procesar→resultado→errores) · Administración
(usuario→rol→permisos→acceso). Detección de fricción por flujo.

## 21. Priority matrix (parcial — se completa en Lote 3)

| Prioridad | Definición | Hallazgos (Lote 1) |
| --- | --- | --- |
| **P0** bloqueante | impide usar o construir | _(ninguno identificado aún)_ |
| **P1** importante antes de MVP | fundacional o muy visible | `DS-01..DS-03`, `DS-05`, `NAV-01..NAV-03`, `DECISION-LANG`, hallazgos A/B/C/D/F/G(parcial) |
| **P2** mejora importante | consistencia, responsive, UX | `DS-04`, `DS-06..DS-12`, `NAV-04..NAV-05`, `F18-01..F18-03`, `RSP-01..RSP-03`, `F17-INV-01`, `F17-SALE-01/05`, `F17-RET-02`, `F17-ADM-02`, hallazgos H/I/N/O |
| **P3** nice to have | pulido | `NAV-06..NAV-11`, `RSP-04..RSP-08`, `F17-ADM-01` (título), hallazgos K/L/M, y la mayoría de "verificar en Lote 2/3" |

Dimensiones (a etiquetar por hallazgo en Lote 3): Functional · UX · Visual · Responsive ·
Accessibility · Technical debt · Product decision.

---

## 22. Dependencies

### 22.1 Dependencias de backend (registradas, NO se implementan en esta fase)

| Gap | Qué desbloquea en UI | Clase |
| --- | --- | --- |
| `GAP-VARIANT-LIST` (`GET /variants?q=`) | búsqueda de SKU en New Sale / Transfer / vista plana de variantes | F17-blocking (workaround en uso) |
| `GAP-NAME-ENRICHMENT` | nombres en inventario/movimientos/transferencias/QR/returns en vez de ids | F17-additive (alto apalancamiento) |
| `GAP-BRAND-SUPPLIER-LIST` (`GET /brands`/`/suppliers`) | selectores de marca/proveedor en el form de producto | decision → additive |
| `GAP-SEARCH` (`?q=` en `/products`, `/orders`) | cajas de búsqueda en Productos e Historial | additive |
| `GAP-SORT` | headers ordenables en todos los listados | additive |
| `GAP-MULTI-STATUS` (`status[]`) | tabs "abiertas"/"por recibir" en 1 llamada | additive |
| `GAP-IMPORT-PROGRESS` (`processedRows`/long-poll) | barra de progreso real en importación | decision/additive |
| `GAP-IMPORT-FILE-HEADERS` (`GET /imports/:id/headers`) | mapeo columna-a-columna visual | additive |
| `GAP-NOTIF-RETRY-BACKEND` (endpoint + migración + permiso + ADR) | botón "reintentar notificación" | future |
| `GAP-QR-PRINT` (proxy `/q/*` o endpoint de imagen) | render/impresión de QR | decision/additive |
| `GAP-SA-PLATFORM-401` (refresh + listener de plataforma) | redirect limpio en 401 de mutación superadmin | additive |
| `GAP-ORDERS-LOCATION`, `GAP-INV-LOCATION-SCOPE` | decidir si las lecturas se limitan por ubicación | decision |
| `GAP-SUSPENDED-TENANT-UX` | estado "empresa suspendida" a nivel shell | decision (un `code` en el 403 ayudaría) |

### 22.2 Dependencias internas de esta fase

- `DECISION-LANG` = **español** (resuelto) → traducción completa en `IMPLEMENTATION-*`.
- `DECISION-NAV-RAIL` = **rail compacto** (resuelto) → `NAV-01..06` en `IMPLEMENTATION-02`.
- `DECISION-PRIMARY` = **azul `#2F6FED`** (resuelto) → `DS-03`/`DS-05`/`DS-04` en `IMPLEMENTATION-01`.
- `DECISION-CHARTS` = **decidir por reporte en Lote 2 (§16)** — único pendiente.
- `UI-UX-IMPLEMENTATION-02..13` dependen de `UI-UX-IMPLEMENTATION-01` (tokens + componentes base).

### 22.3 Propuesta de reestructuración del roadmap (**APROBADA 2026-10-26 y aplicada en `roadmap.md`**)

> El owner propuso separar dos conceptos hoy fusionados en la fila "FASE 22" del `roadmap.md`.
> Se registró aquí sin aplicarse durante esta fase; el 2026-10-26 el owner la **aprobó** y las filas
> F22/F23 de `roadmap.md` se reescribieron. La columna "Hoy" muestra el texto **anterior**.

| Fase | Hoy (`roadmap.md`) | Propuesta del owner |
| --- | --- | --- |
| **F22 — Demo Environment** | "Seed / Demo Environment": tenant demo aislado, datos sintéticos, seed reproducible, estrategia de reset (ADR-0014) | **"Preparar el escenario"**: Demo Environment reproducible con **escenarios** nombrados `DEMO-01..DEMO-12` (Empresa recién creada · Catálogo inicial · Inventario inicial · Transferencia entre almacenes · Venta normal · Venta con aprobación · Devolución · Importación Excel · QR · Dashboard con datos · Multiusuario/roles · Multi-tenant) + procedimiento/botón **"Reset Demo"** para repetir pruebas |
| **F23 — QA Integral** | "QA Integral": validación end-to-end de todo el sistema, regresión de todas las fases, flujos críticos | **"Usar y destruir/repetir"**: el owner recorre el sistema como usuario real (los 10 recorridos: Administración · Catálogo · Inventario · Transferencia · Venta · Devolución · Precio excepcional · Importación · QR · Reportes), manipulando todo, sobre el Demo Environment de F22 |

Orden propuesto por el owner (sin cambios de numeración, solo alcance): **UI-UX-SPEC-001 → F19
Security → F20 Observability → F21 Deployment → F22 Demo (escenarios) → F23 QA Integral → F24
MVP**. Coherente con esta fase: no construir el Demo Environment hasta que las correcciones de UI
cambien cómo se crean productos, transferencias, ventas, etc.

**Acción:** ~~cuando se apruebe, un commit `docs:` sobre `roadmap.md` reescribe las filas F22/F23~~
→ **hecho** (aprobado 2026-10-26). Sigue abierto: un ADR corto si los escenarios `DEMO-*` merecen
especificación propia (se decide al iniciar FASE 22).

---

## 23. Out of scope

Durante UI-UX-SPEC-001 **no** se hace:

- `git commit` / `git push` de implementación.
- Cambios en: API, DB, migraciones, auth, RLS, RBAC, lógica de negocio, permisos, roles, reglas
  de inventario, reportes nuevos, integraciones.
- Funcionalidad nueva de negocio o de API.
- Implementación de UI (componentes, estilos, layouts, rutas, CSS, Tailwind, formularios, tablas,
  lógica frontend) salvo lo estrictamente necesario para inspección.
- "Mejorar" la interfaz por iniciativa propia y presentarlo como hecho. Todo lo mejorable no
  solicitado se registra como `PROPOSED` con su justificación.
- F19 (Security Hardening): `GAP-F19-PARSE-UUID`, `22P02`, Fastify empty body, RLS/IDOR
  exhaustivo, RBAC, tenant isolation, hardening — **no se tocan aquí**.
- Modo oscuro como feature (solo se registra si el mapa de tokens lo deja preparado).
- Edición de `roadmap.md` (la propuesta F22/F23 se registra en §22.3, no se aplica).

### Propuestas del auditor (PROPOSED — requieren tu aprobación, no implementadas)

| ID | Propuesta | Por qué |
| --- | --- | --- |
| `PROP-01` | Unificar los 8 `*ReportError` en un `ReportError`, los `KpiTile` locales en un componente, y migrar `/users` al componente `Table` | Deuda de consistencia pura; bajo riesgo; alto retorno de mantenimiento |
| `PROP-02` | Añadir el tono `info` a `Badge`/`Alert` e icono a `Badge` | Requerido por el baseline de accesibilidad (estado nunca solo por color) |
| `PROP-03` | Consumir `session.timezone` para render de fechas en el detalle de orden (y auditar todas las fechas) | `toLocaleString()` del navegador da fechas incorrectas para el operador; el dato ya existe |
| `PROP-04` | Convención de `<title>`: `"<Pantalla> | SaaS Inventory"` y cubrir `/users*` | Hallazgo 5S; el separador `|` es el del ejemplo de la Parte 10 |
| `PROP-05` | Añadir `env(safe-area-inset-bottom)` + `prefers-reduced-motion` como reglas base | Baseline responsive/a11y; barato |
| `PROP-06` | Corregir `frontend-visual-system.md §6.7` y `f17-navigation.md` para que digan "Sucursal" (`warehouses`) / "Almacén" (`locations`) en vez de "Almacenes"/"Ubicaciones" | OUI-001/`GL-1` invierte la jerarquía de nombres que esos documentos de diseño tenían; quedarían contradictorios si no se corrigen |

---

## 24. Acceptance criteria

_Lote 3._ Cada cambio importante tendrá criterios Given/When/Then verificables (formato de la
Parte 16 del prompt).

```
UI-UX-ACC-OUI-001 — Interfaz en español
Given:  cualquier usuario autenticado o anónimo, en cualquier rutal
When:   se renderiza cualquier pantalla (shell, listado, formulario, detalle, estado
        vacío/error/forbidden/not-found, toast, diálogo, título de pestaña)
Then:   no aparece ninguna cadena en inglés visible al usuario;
        <html lang="es">;
        los mapas de estado (ORDER_STATUS_LABELS, TRANSFER_STATUS_LABELS, …) están en español;
        las fechas se formatean con locale 'es' y la timezone del tenant;
        los <title> siguen la convención "<Pantalla> | SaaS Inventory" en español;
        el glosario canónico (OUI-001) se aplica de forma consistente entre módulos
        (una sola traducción por término, sin sinónimos mezclados);
        los tests unit de apps/web afirman sobre las cadenas en español y pasan.
```

Ejemplo de referencia:

```
UI-UX-ACC-001 — Sidebar desktop (si se aprueba DECISION-NAV-RAIL)
Given:  usuario autenticado
When:   viewport ≥ 1024 px
Then:   la navegación es un rail compacto de 68 px;
        los iconos permanecen visibles;
        los labels aparecen al hacer hover o focus-within (expansión a 232 px, overlay, sin layout shift);
        el módulo activo se identifica con superficie nav.active + barra blanca de 3 px;
        prefers-reduced-motion elimina la transición.
```

## 25. Implementation roadmap

_Lote 3 (borrador)._ Secuencia propuesta (puede cambiar según dependencias del Lote 3):

| # | Bloque | Contenido |
| --- | --- | --- |
| `UI-UX-IMPLEMENTATION-01` | Design tokens / foundations | `:root` completo, mapeo Tailwind, ramp tipográfico, `info` + icono en Badge, focus, sombras, `prefers-reduced-motion`, safe-area |
| `UI-UX-IMPLEMENTATION-02` | Navigation / shell | según `DECISION-NAV-RAIL`: rail + tablet + drawer con tokens `--nav-*`; header con título de pantalla móvil; breadcrumbs si se aprueban |
| `UI-UX-IMPLEMENTATION-03` | Shared tables | `Table` a spec, `TableToolbar`, `FilterChip`, menú `⋮`, formas responsive; migrar `/users` |
| `UI-UX-IMPLEMENTATION-04` | Shared forms | secciones-card, aside sticky, bottom bar móvil, Dialog, Drawer, SegmentedControl, Stepper |
| `UI-UX-IMPLEMENTATION-05` | Catalog | Productos/Variantes/Categorías/Atributos a los nuevos patrones |
| `UI-UX-IMPLEMENTATION-06` | Inventory | Existencias/Movimientos/Transferencias (+ visualización EN TRÁNSITO)/Almacenes/Ubicaciones |
| `UI-UX-IMPLEMENTATION-07` | Sales | New Sale (pantalla prioritaria) / Historial / Detalle de orden |
| `UI-UX-IMPLEMENTATION-08` | Returns / approvals | master-detail, drawers de inspección, modales |
| `UI-UX-IMPLEMENTATION-09` | Imports / QR | step rail, (progreso si llega backend), render QR |
| `UI-UX-IMPLEMENTATION-10` | Administration | Usuarios / Roles / Configuración / acceso por ubicación |
| `UI-UX-IMPLEMENTATION-11` | Reports / dashboards | `ReportSection`/`ReportFilters`/`ReportError` unificados; jerarquía reporte vs listado; charts si se aprueban |
| `UI-UX-IMPLEMENTATION-12` | Responsive / mobile | pasada dedicada de tablet + tabla→tarjeta + sticky actions + screenshots |
| `UI-UX-IMPLEMENTATION-13` | Accessibility / polish | auditoría final de contraste/teclado/foco; `prefers-reduced-motion` end-to-end |

---

## Matriz maestra (se llena en Lotes 2–3)

| ID | Área | Pantalla | Tipo | Problema | Cambio | Prioridad | Dependencia | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DS-01 | Design system | (global) | G | No hay tokens `:root` | Definir bloque de tokens + mapeo Tailwind | P1 | — | APPROVED |
| DS-03 | Design system | (global) | B/G | Sin acento primary | Adoptar `#2F6FED` + estados + tono `info` | P1 | — | APPROVED |
| OUI-001 | Global | (todas) | I/G | UI 100% en inglés; sin i18n; `<html lang="en">` | Traducir toda la UI a español + glosario canónico + locale `es` en fechas + `<html lang="es">` + tests | P1 | IMPLEMENTATION-01 (glosario/labels primero) | OWNER REQUEST → APPROVED |
| NAV-01 | Navegación | Shell | E/G | Nav no usa superficie primary | `--nav-bg = primary` | P1 | DS-01 | APPROVED |
| NAV-02 | Navegación | Shell | H | Sin rail compacto | Construir rail 68→232 + panel tablet + drawer | P1 | DS-01 | APPROVED |
| F18-01 | Reportes | (7 páginas) | G/H | 8× componentes de reporte duplicados | Unificar en `ReportSection`/`Filters`/`Error` | P2 | — | PROPOSED |
| F17-ADM-02 | Admin | /users | G | `<table>` crudo | Migrar a `Table` | P2 | — | PROPOSED |
| F17-SALE-05 | Ventas | /sales/[id] | A | Fechas en locale navegador | Usar `session.timezone` | P2 | — | PROPOSED |
| RSP-02 | Responsive | (listados) | D | Tablas desbordan móvil | Tabla→tarjeta | P2 | — | DISCOVERED |
| 5S-UI-01 | Admin | /users* | B | Sin `<title>` | Convención de títulos | P3 | — | DISCOVERED |
| … | | | | | | | | _(continúa en Lote 2)_ |

Estados permitidos: `DISCOVERED` · `OWNER REQUEST` · `PROPOSED` · `DECISION REQUIRED` ·
`APPROVED` · `DEFERRED` · `OUT OF SCOPE`. **Nada se marca `APPROVED` sin la aprobación del owner.**

---

## Cambios realizados en esta fase (hasta Lote 1)

```
Application code:      0 changes
Database:              0 changes
API:                   0 changes
Migrations:            0 changes
Security architecture: 0 changes
Documentación:         + docs/ui-ux/UI-UX-SPEC-001.md (este documento)
```

## Git

```
branch:       develop
HEAD inicial: 6fcfb79
HEAD actual:  6fcfb79
working tree: solo el nuevo docs/ui-ux/UI-UX-SPEC-001.md sin commitear
commits:      0
```
