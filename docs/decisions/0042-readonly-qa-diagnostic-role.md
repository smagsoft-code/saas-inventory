# ADR-0042: A read-only, tenant-pinned PostgreSQL role for diagnosing the QA tenant

## Status

Proposed (D-8E.26-B4.11, reviewed in B4.11.1). Implemented as migration `0051_qa_readonly_role` and tested on disposable PostgreSQL **16.15** (the project reference) and 18.4; **not applied** to any real database.

## Context

Diagnosing the real data of `qa-dev-tenant` needed a way to read it without writes. The existing options all fail: a login writes `last_login_at` and a session;
`app_platform` has `BYPASSRLS` (and write grants); `app_tenant` can write. The project's tenant isolation is RLS keyed on the session variable `app.tenant_id`
(`TO app_tenant`), which a connection sets itself — acceptable for the application, **not** for a role that may run arbitrary SQL, because it could set the
variable to another tenant's id.

## Decision

A new role `app_qa_readonly` (NOLOGIN until deliberately enabled, no BYPASSRLS, no memberships, no ownership, `SELECT` only on an explicit list of tables and
columns, no default privileges) whose RLS policies do **not** read any session variable: each is `FOR SELECT TO app_qa_readonly USING (tenant_id = (SELECT … FROM
qa_readonly_scope))`, where `qa_readonly_scope` is a `security_barrier` view that resolves the active tenant with slug `qa-dev-tenant`. No new table, no
`SECURITY DEFINER`, no change to an existing policy or grant. It fails closed.

## Alternatives rejected

- **Reuse the `app.tenant_id` policies for a read-only login:** the session could switch tenant.
- **A `SECURITY DEFINER` function returning the scope:** the SQL linter forbids `SECURITY DEFINER` in ordinary migrations; a view achieves the same with no privilege escalation.
- **A new scope table:** adds a table the schema test enumerates and needs a data step to fill; the slug in the migration is reviewable and environment-neutral (absent tenant → no rows).
- **A role-level setting (`ALTER ROLE … SET app.tenant_id`):** a role can override its own settings.
- **A diagnostic endpoint in the API:** a larger surface (`apps/api/src`), not needed for a read.

## Consequences

- The tenant pin is the slug (documented property). `tenant_memberships` has no RLS and is therefore not readable.
- `apps/api/src/database/migration-integrity/sql-lint/rules.ts` lists the role in `PROJECT_ROLES` (otherwise the linter rejects any GRANT to it). That makes a later GRANT to the role only a linter *warning*, so `qa-readonly-role.repo.spec.ts` fails on anything but plain `SELECT`, a membership, a LOGIN/dangerous attribute, default privileges or a policy not pinned to the scope view. Two repo guard specs list `0051` among the privileged migrations.
- The migration creates the role; a role of that name that already exists (roles are cluster-wide) is refused if privileged, entangled or owning objects, and otherwise normalised. No cost or minimum-price column is granted (no demonstrable need). `tenant_memberships` is not readable (no RLS); an aggregate-view alternative is described, not built.
- 0051 is the first privileged migration after 0019: an *incremental* login cannot apply it (bootstrap mode needed), which broke the CI migration-harness assumptions ("all 51", "11 remaining after 40"); its historical scenarios now run on a frozen copy of the first 51 migrations and a new scenario covers 0051 on the full folder.
- Details, the full privilege/column list, tests, usage and revocation: [docs/security/qa-readonly-role.md](../security/qa-readonly-role.md).

## Review B4.11.2 (2026-10-30) — decisions, still Proposed

- **Slug pin:** acceptable only while the role is `NOLOGIN` and `0051` is unapplied. Before any `LOGIN`, move to a scope pinned by tenant **id**, held in a platform-scoped
  configuration row that only the migrator/superuser can write and that is empty by default (closed on new installs). An id constant inside the migration was rejected (it does
  not exist on a fresh install). `0051` is **not** changed in this review. Reason found: `slug` is derived from the company name at registration, so on a database without the QA
  tenant a registration could claim it; no code path edits `slug` afterwards and no audit covers a direct SQL change. See qa-readonly-role.md §10.1.
- **`tenant_memberships`:** stays without SELECT; the role does not verify membership counts. Any such check is a privileged, audited, one-off procedure (§10.2).
- **PUBLIC capabilities:** accepted with the 2-connection limit and the timeouts; no change to `PUBLIC`; operational rule: no migration while a diagnostic session is open (§10.3).
- **CI:** the workflow was reviewed, not run; the role's 38 isolation tests are not part of any CI job (§10.5). Status: pending, not approved.

## Amendment B4.11.3 (2026-10-30) — alternative C implemented; still Proposed

The slug pin is replaced. Migration `0052_qa_readonly_tenant_config` (ordinary, additive; `0051` is not edited) creates `qa_readonly_tenant_config`, a singleton table holding the **UUID** of the authorized tenant, **empty by default**, owned by
`app_migrator` with no privilege for any role (the owner's write privileges are revoked), and replaces `qa_readonly_scope` and `qa_readonly_tenant` with `CREATE OR REPLACE VIEW` so the 27 policies keep depending on the same view by OID.
The scope is that tenant **while it is `active`**; empty configuration, an absent, suspended or archived tenant → no rows (fail closed). The slug and name of a tenant no longer influence authorization. Setting the UUID is a privileged,
explicit, manual operation (qa-readonly-role.md §11.4) that is **not** executed, automated or exposed over HTTP. The earlier "No new table" and "the tenant pin is the slug" statements are superseded. The role remains `NOLOGIN`; `0051` and `0052` are applied to no real database.
Evidence: qa-readonly-role.md §11.5.
