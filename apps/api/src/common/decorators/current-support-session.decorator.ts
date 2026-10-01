import { createParamDecorator, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SupportSessionContext } from '../context/request-context';

/** Injects the support session `SupportSessionGuard` resolved. Throws if used on a route not
 * decorated with `@RequireSupportSession()` (a programmer error) — mirrors `CurrentPlatformAdmin`. */
export const CurrentSupportSession = createParamDecorator((_data: unknown, ctx: ExecutionContext): SupportSessionContext => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!request.supportSession) {
    throw new ForbiddenException('No active support session.');
  }
  return request.supportSession;
});
