import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal, TenantRequestContext } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ConfirmOrderDto } from './dto/confirm-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderNotificationsResponseDto } from './dto/order-notifications-response.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

/**
 * Sales orders within the caller's own tenant only (§81). State changes go through explicit
 * command routes (`/confirm`, `/cancel`), never `PATCH { status }` (§37). `POST /orders` requires
 * an `Idempotency-Key` header (§57-§61). `pricing.floor.view` (CurrentPermissions) controls whether
 * frozen `minPrice` snapshots appear in the response (ADR-0028, §68).
 */
@ApiTags('sales-orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions('sales.orders.view')
  @ApiOkResponse({ type: OrderResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<OrderResponseDto>> {
    return this.ordersService.list(tenantId, principal.userId, permissions, query);
  }

  @Get(':id')
  @RequirePermissions('sales.orders.view')
  @ApiOkResponse({ type: OrderResponseDto })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.getById(tenantId, principal.userId, permissions, id);
  }

  @Get(':id/notifications')
  @RequirePermissions('sales.orders.view')
  @ApiOkResponse({ type: OrderNotificationsResponseDto })
  async notifications(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OrderNotificationsResponseDto> {
    return this.ordersService.getNotifications(tenantId, principal.userId, id);
  }

  @Post()
  @RequirePermissions('sales.orders.create')
  @ApiCreatedResponse({ type: OrderResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Body() dto: CreateOrderDto,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.checkout(
      tenantId,
      principal.userId,
      permissions,
      dto,
      { correlationId: request.correlationId, ipAddress: request.ip },
      idempotencyKey,
    );
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions('sales.orders.create')
  @ApiOkResponse({ type: OrderResponseDto })
  async confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('id') id: string,
    @Body() dto: ConfirmOrderDto,
    @Req() request: FastifyRequest,
  ): Promise<OrderResponseDto> {
    return this.ordersService.confirm(tenantId, principal.userId, permissions, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.orders.cancel')
  @ApiOkResponse({ type: OrderResponseDto })
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<OrderResponseDto> {
    return this.ordersService.cancel(tenantId, principal.userId, permissions, id, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
