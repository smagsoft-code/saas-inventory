import { sql } from 'drizzle-orm';
import { pgPolicy } from 'drizzle-orm/pg-core';
import { appTenant } from './_roles';

/**
 * The standard tenant-isolation policy shape, per database.md#row-level-security — applied
 * identically to every tenant-owned table. `current_setting(..., true)` (missing_ok) returns
 * NULL instead of raising when app.tenant_id was never set for this session/transaction;
 * `tenant_id = NULL` is never true, so the policy fails closed by construction.
 *
 * `NULLIF(..., '')` guards a real PostgreSQL behavior confirmed by running this against a live
 * instance (PROMPT 03-A): a custom GUC like app.tenant_id only ever reads back as SQL NULL the
 * very first time a session touches it. Once any transaction on that physical connection has
 * SET LOCAL'd it — even once — Postgres's placeholder for that GUC is instantiated with a reset
 * value of empty string, not NULL; every later transaction on the SAME pooled connection that
 * forgets to set its own context (a bug this policy is the last line of defense against, not the
 * expected path — withTenantTransaction() in tenant-context.ts always sets it) then sees `''`,
 * not NULL. Without NULLIF, `''::uuid` throws "invalid input syntax for type uuid" — the query
 * still returns zero rows to the caller (no cross-tenant exposure either way, since a thrown
 * error is not a data leak), but as an ugly unhandled SQL error instead of a clean empty result.
 * NULLIF converts that empty string to NULL first, restoring the clean fail-closed behavior the
 * comment above already promises.
 */
export function tenantIsolationPolicy(tableName: string) {
  return pgPolicy(`${tableName}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    to: appTenant,
    using: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
  });
}
