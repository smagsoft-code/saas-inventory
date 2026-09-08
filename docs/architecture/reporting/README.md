# Reporting & Information Architecture — Master Catalog

> **PROMPT 017-A — audited specification, not implementation.** This directory is the *master
> catalogue of information* for SaaS Inventory: metrics, KPIs, reports, dashboards, their
> relationships, their security scope, and — explicitly — what the current backend can and cannot
> produce. **No code, endpoint, migration, schema, RLS or permission is created or changed by
> 017-A.** It is the input to `F17-00 — Frontend Functional Specification` and to `FASE 18 —
> Dashboards & Reports`.

Audited against, at time of writing (HEAD `df12e74`):

- `apps/api/src/**` — every controller, its `@RequirePermissions`, every list-query DTO, every
  response DTO, the services behind them.
- `apps/api/src/database/schema/*.ts` + `database/migrations/*.sql` — every table, column,
  constraint, index, status enum, RLS policy.
- `packages/shared/src/index.ts` — `DEFAULT_ROLE_TEMPLATES` (the permission-to-role matrix).
- `docs/architecture/*` (`database.md`, `modules.md`, `events.md`, `multi-tenancy.md`, `api.md`,
  `security.md`), `docs/decisions/*` (ADR-0004/0009/0010/0015/0017/0019/0020/0021/0022/0023/0024/
  0026/0028/0029/0030/0031/0032/0033), `CLAUDE.md`, `docs/roadmap/roadmap.md`.
- `docs/design/*` (017-DESIGN) — used **only** as a visual reference to map information to screens.

## The files

| File | Answers |
| --- | --- |
| [information-inventory.md](information-inventory.md) | **What data do we actually have?** Every domain, its tables, its states, its timestamps, and which of its data is exposed by an API today. |
| [metrics.md](metrics.md) | **What can we measure?** The metric catalogue — atomic measurable quantities, each with an exact definition, source, scope, permission and A/B/C support state. |
| [kpis.md](kpis.md) | **What indicators can we calculate correctly?** KPIs built from metrics, each tied to a business question, a period, a scope and an A/B/C state. |
| [reports.md](reports.md) | **What detailed information can we consult?** The report catalogue with columns, filters, grouping, totals, export state, drill-down and A/B/C state. |
| [dashboards.md](dashboards.md) | **What should each type of user see?** Operational / executive / analytical dashboards and the SuperAdmin platform dashboard, built only from validated metrics. |
| [matrix.md](matrix.md) | **The master matrix** — Dashboard → KPI → Report → Operational screen → Drill-down, filled only with validated elements. |
| [screen-mapping.md](screen-mapping.md) | **Where is each piece of information shown?** Every 017-DESIGN artboard mapped to its primary/secondary info, KPIs, associated report, actions, filters, permissions, scope, and `PROTOTYPE ONLY` markers. |
| [filters-periods-and-scope.md](filters-periods-and-scope.md) | Reusable filters, period/timezone/currency/precision rules, and the multi-tenancy / location-scope / permission rules every metric, KPI, report and dashboard must obey. |
| [data-gaps.md](data-gaps.md) | The **DATA GAPS** register — every piece of information that cannot be produced today, why, its impact, and its recommended phase. Nothing here is implemented. |
| [f17-f18-boundary.md](f17-f18-boundary.md) | The precise line: what is **operational information F17 needs** vs what is **reserved for F18** dashboards/reporting/analytics. |

## Support-state classification (used everywhere)

Every metric, KPI and report carries exactly one of:

| State | Meaning |
| --- | --- |
| **A — Supported now** | The data exists and there is a realistic way to obtain it with an existing API / query / service. Filtering/paging may still be limited (noted per item), but the value itself is computable and correct against the real model. |
| **B — Partially supported** | The base data exists, but a specific capability is missing: an **aggregation**, a dedicated **endpoint**, a **filter**, a **DTO field**, a specific **query**, a **join/enrichment**, an **authorization scope**, **pagination**, or a **grouping**. The gap is documented in [data-gaps.md](data-gaps.md); it is **not** scheduled or implemented here. |
| **C — Not supported now** | The required datum does not exist, or the current architecture cannot compute it correctly without a schema/contract change (e.g. no reorder-point field → no contractual "low stock"; no `unit_cost` on movements → no COGS from the ledger). Documented in [data-gaps.md](data-gaps.md), not implemented. |

**Rule (017-A §1): information is never invented to complete a mockup.** If the backend has no
reorder point, there is no "low stock" KPI marked A — it is C, with the reason stated. If a
prototype shows a column with no backing contract, it is `PROTOTYPE ONLY` in
[screen-mapping.md](screen-mapping.md), not a requirement.

## Source-of-truth rule (017-A §26)

| Conflict is about… | Authority |
| --- | --- |
| Business / domain (data model, states, rules, permissions, endpoints) | Backend + database + ADRs + current architecture |
| Visual (appearance, layout, tokens, navigation, components) | 017-DESIGN (`docs/design/`) |
| Concrete frontend behaviour of an F17 screen | The future `F17-00` functional specification |

A mockup is never the authority for inventing backend behaviour.

## Where 017-A sits

```
017-DESIGN (visual system + prototypes)  ─┐
                                          ├─►  017-A  (THIS — master information catalogue)  ─►  F17-00 (frontend functional spec)  ─►  FASE 17 (operational modules)
backend + DB + ADRs (audited)  ───────────┘                                                 └─►  FASE 18 (dashboards, KPIs, reporting, analytics)
```

`FASE 18 — Dashboards & Reports` already exists in [roadmap.md](../../roadmap/roadmap.md) as the
REPORTS bounded context ("read-side aggregation across CORE/CATALOG/INVENTORY/SALES … read-optimized
queries … must not reuse the transactional write-path repositories"). 017-A does not change the
roadmap; it fills in what FASE 18 (and the operational slice of FASE 17) will be built against.

## FASE 18 — conceptual plan vs execution (reconciliation)

FASE 18 was planned as ten conceptual blocks. Execution proceeded per **the definition and data
actually available** for each block, so the commit numbering drifted from the conceptual numbering.
The conceptual sequence is kept here as the reference; the commit history is the record of what was
actually built. **Git history is never rewritten to match** — this table is the reconciliation.

| Conceptual | Block | Built as | Commit | Endpoint |
| --- | --- | --- | --- | --- |
| F18-01 | Reporting foundations | F18-01 | `c79d93a` | (`ReportDateRangeQueryDto`, timezone, permission rule) |
| F18-02 | Inventory dashboard / aggregate | F18-02 | `d9a6516` | `GET /reports/sales-summary` |
| F18-03 | Movement analytics | F18-03 | `66df550` | `GET /reports/inventory-summary` + `GET /inventory/movements` date filter |
| **F18-04** | **Transfer analytics** | **F18-08** | *(this phase)* | **`GET /reports/transfers-summary`** |
| F18-05 | Sales analytics | F18-02 (+ F18-06) | `d9a6516` / `e75538a` | `GET /reports/sales-summary` (+ `exceptional` filter) |
| F18-06 | Customer analytics | F18-02 | `d9a6516` | `GET /reports/sales-summary?groupBy=customer` |
| F18-07 | Approvals analytics | F18-05 | `d6812af` | `GET /reports/approvals-summary` |
| F18-08 | Returns analytics | F18-04 | `38ca0b5` | `GET /reports/returns-summary` |
| **F18-09** | **Imports analytics** | **F18-09** | *(this phase)* | **`GET /reports/imports-summary`** |
| F18-10 | Super-Admin platform metrics | *not yet built* | — | — |

Movement analytics also has a dedicated aggregate (`GET /reports/movements-summary`, F18-07,
commit `e640405`) beyond the F18-03 date filter. "F18-04 Transfer analytics" landed as commit
`b02825e` (execution F18-08). The conceptual "F18-09 Imports analytics" slot is what this phase
(commit *feat(reporting): implement imports analytics*) delivers — the execution and conceptual
numbers happen to coincide here.
