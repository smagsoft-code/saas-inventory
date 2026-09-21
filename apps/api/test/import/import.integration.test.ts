import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';
import { buildMultipartUpload } from './multipart';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * FASE 10 (roadmap.md) — the staged Excel import pipeline, exercised through the real guard chain
 * and real app_tenant/app_platform database connections, not mocks. ObjectStorageService is the
 * one substitution in this suite (see import-test-app.ts's header comment) — no S3-compatible
 * endpoint is reachable in this environment; Postgres itself (RLS, constraints, transactions,
 * locking) is entirely real, same as every other *.integration.test.ts file.
 *
 * Does NOT call resetAndMigrate() itself — global-setup.ts already resets/migrates exactly once
 * for the whole test:integration run.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('import: staged Excel onboarding pipeline (integration)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_APP_TENANT_DATABASE_URL'];
    process.env['APP_PLATFORM_DATABASE_URL'] = getAppPlatformDatabaseUrl();
    process.env['APP_PUBLIC_RESOLVER_DATABASE_URL'] = getAppPublicResolverDatabaseUrl();
    process.env['JWT_SECRET'] = 'integration-test-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'integration-test-refresh-pepper';
    process.env['CORS_ORIGINS'] = 'http://localhost:3000';
    process.env['ARGON2_MEMORY_COST_KIB'] = '8192';
    process.env['ARGON2_TIME_COST'] = '2';
    process.env['ARGON2_PARALLELISM'] = '1';
    process.env['AUTH_RATE_LIMIT_MAX'] = '1000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';
    process.env['IMPORT_SYNC_ROW_THRESHOLD'] = '500';

    // Dynamic import, inside beforeAll, after every env var above is set — matching every other
    // *.integration.test.ts file's own `await import('../../src/main')` convention. A static
    // top-level import here would pull in AppModule's whole dependency graph (including
    // auth-config.ts's memoized getAuthConfig()) during vitest's collection phase, before this
    // beforeAll has run at all — surfaced as `MissingEnvVarError: JWT_SECRET` the first time this
    // was tried with a static import.
    const { buildImportTestApp } = await import('./import-test-app');
    app = await buildImportTestApp();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  function inject(options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string>; body?: Buffer }): Promise<LightMyRequestResponse> {
    if (options.body) {
      return app.getHttpAdapter().getInstance().inject({ method: options.method, url: options.url, payload: options.body, headers: options.headers } as InjectOptions);
    }
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

  function cookieHeader(cookies: Record<string, string | undefined>): string {
    return Object.entries(cookies)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  interface Session {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    csrfToken: string;
  }

  function readHeaders(session: Session): Record<string, string> {
    return { cookie: cookieHeader({ access_token: session.accessToken }) };
  }
  function writeHeaders(session: Session): Record<string, string> {
    return { cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }), 'x-csrf-token': session.csrfToken };
  }

  async function registerTenant(companyName: string, email: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/register', payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' } });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function loginAs(email: string, password: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function roleIdByName(admin: Session, name: string): Promise<string> {
    const response = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    const roles = JSON.parse(response.body) as { id: string; name: string }[];
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`Role "${name}" not found`);
    return role.id;
  }

  async function createAndLoginAs(admin: Session, email: string, roleName: string): Promise<Session> {
    const roleId = await roleIdByName(admin, roleName);
    const createResponse = await inject({ method: 'POST', url: '/api/v1/users', headers: writeHeaders(admin), payload: { email, fullName: `${roleName} User`, password: 'a-very-long-password', roleId } });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(email, 'a-very-long-password');
  }

  /** ADR-0035: the founding, system-default Administrador is always unrestricted by
   * `LocationAuthorizationService`, so a test demonstrating that location scope actually applies
   * needs a NON-Administrador actor. None of the DEFAULT_ROLE_TEMPLATES roles hold
   * `import.execute`/`import.inventory` besides Administrador, so this creates a custom role
   * (ROLES/PERMISSIONS block, `POST /roles`) with exactly the permissions needed. */
  async function createAndLoginWithCustomRole(admin: Session, email: string, roleName: string, permissionCodes: string[]): Promise<Session> {
    const roleResponse = await inject({ method: 'POST', url: '/api/v1/roles', headers: writeHeaders(admin), payload: { name: roleName, permissionCodes } });
    expect(roleResponse.statusCode).toBe(201);
    const roleId = (JSON.parse(roleResponse.body) as { id: string }).id;
    const createResponse = await inject({ method: 'POST', url: '/api/v1/users', headers: writeHeaders(admin), payload: { email, fullName: `${roleName} User`, password: 'a-very-long-password', roleId } });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(email, 'a-very-long-password');
  }

  async function createWarehouse(admin: Session, name: string, code: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/warehouses', headers: writeHeaders(admin), payload: { name, code } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function createLocation(admin: Session, warehouseId: string, name: string, code: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId, name, code } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function createCategory(admin: Session, name: string, slug: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/categories', headers: writeHeaders(admin), payload: { name, slug } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function buildXlsx(headers: string[], rows: Array<Array<string | number>>): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Import');
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  async function uploadJob(session: Session, fields: Record<string, string>, buffer: Buffer, filename = 'import.xlsx', contentType = XLSX_MIME): Promise<LightMyRequestResponse> {
    const { body, contentType: multipartContentType } = buildMultipartUpload({ filename, contentType, fileContent: buffer, fields });
    return inject({ method: 'POST', url: '/api/v1/imports', headers: { ...writeHeaders(session), 'content-type': multipartContentType }, body });
  }

  const STANDARD_MAPPING = JSON.stringify({ SKU: 'sku', Nombre: 'name', 'Precio Max': 'maxPrice', 'Precio Base': 'basePrice', 'Precio Min': 'minPrice', Cantidad: 'quantity', Ubicacion: 'location' });

  describe('happy path — small synchronous import (§4, §17, §26)', () => {
    it('create -> validate -> preview -> confirm creates a product/variant and an INITIAL_STOCK movement, never a raw balance write', async () => {
      const admin = await registerTenant('Import Alpha Co', 'admin@import-alpha.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);

      const buffer = await buildXlsx(
        ['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'],
        [[`SKU-${Date.now()}`, 'Imported Widget', 150, 120, 100, 25, 'Zone A']],
      );

      const created = await uploadJob(admin, { columnMapping: STANDARD_MAPPING, defaultLocationId: locationId }, buffer);
      expect(created.statusCode).toBe(201);
      const job = JSON.parse(created.body) as { id: string; status: string };
      expect(job.status).toBe('mapping');

      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${job.id}/validate`, headers: writeHeaders(admin) });
      expect(validated.statusCode).toBe(201);
      const validatedJob = JSON.parse(validated.body) as { status: string; validRows: number; invalidRows: number };
      expect(validatedJob.status).toBe('ready');
      expect(validatedJob.validRows).toBe(1);
      expect(validatedJob.invalidRows).toBe(0);

      const preview = await inject({ method: 'GET', url: `/api/v1/imports/${job.id}/preview`, headers: readHeaders(admin) });
      expect(preview.statusCode).toBe(200);
      expect(JSON.parse(preview.body)).toEqual(expect.objectContaining({ validRows: 1, newProducts: 1 }));

      const confirmed = await inject({ method: 'POST', url: `/api/v1/imports/${job.id}/confirm`, headers: writeHeaders(admin) });
      expect(confirmed.statusCode).toBe(201);
      const confirmedJob = JSON.parse(confirmed.body) as { status: string; importedRows: number };
      expect(confirmedJob.status).toBe('completed');
      expect(confirmedJob.importedRows).toBe(1);

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${job.id}/rows`, headers: readHeaders(admin) });
      const rowData = (JSON.parse(rows.body) as { data: { status: string; matchedProductVariantId: string }[] }).data;
      expect(rowData[0]?.status).toBe('imported');
      const variantId = rowData[0]!.matchedProductVariantId;

      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const movementTypes = (JSON.parse(movements.body) as { data: { movementType: string; referenceType?: string }[] }).data;
      expect(movementTypes).toHaveLength(1);
      expect(movementTypes[0]).toEqual(expect.objectContaining({ movementType: 'INITIAL_STOCK', referenceType: 'import_job' }));

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const balance = (JSON.parse(balances.body) as { data: { quantityPhysical: number }[] }).data[0]!;
      expect(balance.quantityPhysical).toBe(25);
    });
  });

  describe('§16 — duplicate handling: update_catalog_only default never touches inventory', () => {
    it('re-importing an existing SKU updates the name but leaves stock untouched', async () => {
      const admin = await registerTenant('Import Beta Co', 'admin@import-beta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const sku = `SKU-${Date.now()}`;

      const first = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'], [[sku, 'Original Name', 100, 90, 80, 10, 'Zone A']]);
      const firstJob = await uploadJob(admin, { columnMapping: STANDARD_MAPPING, defaultLocationId: locationId }, first);
      const firstJobId = (JSON.parse(firstJob.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/validate`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/confirm`, headers: writeHeaders(admin) });

      // Second import: same SKU, new name, a (deliberately ignored) larger quantity — default mode
      // is update_catalog_only, so quantity must never move.
      const second = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'], [[sku, 'Corrected Name', 100, 90, 80, 999, 'Zone A']]);
      const secondJob = await uploadJob(admin, { columnMapping: STANDARD_MAPPING, defaultLocationId: locationId }, second);
      const secondJobId = (JSON.parse(secondJob.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${secondJobId}/validate`, headers: writeHeaders(admin) });
      const confirmed = await inject({ method: 'POST', url: `/api/v1/imports/${secondJobId}/confirm`, headers: writeHeaders(admin) });
      expect(JSON.parse(confirmed.body)).toEqual(expect.objectContaining({ status: 'completed', importedRows: 1 }));

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${secondJobId}/rows`, headers: readHeaders(admin) });
      const variantId = (JSON.parse(rows.body) as { data: { matchedProductVariantId: string }[] }).data[0]!.matchedProductVariantId;

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const balance = (JSON.parse(balances.body) as { data: { quantityPhysical: number }[] }).data[0]!;
      expect(balance.quantityPhysical).toBe(10); // unchanged — never 999

      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}`, headers: readHeaders(admin) });
      expect((JSON.parse(movements.body) as { data: unknown[] }).data).toHaveLength(1); // only the original INITIAL_STOCK
    });
  });

  describe('§20 — RBAC: import.execute gates the pipeline, import.inventory gates update_catalog_and_inventory', () => {
    it('401 anonymous, 403 without import.execute, 200 with it', async () => {
      const admin = await registerTenant('Import Gamma Co', 'admin@import-gamma.example');
      const vendedor = await createAndLoginAs(admin, 'vendedor@import-gamma.example', 'Vendedor');

      const anon = await inject({ method: 'GET', url: '/api/v1/imports' });
      expect(anon.statusCode).toBe(401);

      const forbidden = await inject({ method: 'GET', url: '/api/v1/imports', headers: readHeaders(vendedor) });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await inject({ method: 'GET', url: '/api/v1/imports', headers: readHeaders(admin) });
      expect(allowed.statusCode).toBe(200);
    });

    it('confirming update_catalog_and_inventory without import.inventory is rejected even for a user with import.execute', async () => {
      const admin = await registerTenant('Import Delta Co', 'admin@import-delta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const sku = `SKU-${Date.now()}`;

      // Seed an existing variant to update.
      const first = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'], [[sku, 'Name', 100, 90, 80, 5, 'Zone A']]);
      const firstJob = await uploadJob(admin, { columnMapping: STANDARD_MAPPING, defaultLocationId: locationId }, first);
      const firstJobId = (JSON.parse(firstJob.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/validate`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/confirm`, headers: writeHeaders(admin) });

      const bodega = await createAndLoginAs(admin, 'bodega@import-delta.example', 'Bodega');
      // Bodega's default template does not include import.execute/import.inventory at all — assert
      // 403 at the route gate first (import.execute), the more common real-world case.
      const second = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'], [[sku, 'Name', 100, 90, 80, 5, 'Zone A']]);
      const rejected = await uploadJob(bodega, { columnMapping: STANDARD_MAPPING, defaultLocationId: locationId, duplicateHandlingMode: 'update_catalog_and_inventory' }, second);
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('§18 — location authorization is checked at validation time, not deferred to commit', () => {
    it('a row targeting a location the importing user is not authorized for becomes invalid, never silently imported', async () => {
      const admin = await registerTenant('Import Epsilon Co', 'admin@import-epsilon.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationA = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      await createLocation(admin, warehouseId, 'Zone B', `ZB-${Date.now()}`);

      // ADR-0035: the founding, system-default Administrador is always unrestricted by
      // LocationAuthorizationService, so demonstrating that this check actually applies needs a
      // non-Administrador actor — a custom role (ROLES/PERMISSIONS block) with exactly
      // import.execute/import.inventory, restricted to locationA only, then tries to import stock
      // into locationB. import_jobs.created_by is the account performing the request, so this
      // exercises the exact check ImportValidationService runs.
      const importer = await createAndLoginWithCustomRole(admin, 'importer@import-epsilon.example', 'Importador', ['import.execute', 'import.inventory']);
      const restrict = await inject({ method: 'PUT', url: `/api/v1/users/${importer.user.id}/locations`, headers: writeHeaders(admin), payload: { locationIds: [locationA] } });
      expect(restrict.statusCode).toBe(200);

      const buffer = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'], [[`SKU-${Date.now()}`, 'Widget', 100, 90, 80, 5, 'Zone B']]);
      const job = await uploadJob(importer, { columnMapping: STANDARD_MAPPING }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;
      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(importer) });
      const validatedBody = JSON.parse(validated.body) as { validRows: number; invalidRows: number };
      expect(validatedBody.invalidRows).toBe(1);
      expect(validatedBody.validRows).toBe(0);

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows?status=invalid`, headers: readHeaders(importer) });
      const rowErrors = (JSON.parse(rows.body) as { data: { errors: { code: string }[] }[] }).data[0]!.errors;
      expect(rowErrors.map((e) => e.code)).toContain('LOCATION_NOT_AUTHORIZED');

      // Control: the same row targeting the authorized location (A) validates cleanly.
      const bufferA = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'], [[`SKU-${Date.now()}-A`, 'Widget', 100, 90, 80, 5, 'Zone A']]);
      const jobA = await uploadJob(importer, { columnMapping: STANDARD_MAPPING }, bufferA);
      const jobAId = (JSON.parse(jobA.body) as { id: string }).id;
      const validatedA = await inject({ method: 'POST', url: `/api/v1/imports/${jobAId}/validate`, headers: writeHeaders(importer) });
      expect(JSON.parse(validatedA.body)).toEqual(expect.objectContaining({ validRows: 1, invalidRows: 0 }));
    });
  });

  describe('§11/§30 — file security', () => {
    it('rejects a .xlsm upload outright', async () => {
      const admin = await registerTenant('Import Zeta Co', 'admin@import-zeta.example');
      const buffer = await buildXlsx(['SKU'], [['SKU-1']]);
      const response = await uploadJob(admin, {}, buffer, 'catalog.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12');
      expect(response.statusCode).toBe(400);
    });

    it('rejects a corrupt file', async () => {
      const admin = await registerTenant('Import Eta Co', 'admin@import-eta.example');
      const response = await uploadJob(admin, {}, Buffer.from('not a real spreadsheet'), 'catalog.xlsx', XLSX_MIME);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('multi-tenancy isolation (mandatory two-tenant check, §19)', () => {
    it('tenant A cannot read, mutate, or validate/confirm tenant B\'s import job', async () => {
      const tenantA = await registerTenant('Import Sigma Co', 'admin@import-sigma.example');
      const tenantB = await registerTenant('Import Tau Co', 'admin@import-tau.example');

      const buffer = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min'], [[`SKU-${Date.now()}`, 'Widget', 100, 90, 80]]);
      const jobB = await uploadJob(tenantB, { columnMapping: JSON.stringify({ SKU: 'sku', Nombre: 'name', 'Precio Max': 'maxPrice', 'Precio Base': 'basePrice', 'Precio Min': 'minPrice' }) }, buffer);
      const jobBId = (JSON.parse(jobB.body) as { id: string }).id;

      const crossRead = await inject({ method: 'GET', url: `/api/v1/imports/${jobBId}`, headers: readHeaders(tenantA) });
      expect(crossRead.statusCode).toBe(404);

      const crossValidate = await inject({ method: 'POST', url: `/api/v1/imports/${jobBId}/validate`, headers: writeHeaders(tenantA) });
      expect(crossValidate.statusCode).toBe(404);

      const crossCancel = await inject({ method: 'POST', url: `/api/v1/imports/${jobBId}/cancel`, headers: writeHeaders(tenantA) });
      expect(crossCancel.statusCode).toBe(404);

      const crossList = await inject({ method: 'GET', url: '/api/v1/imports', headers: readHeaders(tenantA) });
      const ids = (JSON.parse(crossList.body) as { data: { id: string }[] }).data.map((j) => j.id);
      expect(ids).not.toContain(jobBId);
    });

    it('tenant A cannot use or read tenant B\'s mapping template', async () => {
      const tenantA = await registerTenant('Import Upsilon Co', 'admin@import-upsilon.example');
      const tenantB = await registerTenant('Import Phi Co', 'admin@import-phi.example');

      const template = await inject({
        method: 'POST',
        url: '/api/v1/import-mapping-templates',
        headers: writeHeaders(tenantB),
        payload: { name: 'Proveedor X', columnMapping: { SKU: 'sku' } },
      });
      expect(template.statusCode).toBe(201);
      const templateId = (JSON.parse(template.body) as { id: string }).id;

      const crossRead = await inject({ method: 'GET', url: `/api/v1/import-mapping-templates/${templateId}`, headers: readHeaders(tenantA) });
      expect(crossRead.statusCode).toBe(404);

      const buffer = await buildXlsx(['SKU'], [['SKU-1']]);
      const crossUse = await uploadJob(tenantA, { mappingTemplateId: templateId }, buffer);
      expect(crossUse.statusCode).toBe(404);
    });
  });

  describe('§9 — mapping templates are frozen onto the job at the moment they are applied', () => {
    it('editing a template after a job used it does not retroactively change the job\'s column_mapping', async () => {
      const admin = await registerTenant('Import Chi Co', 'admin@import-chi.example');
      const created = await inject({
        method: 'POST',
        url: '/api/v1/import-mapping-templates',
        headers: writeHeaders(admin),
        payload: { name: 'My Template', columnMapping: { SKU: 'sku', Nombre: 'name' } },
      });
      const templateId = (JSON.parse(created.body) as { id: string }).id;

      const buffer = await buildXlsx(['SKU', 'Nombre'], [[`SKU-${Date.now()}`, 'Widget']]);
      const job = await uploadJob(admin, { mappingTemplateId: templateId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string; columnMapping: Record<string, string> }).id;
      const jobBody = JSON.parse(job.body) as { columnMapping: Record<string, string> };
      expect(jobBody.columnMapping).toEqual({ SKU: 'sku', Nombre: 'name' });

      const updated = await inject({
        method: 'PATCH',
        url: `/api/v1/import-mapping-templates/${templateId}`,
        headers: writeHeaders(admin),
        payload: { columnMapping: { SKU: 'sku', Descripcion: 'description' } },
      });
      expect(updated.statusCode).toBe(200);

      const jobAfter = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}`, headers: readHeaders(admin) });
      const jobAfterBody = JSON.parse(jobAfter.body) as { columnMapping: Record<string, string> };
      expect(jobAfterBody.columnMapping).toEqual({ SKU: 'sku', Nombre: 'name' }); // unchanged
    });
  });

  describe('§10 — controlled state machine: no arbitrary transitions', () => {
    it('rejects confirm before validate (still mapping), and rejects validate twice from ready', async () => {
      const admin = await registerTenant('Import Psi Co', 'admin@import-psi.example');
      const buffer = await buildXlsx(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min'], [[`SKU-${Date.now()}`, 'Widget', 100, 90, 80]]);
      const job = await uploadJob(admin, { columnMapping: JSON.stringify({ SKU: 'sku', Nombre: 'name', 'Precio Max': 'maxPrice', 'Precio Base': 'basePrice', 'Precio Min': 'minPrice' }) }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const prematureConfirm = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) });
      expect(prematureConfirm.statusCode).toBe(409);

      await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      const doubleValidate = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      expect(doubleValidate.statusCode).toBe(409);
    });

    it('cancel is allowed before importing, and a cancelled job cannot be validated afterward', async () => {
      const admin = await registerTenant('Import Omega Co', 'admin@import-omega.example');
      const buffer = await buildXlsx(['SKU'], [['SKU-1']]);
      const job = await uploadJob(admin, { columnMapping: JSON.stringify({ SKU: 'sku' }) }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const cancelled = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/cancel`, headers: writeHeaders(admin) });
      expect(cancelled.statusCode).toBe(201);
      expect(JSON.parse(cancelled.body)).toEqual(expect.objectContaining({ status: 'cancelled' }));

      const afterCancel = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      expect(afterCancel.statusCode).toBe(409);
    });
  });

  const SERIAL_MAPPING = JSON.stringify({
    SKU: 'sku',
    Nombre: 'name',
    Categoria: 'category',
    'Precio Max': 'maxPrice',
    'Precio Base': 'basePrice',
    'Precio Min': 'minPrice',
    Cantidad: 'quantity',
    Ubicacion: 'location',
    Serial: 'serialNumber',
  });
  const SERIAL_HEADERS = ['SKU', 'Nombre', 'Categoria', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion', 'Serial'];

  /** Fetches the internal row ids (never exposed over HTTP) for direct repository-level
   * manipulation/inspection — the same DI-container access pattern
   * test/import/import-worker.integration.test.ts already uses. */
  async function getRowIds(tenantId: string, jobId: string): Promise<Array<{ id: string; rowNumber: number }>> {
    const { withTenantTransaction } = await import('../../src/database/tenant-context');
    const { ImportJobRowsRepository } = await import('../../src/import/repositories/import-job-rows.repository');
    const repo = app.get(ImportJobRowsRepository);
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows } = await repo.listByJob(tx, tenantId, jobId, { page: 1, pageSize: 100 });
      return rows.map((r) => ({ id: r.id, rowNumber: r.rowNumber }));
    });
  }

  describe('PROMPT 010-A §4-§11 — multi-serial onboarding for a brand-new SKU', () => {
    it('S1: several rows sharing one brand-new SKU, each with a distinct serial, create exactly one product/variant and one physical unit per row', async () => {
      const admin = await registerTenant('Serial Alpha Co', 'admin@serial-alpha.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      await createCategory(admin, 'Televisores', `televisores-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      const buffer = await buildXlsx(SERIAL_HEADERS, [
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0002'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0003'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0004'],
      ]);

      const job = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      const validatedBody = JSON.parse(validated.body) as { validRows: number; invalidRows: number };
      expect(validatedBody).toEqual(expect.objectContaining({ validRows: 4, invalidRows: 0 }));

      const confirmed = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) });
      const confirmedBody = JSON.parse(confirmed.body) as { status: string; importedRows: number };
      expect(confirmedBody).toEqual(expect.objectContaining({ status: 'completed', importedRows: 4 }));

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows`, headers: readHeaders(admin) });
      const rowData = (JSON.parse(rows.body) as { data: { status: string; matchedProductVariantId: string }[] }).data;
      expect(rowData.every((r) => r.status === 'imported')).toBe(true);
      const distinctVariantIds = new Set(rowData.map((r) => r.matchedProductVariantId));
      expect(distinctVariantIds.size).toBe(1); // exactly one product/variant, never four.
      const variantId = [...distinctVariantIds][0];

      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const movementRows = (JSON.parse(movements.body) as { data: { movementType: string; quantity: number }[] }).data;
      expect(movementRows).toHaveLength(4); // one INITIAL_STOCK per physical unit, never one combined movement.
      expect(movementRows.every((m) => m.movementType === 'INITIAL_STOCK' && m.quantity === 1)).toBe(true);

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const balance = (JSON.parse(balances.body) as { data: { quantityPhysical: number }[] }).data[0]!;
      expect(balance.quantityPhysical).toBe(4);
    });

    it('S2: a serial repeated within the same file is rejected at validation, never silently imported', async () => {
      const admin = await registerTenant('Serial Beta Co', 'admin@serial-beta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      const buffer = await buildXlsx(SERIAL_HEADERS, [
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001'],
      ]);
      const job = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      const validatedBody = JSON.parse(validated.body) as { invalidRows: number };
      expect(validatedBody.invalidRows).toBe(2);

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows?status=invalid`, headers: readHeaders(admin) });
      const errors = (JSON.parse(rows.body) as { data: { errors: { code: string }[] }[] }).data.flatMap((r) => r.errors.map((e) => e.code));
      expect(errors).toContain('DUPLICATE_SERIAL_IN_FILE');
    });

    it('S3: a serial already present in the database (from a prior import) is rejected, never a raw constraint exception', async () => {
      const admin = await registerTenant('Serial Gamma Co', 'admin@serial-gamma.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      await createCategory(admin, 'Televisores', `televisores-${Date.now()}`);
      const existingSerial = `SN-EXISTING-${Date.now()}`;

      const first = await buildXlsx(SERIAL_HEADERS, [[`TV-A-${Date.now()}`, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', existingSerial]]);
      const firstJob = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, first);
      const firstJobId = (JSON.parse(firstJob.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/validate`, headers: writeHeaders(admin) });
      const firstConfirm = await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/confirm`, headers: writeHeaders(admin) });
      expect(JSON.parse(firstConfirm.body)).toEqual(expect.objectContaining({ status: 'completed' }));

      const second = await buildXlsx(SERIAL_HEADERS, [[`TV-B-${Date.now()}`, 'TV LG', 'Televisores', 500, 450, 400, 1, 'Zone A', existingSerial]]);
      const secondJob = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, second);
      const secondJobId = (JSON.parse(secondJob.body) as { id: string }).id;
      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${secondJobId}/validate`, headers: writeHeaders(admin) });
      expect(JSON.parse(validated.body)).toEqual(expect.objectContaining({ invalidRows: 1 }));

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${secondJobId}/rows?status=invalid`, headers: readHeaders(admin) });
      const errors = (JSON.parse(rows.body) as { data: { errors: { code: string }[] }[] }).data.flatMap((r) => r.errors.map((e) => e.code));
      expect(errors).toContain('SERIAL_NUMBER_EXISTS');
    });

    it('S4: rows sharing a brand-new SKU with contradictory product-identity fields are rejected as inconsistent, not silently merged', async () => {
      const admin = await registerTenant('Serial Delta Co', 'admin@serial-delta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      const buffer = await buildXlsx(SERIAL_HEADERS, [
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001'],
        [sku, 'Refrigerador', 'Refrigeracion', 500, 450, 400, 1, 'Zone A', 'SN0002'],
      ]);
      const job = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      expect(JSON.parse(validated.body)).toEqual(expect.objectContaining({ invalidRows: 2 }));

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows?status=invalid`, headers: readHeaders(admin) });
      const errors = (JSON.parse(rows.body) as { data: { errors: { code: string }[] }[] }).data.flatMap((r) => r.errors.map((e) => e.code));
      expect(errors).toContain('SKU_GROUP_INCONSISTENT_METADATA');
    });

    it('mixing serial-tracked and lot-tracked rows under the same brand-new SKU is rejected as a tracking-mode conflict', async () => {
      const admin = await registerTenant('Serial Epsilon Co', 'admin@serial-epsilon.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      const headers = [...SERIAL_HEADERS, 'Lote'];
      const mapping = JSON.stringify({ ...JSON.parse(SERIAL_MAPPING), Lote: 'lotNumber' });
      const buffer = await buildXlsx(headers, [
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001', ''],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', '', 'LOT-1'],
      ]);
      const job = await uploadJob(admin, { columnMapping: mapping, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      expect(JSON.parse(validated.body)).toEqual(expect.objectContaining({ invalidRows: 2 }));
      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows?status=invalid`, headers: readHeaders(admin) });
      const errors = (JSON.parse(rows.body) as { data: { errors: { code: string }[] }[] }).data.flatMap((r) => r.errors.map((e) => e.code));
      expect(errors).toContain('SKU_GROUP_TRACKING_MODE_INCONSISTENT');
    });

    it('S5/§35: distinct physical units of the same brand-new SKU each validate their own (distinct, valid) location independently', async () => {
      const admin = await registerTenant('Serial Zeta Co', 'admin@serial-zeta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationA = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const locationB = await createLocation(admin, warehouseId, 'Zone B', `ZB-${Date.now()}`);
      await createCategory(admin, 'Televisores', `televisores-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      const buffer = await buildXlsx(SERIAL_HEADERS, [
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone B', 'SN0002'],
      ]);
      const job = await uploadJob(admin, { columnMapping: SERIAL_MAPPING }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });
      expect(JSON.parse(validated.body)).toEqual(expect.objectContaining({ validRows: 2, invalidRows: 0 }));

      await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) });
      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows`, headers: readHeaders(admin) });
      const variantId = (JSON.parse(rows.body) as { data: { matchedProductVariantId: string }[] }).data[0]!.matchedProductVariantId;

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const balanceRows = (JSON.parse(balances.body) as { data: { locationId: string; quantityPhysical: number }[] }).data;
      expect(balanceRows.find((b) => b.locationId === locationA)?.quantityPhysical).toBe(1);
      expect(balanceRows.find((b) => b.locationId === locationB)?.quantityPhysical).toBe(1);
    });

    it('S6/§35: one unit targeting an unauthorized location fails independently — sibling units in authorized locations still succeed', async () => {
      const admin = await registerTenant('Serial Eta Co', 'admin@serial-eta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationA = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      await createLocation(admin, warehouseId, 'Zone B', `ZB-${Date.now()}`);
      await createCategory(admin, 'Televisores', `televisores-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      // ADR-0035: the founding Administrador is always unrestricted, so this needs a
      // non-Administrador actor (custom role via the ROLES/PERMISSIONS block) restricted to
      // locationA only to actually exercise the check (see the §18 test above in this file).
      const importer = await createAndLoginWithCustomRole(admin, 'importer@serial-eta.example', 'Importador', ['import.execute', 'import.inventory']);
      const restrict = await inject({ method: 'PUT', url: `/api/v1/users/${importer.user.id}/locations`, headers: writeHeaders(admin), payload: { locationIds: [locationA] } });
      expect(restrict.statusCode).toBe(200);

      const buffer = await buildXlsx(SERIAL_HEADERS, [
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone B', 'SN0002'],
      ]);
      const job = await uploadJob(importer, { columnMapping: SERIAL_MAPPING }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;

      const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(importer) });
      const validatedBody = JSON.parse(validated.body) as { validRows: number; invalidRows: number };
      expect(validatedBody).toEqual(expect.objectContaining({ validRows: 1, invalidRows: 1 }));

      const invalidRows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows?status=invalid`, headers: readHeaders(importer) });
      const errors = (JSON.parse(invalidRows.body) as { data: { errors: { code: string }[] }[] }).data.flatMap((r) => r.errors.map((e) => e.code));
      expect(errors).toContain('LOCATION_NOT_AUTHORIZED');
    });

    it('S7/§16: re-importing an existing serialized SKU under update_catalog_only registers the new serial but never moves stock', async () => {
      const admin = await registerTenant('Serial Theta Co', 'admin@serial-theta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      await createCategory(admin, 'Televisores', `televisores-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      const first = await buildXlsx(SERIAL_HEADERS, [[sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001']]);
      const firstJob = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, first);
      const firstJobId = (JSON.parse(firstJob.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/validate`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/imports/${firstJobId}/confirm`, headers: writeHeaders(admin) });

      const firstRows = await inject({ method: 'GET', url: `/api/v1/imports/${firstJobId}/rows`, headers: readHeaders(admin) });
      const variantId = (JSON.parse(firstRows.body) as { data: { matchedProductVariantId: string }[] }).data[0]!.matchedProductVariantId;
      const balancesBefore = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const physicalBefore = (JSON.parse(balancesBefore.body) as { data: { quantityPhysical: number }[] }).data[0]!.quantityPhysical;

      // Second import: same SKU (now existing), a brand-new serial, default update_catalog_only.
      const second = await buildXlsx(SERIAL_HEADERS, [[sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0002']]);
      const secondJob = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, second);
      const secondJobId = (JSON.parse(secondJob.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${secondJobId}/validate`, headers: writeHeaders(admin) });
      const secondConfirm = await inject({ method: 'POST', url: `/api/v1/imports/${secondJobId}/confirm`, headers: writeHeaders(admin) });
      expect(JSON.parse(secondConfirm.body)).toEqual(expect.objectContaining({ status: 'completed', importedRows: 1 }));

      const balancesAfter = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const physicalAfter = (JSON.parse(balancesAfter.body) as { data: { quantityPhysical: number }[] }).data[0]!.quantityPhysical;
      expect(physicalAfter).toBe(physicalBefore); // unchanged — update_catalog_only never moves stock.

      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}`, headers: readHeaders(admin) });
      expect((JSON.parse(movements.body) as { data: unknown[] }).data).toHaveLength(1); // only the original INITIAL_STOCK.
    });

    it('S8: rows of the same brand-new SKU landing in different commit batches still resolve to exactly one product/variant', async () => {
      const admin = await registerTenant('Serial Iota Co', 'admin@serial-iota.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      await createCategory(admin, 'Televisores', `televisores-${Date.now()}`);
      const sku = `TV-${Date.now()}`;

      const buffer = await buildXlsx(SERIAL_HEADERS, [
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0001'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0002'],
        [sku, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', 'SN0003'],
      ]);
      const job = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });

      const previousBatchSize = process.env['IMPORT_BATCH_SIZE'];
      process.env['IMPORT_BATCH_SIZE'] = '1'; // forces each row into its own commit transaction.
      try {
        const confirmed = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) });
        expect(JSON.parse(confirmed.body)).toEqual(expect.objectContaining({ status: 'completed', importedRows: 3 }));
      } finally {
        if (previousBatchSize === undefined) delete process.env['IMPORT_BATCH_SIZE'];
        else process.env['IMPORT_BATCH_SIZE'] = previousBatchSize;
      }

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows`, headers: readHeaders(admin) });
      const rowData = (JSON.parse(rows.body) as { data: { matchedProductVariantId: string }[] }).data;
      expect(new Set(rowData.map((r) => r.matchedProductVariantId)).size).toBe(1);

      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${rowData[0]!.matchedProductVariantId}`, headers: readHeaders(admin) });
      expect((JSON.parse(movements.body) as { data: unknown[] }).data).toHaveLength(3);
    });
  });

  describe('PROMPT 010-A §19-§28 — crash/retry idempotency', () => {
    it('I1/I6/I7/I8/I9: repeating confirm on an already-completed job is a safe no-op — no duplicate product, serial, movement, or balance increase', async () => {
      const admin = await registerTenant('Idem Alpha Co', 'admin@idem-alpha.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const sku = `SKU-${Date.now()}`;

      const buffer = await buildXlsx(
        ['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'],
        [[sku, 'Widget', 100, 90, 80, 10, 'Zone A']],
      );
      const job = await uploadJob(admin, { columnMapping: STANDARD_MAPPING, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });

      const firstConfirm = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) });
      const firstBody = JSON.parse(firstConfirm.body) as { status: string; importedRows: number };
      expect(firstBody).toEqual(expect.objectContaining({ status: 'completed', importedRows: 1 }));

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows`, headers: readHeaders(admin) });
      const variantId = (JSON.parse(rows.body) as { data: { matchedProductVariantId: string }[] }).data[0]!.matchedProductVariantId;

      const balancesBefore = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const physicalBefore = (JSON.parse(balancesBefore.body) as { data: { quantityPhysical: number }[] }).data[0]!.quantityPhysical;
      const movementsBefore = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const movementCountBefore = (JSON.parse(movementsBefore.body) as { data: unknown[] }).data.length;

      // Retry: the client never saw the first response (or clicked confirm twice) — the state
      // machine itself must reject this cleanly, never re-run the commit (§10: `completed` has no
      // outgoing transition).
      const secondConfirm = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) });
      expect(secondConfirm.statusCode).toBe(409);

      const balancesAfter = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const physicalAfter = (JSON.parse(balancesAfter.body) as { data: { quantityPhysical: number }[] }).data[0]!.quantityPhysical;
      const movementsAfter = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}`, headers: readHeaders(admin) });
      const movementCountAfter = (JSON.parse(movementsAfter.body) as { data: unknown[] }).data.length;

      expect(physicalAfter).toBe(physicalBefore); // I9 — balance never double-incremented.
      expect(movementCountAfter).toBe(movementCountBefore); // I8 — no duplicate inventory_movements.

      const jobAfter = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}`, headers: readHeaders(admin) });
      expect(JSON.parse(jobAfter.body)).toEqual(expect.objectContaining({ importedRows: 1 })); // I6 — counters not doubled.
    });

    it('§31: two concurrent confirm requests on the same job resolve to exactly one effective execution', async () => {
      const admin = await registerTenant('Idem Beta Co', 'admin@idem-beta.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const sku = `SKU-${Date.now()}`;

      const buffer = await buildXlsx(
        ['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'],
        [[sku, 'Widget', 100, 90, 80, 10, 'Zone A']],
      );
      const job = await uploadJob(admin, { columnMapping: STANDARD_MAPPING, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });

      const [first, second] = await Promise.all([
        inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) }),
        inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) }),
      ]);
      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses).toEqual([201, 409]); // exactly one proceeds; the row-locked state machine rejects the other.

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows`, headers: readHeaders(admin) });
      const variantId = (JSON.parse(rows.body) as { data: { matchedProductVariantId: string }[] }).data[0]!.matchedProductVariantId;
      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}`, headers: readHeaders(admin) });
      expect((JSON.parse(movements.body) as { data: unknown[] }).data).toHaveLength(1);
    });

    it('I2/§21: a late conflict on one row (a duplicate serial slipping past validation) fails only that row, in its own rolled-back sub-transaction — the sibling row in the same batch still commits', async () => {
      const admin = await registerTenant('Idem Gamma Co', 'admin@idem-gamma.example');
      const warehouseId = await createWarehouse(admin, 'WH', `WH-${Date.now()}`);
      const locationId = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      await createCategory(admin, 'Televisores', `televisores-${Date.now()}`);
      const skuA = `TV-A-${Date.now()}`;
      const skuB = `TV-B-${Date.now()}`;
      const collidingSerial = `SN-COLLIDE-${Date.now()}`;

      // Two independent (different SKU) rows, each validly serialized — no group relationship, no
      // validation-time duplicate-serial error, since they don't share a serial at validation time.
      const buffer = await buildXlsx(SERIAL_HEADERS, [
        [skuA, 'TV Samsung', 'Televisores', 500, 450, 400, 1, 'Zone A', `${collidingSerial}-A`],
        [skuB, 'TV LG', 'Televisores', 500, 450, 400, 1, 'Zone A', `${collidingSerial}-B`],
      ]);
      const job = await uploadJob(admin, { columnMapping: SERIAL_MAPPING, defaultLocationId: locationId }, buffer);
      const jobId = (JSON.parse(job.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(admin) });

      // Simulate a conflict that only a genuine late race could produce (§12/§21): row B's staged
      // *raw* data (what commit actually re-derives `mapped` from — ImportExecutionService.
      // commitOneRow calls applyColumnMapping(row.rawData, ...) fresh, never trusting the
      // already-computed `mapped_data` column) is corrupted, after validation, to reuse row A's
      // exact serial — the same shape a real concurrent process claiming that serial between
      // validation and commit would produce. This exercises the actual createSerial()
      // unique-violation path this correction added a catch for, using a real Postgres constraint,
      // not a mock.
      // rowNumber starts at 2 (the header occupies row 1) — the second data row is rowNumber 3.
      const rowIds = await getRowIds(admin.user.tenantId, jobId);
      const rowB = rowIds.find((r) => r.rowNumber === 3)!;
      const { withTenantTransaction } = await import('../../src/database/tenant-context');
      const { importJobRows } = await import('../../src/database/schema');
      const { and, eq } = await import('drizzle-orm');
      await withTenantTransaction(admin.user.tenantId, (tx) =>
        tx
          .update(importJobRows)
          .set({ rawData: { SKU: skuB, Nombre: 'TV LG', Categoria: 'Televisores', 'Precio Max': 500, 'Precio Base': 450, 'Precio Min': 400, Cantidad: 1, Ubicacion: 'Zone A', Serial: `${collidingSerial}-A` } })
          .where(and(eq(importJobRows.tenantId, admin.user.tenantId), eq(importJobRows.id, rowB.id))),
      );

      const confirmed = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(admin) });
      const confirmedBody = JSON.parse(confirmed.body) as { status: string; importedRows: number; invalidRows: number };
      expect(confirmedBody.status).toBe('completed_with_errors');
      expect(confirmedBody.importedRows).toBe(1); // row A only.
      expect(confirmedBody.invalidRows).toBe(1); // row B failed cleanly — no unhandled exception, no aborted batch.

      const rows = await inject({ method: 'GET', url: `/api/v1/imports/${jobId}/rows`, headers: readHeaders(admin) });
      const rowData = (JSON.parse(rows.body) as { data: { rowNumber: number; status: string; errors: { code: string }[] }[] }).data;
      expect(rowData.find((r) => r.rowNumber === 2)?.status).toBe('imported'); // sibling row (row A) unaffected.
      expect(rowData.find((r) => r.rowNumber === 3)?.status).toBe('invalid');
      expect(rowData.find((r) => r.rowNumber === 3)?.errors.map((e) => e.code)).toContain('COMMIT_CONFLICT');
    });
  });
});
