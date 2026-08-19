# Roadmap

High-level phase plan for the SaaS Inventory project. Phases are executed in order; each phase is
driven by its own prompt/spec and is only started once the prior phase is complete and reviewed.

- **FASE 0 — Project Foundation** — monorepo scaffolding, tooling, governance docs. *(in progress)*
- **FASE 1 — Architecture** — formal architecture definition and ADRs.
- **FASE 2 — Infrastructure** — Docker, reverse proxy, environments.
- **FASE 3 — Database** — schema design, Drizzle setup, migrations strategy.
- **FASE 4 — Authentication & Authorization** — auth, sessions, roles.
- **FASE 5 — Tenant Administration** — tenant lifecycle and isolation.
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

No phase beyond FASE 0 has been started.
