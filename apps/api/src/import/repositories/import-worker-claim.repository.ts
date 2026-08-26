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
 *
 * PROMPT 011-B: a job belonging to a suspended/archived tenant must never be (re-)claimed —
 * `tenants.status` is read live, joined straight into this same atomic statement rather than a
 * separate round trip, so there is no window between "check status" and "claim" for a suspension
 * to land in. `FOR UPDATE OF ij` (not a bare `FOR UPDATE`) deliberately restricts the row lock to
 * `import_jobs` only — `tenants` is read, never locked, here: locking it would risk this claim
 * query blocking (or being blocked by) `POST /platform/tenants/:id/suspend`'s own `UPDATE tenants
 * SET status = ...`, which would silently delay 011-A's "suspension takes effect on the very next
 * request" guarantee. Requires `GRANT SELECT (id, status) ON tenants TO app_import_worker`
 * (migration 0025) — `tenants` has no RLS (platform table, database.md#row-level-security), so
 * this is access-by-GRANT alone, narrowed to exactly the two columns this JOIN needs.
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
        SELECT ij.id FROM import_jobs ij
        JOIN tenants t ON t.id = ij.tenant_id
        WHERE ij.status IN ('validating', 'importing')
          AND (ij.claimed_at IS NULL OR ij.claimed_at < ${staleBefore})
          AND t.status = 'active'
        ORDER BY ij.created_at
        FOR UPDATE OF ij SKIP LOCKED
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
