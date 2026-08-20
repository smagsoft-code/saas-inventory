import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Separate from vitest.config.ts (unit tests, `src/**\/*.spec.ts`) on purpose — these tests need
 * a real, reachable PostgreSQL instance (see test/database/helpers.ts) and destructively reset
 * a dedicated test database's schema, so they must never run as part of the default `test` task
 * that CI/every contributor runs unconditionally. Run explicitly via `pnpm test:integration`
 * once TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL are set (see that file) —
 * typically against the docker-compose.dev.yml Postgres instance.
 *
 * Transformed with SWC (unplugin-swc), not Vitest's default esbuild — unlike vitest.config.ts's
 * unit suite (mocked DI, no real Nest container), this suite calls the real buildApp() (src/
 * main.ts), which boots an actual Nest DI container and generates the real Swagger document.
 * Both depend on `emitDecoratorMetadata` (design:type/design:paramtypes) being correct for every
 * constructor-injected class and every @ApiProperty()-decorated DTO field. esbuild's decorator-
 * metadata support is a syntax-level approximation, not the real type checker, and was found
 * (Prompt 05-B, running this suite for real for the first time) to silently emit `undefined` for
 * several such properties — surfacing as `SchemaObjectFactory`'s "circular dependency" error at
 * Swagger-doc-generation time, and as `TypeError: Cannot read properties of undefined (reading
 * 'getAllAndOverride')` at guard-execution time (this.reflector undefined — the same class of
 * broken DI as the `import type` bug fixed in Prompt 05-A, but from the transpiler this time, not
 * the source). SWC's decorator-metadata emission matches tsc's (it's what `@nestjs/cli --builder
 * swc` uses in production), so it doesn't have this gap.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    root: './',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The database is reset/migrated exactly once, here, before any test file runs — see
    // global-setup.ts for why per-file reset was a real (not just wasteful) bug.
    globalSetup: ['test/database/global-setup.ts'],
    // All test files now run against the same already-migrated database — no schema-level
    // mutation happens per file, only tenant-scoped row inserts each file creates and scopes to
    // its own generated ids, so parallel files no longer contend on the same DDL/role state.
    fileParallelism: true,
  },
});
