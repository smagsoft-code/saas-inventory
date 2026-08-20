import { createParamDecorator, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** Injects the caller's effective permission codes, resolved once per request by TenantGuard
 * (same source PermissionsGuard checks). Used where a single route has more than one
 * permission-gated field (e.g. PATCH /users/:id — updating `status` needs `core.users.update`,
 * updating `roleId` needs the stricter `core.roles.assign`) and the route-level
 * @RequirePermissions() declaration alone can't express that — the service layer checks the
 * stricter permission itself using this. */
export const CurrentPermissions = createParamDecorator((_data: unknown, ctx: ExecutionContext): string[] => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!request.tenantContext) {
    throw new ForbiddenException('No resolvable tenant context.');
  }
  return request.tenantContext.permissions;
});
