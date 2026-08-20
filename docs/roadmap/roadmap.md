# Roadmap

High-level phase plan for the SaaS Inventory project. Phases are executed in order; each phase is
driven by its own prompt/spec and is only started once the prior phase is complete and reviewed.

- **FASE 0 — Project Foundation** — monorepo scaffolding, tooling, governance docs. *(done)*
- **FASE 1 — Architecture** — formal architecture definition and ADRs. *(done — see
  [docs/architecture/](../architecture/), [docs/decisions/](../decisions/),
  [docs/security/threat-model.md](../security/threat-model.md))*
- **FASE 2 — Infrastructure** — Docker, reverse proxy, environments. *(done)*
- **FASE 3 — Database** — schema design, Drizzle setup, migrations strategy. *(done — see
  [docs/architecture/database.md](../architecture/database.md), `database/migrations/`)*
- **FASE 4 — Authentication & Authorization** — auth, sessions, roles. *(done — see
  [ADR-0030](../decisions/0030-authentication-foundation.md), `apps/api/src/auth/`,
  `apps/api/src/common/`)*
- **FASE 5 — Tenant Administration** — tenant lifecycle and isolation. *(next)*
- **FASE 6 — Products** — product catalog domain.
- **FASE 7 — Warehouses & Locations** — physical/location model.
- **FASE 8 — Inventory** — stock tracking and movements.
- **FASE 9 — QR** — QR code generation/scanning workflows.
- **FASE 10 — Customers, Cart & Orders** — commerce flow.
- **FASE 11 — Event/Outbox** — outbox pattern for reliable event publishing.
- **FASE 12 — n8n Integration** — webhook consumption, Telegram notifications via n8n.
- **FASE 13 — Dashboards & Reports** — reporting and analytics.
- **FASE 14 — Demo Environment** — sanitized demo/sandbox environment.
- **FASE 15 — Security Hardening** — audit, pen-test remediation, RLS evaluation.
- **FASE 16 — Production Deployment** — production rollout.
- **FASE 17 — MVP Release** — public MVP release.

FASE 1 produced architecture documentation and ADRs only — no business tables, endpoints, or
functionality. FASE 2/3 added the Docker/infra scaffold and the PostgreSQL schema (migrations,
RLS, constraints). FASE 4 added the authentication foundation (registration, login, logout, session
refresh, guards/decorators, RBAC integration) — see
[ADR-0030](../decisions/0030-authentication-foundation.md). No business/domain endpoints (products,
inventory, orders, ...) exist yet — that starts at FASE 6. Several implementation-level decisions
were deliberately left open (RLS activation timing, web session-transport mechanism, product
attribute/variant modeling, demo reset mechanism, and others) and are marked `PENDING DECISION` in
their respective documents; most have since been resolved as the corresponding phase was actually
built — see each document's own text for what, if anything, is still open.
