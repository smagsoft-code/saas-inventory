import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from './csrf.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  it('allows safe methods through without any token', () => {
    const guard = new CsrfGuard({ getAllAndOverride: () => false } as unknown as Reflector);
    const context = contextFor({ method: 'GET', headers: {} });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a @SkipCsrf() route through (register/login) without a token', () => {
    const guard = new CsrfGuard({ getAllAndOverride: () => true } as unknown as Reflector);
    const context = contextFor({ method: 'POST', headers: {} });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a bearer-authenticated request through without a CSRF token', () => {
    const guard = new CsrfGuard({ getAllAndOverride: () => false } as unknown as Reflector);
    const context = contextFor({ method: 'POST', headers: { authorization: 'Bearer some-token' } });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a cookie-authenticated state-changing request with no CSRF header', () => {
    const guard = new CsrfGuard({ getAllAndOverride: () => false } as unknown as Reflector);
    const context = contextFor({ method: 'POST', headers: {}, cookies: { csrf_token: 'abc' } });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when the header does not match the cookie', () => {
    const guard = new CsrfGuard({ getAllAndOverride: () => false } as unknown as Reflector);
    const context = contextFor({
      method: 'POST',
      headers: { 'x-csrf-token': 'wrong' },
      cookies: { csrf_token: 'abc' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows when the header matches the cookie (double-submit)', () => {
    const guard = new CsrfGuard({ getAllAndOverride: () => false } as unknown as Reflector);
    const context = contextFor({
      method: 'POST',
      headers: { 'x-csrf-token': 'abc' },
      cookies: { csrf_token: 'abc' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});
