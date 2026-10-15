import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { NextCodeResponseDto } from '../next-code-response.dto';
import { NextSkuQueryDto } from './dto/next-sku-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { VariantFieldsDto } from './dto/variant-fields.dto';
import { VariantResponseDto } from './dto/variant-response.dto';
import { ProductsService } from './products.service';

/**
 * Products + variants within the caller's own tenant only (§10-§21). Every route runs the full
 * guard chain (JwtAuthGuard -> TenantGuard -> CsrfGuard -> PermissionsGuard) — `tenantId` always
 * comes from CurrentTenant, never from client input. `cost`/`minPrice` visibility on variant
 * responses is resolved from CurrentPermissions, not the route-level @RequirePermissions()
 * declaration alone (ADR-0028) — mirrors the pattern already established by
 * core/users/users.controller.ts's PATCH /users/:id.
 */
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: ProductResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListProductsQueryDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    return this.productsService.list(tenantId, query);
  }

  // Declared before `:id` so "next-sku" is never read as a product id.
  @Get('next-sku')
  @RequirePermissions('products.view')
  @ApiOkResponse({
    type: NextCodeResponseDto,
    description: 'Preview of the next automatic product code for a category: ARM-001, ARM-002, … (first three letters of the category; PRD without one).',
  })
  async nextSku(@CurrentTenant() tenantId: string, @Query() query: NextSkuQueryDto): Promise<NextCodeResponseDto> {
    return this.productsService.getNextSku(tenantId, query.categoryId);
  }

  @Get(':id')
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: ProductResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<ProductResponseDto> {
    return this.productsService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('products.manage')
  @ApiCreatedResponse({ type: ProductResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateProductDto,
    @Req() request: FastifyRequest,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id')
  @RequirePermissions('products.manage')
  @ApiOkResponse({ type: ProductResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() request: FastifyRequest,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Get(':id/variants')
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: VariantResponseDto, isArray: true })
  async listVariants(
    @CurrentTenant() tenantId: string,
    @CurrentPermissions() permissions: string[],
    @Param('id') productId: string,
  ): Promise<VariantResponseDto[]> {
    return this.productsService.listVariants(tenantId, productId, permissions);
  }

  @Get(':id/variants/:variantId')
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: VariantResponseDto })
  async getVariant(
    @CurrentTenant() tenantId: string,
    @CurrentPermissions() permissions: string[],
    @Param('id') productId: string,
    @Param('variantId') variantId: string,
  ): Promise<VariantResponseDto> {
    return this.productsService.getVariant(tenantId, productId, variantId, permissions);
  }

  @Post(':id/variants')
  @RequirePermissions('products.manage')
  @ApiCreatedResponse({ type: VariantResponseDto })
  async createVariant(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: string[],
    @Param('id') productId: string,
    @Body() dto: VariantFieldsDto,
    @Req() request: FastifyRequest,
  ): Promise<VariantResponseDto> {
    return this.productsService.createVariant(tenantId, principal.userId, permissions, productId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id/variants/:variantId')
  @RequirePermissions('products.manage')
  @ApiOkResponse({ type: VariantResponseDto })
  async updateVariant(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: string[],
    @Param('id') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
    @Req() request: FastifyRequest,
  ): Promise<VariantResponseDto> {
    return this.productsService.updateVariant(tenantId, principal.userId, permissions, productId, variantId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
