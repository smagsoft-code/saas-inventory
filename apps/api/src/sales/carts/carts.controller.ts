import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { TenantRequestContext } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../common/context/request-context';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CartsService } from './carts.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

/**
 * The caller's own sales cart (a singular `/cart` resource, api.md §80). The cart is owned by the
 * authenticated user (`carts.user_id`), never addressed by an id in the URL — a caller can only
 * ever reach their own open cart. All mutations require `sales.carts.manage`. `pricing.floor.view`
 * (read via CurrentPermissions) controls whether `minPrice` appears in the response (ADR-0028).
 */
@ApiTags('sales-cart')
@Controller('cart')
export class CartsController {
  constructor(private readonly cartsService: CartsService) {}

  @Get()
  @RequirePermissions('sales.carts.manage')
  @ApiOkResponse({ type: CartResponseDto })
  async getActive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
  ): Promise<CartResponseDto> {
    return this.cartsService.getActive(tenantId, principal.userId, permissions);
  }

  @Post()
  @RequirePermissions('sales.carts.manage')
  @ApiCreatedResponse({ type: CartResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Body() dto: CreateCartDto,
    @Req() request: FastifyRequest,
  ): Promise<CartResponseDto> {
    return this.cartsService.createOrGetActive(tenantId, principal.userId, permissions, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch()
  @RequirePermissions('sales.carts.manage')
  @ApiOkResponse({ type: CartResponseDto })
  async updateHeader(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Body() dto: UpdateCartDto,
    @Req() request: FastifyRequest,
  ): Promise<CartResponseDto> {
    return this.cartsService.updateHeader(tenantId, principal.userId, permissions, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Post('items')
  @HttpCode(200)
  @RequirePermissions('sales.carts.manage')
  @ApiOkResponse({ type: CartResponseDto })
  async addItem(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Body() dto: AddCartItemDto,
    @Req() request: FastifyRequest,
  ): Promise<CartResponseDto> {
    return this.cartsService.addItem(tenantId, principal.userId, permissions, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch('items/:itemId')
  @RequirePermissions('sales.carts.manage')
  @ApiOkResponse({ type: CartResponseDto })
  async updateItem(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @Req() request: FastifyRequest,
  ): Promise<CartResponseDto> {
    return this.cartsService.updateItem(tenantId, principal.userId, permissions, itemId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Delete('items/:itemId')
  @HttpCode(200)
  @RequirePermissions('sales.carts.manage')
  @ApiOkResponse({ type: CartResponseDto })
  async removeItem(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('itemId') itemId: string,
    @Req() request: FastifyRequest,
  ): Promise<CartResponseDto> {
    return this.cartsService.removeItem(tenantId, principal.userId, permissions, itemId, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
