import { getRequiredEnvVar } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * The Event Processor deployable's own claiming connection — authenticates as the
 * `app_event_processor` Postgres role (migration 0000 creates the role; migration 0010 grants it
 * `SELECT, UPDATE ON event_outbox` and the permissive `event_outbox_event_processor_access` policy).
 * Subject to RLS, but that one policy lets it claim/mark rows across every tenant in a single query
 * — that is the whole point of a dedicated role (database.md#row-level-security). Its blast radius
 * is exactly `event_outbox`: it holds no GRANT on any other table, so a compromised Event Processor
 * cannot read `orders`/`customers`/`inventory`/etc. (§43, §44, §164).
 *
 * Used ONLY by the separate Event Processor deployable (`apps/api/src/event-processor/main.ts`) —
 * never by the main API process, never by the Import Worker (ADR-0029: separate deployable, separate
 * DB role, separate claim repository). The parallel of `import-worker-client.ts`.
 */

let queryClient: postgres.Sql | undefined;

export function getEventProcessorPostgresClient(): postgres.Sql {
  queryClient ??= postgres(getRequiredEnvVar('APP_EVENT_PROCESSOR_DATABASE_URL'));
  return queryClient;
}

export function getEventProcessorDb() {
  return drizzle(getEventProcessorPostgresClient(), { schema });
}

export type EventProcessorDatabase = ReturnType<typeof getEventProcessorDb>;

export async function closeEventProcessorPostgresClient(): Promise<void> {
  if (queryClient) {
    await queryClient.end();
    queryClient = undefined;
  }
}
