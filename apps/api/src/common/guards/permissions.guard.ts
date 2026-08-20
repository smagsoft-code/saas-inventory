import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * "Are you allowed to do this specific thing?" — the authorization half of ADR-0009's RBAC model,
 * deliberately separate from JwtAuthGuard/TenantGuard's authentication concerns. A route with no
 * @RequirePermissions() declaration passes through unchecked (authentication-only) — this phase
 * ships the mechanism for future business modules to declare against; no auth endpoint needs a
 * specific permission code.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const granted = new Set(request.tenantContext?.permissions ?? []);
    const hasAll = required.every((code) => granted.has(code));
    if (!hasAll) {
      throw new ForbiddenException('Missing required permission.');
    }
    return true;
  }
}
