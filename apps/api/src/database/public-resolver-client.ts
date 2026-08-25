import { getRequiredEnvVar } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * The API's QR-public-resolver-scope connection — authenticates as the `app_public_resolver`
 * Postgres role (database.md#row-level-security). Subject to RLS, but with no `app.tenant_id` to
 * `SET LOCAL`: there is no authenticated session on `GET /q/:code` (api.md#public-endpoints), so
 * this connection never goes through `withTenantTransaction()` (tenant-context.ts) — a plain query
 * is enough, since row/column access is already bounded by the narrow, explicit GRANTs and the
 * `*_public_resolve` policies (qr_codes, products, product_variants, locations — migrations 0003/
 * 0004/0018), not by an application-level tenant filter. This mirrors platform-client.ts's shape
 * exactly (its own separate role/connection for a narrow, explicit purpose), not a general-purpose
 * escape hatch from RLS.
 */

let queryClient: postgres.Sql | undefined;

export function getPublicResolverPostgresClient(): postgres.Sql {
  queryClient ??= postgres(getRequiredEnvVar('APP_PUBLIC_RESOLVER_DATABASE_URL'));
  return queryClient;
}

export function getPublicResolverDb() {
  return drizzle(getPublicResolverPostgresClient(), { schema });
}

export type PublicResolverDatabase = ReturnType<typeof getPublicResolverDb>;

/** For tests/scripts that need to close the pool explicitly. */
export async function closePublicResolverPostgresClient(): Promise<void> {
  if (queryClient) {
    await queryClient.end();
    queryClient = undefined;
  }
}
