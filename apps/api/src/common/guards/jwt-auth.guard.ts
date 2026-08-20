import { Inject, Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth-config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AccessTokenPayload } from '../tokens/access-token-payload';

/**
 * "Who are you?" — api.md#request-flow's Auth Guard. Verifies the access token (Authorization
 * bearer header, or the httpOnly access_token cookie for browser clients — security.md's
 * cookie-vs-bearer decision applies per-client, not globally; see ADR-0030) and attaches the
 * verified principal to the request. Does not touch the database and does not resolve
 * tenant-scoped permissions — that is TenantGuard's job, run immediately after this one.
 *
 * Registered as a global guard (common.module.ts) so every route is protected by default; a route
 * opts out explicitly with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = extractAccessToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentication required.');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.authConfig.jwtSecret,
      });
      request.authPrincipal = { userId: payload.sub, tenantId: payload.tenantId, tenantSlug: payload.tenantSlug };
      return true;
    } catch {
      // Deliberately one generic message — an expired token and a forged/tampered one both look
      // identical to the caller, per security.md's "avoid revealing internal state" guidance.
      throw new UnauthorizedException('Invalid or expired session.');
    }
  }
}

function extractAccessToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim() || undefined;
  }
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.['access_token'];
}
