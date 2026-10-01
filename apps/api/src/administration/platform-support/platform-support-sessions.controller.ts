import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { PlatformPrincipal } from '../../common/context/request-context';
import { CurrentPlatformAdmin } from '../../common/decorators/current-platform-admin.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import type { SupportSessionRow } from '../../auth/repositories/platform-support-sessions.repository';
import { StartSupportSessionDto } from './dto/start-support-session.dto';
import { SupportSessionResponseDto } from './dto/support-session-response.dto';
import { PlatformSupportSessionsService } from './platform-support-sessions.service';

function toResponse(session: SupportSessionRow): SupportSessionResponseDto {
  return {
    id: session.id,
    tenantId: session.tenantId,
    mode: session.mode,
    reason: session.reason,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    ...(session.endedAt ? { endedAt: session.endedAt.toISOString() } : {}),
  };
}

/**
 * ADR-0036 §8-14 — session lifecycle only (start/end/current). The actual read/write support
 * operations live in `platform-support.controller.ts`, gated by `@RequireSupportSession()`
 * reading the row this controller manages — never the other way around.
 */
@ApiTags('platform-support')
@Controller('platform')
@PlatformOnly()
export class PlatformSupportSessionsController {
  constructor(private readonly sessionsService: PlatformSupportSessionsService) {}

  @Post('tenants/:tenantId/support-sessions')
  @ApiOkResponse({ type: SupportSessionResponseDto })
  async start(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Body() dto: StartSupportSessionDto,
    @Req() request: FastifyRequest,
  ): Promise<SupportSessionResponseDto> {
    const session = await this.sessionsService.start(tenantId, dto.mode, dto.reason, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toResponse(session);
  }

  @Post('support-sessions/current/end')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SupportSessionResponseDto })
  async endCurrent(
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<SupportSessionResponseDto | null> {
    const ended = await this.sessionsService.endCurrent({
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return ended ? toResponse(ended) : null;
  }

  @Get('support-sessions/current')
  @ApiOkResponse({ type: SupportSessionResponseDto })
  async current(@CurrentPlatformAdmin() principal: PlatformPrincipal): Promise<SupportSessionResponseDto | null> {
    const session = await this.sessionsService.getCurrent(principal.adminId);
    return session ? toResponse(session) : null;
  }
}
