import { getRequiredEnvVar } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Applies every pending migration in database/migrations/, in order, as the app_migrator role —
 * never as the application's own app_tenant connection (database.md#migration-strategy).
 *
 * `max: 1` is deliberate, not a default: migration 0000 creates app_migrator and issues
 * `SET ROLE app_migrator` (session-scoped) so every table this sequence creates is owned by
 * app_migrator, not the bootstrap login. SET ROLE only persists for the life of one physical
 * connection/session — with a pooled client (max > 1) a later migration file could be dispatched
 * over a *different* connection that never ran the SET ROLE, silently reverting to the bootstrap
 * role's ownership. One dedicated connection for the whole migration run is what makes the
 * "app_migrator owns every table" invariant actually hold.
 *
 * MIGRATOR_DATABASE_URL must authenticate as a role with CREATEROLE and ownership of the target
 * database for the very first run (see migration 0000's header comment) — in local/dev this is
 * docker-compose.dev.yml's POSTGRES_USER; in a provisioned environment it is whatever role infra
 * grants that privilege to once.
 */
async function main(): Promise<void> {
  const connectionString = getRequiredEnvVar('MIGRATOR_DATABASE_URL');
  const migrationClient = postgres(connectionString, { max: 1 });

  try {
    const db = drizzle(migrationClient);
    await migrate(db, { migrationsFolder: '../../database/migrations' });
    console.log('Migrations applied successfully.');
  } finally {
    await migrationClient.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
