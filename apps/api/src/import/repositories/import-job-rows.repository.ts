import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';
import { importJobRows } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ImportRowError {
  field: string;
  code: string;
  message: string;
}

export interface ImportJobRowRow {
  id: string;
  tenantId: string;
  importJobId: string;
  rowNumber: number;
  rawData: unknown;
  mappedData: unknown;
  status: string;
  matchAction: string | null;
  matchedProductVariantId: string | null;
  errors: ImportRowError[];
  warnings: ImportRowError[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `import_job_rows` — the staging table itself
 * (database.md#excel-import-pipeline). Never written to by anything outside the IMPORT module;
 * CATALOG/INVENTORY never read it.
 */
@Injectable()
export class ImportJobRowsRepository {
  async insertMany(
    tx: TenantTransaction,
    rows: Array<{ id: string; tenantId: string; importJobId: string; rowNumber: number; rawData: Record<string, unknown> }>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await tx.insert(importJobRows).values(rows);
  }

  async countByJob(tx: TenantTransaction, tenantId: string, importJobId: string): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(importJobRows)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.importJobId, importJobId)));
    return row?.total ?? 0;
  }

  /** A page of `pending` rows for the validation pass — ordered by row_number so a resumed/retried
   * validation run always processes rows in file order. */
  async nextPendingBatch(tx: TenantTransaction, tenantId: string, importJobId: string, batchSize: number): Promise<ImportJobRowRow[]> {
    const rows = await tx
      .select()
      .from(importJobRows)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.importJobId, importJobId), eq(importJobRows.status, 'pending')))
      .orderBy(importJobRows.rowNumber)
      .limit(batchSize);
    return rows as ImportJobRowRow[];
  }

  /** database.md#committing: "resumes from WHERE status IN ('valid','warning') AND status <>
   * 'imported'" — already-imported rows are skipped, giving retry-safety without a separate
   * idempotency mechanism. */
  async nextCommittableBatch(tx: TenantTransaction, tenantId: string, importJobId: string, batchSize: number): Promise<ImportJobRowRow[]> {
    const rows = await tx
      .select()
      .from(importJobRows)
      .where(
        and(
          eq(importJobRows.tenantId, tenantId),
          eq(importJobRows.importJobId, importJobId),
          inArray(importJobRows.status, ['valid', 'warning']),
        ),
      )
      .orderBy(importJobRows.rowNumber)
      .limit(batchSize);
    return rows as ImportJobRowRow[];
  }

  async listByJob(
    tx: TenantTransaction,
    tenantId: string,
    importJobId: string,
    params: { page: number; pageSize: number; status?: string | undefined },
  ): Promise<{ rows: ImportJobRowRow[]; total: number }> {
    const conditions = [eq(importJobRows.tenantId, tenantId), eq(importJobRows.importJobId, importJobId)];
    if (params.status) {
      conditions.push(eq(importJobRows.status, params.status));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(importJobRows).where(where);

    const rows = await tx
      .select()
      .from(importJobRows)
      .where(where)
      .orderBy(importJobRows.rowNumber)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows: rows as ImportJobRowRow[], total: totalRow?.total ?? 0 };
  }

  /** Counts per status — the incremental preview summary (database.md#preview: "without a full
   * table scan on every page load"), backed by the `(tenant_id, import_job_id, status)` index. */
  async countsByStatus(tx: TenantTransaction, tenantId: string, importJobId: string): Promise<Record<string, number>> {
    const rows = await tx
      .select({ status: importJobRows.status, total: count() })
      .from(importJobRows)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.importJobId, importJobId)))
      .groupBy(importJobRows.status);
    return Object.fromEntries(rows.map((row) => [row.status, row.total]));
  }

  /** Counts per resolved `match_action` (`create`/`update`/`skip`, `null` for rows never reaching
   * a valid match) — §14's "new products" / "existing products" preview figures. Same
   * incremental-count shape as countsByStatus, backed by the same index. */
  async countsByMatchAction(tx: TenantTransaction, tenantId: string, importJobId: string): Promise<Record<string, number>> {
    const rows = await tx
      .select({ matchAction: importJobRows.matchAction, total: count() })
      .from(importJobRows)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.importJobId, importJobId)))
      .groupBy(importJobRows.matchAction);
    return Object.fromEntries(rows.map((row) => [row.matchAction ?? 'none', row.total]));
  }

  async setValidationResult(
    tx: TenantTransaction,
    tenantId: string,
    rowId: string,
    values: {
      mappedData: Record<string, unknown>;
      status: 'valid' | 'warning' | 'invalid';
      matchAction: 'create' | 'update' | 'skip' | null;
      matchedProductVariantId: string | null;
      errors: ImportRowError[];
      warnings: ImportRowError[];
    },
  ): Promise<void> {
    await tx
      .update(importJobRows)
      .set(values)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.id, rowId)));
  }

  async markImported(tx: TenantTransaction, tenantId: string, rowId: string, matchedProductVariantId: string): Promise<void> {
    await tx
      .update(importJobRows)
      .set({ status: 'imported', matchedProductVariantId })
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.id, rowId)));
  }

  async markSkipped(tx: TenantTransaction, tenantId: string, rowId: string): Promise<void> {
    await tx
      .update(importJobRows)
      .set({ status: 'skipped' })
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.id, rowId)));
  }

  async markFailed(tx: TenantTransaction, tenantId: string, rowId: string, errors: ImportRowError[]): Promise<void> {
    await tx
      .update(importJobRows)
      .set({ status: 'invalid', errors })
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.id, rowId)));
  }

  /** The whole file's raw rows, in row-number order — used once, up front, by
   * ImportValidationService to build the intra-file duplicate-detection maps (SKU/serial/lot) that
   * a single-row validation pass can never see on its own (database.md#serialized-and-lot-tracked-rows:
   * a duplicate must be caught "against the file's own rows *and* existing tenant data"). Bounded by
   * IMPORT_MAX_ROWS, the same bound the parser itself enforces when first staging the file. */
  async listAllRaw(tx: TenantTransaction, tenantId: string, importJobId: string): Promise<Array<{ rowNumber: number; rawData: Record<string, unknown> }>> {
    const rows = await tx
      .select({ rowNumber: importJobRows.rowNumber, rawData: importJobRows.rawData })
      .from(importJobRows)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.importJobId, importJobId)))
      .orderBy(importJobRows.rowNumber);
    return rows.map((row) => ({ rowNumber: row.rowNumber, rawData: row.rawData as Record<string, unknown> }));
  }
}
