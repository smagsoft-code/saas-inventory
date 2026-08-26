-- PROMPT 011-B — a real, narrow, demonstrated-necessity grant: the Import Worker's claim query
-- (import-worker-claim.repository.ts) now JOINs `tenants` to filter out jobs belonging to a
-- suspended/archived tenant, so it needs read access to that table over its own `app_import_worker`
-- connection. `tenants` has no RLS (platform table, access controlled purely by role/GRANT since
-- migration 0001 — database.md#row-level-security) — this is the identical shape as `app_platform`'s
-- own SELECT-only access to `tenants`, narrowed to the one column-set the worker actually needs.
-- SELECT only — the worker never creates/suspends/activates a tenant, only reads its current status.
GRANT SELECT (id, status) ON tenants TO app_import_worker;
