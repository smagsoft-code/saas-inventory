import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateQrCodeDto } from './dto/create-qr-code.dto';
import { ListQrCodesQueryDto } from './dto/list-qr-codes-query.dto';
import { QrCodeResponseDto } from './dto/qr-code-response.dto';
import { QrResolveIdentityResponseDto } from './dto/qr-resolve-identity-response.dto';
import { UpdateQrCodeDto } from './dto/update-qr-code.dto';
import { QrCodesService } from './qr-codes.service';

/**
 * QR code management (`catalog.qr.manage` — database.md's permission table: "Generar/revocar
 * qr_codes de producto o ubicacion", the only QR permission this architecture defines, covering both
 * mutation and management-read) plus the authenticated resolve-identity lookup. Every route runs the
 * full guard chain (JwtAuthGuard -> TenantGuard -> CsrfGuard -> PermissionsGuard) — `tenantId` always
 * comes from CurrentTenant, never from client input. `resolve/:code` is declared before `:id` so
 * NestJS never has to disambiguate them (they match a different number of path segments regardless
 * of order), and deliberately carries no `@RequirePermissions()` — see qr-codes.service.ts's
 * `resolveIdentity` doc comment for why.
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

  @Get()
  @RequirePermissions('catalog.qr.manage')
  @ApiOkResponse({ type: QrCodeResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListQrCodesQueryDto): Promise<PaginatedResult<QrCodeResponseDto>> {
    return this.qrCodesService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('catalog.qr.manage')
  @ApiOkResponse({ type: QrCodeResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<QrCodeResponseDto> {
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

  @Patch(':id')
  @RequirePermissions('catalog.qr.manage')
  @ApiOkResponse({ type: QrCodeResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateQrCodeDto,
    @Req() request: FastifyRequest,
  ): Promise<QrCodeResponseDto> {
    return this.qrCodesService.updateStatus(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
