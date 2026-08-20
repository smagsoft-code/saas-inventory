import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit-cookie CSRF protection (security.md#csrf) — required because cookie-authenticated
 * requests are attached ambiently by the browser, so SameSite alone is treated here as
 * insufficient, per that document's explicit warning. csrf-token.service.ts issues a
 * non-httpOnly `csrf_token` cookie alongside the session cookies on login/register/refresh; this
 * guard requires a matching `X-CSRF-Token` header on every state-changing request.
 *
 * Skipped for: safe (read-only) methods, @SkipCsrf() routes (register/login — no session cookie
 * can exist yet to protect), and requests authenticated via an Authorization bearer header
 * (mobile.md's transport — a third-party page cannot make a browser attach an arbitrary header,
 * so CSRF does not apply to that transport).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return true;
    }

    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const cookieToken = cookies?.['csrf_token'];
    const headerToken = request.headers['x-csrf-token'];

    if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
      throw new ForbiddenException('Missing or invalid CSRF token.');
    }
    return true;
  }
}
