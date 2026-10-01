import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ANY_PERMISSIONS_KEY } from '../decorators/require-any-permission.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

/**
 * Unit proof of the AND (`@RequirePermissions`) + OR (`@RequireAnyPermission`) declaration model.
 * The full HTTP-level proof against real PostgreSQL lives in
 * test/sales/sales-exceptional-pricing.integration.test.ts (F17-09 `GAP-APPROVALS-PERMISSION`).
 */
function guardFor(
  granted: string[],
  declarations: { all?: string[]; any?: string[] },
  requestOverrides: Record<string, unknown> = {},
): { guard: PermissionsGuard; context: ExecutionContext } {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === PERMISSIONS_KEY) return declarations.all;
      if (key === ANY_PERMISSIONS_KEY) return declarations.any;
      return undefined;
    },
  } as unknown as Reflector;
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ tenantContext: { permissions: granted }, ...requestOverrides }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { guard: new PermissionsGuard(reflector), context };
}

describe('PermissionsGuard', () => {
  it('allows a route with no declaration through (authentication-only)', () => {
    const { guard, context } = guardFor([], {});
    expect(guard.canActivate(context)).toBe(true);
  });

  describe('@RequirePermissions (AND)', () => {
    it('passes only when every declared code is held', () => {
      const { guard, context } = guardFor(['a', 'b'], { all: ['a', 'b'] });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('throws 403 when one declared code is missing', () => {
      const { guard, context } = guardFor(['a'], { all: ['a', 'b'] });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('@RequireAnyPermission (OR)', () => {
    const any = ['pricing.discount.request', 'pricing.discount.approve'];

    it('passes for a caller holding only the request permission', () => {
      const { guard, context } = guardFor(['pricing.discount.request'], { any });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes for a caller holding only the approve permission', () => {
      const { guard, context } = guardFor(['pricing.discount.approve'], { any });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('throws 403 for a caller holding neither', () => {
      const { guard, context } = guardFor(['inventory.view'], { any });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  it('enforces both the AND list and at least one ANY code when a route declares both', () => {
    expect(() => {
      const { guard, context } = guardFor(['sales.orders.view'], { all: ['sales.orders.view'], any: ['a', 'b'] });
      guard.canActivate(context);
    }).toThrow(ForbiddenException);

    const ok = guardFor(['sales.orders.view', 'a'], { all: ['sales.orders.view'], any: ['a', 'b'] });
    expect(ok.guard.canActivate(ok.context)).toBe(true);
  });

  describe('ADR-0036 extension — a support session bypasses the permission-code check entirely', () => {
    const supportSession = { supportSessionId: 's1', tenantId: 't1', mode: 'read', reason: 'checking a ticket' };

    it('allows a GET under a support session even against a route requiring a permission the (empty) tenantContext does not grant', () => {
      const { guard, context } = guardFor([], { all: ['products.manage'] }, { supportSession, method: 'GET' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows a GET under a support session on a route with no declaration too', () => {
      const { guard, context } = guardFor([], {}, { supportSession, method: 'GET' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('refuses any non-GET method under a support session, regardless of declared permissions', () => {
      const { guard, context } = guardFor([], {}, { supportSession, method: 'POST' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('never consults the granted-permissions set for a support session (the code is irrelevant, not merely unmet)', () => {
      const { guard, context } = guardFor(['products.manage'], { all: ['products.manage'] }, { supportSession, method: 'PATCH' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});
