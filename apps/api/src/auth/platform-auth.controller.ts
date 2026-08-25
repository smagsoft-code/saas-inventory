import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_CONFIG, type AuthConfig } from '../common/config/auth-config';
import { CurrentPlatformAdmin } from '../common/decorators/current-platform-admin.decorator';
import { PlatformOnly } from '../common/decorators/platform-only.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipCsrf } from '../common/decorators/skip-csrf.decorator';
import type { PlatformPrincipal } from '../common/context/request-context';
import { clearPlatformSessionCookies, setPlatformSessionCookies } from './cookies/platform-auth-cookies.util';
import { CurrentPlatformAdminResponseDto, PlatformAuthSessionResponseDto } from './dto/platform-auth-session-response.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard';
import { PlatformAuthService, type IssuedPlatformSession } from './services/platform-auth.service';

function requestMeta(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : undefined,
    ipAddress: request.ip,
  };
}

function toResponse(session: IssuedPlatformSession): PlatformAuthSessionResponseDto {
  return {
    admin: session.admin,
    accessTokenExpiresAt: new Date(Date.now() + session.accessTokenTtlSeconds * 1000).toISOString(),
  };
}

/**
 * SuperAdmin session endpoints (multi-tenancy.md#superadmin-vs-tenant, FASE 11) — structurally
 * separate route surface from `auth/*` (tenant users): distinct controller, distinct cookies
 * (`platform_*`), distinct token shape (`context: 'global'`, no `tenantId`). No `POST
 * /platform/auth/register` — platform admins are provisioned out-of-band (see
 * PlatformAdminsRepository's header comment), never through a public endpoint.
 */
@ApiTags('platform-auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly platformAuthService: PlatformAuthService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  @Public()
  @SkipCsrf()
  @UseGuards(AuthThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformAuthSessionResponseDto })
  async login(
    @Body() dto: PlatformLoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlatformAuthSessionResponseDto> {
    const session = await this.platformAuthService.login(dto, requestMeta(request));
    setPlatformSessionCookies(reply, session, this.authConfig);
    return toResponse(session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformAuthSessionResponseDto })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlatformAuthSessionResponseDto> {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const rawRefreshToken = cookies?.['platform_refresh_token'] ?? dto.refreshToken;
    const session = await this.platformAuthService.refresh(rawRefreshToken, requestMeta(request));
    setPlatformSessionCookies(reply, session, this.authConfig);
    return toResponse(session);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const rawRefreshToken = cookies?.['platform_refresh_token'] ?? dto.refreshToken;
    await this.platformAuthService.logout(rawRefreshToken);
    clearPlatformSessionCookies(reply, this.authConfig);
  }

  @PlatformOnly()
  @Get('me')
  @ApiOkResponse({ type: CurrentPlatformAdminResponseDto })
  async me(@CurrentPlatformAdmin() principal: PlatformPrincipal): Promise<CurrentPlatformAdminResponseDto> {
    return this.platformAuthService.me(principal.adminId);
  }
}
