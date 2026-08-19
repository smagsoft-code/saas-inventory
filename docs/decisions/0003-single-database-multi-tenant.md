# ADR-0003: Single Database, Multi-Tenant (not Database- or Schema-per-Tenant)

## Status

Accepted

## Context

The platform must serve many companies (tenants) from one deployment, and must plausibly scale to
thousands of tenants (see [scalability.md](../architecture/scalability.md)) without the
operational model changing. Three broad multi-tenancy data models exist: database-per-tenant,
schema-per-tenant, and single-database-with-tenant-column.

## Decision

One PostgreSQL database, shared by all tenants, with every tenant-owned table carrying a
`tenant_id` column. Full detail and enforcement strategy in
[multi-tenancy.md](../architecture/multi-tenancy.md).

## Alternatives considered

- **Database-per-tenant.** Strongest isolation (a bug literally cannot cross a database
  connection), but each new tenant means a new database to provision, migrate, back up, and
  monitor — this does not scale operationally to the thousands-of-tenants target; migrations alone
  become an O(tenants) operation instead of O(1).
- **Schema-per-tenant (one Postgres schema per company, same database).** A middle ground, but
  still multiplies migration execution and connection-pool/schema-search-path complexity per
  tenant, and most Postgres tooling (including Drizzle Kit) is not built around dynamically
  targeting one of thousands of schemas per request. Same operational scaling problem as
  database-per-tenant, just less severe.
- **Single database, tenant column (chosen).** One schema, one set of migrations, one connection
  pool, regardless of tenant count. The cost is that isolation must be actively enforced (it is not
  free from the topology the way database-per-tenant's is) — addressed by
  [ADR-0004](0004-tenant-isolation-strategy.md).

## Consequences

- Isolation is a first-class, continuously-enforced concern (guards, repository filtering, planned
  RLS) rather than a structural given — this is the direct trade made for operational simplicity at
  scale, and it is why tenant isolation gets its own dedicated ADR, architecture document, and
  top billing in the threat model.
- Onboarding a new tenant is a data operation (`INSERT INTO tenants ...`), not an infrastructure
  operation (no new database/schema to provision), which is what makes reaching thousands of
  tenants operationally realistic.
- Cross-tenant administrative queries (SuperAdmin metrics, etc.) are straightforward — a single
  query can aggregate across tenants when that is explicitly what's needed — versus requiring
  fan-out across many databases/schemas.
