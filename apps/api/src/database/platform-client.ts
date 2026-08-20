import { getRequiredEnvVar } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * The API's SuperAdmin-scope connection — authenticates as the `app_platform` Postgres role
 * (database.md#row-level-security). BYPASSRLS; only granted `tenants`/`platform_admins` plus
 * read-only cross-tenant access to tenant tables. Used for narrow, explicit, audited
 * administrative operations only — never as a general-purpose escape hatch from RLS
 * (multi-tenancy.md#administrative--cross-tenant-queries).
 *
 * Prompt 04's one concrete use: self-service registration creates a brand-new `tenants` row
 * before any tenant context can exist for it (there is nothing to `SET LOCAL app.tenant_id` to
 * yet) — `app_tenant` has no GRANT on `tenants` at all (migration 0001), by design, so this
 * connection is the only correct way to perform that single INSERT. Everything else registration
 * does (roles, role_permissions, users, user_roles) is tenant-owned and goes through the normal
 * `withTenantTransaction()` / app_tenant path once the new tenant's id is known.
 */

let queryClient: postgres.Sql | undefined;

export function getPlatformPostgresClient(): postgres.Sql {
  queryClient ??= postgres(getRequiredEnvVar('APP_PLATFORM_DATABASE_URL'));
  return queryClient;
}

export function getPlatformDb() {
  return drizzle(getPlatformPostgresClient(), { schema });
}

export type PlatformDatabase = ReturnType<typeof getPlatformDb>;

/** For tests/scripts that need to close the pool explicitly. */
export async function closePlatformPostgresClient(): Promise<void> {
  if (queryClient) {
    await queryClient.end();
    queryClient = undefined;
  }
}
