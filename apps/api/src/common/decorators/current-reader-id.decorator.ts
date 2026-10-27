import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * The id a READ-ONLY route scopes its answer by: the tenant user's `users.id`, or — for a platform admin browsing the tenant under an
 * active support session (ADR-0036 read-through, which has no tenant principal) — the platform admin's own id.
 *
 * For routes whose rule is "what may THIS reader see" (seller scope, ADR-0040) and that are safe to serve to support. A platform admin id is
 * never a `users.id`, so a seller-scoped filter keyed on it matches nothing: support reads the rows but none of the commercial references
 * that belong to a seller. Never use it on a write — writes keep `@CurrentUser()` and so stay closed to support.
 */
export const CurrentReaderId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (request.authPrincipal) return request.authPrincipal.userId;
  if (request.supportSession && request.platformPrincipal) return request.platformPrincipal.adminId;
  throw new UnauthorizedException('Authentication required.');
});
