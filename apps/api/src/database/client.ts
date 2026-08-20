import { getRequiredEnvVar } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * The API's runtime connection — authenticates as the `app_tenant` Postgres role
 * (database.md#row-level-security). Subject to RLS with FORCE ROW LEVEL SECURITY; every table it
 * can reach is filtered by the tenant_isolation policy. This is the only connection the NestJS
 * process uses for ordinary request handling — SuperAdmin-only cross-tenant reads (app_platform)
 * and the Event Processor / QR public resolver (app_event_processor / app_public_resolver) are
 * separate deployables with their own connections, not built in this phase.
 *
 * Pooling is safe here specifically because every unit of work goes through
 * withTenantTransaction() (see tenant-context.ts), which SET LOCALs the tenant context inside an
 * explicit transaction — SET LOCAL is transaction-scoped, so it can never leak across requests
 * even when the underlying TCP connection is reused by the pool afterward.
 */

let queryClient: postgres.Sql | undefined;

export function getPostgresClient(): postgres.Sql {
  queryClient ??= postgres(getRequiredEnvVar('DATABASE_URL'));
  return queryClient;
}

export function getDb() {
  return drizzle(getPostgresClient(), { schema });
}

export type Database = ReturnType<typeof getDb>;

/** For tests/scripts that need to close the pool explicitly (e.g. after a test suite run). */
export async function closePostgresClient(): Promise<void> {
  if (queryClient) {
    await queryClient.end();
    queryClient = undefined;
  }
}
