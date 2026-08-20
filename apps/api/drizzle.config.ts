import { defineConfig } from 'drizzle-kit';
import { getOptionalEnvVar } from '@saas-inventory/config';

/**
 * Drizzle Kit config for `db:generate`/`db:generate:custom`.
 *
 * `generate` only diffs the TypeScript schema against the migration journal — it never opens a
 * database connection, so `dbCredentials` below is a placeholder for that command. Applying
 * migrations for real uses src/database/migrate.ts (the app_migrator role), not `drizzle-kit
 * migrate`, since the migrator connection must run RLS-exempt DDL that provisions the other
 * roles first — see database.md#row-level-security.
 *
 * Migrations live in database/migrations/ at the repo root, not under apps/api — see
 * ADR-0008 (docs/decisions/0008-drizzle-orm.md) and database/migrations/README.md.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/database/schema/01-platform.ts',
    './src/database/schema/02-core.ts',
    './src/database/schema/03-catalog.ts',
    './src/database/schema/04-qr.ts',
    './src/database/schema/05-inventory.ts',
    './src/database/schema/06-location-auth.ts',
    './src/database/schema/07-transfers.ts',
    './src/database/schema/08-import.ts',
    './src/database/schema/09-sales.ts',
    './src/database/schema/10-notifications.ts',
    './src/database/schema/11-idempotency.ts',
    './src/database/schema/12-auth.ts',
  ],
  out: '../../database/migrations',
  dbCredentials: {
    url: getOptionalEnvVar('MIGRATOR_DATABASE_URL', 'postgresql://unused:unused@localhost:5432/unused'),
  },
  verbose: true,
  strict: true,
});
