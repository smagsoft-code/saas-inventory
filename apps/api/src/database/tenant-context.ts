import { sql } from 'drizzle-orm';
import { getDb } from './client';

/**
 * The mandatory tenant-context pattern from database.md#setting-tenant-context-set-local-transactions-and-connection-pooling.
 *
 * Every database operation the API performs — including a single read — happens inside an
 * explicit transaction, specifically so there is always a transaction for SET LOCAL to be scoped
 * to. app.tenant_id is set via `set_config(..., true)` with a bound parameter (never
 * string-interpolated SQL) so it survives Drizzle's query builder unchanged, and is
 * transaction-local: it is unconditionally cleared on COMMIT/ROLLBACK, even if the physical
 * connection is reused afterward by the driver's pool — this is what makes RLS safe under
 * connection pooling. A bare session-level SET would NOT have this property and must never be
 * used here.
 */

type TenantTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
