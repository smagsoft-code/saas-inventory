import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';
import { ExportTransfersQueryDto } from './dto/export-transfers-query.dto';
import { ListTransfersQueryDto } from './dto/list-transfers-query.dto';
import { ReceiveTransferDto } from './dto/receive-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { TransfersExportService } from './transfers-export.service';
import { TransfersService } from './transfers.service';

/**
 * Inventory transfers within the caller's own tenant only — database.md#inventory-transfers-and-in-transit-stock,
 * ADR-0020. `tenantId` always comes from CurrentTenant. Every state-transition route additionally
 * enforces location authorization (ADR-0024) in the service, once the transfer's source/destination
 * location is known.
 */
@ApiTags('inventory-transfers')
@Controller('inventory/transfers')
export class TransfersController {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly transfersExportService: TransfersExportService,
  ) {}

  @Get()
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: TransferResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListTransfersQueryDto): Promise<PaginatedResult<TransferResponseDto>> {
    return this.transfersService.list(tenantId, query);
  }

  /** Excel/PDF of the filtered list. Declared before `:id` so `export` is never read as an id. */
  @Get('export')
  @RequirePermissions('inventory.view')
  async exportTransfers(
    @CurrentTenant() tenantId: string,
    @Query() query: ExportTransfersQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const file = await this.transfersExportService.build(tenantId, query);
    void reply.header('Content-Type', file.contentType);
    void reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.buffer;
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: TransferResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<TransferResponseDto> {
    return this.transfersService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('inventory.transfers.request')
  @ApiCreatedResponse({ type: TransferResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateTransferDto,
    @Req() request: FastifyRequest,
  ): Promise<TransferResponseDto> {
    return this.transfersService.create(tenantId, principal.userId, dto, { correlationId: request.correlationId, ipAddress: request.ip });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('inventory.transfers.approve')
  @ApiOkResponse({ type: TransferResponseDto })
  async approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<TransferResponseDto> {
    return this.transfersService.approve(tenantId, principal.userId, id, { correlationId: request.correlationId, ipAddress: request.ip });
  }

  @Post(':id/prepare')
  @HttpCode(200)
  @RequirePermissions('inventory.transfers.dispatch')
  @ApiOkResponse({ type: TransferResponseDto })
  async prepare(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<TransferResponseDto> {
    return this.transfersService.prepare(tenantId, principal.userId, id, { correlationId: request.correlationId, ipAddress: request.ip });
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @RequirePermissions('inventory.transfers.dispatch')
  @ApiOkResponse({ type: TransferResponseDto })
  async dispatch(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispatchTransferDto,
    @Req() request: FastifyRequest,
  ): Promise<TransferResponseDto> {
    return this.transfersService.dispatch(tenantId, principal.userId, id, dto, { correlationId: request.correlationId, ipAddress: request.ip });
  }

  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermissions('inventory.transfers.receive')
  @ApiOkResponse({ type: TransferResponseDto })
  async receive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferDto,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TransferResponseDto> {
    return this.transfersService.receive(tenantId, principal.userId, id, dto, { correlationId: request.correlationId, ipAddress: request.ip }, idempotencyKey);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('inventory.transfers.approve')
  @ApiOkResponse({ type: TransferResponseDto })
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<TransferResponseDto> {
    return this.transfersService.cancel(tenantId, principal.userId, id, { correlationId: request.correlationId, ipAddress: request.ip });
  }
}
