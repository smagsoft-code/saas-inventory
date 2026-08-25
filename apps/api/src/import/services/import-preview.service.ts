import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaginatedResult } from '@saas-inventory/types';
import { withTenantTransaction } from '../../database/tenant-context';
import type { ImportJobRowResponseDto } from '../dto/import-job-row-response.dto';
import type { ImportPreviewResponseDto } from '../dto/import-preview-response.dto';
import type { ImportJobRowRow } from '../repositories/import-job-rows.repository';
import { ImportJobRowsRepository } from '../repositories/import-job-rows.repository';
import { ImportJobsRepository } from '../repositories/import-jobs.repository';

function toRowResponse(row: ImportJobRowRow): ImportJobRowResponseDto {
  return {
    rowNumber: row.rowNumber,
    status: row.status,
    matchAction: row.matchAction ?? undefined,
    matchedProductVariantId: row.matchedProductVariantId ?? undefined,
    rawData: row.rawData as Record<string, unknown>,
    mappedData: (row.mappedData as Record<string, unknown> | null) ?? undefined,
    errors: row.errors,
    warnings: row.warnings,
  };
}

/**
 * §14 — the preview summary and the paginated row listing. Reads only (`import_jobs`'s own
 * maintained counters plus a cheap, index-backed per-status count) — never a full scan, per
 * database.md#preview's explicit instruction.
 */
@Injectable()
export class ImportPreviewService {
  constructor(
    private readonly importJobsRepository: ImportJobsRepository,
    private readonly importJobRowsRepository: ImportJobRowsRepository,
  ) {}

  async preview(tenantId: string, jobId: string): Promise<ImportPreviewResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const job = await this.importJobsRepository.findById(tx, tenantId, jobId);
      if (!job) throw new NotFoundException('Import job not found.');
      const [counts, matchCounts, total] = await Promise.all([
        this.importJobRowsRepository.countsByStatus(tx, tenantId, jobId),
        this.importJobRowsRepository.countsByMatchAction(tx, tenantId, jobId),
        this.importJobRowsRepository.countByJob(tx, tenantId, jobId),
      ]);
      return {
        status: job.status,
        totalRows: total,
        validRows: counts['valid'] ?? 0,
        invalidRows: counts['invalid'] ?? 0,
        warningRows: counts['warning'] ?? 0,
        importedRows: counts['imported'] ?? 0,
        pendingRows: counts['pending'] ?? 0,
        skippedRows: counts['skipped'] ?? 0,
        newProducts: matchCounts['create'] ?? 0,
        existingProducts: matchCounts['update'] ?? 0,
      };
    });
  }

  async listRows(tenantId: string, jobId: string, params: { page: number; pageSize: number; status?: string | undefined }): Promise<PaginatedResult<ImportJobRowResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const job = await this.importJobsRepository.findById(tx, tenantId, jobId);
      if (!job) throw new NotFoundException('Import job not found.');
      const { rows, total } = await this.importJobRowsRepository.listByJob(tx, tenantId, jobId, params);
      return {
        data: rows.map(toRowResponse),
        meta: { page: params.page, pageSize: params.pageSize, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) },
      };
    });
  }
}
