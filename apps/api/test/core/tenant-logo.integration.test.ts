import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { buildMultipartUpload } from '../import/multipart';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * The company logo (`GET/PUT/DELETE /tenant/logo`, `logoVersion` on `GET /tenant`) end to end
 * against real PostgreSQL. Booted through `buildImportTestApp()` only to swap the S3 client for the
 * in-memory stand-in (no MinIO in this environment); RLS, grants and constraints stay real.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('tenant: company logo (integration)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    setIntegrationEnv();
    // Dynamic import after the env is set: import-test-app pulls in AppModule, which reads env at load.
    const { buildImportTestApp } = await import('../import/import-test-app');
    app = await buildImportTestApp();
    await app.init();
    c = makeClient(app);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // A real 1x1 PNG and a different byte string for the replacement.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const PNG_2 = Buffer.concat([PNG, Buffer.from('v2')]);

  function upload(session: Session, content: Buffer, contentType = 'image/png') {
    const { body, contentType: header } = buildMultipartUpload({ filename: 'logo.png', contentType, fileContent: content });
    return c.inject({ method: 'PUT', url: '/api/v1/tenant/logo', headers: c.writeHeaders(session, { 'content-type': header }), payload: body });
  }
  const getTenant = (session: Session) => c.inject({ method: 'GET', url: '/api/v1/tenant', headers: c.readHeaders(session) });
  const getLogo = (session: Session) => c.inject({ method: 'GET', url: '/api/v1/tenant/logo', headers: c.readHeaders(session) });

  it('a new company has no logo: GET /tenant has no logoVersion and GET /tenant/logo is 404', async () => {
    const admin = await c.registerTenant(`Logo Co ${uniq()}`, `logo-none-${uniq()}@example.com`);
    expect(JSON.parse((await getTenant(admin)).body)).not.toHaveProperty('logoVersion');
    expect((await getLogo(admin)).statusCode).toBe(404);
  });

  it('upload -> served back byte for byte with its type; GET /tenant reports a logoVersion', async () => {
    const admin = await c.registerTenant(`Logo Co ${uniq()}`, `logo-up-${uniq()}@example.com`);
    const res = await upload(admin, PNG);
    expect(res.statusCode, res.body).toBe(200);
    const { logoVersion } = JSON.parse(res.body) as { logoVersion: number };
    expect(logoVersion).toBeGreaterThan(0);

    const logo = await getLogo(admin);
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toContain('image/png');
    expect(logo.rawPayload.equals(PNG)).toBe(true);
    expect(JSON.parse((await getTenant(admin)).body)).toMatchObject({ logoVersion });
  });

  it('replacing keeps one logo (new bytes, newer version); removing brings back the no-logo state', async () => {
    const admin = await c.registerTenant(`Logo Co ${uniq()}`, `logo-rep-${uniq()}@example.com`);
    const first = JSON.parse((await upload(admin, PNG)).body) as { logoVersion: number };
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = JSON.parse((await upload(admin, PNG_2)).body) as { logoVersion: number };
    expect(second.logoVersion).toBeGreaterThan(first.logoVersion);
    expect((await getLogo(admin)).rawPayload.equals(PNG_2)).toBe(true);

    const removed = await c.inject({ method: 'DELETE', url: '/api/v1/tenant/logo', headers: c.writeHeaders(admin) });
    expect(removed.statusCode).toBe(204);
    expect((await getLogo(admin)).statusCode).toBe(404);
    expect(JSON.parse((await getTenant(admin)).body)).not.toHaveProperty('logoVersion');
    // Removing again is a no-op, not an error.
    expect((await c.inject({ method: 'DELETE', url: '/api/v1/tenant/logo', headers: c.writeHeaders(admin) })).statusCode).toBe(204);
  });

  it('rejects an unsupported type, an empty file and an oversized one (400), keeping the previous logo', async () => {
    const admin = await c.registerTenant(`Logo Co ${uniq()}`, `logo-bad-${uniq()}@example.com`);
    await upload(admin, PNG);
    expect((await upload(admin, Buffer.from('<svg/>'), 'image/svg+xml')).statusCode).toBe(400);
    expect((await upload(admin, Buffer.alloc(0))).statusCode).toBe(400);
    expect((await upload(admin, Buffer.alloc(2 * 1024 * 1024 + 1))).statusCode).toBe(400);
    expect((await getLogo(admin)).rawPayload.equals(PNG)).toBe(true);
  });

  it('only core.tenant.update can change it; every member can read it; another company never sees it', async () => {
    const admin = await c.registerTenant(`Logo Co ${uniq()}`, `logo-rbac-${uniq()}@example.com`);
    await upload(admin, PNG);
    const vendedor = await c.createAndLoginAs(admin, `logo-v-${uniq()}@example.com`, 'Vendedor');

    expect((await getLogo(vendedor)).statusCode).toBe(200);
    expect(JSON.parse((await getTenant(vendedor)).body)).toHaveProperty('logoVersion');
    expect((await upload(vendedor, PNG_2)).statusCode).toBe(403);
    expect((await c.inject({ method: 'DELETE', url: '/api/v1/tenant/logo', headers: c.writeHeaders(vendedor) })).statusCode).toBe(403);
    expect((await getLogo(admin)).rawPayload.equals(PNG)).toBe(true);

    const other = await c.registerTenant(`Other Co ${uniq()}`, `logo-other-${uniq()}@example.com`);
    expect((await getLogo(other)).statusCode).toBe(404);
    expect((await c.inject({ method: 'GET', url: '/api/v1/tenant/logo' })).statusCode).toBe(401);
  });
});
