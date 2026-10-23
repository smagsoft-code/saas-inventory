import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '../database/tenant-context';

/**
 * Human-readable sequence number of an Excel import: its position (1, 2, 3 …) among the tenant's
 * import jobs by creation time (ties broken by id) — so the ledger can say "Importación #3" instead
 * of printing the job's uuid. Import jobs are never deleted (historical data is kept), so the number
 * of a given job never changes. Derived at read time rather than stored: it needs no migration and
 * also covers every movement written before this existed (those carry the job id in
 * `reference_id`). One batched query for a whole page of movements, never one per row.
 */
export async function resolveImportJobNumbers(tx: TenantTransaction, tenantId: string, jobIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(jobIds)];
  if (unique.length === 0) return new Map();
  const ids = sql.join(unique.map((id) => sql`${id}`), sql`, `);
  const rows = await tx.execute<{ id: string; number: string }>(sql`
    select id, number from (
      select id, row_number() over (order by created_at, id) as number
      from import_jobs
      where tenant_id = ${tenantId}
    ) numbered
    where id in (${ids})
  `);
  return new Map(rows.map((row) => [row.id, Number(row.number)]));
}

/** "Importación #3" (or a neutral "Importación de Excel" if the job is unknown) — never the uuid. */
export function importLabel(jobId: string | null | undefined, numbers: Map<string, number>): string {
  const number = jobId ? numbers.get(jobId) : undefined;
  return number !== undefined ? `Importación #${number}` : 'Importación de Excel';
}
