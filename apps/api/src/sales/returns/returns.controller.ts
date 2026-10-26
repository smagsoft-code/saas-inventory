import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateReturnDto } from './dto/create-return.dto';
import { InspectReturnDto } from './dto/inspect-return.dto';
import { ListReturnsQueryDto } from './dto/list-returns-query.dto';
import { ReturnResponseDto } from './dto/return-response.dto';
import { ReturnsService } from './returns.service';

/**
 * Sales returns within the caller's own tenant only (§9-§10, §34). State changes go through
 * explicit command routes (`/inspect`, `/resolve`, `/cancel`), never `PATCH { status }` (§14).
 * `sales.returns.view`/`sales.returns.create` gate the SALES-owned administrative half;
 * `inventory.returns.manage` gates the stock-sensitive half (inspect + resolve) — separation of
 * duties per ADR-0021 / §74. `POST /` and `POST /:id/resolve` require an `Idempotency-Key` header.
 */
@ApiTags('sales-returns')
@Controller('sales-returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get()
  @RequirePermissions('sales.returns.view')
  @ApiOkResponse({ type: ReturnResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ListReturnsQueryDto,
  ): Promise<PaginatedResult<ReturnResponseDto>> {
    return this.returnsService.list(tenantId, principal.userId, query);
  }

  @Get(':id')
  @RequirePermissions('sales.returns.view')
  @ApiOkResponse({ type: ReturnResponseDto })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    return this.returnsService.getById(tenantId, principal.userId, id);
  }

  @Post()
  @RequirePermissions('sales.returns.create')
  @ApiCreatedResponse({ type: ReturnResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateReturnDto,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReturnResponseDto> {
    return this.returnsService.create(
      tenantId,
      principal.userId,
      dto,
      { correlationId: request.correlationId, ipAddress: request.ip },
      idempotencyKey,
    );
  }

  @Post(':id/inspect')
  @HttpCode(200)
  @RequirePermissions('inventory.returns.manage')
  @ApiOkResponse({ type: ReturnResponseDto })
  async inspect(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InspectReturnDto,
    @Req() request: FastifyRequest,
  ): Promise<ReturnResponseDto> {
    return this.returnsService.inspect(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions('inventory.returns.manage')
  @ApiOkResponse({ type: ReturnResponseDto })
  async resolve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReturnResponseDto> {
    return this.returnsService.resolve(
      tenantId,
      principal.userId,
      id,
      { correlationId: request.correlationId, ipAddress: request.ip },
      idempotencyKey,
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.returns.create')
  @ApiOkResponse({ type: ReturnResponseDto })
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<ReturnResponseDto> {
    return this.returnsService.cancel(tenantId, principal.userId, id, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
