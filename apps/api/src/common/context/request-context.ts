/**
 * Cross-cutting per-request context, made available via NestJS's request scope
 * (backend.md#cross-cutting-concerns): the verified identity from the JWT (AuthPrincipal, set by
 * JwtAuthGuard) and the resolved tenant scope + effective permissions (TenantRequestContext, set
 * by TenantGuard). Attached directly to the Fastify request object rather than an
 * AsyncLocalStorage store — simpler, and "request scope" is the architecture's own documented
 * alternative to ALS for this purpose.
 */
import type { FastifyRequest } from 'fastify';

export interface AuthPrincipal {
  userId: string;
  tenantId: string;
  tenantSlug: string;
}

export interface TenantRequestContext extends AuthPrincipal {
  /** Effective permission codes for this user, resolved once per request by TenantGuard
   * (user_roles -> role_permissions), per ADR-0009. */
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by JwtAuthGuard once the access token is verified. Absent on public routes. */
    authPrincipal?: AuthPrincipal;
    /** Set by TenantGuard once the tenant scope + permissions are resolved. Absent on public
     * routes and on any route JwtAuthGuard already rejected. */
    tenantContext?: TenantRequestContext;
    /** Set by the correlation-id hook (main.ts) on every request, including public ones. */
    correlationId: string;
  }
}

export function getAuthPrincipal(request: FastifyRequest): AuthPrincipal | undefined {
  return request.authPrincipal;
}

export function getTenantContext(request: FastifyRequest): TenantRequestContext | undefined {
  return request.tenantContext;
}
