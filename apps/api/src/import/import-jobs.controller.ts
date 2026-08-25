import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentPermissions } from '../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthPrincipal } from '../common/context/request-context';
import { ImportPreviewResponseDto } from './dto/import-preview-response.dto';
import { ImportJobRowResponseDto } from './dto/import-job-row-response.dto';
import { ImportJobResponseDto } from './dto/import-job-response.dto';
import { ListImportJobRowsQueryDto } from './dto/list-import-job-rows-query.dto';
import { ListImportJobsQueryDto } from './dto/list-import-jobs-query.dto';
import { SetMappingDto, DUPLICATE_HANDLING_MODES } from './dto/set-mapping.dto';
import { ImportErrorReportService } from './services/import-error-report.service';
import { ImportJobService } from './services/import-job.service';
import { ImportMappingService } from './services/import-mapping.service';
import { ImportPreviewService } from './services/import-preview.service';
import { ImportTemplateService } from './services/import-template.service';
import { withTenantTransaction } from '../database/tenant-context';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Reads the required file part plus any of the optional text fields off a multipart request —
 * @fastify/multipart's `request.parts()`, not a class-validator DTO (mass-assignment protection
 * for these fields is enforced by hand below instead, since ValidationPipe never sees a multipart
 * body). */
async function readUploadParts(request: FastifyRequest): Promise<{
  buffer: Buffer;
  filename: string;
  mimeType: string;
  mappingTemplateId?: string;
  columnMapping?: Record<string, string>;
  defaultLocationId?: string;
  duplicateHandlingMode?: string;
}> {
  let buffer: Buffer | undefined;
  let filename = '';
  let mimeType = '';
  const fields: Record<string, string> = {};

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file') continue;
      filename = part.filename;
      mimeType = part.mimetype;
      buffer = await part.toBuffer();
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }

  if (!buffer) {
    throw new BadRequestException('No file was uploaded (expected a multipart "file" field).');
  }
  if (fields['duplicateHandlingMode'] && !(DUPLICATE_HANDLING_MODES as readonly string[]).includes(fields['duplicateHandlingMode'])) {
    throw new BadRequestException(`duplicateHandlingMode must be one of: ${DUPLICATE_HANDLING_MODES.join(', ')}.`);
  }
  let columnMapping: Record<string, string> | undefined;
  if (fields['columnMapping']) {
    try {
      columnMapping = JSON.parse(fields['columnMapping']) as Record<string, string>;
    } catch {
      throw new BadRequestException('columnMapping must be a JSON-encoded object.');
    }
  }
  return {
    buffer,
    filename,
    mimeType,
    ...(fields['mappingTemplateId'] ? { mappingTemplateId: fields['mappingTemplateId'] } : {}),
    ...(columnMapping ? { columnMapping } : {}),
    ...(fields['defaultLocationId'] ? { defaultLocationId: fields['defaultLocationId'] } : {}),
    ...(fields['duplicateHandlingMode'] ? { duplicateHandlingMode: fields['duplicateHandlingMode'] } : {}),
  };
}

/**
 * §28 — the staged Excel import pipeline's endpoint surface. `import.execute` gates the whole flow
 * (database.md's RBAC table: "una permission para todo el flujo, no cinco"); `import.inventory` is
 * an additional, service-layer-checked requirement only for `update_catalog_and_inventory`
 * confirmations (ImportJobService.triggerConfirm). tenantId always comes from CurrentTenant, never
 * client input (§19).
 */
@ApiTags('imports')
@Controller('imports')
export class ImportJobsController {
  constructor(
    private readonly templateService: ImportTemplateService,
    private readonly jobService: ImportJobService,
    private readonly mappingService: ImportMappingService,
    private readonly previewService: ImportPreviewService,
    private readonly errorReportService: ImportErrorReportService,
  ) {}

  @Get('template')
  @RequirePermissions('import.execute')
  async downloadTemplate(@CurrentTenant() tenantId: string, @Query('categoryId') categoryId: string | undefined, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    const buffer = await withTenantTransaction(tenantId, (tx) => this.templateService.generate(tx, tenantId, categoryId));
    void reply.header('Content-Type', XLSX_MIME);
    void reply.header('Content-Disposition', 'attachment; filename="import-template.xlsx"');
    return buffer;
  }

  @Post()
  @RequirePermissions('import.execute')
  @ApiCreatedResponse({ type: ImportJobResponseDto })
  async create(@CurrentTenant() tenantId: string, @CurrentUser() principal: AuthPrincipal, @Req() request: FastifyRequest): Promise<ImportJobResponseDto> {
    const parts = await readUploadParts(request);
    return this.jobService.create(tenantId, principal.userId, {
      originalFilename: parts.filename,
      mimeType: parts.mimeType,
      fileBuffer: parts.buffer,
      mappingTemplateId: parts.mappingTemplateId,
      columnMapping: parts.columnMapping,
      defaultLocationId: parts.defaultLocationId,
      duplicateHandlingMode: parts.duplicateHandlingMode,
    });
  }

  @Get()
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportJobResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListImportJobsQueryDto): Promise<PaginatedResult<ImportJobResponseDto>> {
    return this.jobService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportJobResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<ImportJobResponseDto> {
    return this.jobService.getById(tenantId, id);
  }

  @Post(':id/mapping')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportJobResponseDto })
  async setMapping(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: SetMappingDto): Promise<ImportJobResponseDto> {
    return this.mappingService.setMapping(tenantId, id, dto);
  }

  @Post(':id/validate')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportJobResponseDto })
  async validate(@CurrentTenant() tenantId: string, @CurrentUser() principal: AuthPrincipal, @Param('id') id: string): Promise<ImportJobResponseDto> {
    return this.jobService.triggerValidate(tenantId, id, principal.userId);
  }

  @Get(':id/preview')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportPreviewResponseDto })
  async preview(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<ImportPreviewResponseDto> {
    return this.previewService.preview(tenantId, id);
  }

  @Get(':id/rows')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportJobRowResponseDto, isArray: true })
  async rows(@CurrentTenant() tenantId: string, @Param('id') id: string, @Query() query: ListImportJobRowsQueryDto): Promise<PaginatedResult<ImportJobRowResponseDto>> {
    return this.previewService.listRows(tenantId, id, query);
  }

  @Post(':id/confirm')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportJobResponseDto })
  async confirm(@CurrentTenant() tenantId: string, @CurrentUser() principal: AuthPrincipal, @CurrentPermissions() permissions: string[], @Param('id') id: string): Promise<ImportJobResponseDto> {
    return this.jobService.triggerConfirm(tenantId, id, principal.userId, permissions);
  }

  @Post(':id/cancel')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportJobResponseDto })
  async cancel(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<ImportJobResponseDto> {
    return this.jobService.cancel(tenantId, id);
  }

  @Get(':id/errors')
  @RequirePermissions('import.execute')
  async errors(@CurrentTenant() tenantId: string, @Param('id') id: string, @Query('includeWarnings') includeWarnings: string | undefined, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    const buffer = await this.errorReportService.generate(tenantId, id, includeWarnings === 'true');
    void reply.header('Content-Type', XLSX_MIME);
    void reply.header('Content-Disposition', 'attachment; filename="import-errors.xlsx"');
    return buffer;
  }
}
