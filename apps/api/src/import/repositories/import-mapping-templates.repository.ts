import { Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { importMappingTemplates } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ImportMappingTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  categoryId: string | null;
  columnMapping: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `import_mapping_templates` — saved, reusable column
 * mappings (database.md#excel-import-pipeline). Hard-deleted (no deleted_at), per that table's own
 * schema comment: safe because `import_jobs.column_mapping` is always a frozen copy, never a live
 * reference.
 */
@Injectable()
export class ImportMappingTemplatesRepository {
  async findById(tx: TenantTransaction, tenantId: string, templateId: string): Promise<ImportMappingTemplateRow | undefined> {
    const [row] = await tx
      .select()
      .from(importMappingTemplates)
      .where(and(eq(importMappingTemplates.tenantId, tenantId), eq(importMappingTemplates.id, templateId)));
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number },
  ): Promise<{ rows: ImportMappingTemplateRow[]; total: number }> {
    const where = eq(importMappingTemplates.tenantId, tenantId);
    const [totalRow] = await tx.select({ total: count() }).from(importMappingTemplates).where(where);
    const rows = await tx
      .select()
      .from(importMappingTemplates)
      .where(where)
      .orderBy(importMappingTemplates.name)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    return { rows, total: totalRow?.total ?? 0 };
  }

  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; name: string; categoryId?: string | null | undefined; columnMapping: Record<string, string>; createdBy: string },
  ): Promise<ImportMappingTemplateRow> {
    const [row] = await tx.insert(importMappingTemplates).values(values).returning();
    if (!row) {
      throw new Error('Import mapping template insert did not return a row.');
    }
    return row;
  }

  async update(
    tx: TenantTransaction,
    tenantId: string,
    templateId: string,
    values: { name?: string; categoryId?: string | null; columnMapping?: Record<string, string> },
  ): Promise<ImportMappingTemplateRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, templateId);
    }
    const [row] = await tx
      .update(importMappingTemplates)
      .set(values)
      .where(and(eq(importMappingTemplates.tenantId, tenantId), eq(importMappingTemplates.id, templateId)))
      .returning();
    return row;
  }

  async delete(tx: TenantTransaction, tenantId: string, templateId: string): Promise<boolean> {
    const rows = await tx
      .delete(importMappingTemplates)
      .where(and(eq(importMappingTemplates.tenantId, tenantId), eq(importMappingTemplates.id, templateId)))
      .returning({ id: importMappingTemplates.id });
    return rows.length > 0;
  }
}
