# F17-00 — Frontend Functional Specification (master)

> **Analysis & documentation only.** No component, page, endpoint, DTO, migration, RLS or
> permission is created or changed by F17-00. This is the contract FASE 17 implements module by
> module, against the real backend, without inventing functionality.

Produced at HEAD `194b5d4` by auditing, in this order of authority:

1. **Backend code** — every controller (`@Controller` prefix + method path + `@RequirePermissions`
   / `@Public` / `@PlatformOnly`), every request/response DTO, the services behind them.
2. **PostgreSQL / Drizzle schema + migrations** — tables, columns, status enums, constraints,
   indexes, RLS policies, grants.
3. **Guards / RBAC / tenant context / security** — `JwtAuthGuard → TenantGuard → CsrfGuard →
   PermissionsGuard`, `LocationAuthorizationService`, ADR-0028 field gates.
4. **ADRs** — 0004, 0009, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0026, 0027, 0028,
   0029, 0030, 0031, 0032, 0033.
5. **`docs/architecture/*`** + **`docs/security/*`**.
6. **`docs/architecture/reporting/`** (017-A) — the authority for **which information / metrics /
   reports / dashboards belong to F17 vs F18**.
7. **`docs/design/`** (017-DESIGN) — **visual & UX reference only.** Never a source of truth for
   endpoints, permissions, states, business rules, data, relationships, actions or backend
   capabilities.
8. **`apps/web`** — the FASE 16 foundation (routing conventions, API client, session, permission
   helpers, UI primitives, app shell).

## The documents

| File | Purpose |
| --- | --- |
| [f17-screen-catalog.md](f17-screen-catalog.md) | The master table of every F17 screen — id, module, persona, route, objective, scope, permission, real endpoint(s), request/response DTOs, fields, columns, filters, sort, pagination, actions, domain states, transitions, validation, errors, loading/empty/error/forbidden states, responsive behaviour, dependencies, gaps, F17/F18. |
| [f17-navigation.md](f17-navigation.md) | The navigation catalogue per persona/context — routes, labels, icons, permission, F17/F18, backing state. Aligned to the existing `apps/web/src/lib/navigation.ts` registry. |
| [f17-functional-contract.md](f17-functional-contract.md) | Cross-cutting functional rules: the standard screen-state model, list/pagination/filter/search/sort contract, form/validation/mutation contract, error-envelope handling, idempotency, field-level authorization, money/quantity/date handling. |
| [f17-super-admin.md](f17-super-admin.md) | The Platform Admin / Super-Admin experience — what the backend supports **today**, what is a **GAP BACKEND**, what is a later phase. Kept structurally separate from Tenant Admin. |
| [f17-security-and-scope.md](f17-security-and-scope.md) | Per-persona and per-screen: auth requirement, tenant context, permissions, location scope, platform scope, route protection, sensitive data, and what must never be trusted to the frontend. |
| [f17-dependencies.md](f17-dependencies.md) | Dependency graph between modules/screens (Product → Category → … , Sale → Customer → Variant → Price → Location → Approval → Order → Notification, etc.). |
| [f17-gaps.md](f17-gaps.md) | Every backend/frontend gap and ambiguity found, prioritised, each classified F17-blocking / F17-additive / F18 / future / decision-needed. Cross-references [017-A data-gaps](../reporting/data-gaps.md). |
| [f17-f18-boundary.md](f17-f18-boundary.md) | The explicit screen-level F17 vs F18 matrix. Complements [017-A's f17-f18-boundary](../reporting/f17-f18-boundary.md) (which is data/metric-level). |
| [f17-implementation-order.md](f17-implementation-order.md) | Recommended build order, dependency-justified, with the sub-prompt breakdown (F17-01 … F17-13). |
| [f17-traceability-matrix.md](f17-traceability-matrix.md) | Screen → endpoint → DTO → permission → entity → ADR → reporting/design reference → support state. |

## Scope

**F17 = daily operation.** App shell, auth + company selection, operational Home, catalog,
inventory, locations, transfers, sales, sales history, customers, returns, operational approvals,
imports, QR, tenant administration (users, roles, location access, settings), and a minimal
Super-Admin area.

**F18 = advanced analytics** — executive dashboards, trends, comparisons, rankings, charts,
complex aggregation, historical analysis, profitability, inventory valuation, COGS, sales-by-branch
(until the backend supports it), advanced export. See
[f17-f18-boundary.md](f17-f18-boundary.md) and [017-A](../reporting/f17-f18-boundary.md).

F17 may show **only** operational KPIs/indicators the backend already supports for real
([017-A kpis.md](../reporting/kpis.md) — the 7 state-A KPIs and cheap state-B queue counts).

## How to use this spec

1. FASE 17 is implemented in the order of [f17-implementation-order.md](f17-implementation-order.md).
2. Each sub-prompt (F17-01…) takes one module's rows from [f17-screen-catalog.md](f17-screen-catalog.md)
   and [f17-traceability-matrix.md](f17-traceability-matrix.md) as its contract.
3. Anything not in the catalogue is **not in F17**. Anything marked **GAP** is not implemented in
   the frontend — it is raised for a backend decision first.
4. The design canvas informs *layout*; this spec informs *behaviour, data and permissions*. On
   conflict, this spec (and the backend) wins.

## Rule against invention

If a screen needs something the backend does not support: **do not** invent an endpoint, DTO,
permission, state, table or datum; **do not** modify the backend. Record a **GAP** in
[f17-gaps.md](f17-gaps.md). If multiple interpretations are possible, record the ambiguity and the
decision required before implementation.
