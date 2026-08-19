# ADR-0002: PostgreSQL as the Primary Database

## Status

Accepted

## Context

The platform needs a single, durable, transactional data store capable of: strong consistency for
inventory/order operations (see [modules.md](../architecture/modules.md)), row-level tenant
isolation strong enough to add database-enforced policies later (see
[multi-tenancy.md](../architecture/multi-tenancy.md)), and a mature operational ecosystem (backups,
extensions, hosting options) for a small team to run reliably.

## Decision

PostgreSQL is the platform's only database. This was set in the approved stack before this
architecture phase (see [CLAUDE.md](../../CLAUDE.md) and Prompt 00); this ADR records why it holds
up under the architecture defined here.

## Alternatives considered

- **MySQL/MariaDB.** Viable relationally, but PostgreSQL's Row-Level Security (the planned
  defense-in-depth layer for tenant isolation — see
  [multi-tenancy.md#enforcement-layers-defense-in-depth](../architecture/multi-tenancy.md#enforcement-layers-defense-in-depth))
  and JSONB support (needed for flexible product attributes — see
  [database.md#product-model-conceptual](../architecture/database.md#product-model-conceptual))
  are materially stronger in PostgreSQL.
- **A NoSQL document store (e.g. MongoDB).** Rejected: inventory movements, order/cart consistency,
  and tenant isolation all lean heavily on multi-row ACID transactions and relational integrity
  (foreign keys, constraints) — the domain is fundamentally relational, and modeling it
  document-first would push consistency logic into the application layer that the database can
  already guarantee.

## Consequences

- Schema changes are versioned migrations (Drizzle Kit — see
  [ADR-0008](0008-drizzle-orm.md)), which is more ceremony than a schemaless store but gives
  reviewable, reversible, auditable schema evolution.
- Row-Level Security is available if/when the tenant isolation hardening pass activates it (see
  [database.md#row-level-security](../architecture/database.md#row-level-security)) — this
  optionality is a direct reason PostgreSQL was chosen.
- Vertical scaling and read replicas are PostgreSQL's standard scaling levers, matching the growth
  path in [scalability.md](../architecture/scalability.md).
