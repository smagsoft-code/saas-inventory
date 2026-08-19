# ADR-0004: Tenant Isolation Strategy

## Status

Accepted (core strategy); RLS activation timing is a documented `PENDING DECISION`, see
[Consequences](#consequences).

## Context

Given single-database multi-tenancy ([ADR-0003](0003-single-database-multi-tenant.md)), isolation
between tenants must be actively enforced rather than structurally guaranteed by the database
topology. This is the platform's single highest-priority security property — see the
[threat model](../security/threat-model.md#cross-tenant-access) (P0).

## Decision

Full design in [multi-tenancy.md](../architecture/multi-tenancy.md). Summary:

1. Tenant context is derived exclusively from the verified auth token's claims — never from
   request body, query string, or arbitrary headers.
2. A Tenant Guard resolves this context once per request, before any controller runs.
3. The repository/data-access layer filters every tenant-owned-table query by `tenant_id` as a
   structural convention, not a per-call-site reminder.
4. PostgreSQL Row-Level Security is planned as an additional, database-enforced backstop layer, on
   top of (not instead of) layers 1–3.
5. SuperAdmin is a structurally separate identity (`platform_admins`, not a role inside `users`),
   so tenant isolation logic and SuperAdmin-scope logic can never be confused with each other — see
   [multi-tenancy.md#superadmin-vs-tenant](../architecture/multi-tenancy.md#superadmin-vs-tenant).

## Alternatives considered

- **Trust a tenant identifier supplied by the client (e.g. a header or subdomain the client sets).**
  Rejected outright — this makes cross-tenant access a matter of changing a request value, which is
  exactly the P0 risk this ADR exists to prevent.
- **Rely on RLS alone, without application-layer filtering.** Rejected as the sole layer: RLS
  depends on every code path (including migrations, seed scripts, and any future admin tooling)
  correctly setting the session variable it checks — a single path that forgets to set it, without
  RLS turned on for that table, fails open. Application-layer filtering is enforced by code review
  and repository structure, which is a more legible failure mode to defend during implementation
  than "did every path remember to `SET LOCAL app.tenant_id`."
- **Model SuperAdmin as a role/flag on the regular `users` table.** Rejected — this would put a
  single boolean/enum value between "ordinary tenant user" and "can see every tenant," which is a
  much thinner safety margin than a structurally distinct identity and login path.

## Consequences

- Every new tenant-owned table's repository must implement tenant filtering — this is now a
  checklist item for [Definition of Done](../../CLAUDE.md#79-definition-of-done) and for code
  review, not optional.
- **`PENDING DECISION`:** whether RLS policies are added starting with the first schema migration
  (Prompt 02) or introduced later as a FASE 15 hardening pass — see
  [database.md#row-level-security](../architecture/database.md#row-level-security) for the
  trade-off. This does not block Prompt 02 database design; it affects whether Prompt 02's
  migrations include `ENABLE ROW LEVEL SECURITY` statements or not.
- SuperAdmin functionality is necessarily a separate set of endpoints/guards/UI area (see
  [frontend.md](../architecture/frontend.md#app-router-structure)), not a mode switch inside the
  tenant application.
