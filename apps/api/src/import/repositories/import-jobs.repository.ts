import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { importJobs } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ImportJobRow {
  id: string;
  tenantId: string;
  createdBy: string;
  defaultLocationId: string | null;
  mappingTemplateId: string | null;
  columnMapping: unknown;
  duplicateHandlingMode: string;
  storageKey: string;
  originalFilename: string;
  status: string;
  totalRows: number | null;
  validRows: number | null;
  invalidRows: number | null;
  warningRows: number | null;
  importedRows: number | null;
  errorReportStorageKey: string | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const IMPORT_JOB_STATUSES = [
  'uploaded',
  'mapping',
  'validating',
  'ready',
  'importing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/**
 * Tenant-scoped, RLS-backed reads/writes on `import_jobs` — same per-transaction convention as
 * every other repository in this codebase (database.md#excel-import-pipeline, ADR-0027).
 */
@Injectable()
export class ImportJobsRepository {
  async findById(tx: TenantTransaction, tenantId: string, jobId: string): Promise<ImportJobRow | undefined> {
    const [row] = await tx.select().from(importJobs).where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)));
    return row;
  }

  /** Row-locked read — used by the confirm/validate/cancel paths so a concurrent request against
   * the same job serializes on this row before any state transition, mirroring
   * inventory/transfers/transfers.service.ts's own header-lock-first convention. */
  async findByIdForUpdate(tx: TenantTransaction, tenantId: string, jobId: string): Promise<ImportJobRow | undefined> {
    const [row] = await tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)))
      .for('update');
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; status?: string | undefined },
  ): Promise<{ rows: ImportJobRow[]; total: number }> {
    const conditions = [eq(importJobs.tenantId, tenantId)];
    if (params.status) {
      conditions.push(eq(importJobs.status, params.status));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(importJobs).where(where);

    const rows = await tx
      .select()
      .from(importJobs)
      .where(where)
      .orderBy(sql`${importJobs.createdAt} DESC`)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  async create(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      createdBy: string;
      defaultLocationId?: string | null | undefined;
      mappingTemplateId?: string | null | undefined;
      columnMapping: Record<string, string>;
      duplicateHandlingMode: string;
      storageKey: string;
      originalFilename: string;
    },
  ): Promise<ImportJobRow> {
    const [row] = await tx.insert(importJobs).values(values).returning();
    if (!row) {
      throw new Error('Import job insert did not return a row.');
    }
    return row;
  }

  async update(
    tx: TenantTransaction,
    tenantId: string,
    jobId: string,
    values: {
      columnMapping?: Record<string, string>;
      mappingTemplateId?: string | null;
      defaultLocationId?: string | null;
      duplicateHandlingMode?: string;
      status?: string;
      totalRows?: number | null;
      validRows?: number | null;
      invalidRows?: number | null;
      warningRows?: number | null;
      importedRows?: number | null;
      errorReportStorageKey?: string | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
    },
  ): Promise<ImportJobRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, jobId);
    }
    const [row] = await tx
      .update(importJobs)
      .set(values)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)))
      .returning();
    return row;
  }
}
