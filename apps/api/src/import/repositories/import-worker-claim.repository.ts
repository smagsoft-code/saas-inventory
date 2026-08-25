import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getOptionalEnvVar } from '@saas-inventory/config';
import type { ImportWorkerDatabase } from '../../database/import-worker-client';

export interface ClaimedImportJob {
  id: string;
  tenantId: string;
  status: 'validating' | 'importing';
  createdBy: string;
}

function staleClaimMs(): number {
  return Number(getOptionalEnvVar('IMPORT_WORKER_STALE_CLAIM_MS', '600000'));
}

/**
 * The Import Worker's claim query — database.md#large-imports' "identical mechanism" to
 * event_outbox's (database.md#outbox), applied to `import_jobs` instead: `FOR UPDATE SKIP LOCKED`
 * inside a CTE, then an UPDATE that stamps claimed_at/claimed_by, all in one atomic statement so
 * concurrent worker instances never double-claim the same job. Runs over the dedicated
 * app_import_worker connection (import-worker-client.ts) — never the normal per-tenant app_tenant
 * connection, since this query is intentionally cross-tenant.
 */
@Injectable()
export class ImportWorkerClaimRepository {
  async claimBatch(db: ImportWorkerDatabase, workerId: string, batchSize: number): Promise<ClaimedImportJob[]> {
    // .toISOString(), not the raw Date: drizzle-orm's db.execute(sql\`...\`) raw-SQL path does not
    // serialize an interpolated Date the way its typed query builders do — confirmed running this
    // for real against PostgreSQL (`TypeError: ... Received an instance of Date`, tools/pg-verify's
    // worker-claim suite). An ISO string binds cleanly against the timestamptz column either way.
    const staleBefore = new Date(Date.now() - staleClaimMs()).toISOString();
    const result = await db.execute<{ id: string; tenant_id: string; status: 'validating' | 'importing'; created_by: string }>(sql`
      WITH claimed AS (
        SELECT id FROM import_jobs
        WHERE status IN ('validating', 'importing')
          AND (claimed_at IS NULL OR claimed_at < ${staleBefore})
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE import_jobs
      SET claimed_at = now(), claimed_by = ${workerId}
      WHERE id IN (SELECT id FROM claimed)
      RETURNING id, tenant_id, status, created_by
    `);
    return result.map((row) => ({ id: row.id, tenantId: row.tenant_id, status: row.status, createdBy: row.created_by }));
  }
}
