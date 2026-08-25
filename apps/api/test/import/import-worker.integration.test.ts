import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAppImportWorkerDatabaseUrl, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, importWorkerIntegrationTestsEnabled } from '../database/helpers';

/**
 * §22/ADR-0029 — the Import Worker's own claiming connection (app_import_worker, migration
 * 0019/0020/0021), exercised for real: a real cross-tenant `FOR UPDATE SKIP LOCKED` claim query
 * against real PostgreSQL, not a mock. Gated by importWorkerIntegrationTestsEnabled (needs
 * TEST_APP_IMPORT_WORKER_DATABASE_URL in addition to every other TEST_APP_*_DATABASE_URL) — most
 * environments running `pnpm test:integration` (including tools/pg-verify's own harness) don't set
 * this one, so this file's tests are skipped there without failing the run; see this repo's FASE
 * 10 final report for the exact command to run this file specifically.
 *
 * Seeds its fixture jobs through the real HTTP registration/import-upload flow (buildApp(), same
 * as every other integration file), then drives ImportWorkerClaimRepository directly against the
 * real app_import_worker connection — the one piece the HTTP-only import.integration.test.ts file
 * cannot reach, since the main API process never touches that connection.
 */
describe.skipIf(!importWorkerIntegrationTestsEnabled)('import worker: claiming (integration)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_APP_TENANT_DATABASE_URL'];
    process.env['APP_PLATFORM_DATABASE_URL'] = getAppPlatformDatabaseUrl();
    process.env['APP_PUBLIC_RESOLVER_DATABASE_URL'] = getAppPublicResolverDatabaseUrl();
    process.env['APP_IMPORT_WORKER_DATABASE_URL'] = getAppImportWorkerDatabaseUrl();
    process.env['JWT_SECRET'] = 'integration-test-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'integration-test-refresh-pepper';
    process.env['CORS_ORIGINS'] = 'http://localhost:3000';
    process.env['ARGON2_MEMORY_COST_KIB'] = '8192';
    process.env['ARGON2_TIME_COST'] = '2';
    process.env['ARGON2_PARALLELISM'] = '1';
    process.env['AUTH_RATE_LIMIT_MAX'] = '1000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';

    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  function inject(options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse> {
    return app.getHttpAdapter().getInstance().inject(options as InjectOptions);
  }

  function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
    const raw = response.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) return value;
    }
    return undefined;
  }

  interface Session {
    user: { id: string; tenantId: string };
    accessToken: string;
    csrfToken: string;
  }

  async function registerTenant(companyName: string, email: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/register', payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' } });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  /** Creates one import_jobs row directly in `validating` — as if the sync HTTP path had just
   * flipped it and returned, waiting for the worker. Bypasses the real /imports upload endpoint
   * deliberately: that endpoint also writes the file to ObjectStorageService, an unrelated
   * dependency this file has no need to provision (this environment has no reachable S3/MinIO
   * endpoint — see import-test-app.ts's header comment for the same constraint in the HTTP-level
   * suite). Registration still goes through the real endpoint, since created_by/tenant_id must be
   * real, FK-valid rows. */
  async function seedValidatingJob(session: Session): Promise<string> {
    const { withTenantTransaction } = await import('../../src/database/tenant-context');
    const { ImportJobsRepository } = await import('../../src/import/repositories/import-jobs.repository');
    const { generateId } = await import('@saas-inventory/shared');
    const importJobsRepository = app.get(ImportJobsRepository);
    const jobId = generateId();
    await withTenantTransaction(session.user.tenantId, async (tx) => {
      await importJobsRepository.create(tx, {
        id: jobId,
        tenantId: session.user.tenantId,
        createdBy: session.user.id,
        columnMapping: { SKU: 'sku' },
        duplicateHandlingMode: 'update_catalog_only',
        storageKey: `imports/${session.user.tenantId}/${jobId}/upload.xlsx`,
        originalFilename: 'worker-test.xlsx',
      });
      await importJobsRepository.update(tx, session.user.tenantId, jobId, { status: 'validating' });
    });
    return jobId;
  }

  it('claims jobs across multiple tenants in one cross-tenant query, never claiming the same job twice concurrently', async () => {
    const tenantA = await registerTenant('Worker Test Alpha', 'admin@worker-test-alpha.example');
    const tenantB = await registerTenant('Worker Test Beta', 'admin@worker-test-beta.example');
    const jobAId = await seedValidatingJob(tenantA);
    const jobBId = await seedValidatingJob(tenantB);

    const { ImportWorkerClaimRepository } = await import('../../src/import/repositories/import-worker-claim.repository');
    const { getImportWorkerDb } = await import('../../src/database/import-worker-client');
    const claimRepository = app.get(ImportWorkerClaimRepository);
    const db = getImportWorkerDb();

    const [firstAttempt, secondAttempt] = await Promise.all([claimRepository.claimBatch(db, 'worker-A', 10), claimRepository.claimBatch(db, 'worker-B', 10)]);

    const allClaimed = [...firstAttempt, ...secondAttempt].filter((j) => j.id === jobAId || j.id === jobBId);
    expect(allClaimed).toHaveLength(2);
    expect(allClaimed.map((j) => j.tenantId).sort()).toEqual([tenantA.user.tenantId, tenantB.user.tenantId].sort());

    // FOR UPDATE SKIP LOCKED guarantees no job was claimed by both concurrent callers.
    const claimedIds = allClaimed.map((j) => j.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);

    // Immediately after, neither job is claimable again (not stale yet).
    const thirdAttempt = await claimRepository.claimBatch(db, 'worker-C', 10);
    expect(thirdAttempt.filter((j) => j.id === jobAId || j.id === jobBId)).toHaveLength(0);
  });

  it('reclaims a job whose claim has exceeded the staleness threshold', async () => {
    const tenant = await registerTenant('Worker Test Gamma', 'admin@worker-test-gamma.example');
    const jobId = await seedValidatingJob(tenant);

    const { ImportWorkerClaimRepository } = await import('../../src/import/repositories/import-worker-claim.repository');
    const { getImportWorkerDb } = await import('../../src/database/import-worker-client');
    const claimRepository = app.get(ImportWorkerClaimRepository);
    const db = getImportWorkerDb();

    const firstClaim = await claimRepository.claimBatch(db, 'worker-original', 10);
    expect(firstClaim.some((j) => j.id === jobId)).toBe(true);

    // Immediately after: not yet stale under the default threshold.
    const tooSoon = await claimRepository.claimBatch(db, 'worker-reclaimer', 10);
    expect(tooSoon.some((j) => j.id === jobId)).toBe(false);

    // With the staleness threshold forced to 0ms, the same job becomes reclaimable immediately.
    const previous = process.env['IMPORT_WORKER_STALE_CLAIM_MS'];
    process.env['IMPORT_WORKER_STALE_CLAIM_MS'] = '0';
    try {
      const reclaimed = await claimRepository.claimBatch(db, 'worker-reclaimer', 10);
      expect(reclaimed.some((j) => j.id === jobId)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env['IMPORT_WORKER_STALE_CLAIM_MS'];
      else process.env['IMPORT_WORKER_STALE_CLAIM_MS'] = previous;
    }
  });
});
