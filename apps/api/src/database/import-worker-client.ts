import { getRequiredEnvVar } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * The Import Worker deployable's own claiming connection — authenticates as the `app_import_worker`
 * Postgres role (migration 0019, ADR-0029). Subject to RLS, but granted one permissive,
 * table-scoped policy on `import_jobs`/`import_job_rows` only (the same shape as
 * `app_event_processor`'s `event_outbox` policy — see database/import-worker's own bootstrap in
 * import-worker/main.ts). Used only to claim a job and update its own status/counters; the actual
 * catalog/inventory writes for a claimed job go through the normal, per-tenant `app_tenant`
 * connection (client.ts's `getDb()`/`withTenantTransaction()`) once the job's tenantId is known —
 * mirroring platform-client.ts's "narrow, explicit, administrative connection, never a general
 * substitute" posture.
 */

let queryClient: postgres.Sql | undefined;

export function getImportWorkerPostgresClient(): postgres.Sql {
  queryClient ??= postgres(getRequiredEnvVar('APP_IMPORT_WORKER_DATABASE_URL'));
  return queryClient;
}

export function getImportWorkerDb() {
  return drizzle(getImportWorkerPostgresClient(), { schema });
}

export type ImportWorkerDatabase = ReturnType<typeof getImportWorkerDb>;

export async function closeImportWorkerPostgresClient(): Promise<void> {
  if (queryClient) {
    await queryClient.end();
    queryClient = undefined;
  }
}
