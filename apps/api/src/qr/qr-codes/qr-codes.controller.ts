import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BulkCreateQrCodesResponseDto } from './dto/bulk-create-qr-codes-response.dto';
import { BulkCreateQrCodesDto } from './dto/bulk-create-qr-codes.dto';
import { CreateQrCodeDto } from './dto/create-qr-code.dto';
import { ListPendingVariantsQueryDto } from './dto/list-pending-variants-query.dto';
import { ListQrCodesQueryDto } from './dto/list-qr-codes-query.dto';
import { PendingVariantResponseDto } from './dto/pending-variant-response.dto';
import { QrCodeResponseDto } from './dto/qr-code-response.dto';
import { QrResolveIdentityResponseDto } from './dto/qr-resolve-identity-response.dto';
import { UpdateQrCodeDto } from './dto/update-qr-code.dto';
import { QrCodesService } from './qr-codes.service';

/**
 * QR code management (`catalog.qr.manage` — database.md's permission table: "Generar/revocar
 * qr_codes de producto o ubicacion", the only QR permission this architecture defines, covering both
 * mutation and management-read) plus the authenticated resolve-identity lookup. Every route runs the
 * full guard chain (JwtAuthGuard -> TenantGuard -> CsrfGuard -> PermissionsGuard) — `tenantId` always
 * comes from CurrentTenant, never from client input. `resolve/:code` and `pending-variants` are both
 * declared before `:id` — `pending-variants` in particular MUST come first, since (unlike
 * `resolve/:code`) it has the exact same one-segment shape `:id` matches; declared after it, Nest
 * would route `GET /qr-codes/pending-variants` into `getById` with `id="pending-variants"` instead.
 * Bulk generation reuses the one permission this module already has — no new `qr.bulk`-style
 * permission (§25: it is an operation inside the same existing QR management surface).
 */
@ApiTags('qr-codes')
@Controller('qr-codes')
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Get('resolve/:code')
  @ApiOkResponse({ type: QrResolveIdentityResponseDto })
  async resolve(@CurrentTenant() tenantId: string, @Param('code') code: string): Promise<QrResolveIdentityResponseDto> {
    return this.qrCodesService.resolveIdentity(tenantId, code);
  }

  @Get('pending-variants')
  @RequirePermissions('catalog.qr.manage')
  @ApiOkResponse({ type: PendingVariantResponseDto, isArray: true })
  async listPendingVariants(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPendingVariantsQueryDto,
  ): Promise<PaginatedResult<PendingVariantResponseDto>> {
    return this.qrCodesService.listPendingVariants(tenantId, query);
  }

  @Get()
  @RequirePermissions('catalog.qr.manage')
  @ApiOkResponse({ type: QrCodeResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListQrCodesQueryDto): Promise<PaginatedResult<QrCodeResponseDto>> {
    return this.qrCodesService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('catalog.qr.manage')
  @ApiOkResponse({ type: QrCodeResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<QrCodeResponseDto> {
    return this.qrCodesService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('catalog.qr.manage')
  @ApiCreatedResponse({ type: QrCodeResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateQrCodeDto,
    @Req() request: FastifyRequest,
  ): Promise<QrCodeResponseDto> {
    return this.qrCodesService.create(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Post('bulk')
  @RequirePermissions('catalog.qr.manage')
  @ApiCreatedResponse({ type: BulkCreateQrCodesResponseDto })
  async createBulk(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: BulkCreateQrCodesDto,
    @Req() request: FastifyRequest,
  ): Promise<BulkCreateQrCodesResponseDto> {
    return this.qrCodesService.createBulk(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id')
  @RequirePermissions('catalog.qr.manage')
  @ApiOkResponse({ type: QrCodeResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQrCodeDto,
    @Req() request: FastifyRequest,
  ): Promise<QrCodeResponseDto> {
    return this.qrCodesService.updateStatus(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
