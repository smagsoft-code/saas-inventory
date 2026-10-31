# Architecture Decision Records (ADRs)

An ADR is a short document that records a significant architectural decision: the context that
forced it, the decision itself, the alternatives considered, and the consequences of choosing it.

## Why we use them

- They give future contributors (human or Claude Code) the *why* behind a decision, not just the *what*.
- They prevent re-litigating settled decisions without new information.
- They create an audit trail for decisions that affect security, multi-tenancy, or data integrity.

## When to write one

An ADR is warranted when a decision:

- Changes the approved architecture or stack (see [CLAUDE.md](../../CLAUDE.md)).
- Affects multi-tenancy, security, or data model boundaries.
- Introduces a new external dependency or infrastructure component.
- Would be expensive to reverse later.

Routine implementation choices within an already-approved design do not need an ADR.

## Format

Each ADR lives in this directory as `NNNN-short-title.md` (four-digit sequence number) and covers:

1. **Status** — proposed / accepted / superseded.
2. **Context** — the problem and constraints.
3. **Decision** — what was decided.
4. **Alternatives considered** — and why they were rejected.
5. **Consequences** — trade-offs, follow-up work, risks.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular Monolith over Microservices | Accepted |
| [0002](0002-postgresql.md) | PostgreSQL as the Primary Database | Accepted |
| [0003](0003-single-database-multi-tenant.md) | Single Database, Multi-Tenant | Accepted |
| [0004](0004-tenant-isolation-strategy.md) | Tenant Isolation Strategy | Accepted (RLS timing resolved in Prompt 02) |
| [0005](0005-rest-api.md) | REST API (not GraphQL) | Accepted |
| [0006](0006-nextjs.md) | Next.js for the Web Frontend | Accepted |
| [0007](0007-nestjs.md) | NestJS for the Backend | Accepted |
| [0008](0008-drizzle-orm.md) | Drizzle ORM | Accepted |
| [0009](0009-rbac-permissions.md) | RBAC with Granular, Toggleable Permissions | Accepted |
| [0010](0010-outbox-pattern.md) | Transactional Outbox Pattern for Domain Events | Accepted |
| [0011](0011-n8n-external-automation.md) | n8n as an External, Decoupled Automation Layer | Accepted |
| [0012](0012-telegram-through-n8n.md) | Telegram Notifications Exclusively Through n8n | Accepted |
| [0013](0013-docker-deployment.md) | Docker-based Deployment | Accepted (hosting provider pending) |
| [0014](0014-demo-tenant-strategy.md) | Demo Tenant Strategy | Accepted (reset mechanism resolved in Prompt 02, cadence pending) |
| [0015](0015-audit-log.md) | Audit Log | Accepted |
| [0016](0016-uuid-identifier-strategy.md) | UUIDv7 Primary Keys, Generated in the Application | Accepted |
| [0017](0017-product-variant-attribute-model.md) | Product Model — Hybrid Relational + JSONB, Product/Variant Split | Accepted |
| [0018](0018-tenant-aware-referential-integrity.md) | Tenant-Aware Referential Integrity (Composite Foreign Keys) | Accepted |
| [0019](0019-suppliers-ownership.md) | Suppliers as a CATALOG-Owned Reference Entity | Accepted |
| [0020](0020-multi-location-inventory-transfers.md) | Multi-Location Inventory Transfers and In-Transit Representation | Accepted |
| [0021](0021-sales-returns-disposition.md) | Sales Returns and Disposition via Non-Sellable Locations | Accepted |
| [0022](0022-pricing-tiers-and-discount-approval.md) | Three-Tier Pricing, Price History, and Exceptional-Discount Approval | Accepted |
| [0023](0023-document-type-and-external-invoicing.md) | Document Type Selection (Invoice / Sales Note) and the External-Invoicing Boundary | Accepted |
| [0024](0024-location-scoped-authorization.md) | Location-Scoped Authorization as an RBAC Extension | Accepted |
| [0025](0025-flutter-for-mobile.md) | Flutter for Mobile Applications | Accepted |
| [0026](0026-dynamic-attribute-system.md) | Dynamic Attribute System (`attribute_definitions`, `category_attributes`) | Accepted |
| [0027](0027-staged-excel-import-pipeline.md) | Staged Excel Import Pipeline | Accepted |
| [0028](0028-field-level-price-authorization.md) | Field-Level Authorization for `cost` and `min_price` | Accepted |
| [0029](0029-import-worker-separation.md) | Import Worker as a Separate Process from the Event Processor | Accepted |
| [0030](0030-authentication-foundation.md) | Authentication Foundation — Session Transport, Token Model, and Login/Registration Contract | Accepted |
| [0031](0031-role-assignment-escalation-prevention.md) | Role-Assignment Authorization and Self-Escalation Prevention | Accepted |
| [0032](0032-platform-admin-authentication.md) | Platform-Admin (SuperAdmin) Authentication | Accepted |
| [0033](0033-global-identity-tenant-memberships.md) | Global Identity + Tenant Memberships (database layer) | Accepted |
| [0034](0034-role-permission-self-escalation-prevention.md) | Role-Permission Self-Escalation Prevention | Accepted |
| [0035](0035-location-scope-deny-by-default.md) | Location-Scoped Authorization Defaults to Deny, with a Founding-Administrador Exception | Accepted |
| [0036](0036-tenant-onboarding-and-support.md) | Tenant Onboarding (No SuperAdmin-Set Password) and Tenant Support (Audited, Non-Impersonating Access) | Accepted |
| [0037](0037-inventory-moving-average-cost.md) | Inventory Costing — Weighted-Average, Computed Never Stored | Accepted |
| [0038](0038-order-pdf-export.md) | Order PDF Export — Browser Print Now, Server-Side Generation Deferred | Accepted |
| [0039](0039-mvp-scope-serialized-lot-sales.md) | MVP Scope — Serialized and Lot-Tracked Variants Are Not Sellable | Accepted |
| [0040](0040-seller-scope-for-order-derived-operations.md) | Seller Scope for Order-Derived Operations and Reads | Accepted |
| [0041](0041-migration-identity-and-history-integrity.md) | Migration Identity, History Integrity and Data Migrations under RLS | Proposed (snapshot, pure checks, the migration wrapper and the SQL/RLS linter implemented; verified on disposable 16.15 clusters only; wrapper-bypass paths and PL/pgSQL analysis limits remain open) |
| [0042](0042-readonly-qa-diagnostic-role.md) | A read-only, tenant-pinned PostgreSQL role for diagnosing the QA tenant | Proposed (migration `0051` prepared and tested on a disposable PostgreSQL; **not applied** anywhere) |

ADRs 0001–0015 were produced in Prompt 01 (architecture phase) alongside
[docs/architecture/](../architecture/) and [docs/security/threat-model.md](../security/threat-model.md).
ADRs 0016–0019 were produced in Prompt 02 (database design phase), which also resolved the RLS-timing
and demo-reset-mechanism pending items on 0004 and 0014 — see
[docs/architecture/database.md](../architecture/database.md). ADRs 0020–0024 were produced in
Prompt 02-A (an audit/extension pass over the Prompt 02 design), which also revised `product_variants`'
single `price` column into three tiers (`max_price`/`base_price`/`min_price`) — see
[discrepancy #5](../architecture/database.md#discrepancies-found-and-how-they-were-resolved) in
`database.md`. ADRs 0025–0027 were produced in Prompt 02-B, which closed the dynamic per-tenant/
per-category product attribute system governing Prompt 02's `attributes` JSONB columns, the staged
Excel import pipeline (adding the `INITIAL_STOCK` movement type), and the mobile architecture — see
[docs/architecture/mobile.md](../architecture/mobile.md) and
[discrepancies #7–8](../architecture/database.md#discrepancies-found-and-how-they-were-resolved) in
`database.md`. ADRs 0028–0029 were produced in Prompt 02-D, a controlled correction pass closing the
required (HIGH) findings from the Prompt 02-C consistency audit — see
[discrepancies #9–13](../architecture/database.md#discrepancies-found-and-how-they-were-resolved) in
`database.md`. That pass also standardized every Prompt 02-A/02-B enum/status value to lowercase (no
new ADR — a `CHECK`-list content correction, not a mechanism change) and corrected the
`INITIAL_STOCK`/`ADJUSTMENT_IN` mapping in [ADR-0027](0027-staged-excel-import-pipeline.md)'s design
without reopening that ADR's core decision. ADR-0030 was produced in Prompt 04 (authentication),
which also resolved the web session-transport `PENDING DECISION` on
[frontend.md](../architecture/frontend.md#authentication-and-route-protection) and the
refresh-token-storage `PENDING DECISION` on
[security.md](../architecture/security.md#authentication). ADR-0031 was produced in Prompt 05-A
(tenant/user/role administration), fixing the role-assignment authorization rule
(`core.roles.assign`, unconditional self-role/status block) that RBAC's permission mechanism
([ADR-0009](0009-rbac-permissions.md)) never itself defined. ADR-0032 was produced in FASE 11
(ADMINISTRATION — tenant configuration and system-level administration), closing the
platform-admin (SuperAdmin) authentication mechanism ADR-0030/Prompt 04 deliberately left
unbuilt — see [modules.md#administration](../architecture/modules.md#administration). ADR-0033 was
produced in 016-B (database layer for global identity + tenant memberships), following the
016-AUDIT/016-A audit and architectural-design pass over FASE 16's `tenantSlug`-based login — see
[database.md#global-identity-and-tenant-memberships](../architecture/database.md#global-identity-and-tenant-memberships).
ADR-0034 and ADR-0035 were produced in the ROLES/ALCANCE block (custom-role CRUD and
location-scope UX), closing a self-escalation gap RBAC's permission-editing surface left open and
revising ADR-0024's zero-assignment default from unrestricted to deny-by-default (with a narrow,
named exception for the tenant's founding Administrador role) — see
[f17-gaps.md#gap-role-crud](../architecture/frontend/f17-gaps.md). ADR-0036 was produced in the
TENANT ONBOARDING + TENANT SUPPORT block, closing `GAP-SA-CREATE-TENANT` and resolving
`GAP-SA-IMPERSONATION` — see
[f17-super-admin.md](../architecture/frontend/f17-super-admin.md). ADR-0037 was produced for the
Inventario/Kardex block, resolving `GAP-COST`
([data-gaps.md](../architecture/reporting/data-gaps.md)) — a weighted-average costing engine
(`apps/api/src/inventory/kardex/kardex-costing.ts`) feeding the new `GET /reports/kardex` endpoint.
ADR-0041 (**Proposed**) was produced by the 2026-10-28 migration-safety analysis: which database role runs a migration, how the
Drizzle history is validated before it is trusted, and how data migrations behave under row-level security. Its snapshot
reconciliation, the pure checks (delivery 2a) and the migration wrapper in `migrate.ts` (delivery 2b, D-7.2) are implemented and were exercised
only on disposable PostgreSQL 16.15 clusters. The SQL/RLS linter (D-8D) is also implemented, within the documented limits (PL/pgSQL and dynamic SQL cannot be analysed; paths that bypass the wrapper and historical RLS windows remain open) — see
[migration-integrity.md](../architecture/migration-integrity.md).
