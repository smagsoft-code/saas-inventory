import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { getOptionalEnvVar } from '@saas-inventory/config';
import type { PaginatedResult } from '@saas-inventory/types';
import { withTenantTransaction } from '../../database/tenant-context';
import type { ImportJobResponseDto } from '../dto/import-job-response.dto';
import { assertTransition } from '../import-job-state-machine';
import { assertValidColumnMapping } from '../import-fields';
import type { ImportJobRow, ImportJobStatus } from '../repositories/import-jobs.repository';
import { ImportJobsRepository } from '../repositories/import-jobs.repository';
import { ImportJobRowsRepository } from '../repositories/import-job-rows.repository';
import { ImportMappingTemplatesRepository } from '../repositories/import-mapping-templates.repository';
import { ImportFileService, ImportFileStorage } from './import-file.service';
import { ImportValidationService } from './import-validation.service';
import { ImportExecutionService } from './import-execution.service';
import { ImportAuditService } from './import-audit.service';

function toJobResponse(row: ImportJobRow): ImportJobResponseDto {
  return {
    id: row.id,
    status: row.status,
    originalFilename: row.originalFilename,
    duplicateHandlingMode: row.duplicateHandlingMode,
    defaultLocationId: row.defaultLocationId ?? undefined,
    mappingTemplateId: row.mappingTemplateId ?? undefined,
    columnMapping: row.columnMapping as Record<string, string>,
    totalRows: row.totalRows ?? undefined,
    validRows: row.validRows ?? undefined,
    invalidRows: row.invalidRows ?? undefined,
    warningRows: row.warningRows ?? undefined,
    importedRows: row.importedRows ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function syncRowThreshold(): number {
  return Number(getOptionalEnvVar('IMPORT_SYNC_ROW_THRESHOLD', '500'));
}

export interface CreateImportJobInput {
  originalFilename: string;
  mimeType: string;
  fileBuffer: Buffer;
  mappingTemplateId?: string | undefined;
  columnMapping?: Record<string, string> | undefined;
  defaultLocationId?: string | undefined;
  duplicateHandlingMode?: string | undefined;
}

/**
 * §24's `ImportJobService` — the orchestrator: creates the job (upload -> staging), lists/reads,
 * cancels, and decides sync-vs-worker for validate/confirm (database.md#large-imports' threshold),
 * delegating the actual row-processing work to ImportValidationService/ImportExecutionService
 * either way so the two paths share one implementation.
 */
@Injectable()
export class ImportJobService {
  constructor(
    private readonly importJobsRepository: ImportJobsRepository,
    private readonly importJobRowsRepository: ImportJobRowsRepository,
    private readonly fileService: ImportFileService,
    private readonly fileStorage: ImportFileStorage,
    private readonly validationService: ImportValidationService,
    private readonly executionService: ImportExecutionService,
    private readonly auditService: ImportAuditService,
    private readonly mappingTemplatesRepository: ImportMappingTemplatesRepository,
  ) {}

  async list(tenantId: string, params: { page: number; pageSize: number; status?: string | undefined }): Promise<PaginatedResult<ImportJobResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.importJobsRepository.listByTenant(tx, tenantId, params);
      return {
        data: rows.map(toJobResponse),
        meta: { page: params.page, pageSize: params.pageSize, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) },
      };
    });
  }

  async getById(tenantId: string, jobId: string): Promise<ImportJobResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.importJobsRepository.findById(tx, tenantId, jobId);
      if (!row) throw new NotFoundException('Import job not found.');
      return toJobResponse(row);
    });
  }

  async create(tenantId: string, actorId: string, input: CreateImportJobInput): Promise<ImportJobResponseDto> {
    this.fileService.assertUploadIsAcceptable(input.originalFilename, input.mimeType, input.fileBuffer.length);
    const parsed = await this.fileService.parse(input.fileBuffer);

    const jobId = generateId();
    const storageKey = await this.fileStorage.storeUpload(tenantId, jobId, input.fileBuffer);

    return withTenantTransaction(tenantId, async (tx) => {
      const job = await this.importJobsRepository.create(tx, {
        id: jobId,
        tenantId,
        createdBy: actorId,
        columnMapping: input.columnMapping ?? {},
        duplicateHandlingMode: input.duplicateHandlingMode ?? 'update_catalog_only',
        storageKey,
        originalFilename: input.originalFilename,
      });

      await this.importJobRowsRepository.insertMany(
        tx,
        parsed.rows.map((row) => ({ id: generateId(), tenantId, importJobId: jobId, rowNumber: row.rowNumber, rawData: row.data })),
      );

      // An upload that already supplies a mapping goes straight to `mapping` (§9) — otherwise it
      // stays `uploaded` until a separate POST .../mapping call.
      if (input.mappingTemplateId || input.columnMapping) {
        let resolvedMapping: Record<string, string>;
        if (input.columnMapping) {
          resolvedMapping = input.columnMapping;
        } else {
          const template = await this.mappingTemplatesRepository.findById(tx, tenantId, input.mappingTemplateId!);
          if (!template) throw new NotFoundException('Mapping template not found.');
          resolvedMapping = template.columnMapping as Record<string, string>;
        }
        assertValidColumnMapping(resolvedMapping);
        assertTransition('uploaded', 'mapping');
        const updated = await this.importJobsRepository.update(tx, tenantId, jobId, {
          status: 'mapping',
          columnMapping: resolvedMapping,
          ...(input.mappingTemplateId !== undefined ? { mappingTemplateId: input.mappingTemplateId } : {}),
          ...(input.defaultLocationId !== undefined ? { defaultLocationId: input.defaultLocationId } : {}),
        });
        return toJobResponse(updated ?? job);
      }
      if (input.defaultLocationId !== undefined) {
        const updated = await this.importJobsRepository.update(tx, tenantId, jobId, { defaultLocationId: input.defaultLocationId });
        return toJobResponse(updated ?? job);
      }
      return toJobResponse(job);
    });
  }

  /** `mapping -> validating` (§10). Small files validate synchronously within this call; large
   * files flip to `validating` and return immediately — the Import Worker picks them up
   * (database.md#large-imports). Retrying a `failed` job is only routed here when validation
   * itself never finished (§21 — `totalRows` is only ever set once the validation pass
   * completes); a job that failed *after* reaching `ready` must be retried via confirm instead,
   * since re-validating would be pointless and re-running commit is the actual recovery. */
  async triggerValidate(tenantId: string, jobId: string, actorId: string): Promise<ImportJobResponseDto> {
    const job = await withTenantTransaction(tenantId, async (tx) => {
      const current = await this.importJobsRepository.findByIdForUpdate(tx, tenantId, jobId);
      if (!current) throw new NotFoundException('Import job not found.');
      if (current.status === 'failed' && current.totalRows !== null) {
        throw new ConflictException('This job already completed validation — retry via confirm, not validate.');
      }
      assertTransition(current.status as ImportJobStatus, 'validating');
      const updated = await this.importJobsRepository.update(tx, tenantId, jobId, { status: 'validating', startedAt: current.startedAt ?? new Date() });
      return updated!;
    });

    const totalRows = await withTenantTransaction(tenantId, (tx) => this.importJobRowsRepository.countByJob(tx, tenantId, jobId));
    if (totalRows > syncRowThreshold()) {
      return toJobResponse(job);
    }

    return this.runValidation(tenantId, jobId, actorId);
  }

  /** Shared by the synchronous path above and ImportWorkerService — identical call, different
   * caller. */
  async runValidation(tenantId: string, jobId: string, actorId: string): Promise<ImportJobResponseDto> {
    try {
      await this.validationService.validateJob(tenantId, jobId, actorId);
    } catch (error) {
      await this.markFailedAndAudit(tenantId, jobId);
      throw error;
    }
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.importJobsRepository.findById(tx, tenantId, jobId);
      return toJobResponse(row!);
    });
  }

  /** `ready -> importing` (§10). §16/§20 — `update_catalog_and_inventory` additionally requires
   * `import.inventory`, checked here (service layer), not just the route's `import.execute` gate.
   * Retrying a `failed` job is only routed here once validation has actually completed
   * (`totalRows !== null`) — see triggerValidate's matching guard. */
  async triggerConfirm(tenantId: string, jobId: string, actorId: string, actorPermissions: string[]): Promise<ImportJobResponseDto> {
    const job = await withTenantTransaction(tenantId, async (tx) => {
      const current = await this.importJobsRepository.findByIdForUpdate(tx, tenantId, jobId);
      if (!current) throw new NotFoundException('Import job not found.');
      if (current.status === 'failed' && current.totalRows === null) {
        throw new ConflictException('This job never completed validation — retry via validate, not confirm.');
      }
      assertTransition(current.status as ImportJobStatus, 'importing');
      if (current.duplicateHandlingMode === 'update_catalog_and_inventory' && !actorPermissions.includes('import.inventory')) {
        throw new ForbiddenException('import.inventory permission is required for update_catalog_and_inventory imports.');
      }
      const updated = await this.importJobsRepository.update(tx, tenantId, jobId, { status: 'importing', startedAt: current.startedAt ?? new Date() });
      return updated!;
    });

    const remainingRows = await withTenantTransaction(tenantId, async (tx) => {
      const counts = await this.importJobRowsRepository.countsByStatus(tx, tenantId, jobId);
      return (counts['valid'] ?? 0) + (counts['warning'] ?? 0);
    });
    if (remainingRows > syncRowThreshold()) {
      return toJobResponse(job);
    }

    return this.runCommit(tenantId, jobId, actorId);
  }

  /** Shared by the synchronous path above and ImportWorkerService. */
  async runCommit(tenantId: string, jobId: string, actorId: string): Promise<ImportJobResponseDto> {
    try {
      await this.executionService.commitJob(tenantId, jobId, actorId);
    } catch (error) {
      await this.markFailedAndAudit(tenantId, jobId);
      throw error;
    }
    return withTenantTransaction(tenantId, async (tx) => {
      const current = await this.importJobsRepository.findById(tx, tenantId, jobId);
      if (!current) throw new NotFoundException('Import job not found.');
      const finalStatus: ImportJobStatus = (current.invalidRows ?? 0) > 0 ? 'completed_with_errors' : 'completed';
      const updated = await this.importJobsRepository.update(tx, tenantId, jobId, { status: finalStatus, completedAt: new Date() });
      await this.auditService.recordTerminalState(tx, tenantId, updated!, finalStatus);
      return toJobResponse(updated!);
    });
  }

  async cancel(tenantId: string, jobId: string): Promise<ImportJobResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const current = await this.importJobsRepository.findByIdForUpdate(tx, tenantId, jobId);
      if (!current) throw new NotFoundException('Import job not found.');
      assertTransition(current.status as ImportJobStatus, 'cancelled');
      const updated = await this.importJobsRepository.update(tx, tenantId, jobId, { status: 'cancelled', completedAt: new Date() });
      await this.auditService.recordTerminalState(tx, tenantId, updated!, 'cancelled');
      return toJobResponse(updated!);
    });
  }

  private async markFailedAndAudit(tenantId: string, jobId: string): Promise<void> {
    await withTenantTransaction(tenantId, async (tx) => {
      const current = await this.importJobsRepository.findByIdForUpdate(tx, tenantId, jobId);
      if (!current) return;
      if (!['validating', 'importing'].includes(current.status)) return;
      const updated = await this.importJobsRepository.update(tx, tenantId, jobId, { status: 'failed', completedAt: new Date() });
      await this.auditService.recordTerminalState(tx, tenantId, updated!, 'failed');
    });
  }
}
