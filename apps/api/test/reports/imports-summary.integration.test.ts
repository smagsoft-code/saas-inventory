import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importJobs } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb } from '../database/helpers';
import { buildMultipartUpload } from '../import/multipart';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAPPING = JSON.stringify({ SKU: 'sku', Nombre: 'name', 'Precio Max': 'maxPrice', 'Precio Base': 'basePrice', 'Precio Min': 'minPrice', Cantidad: 'quantity', Ubicacion: 'location' });
const HEADERS = ['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad', 'Ubicacion'];

/**
 * F18-09 — `GET /api/v1/reports/imports-summary` end to end against real PostgreSQL, through the
 * real `buildImportTestApp()` (only `ObjectStorageService` is the in-memory stand-in — see
 * import-test-app.ts; Postgres, RLS, the whole pipeline are real): RBAC (`import.execute`), tenant
 * isolation, `[from, to)` on `import_jobs.completed_at`, `groupBy=day|week|month|status`, the
 * `Σ *_rows` aggregation, and — the key cardinality guarantee — a job with N rows counts as **one**
 * job (`import_jobs` is queried alone, never joined to `import_job_rows`). Every fixture job is
 * produced by the real upload → validate → confirm/cancel pipeline; `completed_at` is backdated via
 * a direct UPDATE on the disposable pg-verify database only (the pipeline sets it to `now()` and
 * there is no override field on the HTTP contract, unlike `inventory/adjustments`' `occurredAt`).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: imports summary (integration, F18-09)', () => {
  let app: NestFastifyApplication;
  let f: Fixture;

  interface Session {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    csrfToken: string;
  }
  interface Fixture {
    admin: Session;
    tenantId: string;
    locationId: string;
  }

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  function inject(options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string>; body?: Buffer }): Promise<LightMyRequestResponse> {
    if (options.body) {
      return app.getHttpAdapter().getInstance().inject({ method: options.method, url: options.url, payload: options.body, headers: options.headers } as InjectOptions);
    }
    return app.getHttpAdapter().getInstance().inject(options as InjectOptions);
  }

  const cookieValue = (res: LightMyRequestResponse, name: string): string | undefined => {
    const raw = res.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) return value;
    }
    return undefined;
  };
  const cookieHeader = (c: Record<string, string | undefined>): string =>
    Object.entries(c).filter((e): e is [string, string] => e[1] !== undefined).map(([k, v]) => `${k}=${v}`).join('; ');
  const readHeaders = (s: Session): Record<string, string> => ({ cookie: cookieHeader({ access_token: s.accessToken }) });
  const writeHeaders = (s: Session): Record<string, string> => ({
    cookie: cookieHeader({ access_token: s.accessToken, csrf_token: s.csrfToken }),
    'x-csrf-token': s.csrfToken,
  });

  async function registerTenant(companyName: string, email: string): Promise<Session> {
    const res = await inject({ method: 'POST', url: '/api/v1/auth/register', payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' } });
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(res, 'access_token')!, csrfToken: cookieValue(res, 'csrf_token')! };
  }

  async function createAndLoginAs(admin: Session, email: string, roleName: string): Promise<Session> {
    const rolesRes = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    const role = (JSON.parse(rolesRes.body) as { id: string; name: string }[]).find((r) => r.name === roleName)!;
    const created = await inject({ method: 'POST', url: '/api/v1/users', headers: writeHeaders(admin), payload: { email, fullName: `${roleName} User`, password: 'a-very-long-password', roleId: role.id } });
    expect(created.statusCode, created.body).toBe(201);
    const login = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'a-very-long-password' } });
    expect(login.statusCode).toBe(200);
    const body = JSON.parse(login.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(login, 'access_token')!, csrfToken: cookieValue(login, 'csrf_token')! };
  }

  async function seed(companyName: string, email: string): Promise<Fixture> {
    const admin = await registerTenant(companyName, email);
    const wh = await inject({ method: 'POST', url: '/api/v1/warehouses', headers: writeHeaders(admin), payload: { name: 'WH', code: `WH-${uniq()}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-') } });
    const warehouseId = (JSON.parse(wh.body) as { id: string }).id;
    const loc = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId, name: 'Zone A', code: `ZA-${uniq()}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-') } });
    const locationId = (JSON.parse(loc.body) as { id: string }).id;
    return { admin, tenantId: admin.user.tenantId, locationId };
  }

  async function buildXlsx(rows: Array<Array<string | number>>): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Import');
    sheet.addRow(HEADERS);
    for (const r of rows) sheet.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Upload + validate. Returns the job id and its post-validate counters. */
  async function uploadAndValidate(fx: Fixture, rows: Array<Array<string | number>>): Promise<string> {
    const buffer = await buildXlsx(rows);
    const { body, contentType } = buildMultipartUpload({ filename: `import-${uniq()}.xlsx`, contentType: XLSX_MIME, fileContent: buffer, fields: { columnMapping: MAPPING, defaultLocationId: fx.locationId } });
    const created = await inject({ method: 'POST', url: '/api/v1/imports', headers: { ...writeHeaders(fx.admin), 'content-type': contentType }, body });
    expect(created.statusCode, created.body).toBe(201);
    const jobId = (JSON.parse(created.body) as { id: string }).id;
    const validated = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/validate`, headers: writeHeaders(fx.admin) });
    expect(validated.statusCode, validated.body).toBe(201);
    return jobId;
  }

  async function confirm(fx: Fixture, jobId: string): Promise<{ id: string; status: string; importedRows: number }> {
    const res = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/confirm`, headers: writeHeaders(fx.admin) });
    expect(res.statusCode, res.body).toBe(201);
    return JSON.parse(res.body) as { id: string; status: string; importedRows: number };
  }

  async function cancel(fx: Fixture, jobId: string): Promise<void> {
    const res = await inject({ method: 'POST', url: `/api/v1/imports/${jobId}/cancel`, headers: writeHeaders(fx.admin) });
    expect(res.statusCode, res.body).toBe(201);
  }

  /** One valid SKU row (unique sku each call). */
  const validRow = (qty = 5): Array<string | number> => [`SKU-${uniq()}`, 'Widget', 150, 120, 100, qty, 'Zone A'];
  /** A row missing the price columns -> validation error. */
  const invalidRow = (): Array<string | number> => [`SKU-${uniq()}`, 'BadWidget', '', '', '', 3, 'Zone A'];

  async function backdateCompleted(jobId: string, iso: string): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      await db.update(importJobs).set({ completedAt: new Date(iso) }).where(eq(importJobs.id, jobId));
    } finally {
      await client.end();
    }
  }

  function summary(session: Session, query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    return inject({ method: 'GET', url: `/api/v1/reports/imports-summary?${qs}`, headers: readHeaders(session) });
  }

  interface Bucket {
    key: string;
    jobCount: number;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    warningRows: number;
    importedRows: number;
  }
  interface Body {
    from: string;
    to: string;
    timezone: string;
    groupBy: string;
    totals: Bucket;
    buckets: Bucket[];
  }
  const parse = (res: { body: string }): Body => JSON.parse(res.body) as Body;

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
    process.env['AUTH_RATE_LIMIT_MAX'] = '5000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';
    process.env['IMPORT_SYNC_ROW_THRESHOLD'] = '500';

    const { buildImportTestApp } = await import('../import/import-test-app');
    app = await buildImportTestApp();
    await app.init();
    f = await seed('ImportSummary Co', `admin@import-summary-${uniq()}.example`);
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- access control -------------------------------------------------------------

  it('an unauthenticated caller is 401', async () => {
    const res = await inject({ method: 'GET', url: `/api/v1/reports/imports-summary?from=${HOUR_AGO}&to=${IN_AN_HOUR}&groupBy=day` });
    expect(res.statusCode).toBe(401);
  });

  it('requires import.execute — a Vendedor (no import.execute in the default template) is 403', async () => {
    const vendedor = await createAndLoginAs(f.admin, `vendedor-${uniq()}@ex.example`, 'Vendedor');
    expect((await summary(vendedor, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' })).statusCode).toBe(403);
  });

  it('an import.execute holder (admin) gets 200', async () => {
    expect((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' })).statusCode).toBe(200);
  });

  // ---- validation ----------------------------------------------------------------

  it('400 when from/to missing, from >= to, or groupBy/status invalid', async () => {
    expect((await summary(f.admin, { to: IN_AN_HOUR, groupBy: 'day' })).statusCode).toBe(400);
    expect((await summary(f.admin, { from: HOUR_AGO, groupBy: 'day' })).statusCode).toBe(400);
    expect((await summary(f.admin, { from: IN_AN_HOUR, to: HOUR_AGO, groupBy: 'day' })).statusCode).toBe(400);
    expect((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'mapping' })).statusCode).toBe(400);
    expect((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', status: 'done' })).statusCode).toBe(400);
  });

  // ---- cardinality: 1 job, N rows -> jobCount 1, not N ---------------------------

  it('a job that imported 3 rows counts as ONE job; importedRows is the row total (no fan-out)', async () => {
    const jobId = await uploadAndValidate(f, [validRow(2), validRow(4), validRow(6)]);
    const result = await confirm(f, jobId);
    expect(result.status).toBe('completed');
    expect(result.importedRows).toBe(3);

    const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'status', status: 'completed' });
    expect(res.statusCode).toBe(200);
    const completed = parse(res).buckets.find((b) => b.key === 'completed')!;
    expect(completed.jobCount).toBe(1); // ONE job, never 3
    expect(completed.totalRows).toBe(3);
    expect(completed.validRows).toBe(3);
    expect(completed.importedRows).toBe(3);
    expect(parse(res).totals.jobCount).toBe(1);
  });

  // ---- error isolation: a bad row is that job's invalidRows, not multiplied -----

  it('a job with 1 invalid + 2 valid rows -> completed_with_errors, invalidRows=1 on that one job', async () => {
    const jobId = await uploadAndValidate(f, [validRow(), validRow(), invalidRow()]);
    const result = await confirm(f, jobId);
    expect(result.status).toBe('completed_with_errors');

    const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'status', status: 'completed_with_errors' });
    const bucket = parse(res).buckets.find((b) => b.key === 'completed_with_errors')!;
    expect(bucket.jobCount).toBe(1);
    expect(bucket.invalidRows).toBe(1);
    expect(bucket.importedRows).toBe(2);
  });

  // ---- status grouping incl. cancelled ------------------------------------------

  it('groupBy=status buckets a cancelled job under "cancelled"', async () => {
    const jobId = await uploadAndValidate(f, [validRow()]);
    await cancel(f, jobId);
    const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'status' });
    const keys = parse(res).buckets.map((b) => b.key);
    expect(keys).toContain('cancelled');
    expect(parse(res).buckets.every((b) => ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(b.key))).toBe(true);
  });

  // ---- multi-job aggregation ---------------------------------------------------

  it('totals aggregate across multiple completed jobs', async () => {
    const fx = await seed('ImportSummary Multi', `admin@import-multi-${uniq()}.example`);
    await confirm(fx, await uploadAndValidate(fx, [validRow(), validRow()])); // 2 imported
    await confirm(fx, await uploadAndValidate(fx, [validRow()])); // 1 imported
    await confirm(fx, await uploadAndValidate(fx, [validRow(), validRow(), validRow()])); // 3 imported

    const res = await summary(fx.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    expect(res.statusCode).toBe(200);
    expect(parse(res).totals.jobCount).toBe(3);
    expect(parse(res).totals.importedRows).toBe(6);
  });

  // ---- [from, to) on completed_at, NULL-completed excluded --------------------

  it('a job backdated inside the window is counted; one before `from` and one still non-terminal are not', async () => {
    const fx = await seed('ImportSummary Window', `admin@import-window-${uniq()}.example`);
    const from = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const to = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const interior = new Date((from.getTime() + to.getTime()) / 2).toISOString();
    const before = new Date(from.getTime() - 24 * 3600 * 1000).toISOString();

    const inside = await confirm(fx, await uploadAndValidate(fx, [validRow(), validRow()]));
    expect(inside.status).toBe('completed');
    await backdateCompleted(inside.id, interior);

    const outside = await confirm(fx, await uploadAndValidate(fx, [validRow()]));
    await backdateCompleted(outside.id, before);

    // a third job left at `ready` (validated, not confirmed) -> completed_at IS NULL
    await uploadAndValidate(fx, [validRow()]);

    const res = await summary(fx.admin, { from: from.toISOString(), to: to.toISOString(), groupBy: 'month' });
    expect(res.statusCode).toBe(200);
    expect(parse(res).totals.jobCount).toBe(1); // only the interior job
    expect(parse(res).totals.importedRows).toBe(2);
  });

  // ---- tenant isolation -----------------------------------------------------

  it("tenant A never sees tenant B's import jobs", async () => {
    const b = await seed('ImportSummary Iso B', `admin@import-iso-b-${uniq()}.example`);
    await confirm(b, await uploadAndValidate(b, [validRow(), validRow(), validRow(), validRow(), validRow()])); // 5 rows

    const resB = await summary(b.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    expect(parse(resB).totals.importedRows).toBe(5);

    const resA = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    // tenant A (shared fixture) never imported 5 rows in one shot; its total must not include B's
    expect(parse(resA).buckets.every((x) => x.key.match(/^\d{4}-\d{2}-\d{2}$/))).toBe(true);
    expect(parse(resA).totals.importedRows).toBeLessThan(parse(resB).totals.importedRows + 100);
  });

  // ---- empty --------------------------------------------------------------

  it('a tenant with no completed imports returns 200 with buckets: [] and zeroed totals', async () => {
    const fresh = await seed('ImportSummary Empty', `admin@import-empty-${uniq()}.example`);
    const res = await summary(fresh.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    expect(res.statusCode).toBe(200);
    expect(parse(res).buckets).toEqual([]);
    expect(parse(res).totals).toMatchObject({ jobCount: 0, totalRows: 0, validRows: 0, invalidRows: 0, warningRows: 0, importedRows: 0 });
    expect(parse(res)).not.toHaveProperty('currency');
  });
});
