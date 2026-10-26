import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformAdmin } from '../../common/decorators/current-platform-admin.decorator';
import { CurrentSupportSession } from '../../common/decorators/current-support-session.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { RequireSupportSession } from '../../common/decorators/require-support-session.decorator';
import type { PlatformPrincipal, SupportSessionContext } from '../../common/context/request-context';
import { SupportSessionGuard } from '../../common/guards/support-session.guard';
import { SetSupportWarehouseStatusDto, SupportWarehouseResponseDto } from './dto/support-warehouse.dto';
import { SupportUserResponseDto } from './dto/support-user-response.dto';
import { PlatformSupportService } from './platform-support.service';

/**
 * ADR-0036 §9 — the curated SUPPORT_READ/SUPPORT_WRITE operations. Every route is `@PlatformOnly()`
 * (ADR-0032: authenticated as a platform admin) AND `@RequireSupportSession(mode)` (ADR-0036: a
 * live session for this exact `:tenantId`, in at least that mode) — never tenant RBAC
 * (`@RequirePermissions()` is never used here, per the prompt's explicit §15/§20 instruction).
 * `SUPPORT_WRITE` is never "the Administrador role" — it is exactly the one action below, nothing
 * more (§9 of the prompt).
 */
@ApiTags('platform-support')
@Controller('platform/tenants/:tenantId/support')
@PlatformOnly()
@UseGuards(SupportSessionGuard)
export class PlatformSupportController {
  constructor(private readonly supportService: PlatformSupportService) {}

  @Get('users')
  @RequireSupportSession('read')
  @ApiOkResponse({ type: SupportUserResponseDto, isArray: true })
  async listUsers(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<SupportUserResponseDto[]> {
    const rows = await this.supportService.listUsers(tenantId);
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      status: row.status,
      roleNames: row.roleNames,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  @Get('warehouses')
  @RequireSupportSession('read')
  @ApiOkResponse({ type: SupportWarehouseResponseDto, isArray: true })
  async listWarehouses(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<SupportWarehouseResponseDto[]> {
    return this.supportService.listWarehouses(tenantId);
  }

  @Patch('warehouses/:warehouseId/status')
  @RequireSupportSession('write')
  @ApiOkResponse({ type: SupportWarehouseResponseDto })
  async setWarehouseStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() dto: SetSupportWarehouseStatusDto,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @CurrentSupportSession() session: SupportSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<SupportWarehouseResponseDto> {
    return this.supportService.setWarehouseStatus(tenantId, warehouseId, dto.status, session, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
