import { Global, Module } from '@nestjs/common';
import { getDb } from './client';

/** DI token for the app_tenant-scoped Drizzle instance — inject with `@Inject(DATABASE)`. */
export const DATABASE = Symbol('DATABASE');

/**
 * Provides the Drizzle/PostgreSQL connection (app_tenant role) to the rest of the application.
 * Global so every future feature module can inject DATABASE without re-importing this module.
 *
 * Deliberately minimal: this only wires up the connection itself. Repository classes, the
 * request-scoped TenantContext, and the guard that resolves it from the verified JWT are
 * business/application-layer concerns for later phases (backend.md#layering-inside-each-module)
 * — out of this phase's scope, which stops at the persistence layer.
 */
@Global()
@Module({
  providers: [{ provide: DATABASE, useFactory: getDb }],
  exports: [DATABASE],
})
export class DatabaseModule {}
