import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_CONFIG, type AuthConfig } from '../common/config/auth-config';
import { Public } from '../common/decorators/public.decorator';
import { SkipCsrf } from '../common/decorators/skip-csrf.decorator';
import {
  clearSelectionCookie,
  clearSessionCookies,
  setSelectionCookie,
  setSessionCookies,
} from './cookies/auth-cookies.util';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import {
  AuthSessionResponseDto,
  CurrentUserResponseDto,
  LoginResponseDto,
} from './dto/auth-session-response.dto';
import { InvitationInfoResponseDto } from './dto/invitation-info-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { SelectTenantDto } from './dto/select-tenant.dto';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard';
import { AuthService, type IssuedSession, type SessionRequestMeta } from './services/auth.service';

function requestMeta(request: FastifyRequest): SessionRequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : undefined,
    ipAddress: request.ip,
  };
}

function toResponse(session: IssuedSession): AuthSessionResponseDto {
  return {
    user: session.user,
    accessTokenExpiresAt: new Date(Date.now() + session.accessTokenTtlSeconds * 1000).toISOString(),
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  @Public()
  @SkipCsrf()
  @UseGuards(AuthThrottlerGuard)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: AuthSessionResponseDto, description: 'Registers a new company + its first (Administrador) user and issues a session.' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponseDto> {
    const session = await this.authService.register(dto, requestMeta(request));
    setSessionCookies(reply, session, this.authConfig);
    return toResponse(session);
  }

  /** ADR-0036 §5/§23 — public, no auth. Never leaks whether an unknown token \"exists\" beyond the
   * fixed `reason` the service already returns (not_found/expired/revoked/accepted). */
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Get('invitations/:token')
  @ApiOkResponse({ type: InvitationInfoResponseDto })
  async invitationInfo(@Param('token') token: string): Promise<InvitationInfoResponseDto> {
    return this.authService.getInvitationInfo(token);
  }

  /** ADR-0036 §5 — the admin sets their OWN password; the identity moves
   * `pending_credential` -> `active` and a real tenant session is issued immediately, same
   * "accept flows straight into being logged in" shape as `register()`. */
  @Public()
  @SkipCsrf()
  @UseGuards(AuthThrottlerGuard)
  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponseDto> {
    const session = await this.authService.acceptInvitation(dto.token, dto.password, requestMeta(request));
    setSessionCookies(reply, session, this.authConfig);
    return toResponse(session);
  }

  /**
   * 016-C: `{ email, password }` only. One active membership -> a session (cookies set). More than
   * one -> the `tenant_selection` cookie + `availableTenants`, and NO session yet — the caller
   * completes with `POST /auth/select-tenant`.
   */
  @Public()
  @SkipCsrf()
  @UseGuards(AuthThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto, requestMeta(request));

    if (result.kind === 'session') {
      setSessionCookies(reply, result, this.authConfig);
      return { status: 'authenticated', ...toResponse(result) };
    }

    setSelectionCookie(reply, result.selectionToken, result.selectionTokenTtlSeconds, this.authConfig);
    return {
      status: 'tenant_selection_required',
      availableTenants: result.availableTenants,
      selectionToken: result.selectionToken,
      selectionTokenExpiresAt: new Date(Date.now() + result.selectionTokenTtlSeconds * 1000).toISOString(),
    };
  }

  /** 016-C step 2: picks the company from a multi-membership login. The selection token comes from
   * the httpOnly `tenant_selection` cookie (browser) or the body (non-browser). */
  @Public()
  @SkipCsrf()
  @UseGuards(AuthThrottlerGuard)
  @Post('select-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async selectTenant(
    @Body() dto: SelectTenantDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponseDto> {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const rawSelectionToken = cookies?.['tenant_selection'] ?? dto.selectionToken;
    const session = await this.authService.selectTenant(rawSelectionToken, dto.tenantId, requestMeta(request));
    setSessionCookies(reply, session, this.authConfig);
    clearSelectionCookie(reply, this.authConfig);
    return toResponse(session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponseDto> {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const rawRefreshToken = cookies?.['refresh_token'] ?? dto.refreshToken;
    const session = await this.authService.refresh(rawRefreshToken, requestMeta(request));
    setSessionCookies(reply, session, this.authConfig);
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
    const rawRefreshToken = cookies?.['refresh_token'] ?? dto.refreshToken;
    await this.authService.logout(rawRefreshToken);
    clearSessionCookies(reply, this.authConfig);
  }

  /**
   * ADR-0036 extension — a Platform Admin browsing a Tenant under an active support session has no
   * `authPrincipal` (no tenant JWT was ever issued for them — TenantGuard resolved
   * `request.supportSession`/`request.tenantContext` from the session row instead, GET-only). This
   * is the one route that branches on that instead of using `@CurrentUser()` (which would 401 a
   * support principal outright) — everywhere else that still fails closed is correct: a support
   * session grants read access to ordinary tenant GET routes, never a synthetic identity for them.
   */
  @Get('me')
  @ApiOkResponse({ type: CurrentUserResponseDto })
  async me(@Req() request: FastifyRequest): Promise<CurrentUserResponseDto> {
    if (request.supportSession) {
      return this.authService.meAsSupport(request.platformPrincipal!.adminId, request.supportSession);
    }
    const principal = request.authPrincipal;
    if (!principal) {
      throw new UnauthorizedException('Authentication required.');
    }
    return this.authService.me(principal.userId, principal.identityId, principal.tenantId, principal.tenantSlug);
  }
}
