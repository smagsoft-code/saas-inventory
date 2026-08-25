import { Global, Module } from '@nestjs/common';
import { getDb } from './client';
import { getPlatformDb } from './platform-client';
import { getPublicResolverDb } from './public-resolver-client';

/** DI token for the app_tenant-scoped Drizzle instance — inject with `@Inject(DATABASE)`. */
export const DATABASE = Symbol('DATABASE');

/** DI token for the app_platform-scoped (BYPASSRLS) Drizzle instance — inject with
 * `@Inject(PLATFORM_DATABASE)`. Reach for this only for the narrow, explicit administrative
 * operations described in platform-client.ts — never as a general substitute for DATABASE. */
export const PLATFORM_DATABASE = Symbol('PLATFORM_DATABASE');

/** DI token for the app_public_resolver-scoped Drizzle instance — inject with
 * `@Inject(PUBLIC_RESOLVER_DATABASE)`. Reach for this only from the QR public resolver (`GET
 * /q/:code`, apps/api/src/qr/public/qr-public.repository.ts) — never a general substitute for
 * DATABASE, and never inside `withTenantTransaction()` (there is no `app.tenant_id` to set on this
 * connection). */
export const PUBLIC_RESOLVER_DATABASE = Symbol('PUBLIC_RESOLVER_DATABASE');

/**
 * Provides the Drizzle/PostgreSQL connections (app_tenant and app_platform roles) to the rest of
 * the application. Global so every future feature module can inject either token without
 * re-importing this module.
 *
 * Deliberately minimal: this only wires up the connections themselves. Repository classes, the
 * request-scoped TenantContext, and the guard that resolves it from the verified JWT are
 * business/application-layer concerns (backend.md#layering-inside-each-module) — see
 * apps/api/src/common and apps/api/src/auth for Prompt 04's guards/repositories.
 */
@Global()
@Module({
  providers: [
    { provide: DATABASE, useFactory: getDb },
    { provide: PLATFORM_DATABASE, useFactory: getPlatformDb },
    { provide: PUBLIC_RESOLVER_DATABASE, useFactory: getPublicResolverDb },
  ],
  exports: [DATABASE, PLATFORM_DATABASE, PUBLIC_RESOLVER_DATABASE],
})
export class DatabaseModule {}
