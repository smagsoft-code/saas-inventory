import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PlatformPrincipal } from '../context/request-context';

/** Injects the authenticated platform-admin principal resolved by JwtAuthGuard. Throws if used on
 * a route that isn't @PlatformOnly() (a programmer error, not a runtime/client-facing condition) —
 * mirrors CurrentUser's contract for the tenant side. */
export const CurrentPlatformAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): PlatformPrincipal => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!request.platformPrincipal) {
    throw new UnauthorizedException('Platform authentication required.');
  }
  return request.platformPrincipal;
});
