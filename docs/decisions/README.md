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
| [0004](0004-tenant-isolation-strategy.md) | Tenant Isolation Strategy | Accepted (RLS timing pending) |
| [0005](0005-rest-api.md) | REST API (not GraphQL) | Accepted |
| [0006](0006-nextjs.md) | Next.js for the Web Frontend | Accepted |
| [0007](0007-nestjs.md) | NestJS for the Backend | Accepted |
| [0008](0008-drizzle-orm.md) | Drizzle ORM | Accepted |
| [0009](0009-rbac-permissions.md) | RBAC with Granular, Toggleable Permissions | Accepted |
| [0010](0010-outbox-pattern.md) | Transactional Outbox Pattern for Domain Events | Accepted |
| [0011](0011-n8n-external-automation.md) | n8n as an External, Decoupled Automation Layer | Accepted |
| [0012](0012-telegram-through-n8n.md) | Telegram Notifications Exclusively Through n8n | Accepted |
| [0013](0013-docker-deployment.md) | Docker-based Deployment | Accepted (hosting provider pending) |
| [0014](0014-demo-tenant-strategy.md) | Demo Tenant Strategy | Accepted (reset mechanism pending) |
| [0015](0015-audit-log.md) | Audit Log | Accepted |

These were produced in Prompt 01 (architecture phase) alongside
[docs/architecture/](../architecture/) and [docs/security/threat-model.md](../security/threat-model.md).
