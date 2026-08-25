import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthPrincipal } from '../common/context/request-context';
import { CreateMappingTemplateDto, MappingTemplateResponseDto, UpdateMappingTemplateDto } from './dto/mapping-template.dto';
import { ImportMappingService } from './services/import-mapping.service';

class ListMappingTemplatesQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

/** §9 — saved, tenant-scoped, reusable column mappings. Gated by the same `import.execute`
 * permission as the rest of the pipeline (database.md's RBAC table treats the whole flow as one
 * permission). */
@ApiTags('import-mapping-templates')
@Controller('import-mapping-templates')
export class ImportMappingTemplatesController {
  constructor(private readonly mappingService: ImportMappingService) {}

  @Get()
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: MappingTemplateResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListMappingTemplatesQueryDto): Promise<PaginatedResult<MappingTemplateResponseDto>> {
    return this.mappingService.listTemplates(tenantId, { page: query.page, pageSize: query.pageSize });
  }

  @Get(':id')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: MappingTemplateResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<MappingTemplateResponseDto> {
    return this.mappingService.getTemplate(tenantId, id);
  }

  @Post()
  @RequirePermissions('import.execute')
  @ApiCreatedResponse({ type: MappingTemplateResponseDto })
  async create(@CurrentTenant() tenantId: string, @CurrentUser() principal: AuthPrincipal, @Body() dto: CreateMappingTemplateDto): Promise<MappingTemplateResponseDto> {
    return this.mappingService.createTemplate(tenantId, principal.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: MappingTemplateResponseDto })
  async update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateMappingTemplateDto): Promise<MappingTemplateResponseDto> {
    return this.mappingService.updateTemplate(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('import.execute')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<void> {
    return this.mappingService.deleteTemplate(tenantId, id);
  }
}
