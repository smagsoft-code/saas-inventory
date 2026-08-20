import { createParamDecorator, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** Injects the resolved tenant id (multi-tenancy.md — never trusted from client input; this is
 * the guard-resolved value from the verified token, set by TenantGuard). */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!request.tenantContext) {
    throw new ForbiddenException('No resolvable tenant context.');
  }
  return request.tenantContext.tenantId;
});
