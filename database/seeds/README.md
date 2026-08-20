# Seeds

Idempotent data-seeding scripts (reference/lookup data, demo tenants) run after migrations.

Rules:

- No real customer or production data is ever seeded.
- Demo/seed credentials are never reused in production.

## Contents

- `default-role-templates.ts` — the fixed application-level role template
  (Administrador/Supervisor/Vendedor/Bodega) copied into a newly-created tenant's
  `roles`/`role_permissions` — see
  [docs/architecture/database.md#rbac-roles-permissions](../../docs/architecture/database.md#rbac-roles-permissions).
- `demo-tenant.ts` — the demo tenant seed (ADR-0014), keyed by `tenants.slug = 'demo'`. Every
  starting inventory quantity is written as an `INITIAL_STOCK` ledger row first, never a bare
  `inventory_balances` insert.
- `run.ts` — entrypoint. `permissions`/`measurement_units` are **not** seeded here — they are
  migration-managed data (see `database/migrations/0001_platform_tables.sql` and
  `0003_catalog.sql`), not environment-dependent seeds.

## Running

```sh
pnpm --filter @saas-inventory/api db:seed
```

Requires `MIGRATOR_DATABASE_URL` (writes the `tenants` row) and `DATABASE_URL` (writes every
tenant-scoped row through `app_tenant` + `SET LOCAL app.tenant_id` — RLS is a live guarantee for
seed data too, not bypassed). See `database/scripts/reset-demo-tenant.ts` to reset and reseed.
