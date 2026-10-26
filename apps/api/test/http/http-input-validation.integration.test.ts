import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * FASE 19 pre-work — HTTP input robustness against a real PostgreSQL (no mocks), one regression
 * suite for three defects found in QA 5S and tracked in docs/roadmap/pending-register.md:
 *
 * - GAP-F19-PARSE-UUID — a malformed UUID in a path parameter used to reach PostgreSQL and come
 *   back as HTTP 500 (`22P02`); it must be a controlled 4xx, and a well-formed-but-unknown UUID must
 *   still be a plain 404 (the validation must not be so broad that it hides "not found").
 * - GAP-F19-EMPTY-BODY — a body-less request that declares `Content-Type: application/json` (or
 *   sends malformed JSON / an unsupported media type) was answered 500 because the framework's own
 *   body-parsing errors were not mapped by the global filter.
 * - DEFECT-TZ-DEFAULT-UNSETTABLE — `UTC`, the platform default timezone, was rejected on update.
 *
 * Every assertion also checks that the response is the one API error envelope and never leaks a
 * database or framework message.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('http input validation (integration, FASE 19 pre-work)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let admin: Session;

  const NIL_UUID = '00000000-0000-0000-0000-000000000000';
  const MALFORMED = ['not-a-uuid', '123', '00000000-0000-0000-0000-00000000000Z', '%27%3B%20drop%20table%20users%3B--'];

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    admin = await c.registerTenant('Http Input Co', `http-input-${Date.now()}@ex.example`);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  const JSON_HEADERS = { 'content-type': 'application/json' };

  /** Representative routes across every module that has a UUID path parameter (the exhaustive check
   * is the static guard in src/common/uuid-path-params.spec.ts). `{id}` is replaced per case. */
  const ROUTES: Array<{ method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/v1/warehouses/{id}' },
    { method: 'GET', path: '/api/v1/locations/{id}' },
    { method: 'GET', path: '/api/v1/categories/{id}' },
    { method: 'GET', path: '/api/v1/products/{id}' },
    { method: 'GET', path: '/api/v1/products/{id}/variants/{id}' },
    { method: 'PATCH', path: '/api/v1/customers/{id}', body: { phone: '+593999' } },
    { method: 'GET', path: '/api/v1/orders/{id}' },
    { method: 'POST', path: '/api/v1/orders/{id}/cancel' },
    { method: 'GET', path: '/api/v1/sales-returns/{id}' },
    { method: 'GET', path: '/api/v1/price-approvals/{id}' },
    { method: 'GET', path: '/api/v1/inventory/balances/{id}' },
    { method: 'GET', path: '/api/v1/inventory/transfers/{id}' },
    { method: 'POST', path: '/api/v1/inventory/transfers/{id}/approve' },
    { method: 'GET', path: '/api/v1/users/{id}' },
    { method: 'PUT', path: '/api/v1/users/{id}/locations', body: { locationIds: [] } },
    { method: 'PATCH', path: '/api/v1/roles/{id}', body: { name: 'Renamed Role' } },
    { method: 'DELETE', path: '/api/v1/roles/{id}' },
    { method: 'GET', path: '/api/v1/qr-codes/{id}' },
    { method: 'GET', path: '/api/v1/imports/{id}' },
    { method: 'GET', path: '/api/v1/import-mapping-templates/{id}' },
  ];

  const call = (route: (typeof ROUTES)[number], id: string) =>
    c.inject({
      method: route.method,
      url: route.path.replaceAll('{id}', id),
      headers: route.method === 'GET' ? c.readHeaders(admin) : c.writeHeaders(admin),
      ...(route.body !== undefined ? { payload: route.body } : {}),
    });

  /** The one error envelope, with no PostgreSQL / framework text. */
  const expectCleanEnvelope = (res: { statusCode: number; body: string }): void => {
    const body = JSON.parse(res.body) as { statusCode: number; code: string; message: string; correlationId: string };
    expect(body.statusCode).toBe(res.statusCode);
    expect(typeof body.code).toBe('string');
    expect(typeof body.correlationId).toBe('string');
    expect(res.body).not.toMatch(/invalid input syntax|22P02|postgres|pg_|SyntaxError|FST_ERR|at \S+\.(ts|js)/i);
  };

  describe('GAP-F19-PARSE-UUID', () => {
    for (const route of ROUTES) {
      it(`${route.method} ${route.path}: a malformed UUID is a controlled 400, never a 500`, async () => {
        for (const bad of MALFORMED) {
          const res = await call(route, bad);
          expect(res.statusCode, `${route.method} ${route.path} with "${bad}" -> ${res.statusCode} ${res.body}`).toBe(400);
          expectCleanEnvelope(res);
        }
      });

      it(`${route.method} ${route.path}: a well-formed but unknown UUID still reaches the handler (404, not 400)`, async () => {
        const res = await call(route, NIL_UUID);
        expect(res.statusCode, `${route.method} ${route.path} with nil uuid -> ${res.statusCode} ${res.body}`).toBe(404);
      });
    }

    it('identifiers that are NOT UUIDs are untouched: an opaque QR code is a 404 and an invitation token is never rejected by the UUID pipe', async () => {
      const qr = await c.inject({ method: 'GET', url: '/api/v1/qr-codes/resolve/not-a-uuid-just-an-opaque-token', headers: c.readHeaders(admin) });
      expect(qr.statusCode).toBe(404);
      const publicQr = await c.inject({ method: 'GET', url: '/q/not-a-uuid-just-an-opaque-token' });
      expect(publicQr.statusCode).toBe(404);
      const invitation = await c.inject({ method: 'GET', url: '/api/v1/auth/invitations/not-a-uuid-just-an-opaque-token' });
      // The token endpoint answers an unknown token with its own (non-error) shape; the point is that it is
      // never rejected by the UUID pipe and never a 500.
      expect(invitation.statusCode).toBeLessThan(500);
      expect(invitation.body).not.toMatch(/uuid is expected|Validation failed/i);
    });
  });

  describe('GAP-F19-EMPTY-BODY', () => {
    it('a bodyless action POST with Content-Type: application/json is NOT a 500 and still reaches the handler (404 for an unknown order)', async () => {
      const res = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${NIL_UUID}/cancel`,
        headers: { ...c.writeHeaders(admin), ...JSON_HEADERS },
      });
      expect(res.statusCode, res.body).toBe(404);
      expectCleanEnvelope(res);
    });

    it('a bodyless action POST WITHOUT a content type keeps working exactly as before (404 for an unknown order)', async () => {
      const res = await c.inject({ method: 'POST', url: `/api/v1/orders/${NIL_UUID}/cancel`, headers: c.writeHeaders(admin) });
      expect(res.statusCode, res.body).toBe(404);
    });

    it('an endpoint that REQUIRES a body rejects an empty JSON body with 400 VALIDATION_ERROR (not 500, not silently accepted)', async () => {
      const res = await c.inject({ method: 'POST', url: '/api/v1/customers', headers: { ...c.writeHeaders(admin), ...JSON_HEADERS } });
      expect(res.statusCode, res.body).toBe(400);
      expect((JSON.parse(res.body) as { code: string }).code).toBe('VALIDATION_ERROR');
      expectCleanEnvelope(res);
    });

    it('malformed JSON is a 400, never a 500', async () => {
      const res = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: { ...c.writeHeaders(admin), ...JSON_HEADERS },
        body: '{"firstName": "x",',
      });
      expect(res.statusCode, res.body).toBe(400);
      expectCleanEnvelope(res);
    });

    it('a media type with no parser (application/xml) is a 415, never a 500', async () => {
      const res = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: { ...c.writeHeaders(admin), 'content-type': 'application/xml' },
        body: '<a/>',
      });
      expect(res.statusCode, res.body).toBe(415);
      expectCleanEnvelope(res);
    });

    it('JSON "null" or an empty object on a body-requiring endpoint is a 400 (validated by the DTO)', async () => {
      for (const raw of ['null', '{}']) {
        const res = await c.inject({
          method: 'POST',
          url: '/api/v1/customers',
          headers: { ...c.writeHeaders(admin), ...JSON_HEADERS },
          body: raw,
        });
        expect(res.statusCode, `${raw} -> ${res.body}`).toBe(400);
      }
    });
  });

  describe('DEFECT-TZ-DEFAULT-UNSETTABLE', () => {
    const patchTimezone = (timezone: unknown) =>
      c.inject({ method: 'PATCH', url: '/api/v1/administration/tenant-settings', headers: c.writeHeaders(admin), payload: { timezone } });

    it('the default timezone UTC can be set (and read back)', async () => {
      const res = await patchTimezone('UTC');
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as { timezone: string }).timezone).toBe('UTC');
      const read = await c.inject({ method: 'GET', url: '/api/v1/administration/tenant-settings', headers: c.readHeaders(admin) });
      expect((JSON.parse(read.body) as { timezone: string }).timezone).toBe('UTC');
    });

    it('a real IANA zone still works, then UTC can be restored', async () => {
      const set = await patchTimezone('America/Guayaquil');
      expect(set.statusCode, set.body).toBe(200);
      expect((JSON.parse(set.body) as { timezone: string }).timezone).toBe('America/Guayaquil');
      const back = await patchTimezone('UTC');
      expect(back.statusCode, back.body).toBe(200);
    });

    it('invalid identifiers are still rejected with 400', async () => {
      for (const bad of ['Mars/Phobos', 'utc ', '', 'UTC+5', 'Not/AZone', 123]) {
        const res = await patchTimezone(bad);
        expect(res.statusCode, `${JSON.stringify(bad)} -> ${res.body}`).toBe(400);
      }
    });
  });
});
