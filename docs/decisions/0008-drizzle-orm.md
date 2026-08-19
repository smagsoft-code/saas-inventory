# ADR-0008: Drizzle ORM

## Status

Accepted

## Context

Data access needs to: produce safe, parameterized SQL by construction (see
[security.md#input-validation-sql-injection-xss](../architecture/security.md#input-validation-sql-injection-xss)),
support versioned, reviewable migrations (see
[database.md](../architecture/database.md#conventions)), and stay close enough to SQL that
tenant-filtering conventions (see
[multi-tenancy.md](../architecture/multi-tenancy.md#enforcement-layers-defense-in-depth)) and
PostgreSQL-specific features (JSONB, planned RLS) aren't hidden behind heavy abstraction.

## Decision

Drizzle ORM + Drizzle Kit for migrations — set in the approved stack in Prompt 00. Migrations live
in [database/migrations/](../../database/migrations/), one file per schema change, never edited
after being applied (see [CLAUDE.md §7.7](../../CLAUDE.md#77-database)).

## Alternatives considered

- **Prisma.** Strong DX and a mature migration tool, but its query engine and schema DSL sit
  further from raw SQL, which makes some PostgreSQL-specific patterns this platform expects to use
  (RLS-aware queries, precise index/constraint control) more awkward than with Drizzle's
  closer-to-SQL, TypeScript-native query builder.
- **A raw query builder with no ORM (e.g. Kysely alone) or hand-written SQL.** Would satisfy the
  "close to SQL" goal but loses Drizzle Kit's migration tooling and schema-as-TypeScript, which
  doubles as the source of truth for generated types shared with the rest of the backend.
- **A full data-mapper ORM (e.g. TypeORM).** Historically more prone to hidden N+1 query patterns
  and less precise control over generated SQL than Drizzle's query-builder style; avoiding N+1
  queries is an explicit requirement ([CLAUDE.md §7.7](../../CLAUDE.md#77-database)).

## Consequences

- Repositories (see [backend.md](../architecture/backend.md#layering-inside-each-module)) write
  Drizzle queries directly rather than working through a heavier abstraction layer — this keeps the
  tenant-filtering convention visible and reviewable at the query call site.
- Schema is defined in TypeScript (Drizzle's schema DSL), which is also where `tenant_id`,
  timestamp, and soft-delete conventions from [database.md](../architecture/database.md) are
  applied consistently per table.
- No ORM-level "magic" query generation across relations that could silently produce N+1 patterns
  or bypass tenant filtering — joins and includes are explicit.
