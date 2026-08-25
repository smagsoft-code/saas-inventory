import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { CategoriesRepository } from '../../catalog/repositories/categories.repository';
import { withTenantTransaction } from '../../database/tenant-context';
import { LocationsRepository } from '../../inventory/repositories/locations.repository';
import { assertTransition } from '../import-job-state-machine';
import { assertValidColumnMapping } from '../import-fields';
import type { CreateMappingTemplateDto, UpdateMappingTemplateDto } from '../dto/mapping-template.dto';
import type { MappingTemplateResponseDto } from '../dto/mapping-template.dto';
import type { SetMappingDto } from '../dto/set-mapping.dto';
import type { ImportJobResponseDto } from '../dto/import-job-response.dto';
import type { ImportMappingTemplateRow } from '../repositories/import-mapping-templates.repository';
import { ImportMappingTemplatesRepository } from '../repositories/import-mapping-templates.repository';
import type { ImportJobRow, ImportJobStatus } from '../repositories/import-jobs.repository';
import { ImportJobsRepository } from '../repositories/import-jobs.repository';

function toTemplateResponse(row: ImportMappingTemplateRow): MappingTemplateResponseDto {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId ?? undefined,
    columnMapping: row.columnMapping as Record<string, string>,
    createdAt: row.createdAt.toISOString(),
  };
}

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

/**
 * §9 — saved mapping templates (`import_mapping_templates`) plus applying a mapping to one
 * `import_job` (§10's `uploaded -> mapping` transition). A job's `column_mapping` is always a
 * frozen copy at the moment it is set, even when sourced from a template — a later edit to the
 * template never retroactively changes an already-created job (§9's explicit requirement).
 */
@Injectable()
export class ImportMappingService {
  constructor(
    private readonly templatesRepository: ImportMappingTemplatesRepository,
    private readonly importJobsRepository: ImportJobsRepository,
    private readonly categoriesRepository: CategoriesRepository,
    private readonly locationsRepository: LocationsRepository,
  ) {}

  async listTemplates(tenantId: string, params: { page: number; pageSize: number }): Promise<PaginatedResult<MappingTemplateResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.templatesRepository.listByTenant(tx, tenantId, params);
      return {
        data: rows.map(toTemplateResponse),
        meta: { page: params.page, pageSize: params.pageSize, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) },
      };
    });
  }

  async getTemplate(tenantId: string, templateId: string): Promise<MappingTemplateResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.templatesRepository.findById(tx, tenantId, templateId);
      if (!row) throw new NotFoundException('Mapping template not found.');
      return toTemplateResponse(row);
    });
  }

  async createTemplate(tenantId: string, actorId: string, dto: CreateMappingTemplateDto): Promise<MappingTemplateResponseDto> {
    assertValidColumnMapping(dto.columnMapping);
    return withTenantTransaction(tenantId, async (tx) => {
      if (dto.categoryId) {
        const category = await this.categoriesRepository.findById(tx, tenantId, dto.categoryId);
        if (!category) throw new NotFoundException('Category not found.');
      }
      let created: ImportMappingTemplateRow;
      try {
        created = await this.templatesRepository.create(tx, {
          id: generateId(),
          tenantId,
          name: dto.name,
          categoryId: dto.categoryId ?? null,
          columnMapping: dto.columnMapping,
          createdBy: actorId,
        });
      } catch (error) {
        if (this.isUniqueViolation(error)) throw new ConflictException('A mapping template with this name already exists.');
        throw error;
      }
      return toTemplateResponse(created);
    });
  }

  async updateTemplate(tenantId: string, templateId: string, dto: UpdateMappingTemplateDto): Promise<MappingTemplateResponseDto> {
    if (dto.columnMapping) assertValidColumnMapping(dto.columnMapping);
    return withTenantTransaction(tenantId, async (tx) => {
      const existing = await this.templatesRepository.findById(tx, tenantId, templateId);
      if (!existing) throw new NotFoundException('Mapping template not found.');
      if (dto.categoryId !== undefined) {
        const category = await this.categoriesRepository.findById(tx, tenantId, dto.categoryId);
        if (!category) throw new NotFoundException('Category not found.');
      }
      let updated: ImportMappingTemplateRow | undefined;
      try {
        updated = await this.templatesRepository.update(tx, tenantId, templateId, {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.columnMapping !== undefined ? { columnMapping: dto.columnMapping } : {}),
        });
      } catch (error) {
        if (this.isUniqueViolation(error)) throw new ConflictException('A mapping template with this name already exists.');
        throw error;
      }
      if (!updated) throw new NotFoundException('Mapping template not found.');
      return toTemplateResponse(updated);
    });
  }

  async deleteTemplate(tenantId: string, templateId: string): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      const deleted = await this.templatesRepository.delete(tx, tenantId, templateId);
      if (!deleted) throw new NotFoundException('Mapping template not found.');
    });
  }

  /** `uploaded -> mapping` (or re-mapping while already in `mapping`/`ready`, before validation
   * starts) — §9. Exactly one of `mappingTemplateId`/`columnMapping` must be supplied. */
  async setMapping(tenantId: string, jobId: string, dto: SetMappingDto): Promise<ImportJobResponseDto> {
    if (Boolean(dto.mappingTemplateId) === Boolean(dto.columnMapping)) {
      throw new BadRequestException('Provide exactly one of mappingTemplateId or columnMapping.');
    }
    return withTenantTransaction(tenantId, async (tx) => {
      const job = await this.importJobsRepository.findByIdForUpdate(tx, tenantId, jobId);
      if (!job) throw new NotFoundException('Import job not found.');
      assertTransition(job.status as ImportJobStatus, 'mapping');

      let columnMapping: Record<string, string>;
      if (dto.mappingTemplateId) {
        const template = await this.templatesRepository.findById(tx, tenantId, dto.mappingTemplateId);
        if (!template) throw new NotFoundException('Mapping template not found.');
        columnMapping = template.columnMapping as Record<string, string>;
      } else {
        columnMapping = dto.columnMapping!;
      }
      assertValidColumnMapping(columnMapping);

      if (dto.defaultLocationId) {
        const location = await this.locationsRepository.findById(tx, tenantId, dto.defaultLocationId);
        if (!location) throw new NotFoundException('Default location not found.');
      }

      const updated = await this.importJobsRepository.update(tx, tenantId, jobId, {
        columnMapping,
        mappingTemplateId: dto.mappingTemplateId ?? null,
        status: 'mapping',
        ...(dto.defaultLocationId !== undefined ? { defaultLocationId: dto.defaultLocationId } : {}),
        ...(dto.duplicateHandlingMode !== undefined ? { duplicateHandlingMode: dto.duplicateHandlingMode } : {}),
      });
      if (!updated) throw new NotFoundException('Import job not found.');
      return toJobResponse(updated);
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    const hasCode = (value: unknown): value is { code: string } => typeof value === 'object' && value !== null && 'code' in value;
    if (hasCode(error) && error.code === '23505') return true;
    return error instanceof Error && hasCode(error.cause) && error.cause.code === '23505';
  }
}
