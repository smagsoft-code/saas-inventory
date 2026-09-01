# Scripts

Operational database scripts (backup, restore, maintenance helpers) that are not migrations.

## Contents

- `reset-demo-tenant.ts` — resets and reseeds the demo tenant (ADR-0014,
  [docs/architecture/database.md#seed-and-demo-tenant](../../docs/architecture/database.md#seed-and-demo-tenant)).
  Resolves the tenant by its fixed `slug = 'demo'` (never a hardcoded id), deletes every row it
  owns in FK-dependency order inside one `app_tenant` + `SET LOCAL app.tenant_id` transaction
  (RLS is a second guarantee on top of the explicit `tenant_id`-scoped deletes — this script
  cannot touch any other tenant's rows), then re-runs the seed. Deliberately **not** an
  `ON DELETE CASCADE` from `tenants` — that capability does not exist anywhere in this schema.

## Running

```sh
pnpm --filter @saas-inventory/api db:reset-demo
```

Reset **cadence** (on-demand vs. scheduled vs. reset-on-login) is an explicit `PENDING DECISION`
deferred to FASE 14 (ADR-0014) — this script only fixes the reset *mechanism*.

- `report-identity-backfill.sql` — read-only report for reviewing the 016-B / [ADR-0033](../../docs/decisions/0033-global-identity-tenant-memberships.md)
  identities backfill (migration `0029`) against a real environment with existing data: summary
  counts, `pending_credential` conflicts (internal ids only, never a password), any excluded
  (empty/invalid-email) `users` rows, and a structural consistency check. Never modifies anything.

```sh
psql "$APP_PLATFORM_DATABASE_URL" -f database/scripts/report-identity-backfill.sql
```
