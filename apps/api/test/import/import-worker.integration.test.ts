import { generateId } from '@saas-inventory/shared';
import * as argon2 from 'argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAppImportWorkerDatabaseUrl, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb, importWorkerIntegrationTestsEnabled } from '../database/helpers';

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
  const PLATFORM_ADMIN_PASSWORD = 'a-very-long-platform-admin-password';
  let platformAdminEmail: string;

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

    // PROMPT 011-B: this suite's W1-W7 cases need a way to suspend/activate a tenant — the same
    // platform-admin bootstrap test/administration/platform-admin.integration.test.ts uses.
    const schema = await import('../../src/database/schema');
    platformAdminEmail = `superadmin-worker-${generateId()}@example.com`;
    const passwordHash = await argon2.hash(PLATFORM_ADMIN_PASSWORD, { type: argon2.argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1 });
    const { client, db } = getMigratorDb();
    try {
      await db.insert(schema.platformAdmins).values({
        id: generateId(),
        email: platformAdminEmail,
        passwordHash,
        fullName: 'Test SuperAdmin (worker suite)',
      });
    } finally {
      await client.end();
    }
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

  function cookieHeader(cookies: Record<string, string | undefined>): string {
    return Object.entries(cookies)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  function writeHeaders(session: Session): Record<string, string> {
    return {
      cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  interface PlatformSession {
    accessToken: string;
    csrfToken: string;
  }

  async function loginPlatformAdmin(): Promise<PlatformSession> {
    const response = await inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: platformAdminEmail, password: PLATFORM_ADMIN_PASSWORD } });
    expect(response.statusCode).toBe(200);
    return { accessToken: cookieValue(response, 'platform_access_token')!, csrfToken: cookieValue(response, 'platform_csrf_token')! };
  }

  async function suspendTenant(platformSession: PlatformSession, tenantId: string): Promise<void> {
    const response = await inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/suspend`,
      headers: {
        cookie: cookieHeader({ platform_access_token: platformSession.accessToken, platform_csrf_token: platformSession.csrfToken }),
        'x-csrf-token': platformSession.csrfToken,
      },
    });
    expect(response.statusCode).toBe(200);
  }

  async function activateTenant(platformSession: PlatformSession, tenantId: string): Promise<void> {
    const response = await inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/activate`,
      headers: {
        cookie: cookieHeader({ platform_access_token: platformSession.accessToken, platform_csrf_token: platformSession.csrfToken }),
        'x-csrf-token': platformSession.csrfToken,
      },
    });
    expect(response.statusCode).toBe(200);
  }

  async function createWarehouse(session: Session, name: string, code: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/warehouses', headers: writeHeaders(session), payload: { name, code } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function createLocation(session: Session, warehouseId: string, name: string, code: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(session), payload: { warehouseId, name, code } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  /** Creates one `importing`-status job with `count` rows already staged `valid`/`create` —
   * as if a real validation pass had already run (bypassed here deliberately: this file's whole
   * point is exercising the commit-time worker/suspension mechanism, not re-proving FASE 10's own
   * already-extensively-tested validation logic). Each row is a brand-new SKU with quantity 1 at
   * `locationName`, so a successful commit produces exactly one INITIAL_STOCK movement per row. */
  async function seedCommittableJob(session: Session, locationName: string, skuPrefix: string, count: number): Promise<string> {
    const { withTenantTransaction } = await import('../../src/database/tenant-context');
    const { ImportJobsRepository } = await import('../../src/import/repositories/import-jobs.repository');
    const { ImportJobRowsRepository } = await import('../../src/import/repositories/import-job-rows.repository');
    const importJobsRepository = app.get(ImportJobsRepository);
    const importJobRowsRepository = app.get(ImportJobRowsRepository);
    const jobId = generateId();
    const identityMapping = { sku: 'sku', name: 'name', maxPrice: 'maxPrice', basePrice: 'basePrice', minPrice: 'minPrice', quantity: 'quantity', location: 'location' };

    await withTenantTransaction(session.user.tenantId, async (tx) => {
      await importJobsRepository.create(tx, {
        id: jobId,
        tenantId: session.user.tenantId,
        createdBy: session.user.id,
        columnMapping: identityMapping,
        duplicateHandlingMode: 'update_catalog_only',
        storageKey: `imports/${session.user.tenantId}/${jobId}/upload.xlsx`,
        originalFilename: 'worker-commit-test.xlsx',
      });

      const rows = Array.from({ length: count }, (_, i) => ({
        id: generateId(),
        tenantId: session.user.tenantId,
        importJobId: jobId,
        rowNumber: i + 1,
        rawData: {
          sku: `${skuPrefix}-${i + 1}`,
          name: `${skuPrefix} Product ${i + 1}`,
          maxPrice: '100',
          basePrice: '80',
          minPrice: '50',
          quantity: '1',
          location: locationName,
        },
      }));
      await importJobRowsRepository.insertMany(tx, rows);
      for (const row of rows) {
        await importJobRowsRepository.setValidationResult(tx, session.user.tenantId, row.id, {
          mappedData: row.rawData,
          status: 'valid',
          matchAction: 'create',
          matchedProductVariantId: null,
          errors: [],
          warnings: [],
        });
      }

      await importJobsRepository.update(tx, session.user.tenantId, jobId, { status: 'importing', totalRows: count, validRows: count, invalidRows: 0 });
    });
    return jobId;
  }

  async function countInventoryMovements(tenantId: string, jobId: string): Promise<number> {
    const { client } = getMigratorDb();
    try {
      const rows = await client<{ count: string }[]>`
        select count(*) from inventory_movements
        where tenant_id = ${tenantId} and reference_type = 'import_job' and reference_id = ${jobId}
      `;
      return Number(rows[0]?.count ?? 0);
    } finally {
      await client.end();
    }
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

  describe('PROMPT 011-B: suspended-tenant enforcement', () => {
    // W1 — a suspended tenant's job is not (newly) claimed; an active tenant's job still is.
    it('W1: claimBatch skips a suspended tenant\'s job but still claims an active tenant\'s job', async () => {
      const tenantA = await registerTenant('Worker Suspend W1-A', 'admin@worker-suspend-w1-a.example');
      const tenantB = await registerTenant('Worker Suspend W1-B', 'admin@worker-suspend-w1-b.example');
      const jobAId = await seedValidatingJob(tenantA);
      const jobBId = await seedValidatingJob(tenantB);
      const platformSession = await loginPlatformAdmin();

      await suspendTenant(platformSession, tenantA.user.tenantId);

      const { ImportWorkerClaimRepository } = await import('../../src/import/repositories/import-worker-claim.repository');
      const { getImportWorkerDb } = await import('../../src/database/import-worker-client');
      const claimRepository = app.get(ImportWorkerClaimRepository);
      const db = getImportWorkerDb();

      const claimed = await claimRepository.claimBatch(db, 'worker-w1', 10);
      expect(claimed.some((j) => j.id === jobAId)).toBe(false);
      expect(claimed.some((j) => j.id === jobBId)).toBe(true);
    });

    // W2 — reactivation makes the same (never recreated) job claimable again.
    it('W2: reactivating the tenant makes the same, never-recreated job claimable', async () => {
      const tenant = await registerTenant('Worker Suspend W2', 'admin@worker-suspend-w2.example');
      const jobId = await seedValidatingJob(tenant);
      const platformSession = await loginPlatformAdmin();

      await suspendTenant(platformSession, tenant.user.tenantId);

      const { ImportWorkerClaimRepository } = await import('../../src/import/repositories/import-worker-claim.repository');
      const { getImportWorkerDb } = await import('../../src/database/import-worker-client');
      const claimRepository = app.get(ImportWorkerClaimRepository);
      const db = getImportWorkerDb();

      const whileSuspended = await claimRepository.claimBatch(db, 'worker-w2', 10);
      expect(whileSuspended.some((j) => j.id === jobId)).toBe(false);

      await activateTenant(platformSession, tenant.user.tenantId);

      const afterReactivation = await claimRepository.claimBatch(db, 'worker-w2', 10);
      expect(afterReactivation.some((j) => j.id === jobId)).toBe(true);
    });

    // W3 — a stale claim on a suspended tenant is not reclaimed; reactivation allows reclaiming.
    it('W3: a stale claim is not reclaimed while the tenant is suspended, but is once reactivated', async () => {
      const tenant = await registerTenant('Worker Suspend W3', 'admin@worker-suspend-w3.example');
      const jobId = await seedValidatingJob(tenant);
      const platformSession = await loginPlatformAdmin();

      const { ImportWorkerClaimRepository } = await import('../../src/import/repositories/import-worker-claim.repository');
      const { getImportWorkerDb } = await import('../../src/database/import-worker-client');
      const claimRepository = app.get(ImportWorkerClaimRepository);
      const db = getImportWorkerDb();

      const firstClaim = await claimRepository.claimBatch(db, 'worker-original-w3', 10);
      expect(firstClaim.some((j) => j.id === jobId)).toBe(true);

      await suspendTenant(platformSession, tenant.user.tenantId);

      const previous = process.env['IMPORT_WORKER_STALE_CLAIM_MS'];
      process.env['IMPORT_WORKER_STALE_CLAIM_MS'] = '0';
      try {
        const staleButSuspended = await claimRepository.claimBatch(db, 'worker-reclaimer-w3', 10);
        expect(staleButSuspended.some((j) => j.id === jobId)).toBe(false);

        await activateTenant(platformSession, tenant.user.tenantId);

        const staleAndActive = await claimRepository.claimBatch(db, 'worker-reclaimer-w3', 10);
        expect(staleAndActive.some((j) => j.id === jobId)).toBe(true);
      } finally {
        if (previous === undefined) delete process.env['IMPORT_WORKER_STALE_CLAIM_MS'];
        else process.env['IMPORT_WORKER_STALE_CLAIM_MS'] = previous;
      }
    });

    // W4/W5 — the between-batch commit-loop check: no new batch begins once suspension is
    // observable; the job stays `importing` (never `failed`, never falsely `completed`); after
    // reactivation, only the still-`valid` rows get processed — the already-imported ones (none,
    // in this minimal case, since the check fires before the very first batch) are never replayed.
    it('W4/W5: commitJob processes nothing while suspended (job stays importing, not failed/completed); reactivation completes it exactly once', async () => {
      const tenant = await registerTenant('Worker Suspend W4W5', 'admin@worker-suspend-w4w5.example');
      const warehouseId = await createWarehouse(tenant, 'WH', `WH-W4W5-${Date.now()}`);
      await createLocation(tenant, warehouseId, 'Zone W4W5', `Z-W4W5-${Date.now()}`);
      const jobId = await seedCommittableJob(tenant, 'Zone W4W5', 'W4W5', 2);
      const platformSession = await loginPlatformAdmin();

      await suspendTenant(platformSession, tenant.user.tenantId);

      const { ImportJobService } = await import('../../src/import/services/import-job.service');
      const importJobService = app.get(ImportJobService);

      const whileSuspended = await importJobService.runCommit(tenant.user.tenantId, jobId, tenant.user.id);
      expect(whileSuspended.status).toBe('importing');
      expect(whileSuspended.completedAt).toBeUndefined();
      expect(await countInventoryMovements(tenant.user.tenantId, jobId)).toBe(0);

      await activateTenant(platformSession, tenant.user.tenantId);

      const afterReactivation = await importJobService.runCommit(tenant.user.tenantId, jobId, tenant.user.id);
      expect(afterReactivation.status).toBe('completed');
      expect(afterReactivation.importedRows).toBe(2);
      // Exactly one INITIAL_STOCK movement per row — no duplication from the earlier no-op attempt.
      expect(await countInventoryMovements(tenant.user.tenantId, jobId)).toBe(2);

      // Calling runCommit again (as a retry/worker-repoll might) is a safe no-op — every row is
      // already `imported`, nextCommittableBatch selects nothing, no further movements are written.
      const idempotentRetry = await importJobService.runCommit(tenant.user.tenantId, jobId, tenant.user.id);
      expect(idempotentRetry.status).toBe('completed');
      expect(await countInventoryMovements(tenant.user.tenantId, jobId)).toBe(2);
    });

    // W6 — a multi-serial regression (PROMPT 010-A) run through the same suspend/reactivate gate:
    // N serialized units of one product, suspended before commit, reactivated, committed exactly
    // once — N serials, N movements, correct balance, no duplication.
    it('W6: a multi-serial job is unaffected by an intervening suspend/reactivate cycle — no duplicate serials/movements', async () => {
      const tenant = await registerTenant('Worker Suspend W6', 'admin@worker-suspend-w6.example');
      const warehouseId = await createWarehouse(tenant, 'WH', `WH-W6-${Date.now()}`);
      await createLocation(tenant, warehouseId, 'Zone W6', `Z-W6-${Date.now()}`);
      const platformSession = await loginPlatformAdmin();

      // Three rows sharing one brand-new SKU (multi-serial onboarding, PROMPT 010-A) — built
      // directly (not via seedCommittableJob's one-row-per-SKU shape) since this case needs the
      // *same* SKU across rows plus a distinct serialNumber per row.
      const { withTenantTransaction } = await import('../../src/database/tenant-context');
      const { ImportJobsRepository } = await import('../../src/import/repositories/import-jobs.repository');
      const { ImportJobRowsRepository } = await import('../../src/import/repositories/import-job-rows.repository');
      const importJobsRepository = app.get(ImportJobsRepository);
      const importJobRowsRepository = app.get(ImportJobRowsRepository);
      const jobId = generateId();
      const sku = `W6-MULTISERIAL-${Date.now()}`;
      const identityMapping = {
        sku: 'sku',
        name: 'name',
        maxPrice: 'maxPrice',
        basePrice: 'basePrice',
        minPrice: 'minPrice',
        quantity: 'quantity',
        location: 'location',
        serialNumber: 'serialNumber',
      };
      const serials = ['SN-W6-1', 'SN-W6-2', 'SN-W6-3'];

      await withTenantTransaction(tenant.user.tenantId, async (tx) => {
        await importJobsRepository.create(tx, {
          id: jobId,
          tenantId: tenant.user.tenantId,
          createdBy: tenant.user.id,
          columnMapping: identityMapping,
          duplicateHandlingMode: 'update_catalog_only',
          storageKey: `imports/${tenant.user.tenantId}/${jobId}/upload.xlsx`,
          originalFilename: 'worker-multiserial-test.xlsx',
        });
        const rows = serials.map((serialNumber, i) => ({
          id: generateId(),
          tenantId: tenant.user.tenantId,
          importJobId: jobId,
          rowNumber: i + 1,
          rawData: { sku, name: 'W6 Multi-Serial Product', maxPrice: '100', basePrice: '80', minPrice: '50', quantity: '1', location: 'Zone W6', serialNumber },
        }));
        await importJobRowsRepository.insertMany(tx, rows);
        for (const row of rows) {
          await importJobRowsRepository.setValidationResult(tx, tenant.user.tenantId, row.id, {
            mappedData: row.rawData,
            status: 'valid',
            matchAction: 'create',
            matchedProductVariantId: null,
            errors: [],
            warnings: [],
          });
        }
        await importJobsRepository.update(tx, tenant.user.tenantId, jobId, { status: 'importing', totalRows: serials.length, validRows: serials.length, invalidRows: 0 });
      });

      await suspendTenant(platformSession, tenant.user.tenantId);

      const { ImportJobService } = await import('../../src/import/services/import-job.service');
      const importJobService = app.get(ImportJobService);

      const whileSuspended = await importJobService.runCommit(tenant.user.tenantId, jobId, tenant.user.id);
      expect(whileSuspended.status).toBe('importing');
      expect(await countInventoryMovements(tenant.user.tenantId, jobId)).toBe(0);

      await activateTenant(platformSession, tenant.user.tenantId);

      const completed = await importJobService.runCommit(tenant.user.tenantId, jobId, tenant.user.id);
      expect(completed.status).toBe('completed');
      expect(completed.importedRows).toBe(3);
      expect(await countInventoryMovements(tenant.user.tenantId, jobId)).toBe(3);

      const { client } = getMigratorDb();
      try {
        const serialRows = await client<{ serial_number: string }[]>`
          select serial_number from product_serials ps
          join product_variants pv on pv.id = ps.product_variant_id
          where pv.tenant_id = ${tenant.user.tenantId} and pv.sku = ${sku}
        `;
        expect(serialRows.map((r) => r.serial_number).sort()).toEqual([...serials].sort());

        const balanceRows = await client<{ quantity_physical: string }[]>`
          select ib.quantity_physical from inventory_balances ib
          join product_variants pv on pv.id = ib.product_variant_id
          where pv.tenant_id = ${tenant.user.tenantId} and pv.sku = ${sku}
        `;
        expect(balanceRows).toHaveLength(1);
        expect(Number(balanceRows[0]!.quantity_physical)).toBe(3);
      } finally {
        await client.end();
      }
    });

    // W7 — the new tenant-status JOIN must not break FOR UPDATE SKIP LOCKED atomicity: two
    // concurrent claimers, one suspended tenant mixed in with active ones, no double-claim.
    it('W7: two concurrent claimers never double-claim, and a suspended tenant mixed in is still excluded from both', async () => {
      const tenantA = await registerTenant('Worker Suspend W7-A', 'admin@worker-suspend-w7-a.example');
      const tenantB = await registerTenant('Worker Suspend W7-B', 'admin@worker-suspend-w7-b.example');
      const tenantC = await registerTenant('Worker Suspend W7-C', 'admin@worker-suspend-w7-c.example');
      const jobAId = await seedValidatingJob(tenantA);
      const jobBId = await seedValidatingJob(tenantB);
      const jobCId = await seedValidatingJob(tenantC);
      const platformSession = await loginPlatformAdmin();

      await suspendTenant(platformSession, tenantB.user.tenantId);

      const { ImportWorkerClaimRepository } = await import('../../src/import/repositories/import-worker-claim.repository');
      const { getImportWorkerDb } = await import('../../src/database/import-worker-client');
      const claimRepository = app.get(ImportWorkerClaimRepository);
      const db = getImportWorkerDb();

      const [firstAttempt, secondAttempt] = await Promise.all([
        claimRepository.claimBatch(db, 'worker-w7-1', 10),
        claimRepository.claimBatch(db, 'worker-w7-2', 10),
      ]);
      const allClaimed = [...firstAttempt, ...secondAttempt];
      const claimedIds = allClaimed.map((j) => j.id);

      expect(claimedIds).toContain(jobAId);
      expect(claimedIds).toContain(jobCId);
      expect(claimedIds).not.toContain(jobBId);
      expect(new Set(claimedIds).size).toBe(claimedIds.length);
    });
  });
});
