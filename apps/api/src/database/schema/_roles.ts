import { pgRole } from 'drizzle-orm/pg-core';

/**
 * Postgres roles, per database.md#row-level-security. All five are created (with their base
 * GRANTs/attributes) by the custom SQL in migration 0000_extensions_and_roles.sql — marked
 * `.existing()` here so `drizzle-kit generate` never tries to (re-)create them itself and only
 * emits the CREATE POLICY / ENABLE ROW LEVEL SECURITY statements that reference them.
 */

/** Drizzle Kit (CI/deploy). Table owner — RLS does not apply to it. */
export const appMigrator = pgRole('app_migrator').existing();

/** NestJS API, all normal tenant-scoped requests. Subject to RLS, FORCE ROW LEVEL SECURITY. */
export const appTenant = pgRole('app_tenant').existing();

/** NestJS API, SuperAdmin-only service methods. BYPASSRLS. */
export const appPlatform = pgRole('app_platform').existing();

/** Event Processor worker. Subject to RLS, one permissive table-scoped policy on event_outbox. */
export const appEventProcessor = pgRole('app_event_processor').existing();

/** QR public resolver endpoint. Subject to RLS, one narrow SELECT policy on qr_codes. */
export const appPublicResolver = pgRole('app_public_resolver').existing();

/** Import Worker (ADR-0029, FASE 10). Subject to RLS, one permissive table-scoped policy each on
 * import_jobs/import_job_rows — the same shape as app_event_processor's event_outbox policy, sized
 * to the two tables this worker claims/updates cross-tenant. Not created by migration 0000 (that
 * migration predates ADR-0027/0029); created by migration 0019 instead, following the precedent
 * that an applied migration is never edited retroactively. */
export const appImportWorker = pgRole('app_import_worker').existing();
