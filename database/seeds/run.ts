/**
 * Seed entrypoint — run after migrations, per database/seeds/README.md. Only the demo tenant is
 * seeded here; `permissions`/`measurement_units` are migration-managed data (see migrations
 * 0001/0003), not seeds — database.md#seed-and-demo-tenant.
 */
import { closePostgresClient } from '../../apps/api/src/database/client';
import { seedDemoTenant } from './demo-tenant';

// withTenantTransaction() (called by seedDemoTenant) lazily opens a pooled connection via
// apps/api's client.ts singleton and never closes it on its own — postgres.js keeps idle
// connections open by default, so without this explicit close the process never exits on its
// own once the seed finishes, even on success. Discovered by running this for real against a
// live PostgreSQL instance (PROMPT 03-A): the script printed "Demo tenant ready" and then hung
// indefinitely instead of returning control to its caller.
seedDemoTenant()
  .catch((error: unknown) => {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresClient());
