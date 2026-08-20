import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CategoriesService } from './categories.service';
import { CategoryAttributeResponseDto, SetCategoryAttributesDto } from './dto/category-attributes.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/**
 * Categories + the per-category attribute-assignment layer, within the caller's own tenant only
 * (§13, §32). Every route runs the full guard chain (JwtAuthGuard -> TenantGuard -> CsrfGuard ->
 * PermissionsGuard) — `tenantId` always comes from CurrentTenant, never from client input.
 */
@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermissions('categories.view')
  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<PaginatedResult<CategoryResponseDto>> {
    return this.categoriesService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('categories.view')
  @ApiOkResponse({ type: CategoryResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<CategoryResponseDto> {
    return this.categoriesService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('categories.manage')
  @ApiCreatedResponse({ type: CategoryResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateCategoryDto,
    @Req() request: FastifyRequest,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.create(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id')
  @RequirePermissions('categories.manage')
  @ApiOkResponse({ type: CategoryResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() request: FastifyRequest,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.update(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Get(':id/attributes')
  @RequirePermissions('categories.view')
  @ApiOkResponse({ type: CategoryAttributeResponseDto, isArray: true })
  async getAttributes(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<CategoryAttributeResponseDto[]> {
    return this.categoriesService.getAttributes(tenantId, id);
  }

  @Put(':id/attributes')
  @RequirePermissions('catalog.attributes.manage')
  @ApiOkResponse({ type: CategoryAttributeResponseDto, isArray: true })
  async setAttributes(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: SetCategoryAttributesDto,
    @Req() request: FastifyRequest,
  ): Promise<CategoryAttributeResponseDto[]> {
    return this.categoriesService.setAttributes(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
