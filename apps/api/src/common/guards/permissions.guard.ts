import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ANY_PERMISSIONS_KEY } from '../decorators/require-any-permission.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * "Are you allowed to do this specific thing?" — the authorization half of ADR-0009's RBAC model,
 * deliberately separate from JwtAuthGuard/TenantGuard's authentication concerns. A route with no
 * @RequirePermissions() / @RequireAnyPermission() declaration passes through unchecked
 * (authentication-only) — this phase ships the mechanism for future business modules to declare
 * against; no auth endpoint needs a specific permission code.
 *
 * `@RequirePermissions('a', 'b')` requires **all** of `a` and `b`. `@RequireAnyPermission('c', 'd')`
 * requires **at least one** of `c` or `d` (F17-09 — the OR case the AND-only declaration cannot
 * express, e.g. the exceptional-discount queue readable by both requester and approver). A route
 * may carry both; the guard enforces every AND code and at least one ANY code.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, targets);

    const hasAllDeclaration = Array.isArray(requiredAll) && requiredAll.length > 0;
    const hasAnyDeclaration = Array.isArray(requiredAny) && requiredAny.length > 0;
    if (!hasAllDeclaration && !hasAnyDeclaration) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const granted = new Set(request.tenantContext?.permissions ?? []);

    if (hasAllDeclaration && !requiredAll.every((code) => granted.has(code))) {
      throw new ForbiddenException('Missing required permission.');
    }
    if (hasAnyDeclaration && !requiredAny.some((code) => granted.has(code))) {
      throw new ForbiddenException('Missing required permission.');
    }
    return true;
  }
}
