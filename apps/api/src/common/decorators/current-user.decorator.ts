import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../context/request-context';

/** Injects the authenticated principal resolved by JwtAuthGuard. Throws if used on a route that
 * doesn't run JwtAuthGuard first (a programmer error, not a runtime/client-facing condition). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!request.authPrincipal) {
    throw new UnauthorizedException('Authentication required.');
  }
  return request.authPrincipal;
});
