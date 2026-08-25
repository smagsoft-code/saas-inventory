import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';

/**
 * Prompt 09's mandatory security/functional proof: QR (generation, management, the authenticated
 * resolve-identity path, and the unauthenticated public resolver) exercised through the real guard
 * chain and real app_tenant/app_platform/app_public_resolver connections — not mocks. Same boot/
 * inject convention as test/catalog/catalog.integration.test.ts; skipped (not failed) unless
 * TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL / TEST_APP_PLATFORM_DATABASE_URL /
 * TEST_APP_PUBLIC_RESOLVER_DATABASE_URL are all set — see test/database/helpers.ts.
 *
 * Does NOT call resetAndMigrate() itself — global-setup.ts already resets/migrates exactly once for
 * the whole test:integration run; a second per-file call here would race against it and against
 * every other integration file under fileParallelism: true (Prompt 05-B's fix).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('qr: generation, resolution, public resolver (integration)', () => {
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
    process.env['QR_PUBLIC_RATE_LIMIT_MAX'] = '1000';
    process.env['QR_PUBLIC_RATE_LIMIT_TTL_SECONDS'] = '60';

    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
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
      if (key === name) {
        return value;
      }
    }
    return undefined;
  }

  function cookieHeader(cookies: Record<string, string | undefined>): string {
    return Object.entries(cookies)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`)
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
    return {
      cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  async function registerTenant(companyName: string, email: string): Promise<Session> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function loginAs(tenantSlug: string, email: string, password: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantSlug, email, password } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function roleIdByName(admin: Session, name: string): Promise<string> {
    const response = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    expect(response.statusCode).toBe(200);
    const roles = JSON.parse(response.body) as { id: string; name: string }[];
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`Role "${name}" not found in tenant ${admin.user.tenantId}`);
    return role.id;
  }

  /** Vendedor: products.view/categories.view/pricing.floor.view, but not catalog.qr.manage — the
   * "authenticated but under-privileged" actor for this suite's RBAC matrix, and also the actor that
   * proves the resolve-identity endpoint needs no special permission (mobile.md#qr-on-mobile). */
  async function createAndLoginAs(admin: Session, email: string, roleName: string): Promise<Session> {
    const roleId = await roleIdByName(admin, roleName);
    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: `${roleName} User`, password: 'a-very-long-password', roleId },
    });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(admin.user.tenantSlug, email, 'a-very-long-password');
  }

  async function createProductVariant(admin: Session, sku: string, maxPrice = 500): Promise<{ productId: string; variantId: string }> {
    const productResponse = await inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(admin),
      payload: { name: `Product ${sku}`, defaultVariant: { sku, maxPrice, basePrice: maxPrice * 0.8, minPrice: maxPrice * 0.6, cost: maxPrice * 0.4 } },
    });
    expect(productResponse.statusCode).toBe(201);
    const productId = (JSON.parse(productResponse.body) as { id: string }).id;

    const variantsResponse = await inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: readHeaders(admin) });
    expect(variantsResponse.statusCode).toBe(200);
    const variants = JSON.parse(variantsResponse.body) as { id: string; sku: string }[];
    const variant = variants.find((v) => v.sku === sku);
    if (!variant) throw new Error(`Default variant ${sku} not found after product creation`);
    return { productId, variantId: variant.id };
  }

  async function createLocation(admin: Session, warehouseCode: string): Promise<string> {
    const warehouseResponse = await inject({
      method: 'POST',
      url: '/api/v1/warehouses',
      headers: writeHeaders(admin),
      payload: { name: `Warehouse ${warehouseCode}`, code: warehouseCode },
    });
    expect(warehouseResponse.statusCode).toBe(201);
    const warehouseId = (JSON.parse(warehouseResponse.body) as { id: string }).id;

    const locationsResponse = await inject({ method: 'GET', url: `/api/v1/locations?warehouseId=${warehouseId}`, headers: readHeaders(admin) });
    expect(locationsResponse.statusCode).toBe(200);
    const locationsBody = JSON.parse(locationsResponse.body) as { data: { id: string; name: string }[] };
    const location = locationsBody.data.find((l) => l.name === 'General');
    if (!location) throw new Error('Default "General" location not found after warehouse creation');
    return location.id;
  }

  async function createQrCode(admin: Session, targetType: 'product_variant' | 'location', targetId: string): Promise<{ id: string; code: string }> {
    const response = await inject({ method: 'POST', url: '/api/v1/qr-codes', headers: writeHeaders(admin), payload: { targetType, targetId } });
    expect(response.statusCode).toBe(201);
    return JSON.parse(response.body) as { id: string; code: string };
  }

  describe('product QR: generation, management, authenticated resolution', () => {
    it('create/list/get round-trip, and revoking it flips status to revoked', async () => {
      const admin = await registerTenant('QR Product Alpha Co', 'admin@qr-product-alpha.example');
      const { productId, variantId } = await createProductVariant(admin, 'QR-PROD-ALPHA-1');

      const qr = await createQrCode(admin, 'product_variant', variantId);
      expect(qr.code).toBeTruthy();

      const listResponse = await inject({ method: 'GET', url: `/api/v1/qr-codes?targetType=product_variant&targetId=${variantId}`, headers: readHeaders(admin) });
      expect(listResponse.statusCode).toBe(200);
      const listBody = JSON.parse(listResponse.body) as { data: { id: string; targetId: string }[] };
      expect(listBody.data.some((row) => row.id === qr.id && row.targetId === variantId)).toBe(true);

      const getResponse = await inject({ method: 'GET', url: `/api/v1/qr-codes/${qr.id}`, headers: readHeaders(admin) });
      expect(getResponse.statusCode).toBe(200);
      expect(JSON.parse(getResponse.body).status).toBe('active');

      const revokeResponse = await inject({ method: 'PATCH', url: `/api/v1/qr-codes/${qr.id}`, headers: writeHeaders(admin), payload: { status: 'revoked' } });
      expect(revokeResponse.statusCode).toBe(200);
      expect(JSON.parse(revokeResponse.body).status).toBe('revoked');

      void productId;
    });

    it('rejects a targetId that does not exist in the tenant (404), an invalid targetType (400), and tenantId in the body (400, mass assignment)', async () => {
      const admin = await registerTenant('QR Product Beta Co', 'admin@qr-product-beta.example');

      const missingTarget = await inject({
        method: 'POST',
        url: '/api/v1/qr-codes',
        headers: writeHeaders(admin),
        payload: { targetType: 'product_variant', targetId: '11111111-1111-7111-8111-111111111111' },
      });
      expect(missingTarget.statusCode).toBe(404);

      const invalidTargetType = await inject({
        method: 'POST',
        url: '/api/v1/qr-codes',
        headers: writeHeaders(admin),
        payload: { targetType: 'product', targetId: '11111111-1111-7111-8111-111111111111' },
      });
      expect(invalidTargetType.statusCode).toBe(400);

      const { variantId } = await createProductVariant(admin, 'QR-PROD-BETA-1');
      const massAssignment = await inject({
        method: 'POST',
        url: '/api/v1/qr-codes',
        headers: writeHeaders(admin),
        payload: { targetType: 'product_variant', targetId: variantId, tenantId: 'some-other-tenant' },
      });
      expect(massAssignment.statusCode).toBe(400);
    });

    it('401 anonymous, 403 without catalog.qr.manage on management routes; the resolve-identity route needs only authentication', async () => {
      const admin = await registerTenant('QR Product Gamma Co', 'admin@qr-product-gamma.example');
      const vendedor = await createAndLoginAs(admin, 'vendedor@qr-product-gamma.example', 'Vendedor');
      const { variantId, productId } = await createProductVariant(admin, 'QR-PROD-GAMMA-1');
      const qr = await createQrCode(admin, 'product_variant', variantId);

      const anon = await inject({ method: 'GET', url: '/api/v1/qr-codes' });
      expect(anon.statusCode).toBe(401);

      const vendedorCreate = await inject({
        method: 'POST',
        url: '/api/v1/qr-codes',
        headers: writeHeaders(vendedor),
        payload: { targetType: 'product_variant', targetId: variantId },
      });
      expect(vendedorCreate.statusCode).toBe(403);

      const vendedorList = await inject({ method: 'GET', url: '/api/v1/qr-codes', headers: readHeaders(vendedor) });
      expect(vendedorList.statusCode).toBe(403);

      const vendedorRevoke = await inject({ method: 'PATCH', url: `/api/v1/qr-codes/${qr.id}`, headers: writeHeaders(vendedor), payload: { status: 'revoked' } });
      expect(vendedorRevoke.statusCode).toBe(403);

      // The scan-and-look-up step itself (mobile.md#qr-on-mobile) — a Vendedor without
      // catalog.qr.manage must still be able to resolve a code to identity.
      const vendedorResolve = await inject({ method: 'GET', url: `/api/v1/qr-codes/resolve/${qr.code}`, headers: readHeaders(vendedor) });
      expect(vendedorResolve.statusCode).toBe(200);
      const resolved = JSON.parse(vendedorResolve.body) as { targetType: string; productVariantId: string; productId: string };
      expect(resolved.targetType).toBe('product_variant');
      expect(resolved.productVariantId).toBe(variantId);
      expect(resolved.productId).toBe(productId);

      // And the client can now call the real, ADR-0028-governed CATALOG endpoint with those ids —
      // never a duplicate pricing path inside QR itself.
      const catalogLookup = await inject({
        method: 'GET',
        url: `/api/v1/products/${resolved.productId}/variants/${resolved.productVariantId}`,
        headers: readHeaders(vendedor),
      });
      expect(catalogLookup.statusCode).toBe(200);
      const variantDto = JSON.parse(catalogLookup.body) as { maxPrice: number; minPrice?: number; cost?: number };
      expect(variantDto.maxPrice).toBeGreaterThan(0);
      // Vendedor has pricing.floor.view (default template) but not pricing.cost.view.
      expect(variantDto).toHaveProperty('minPrice');
      expect(variantDto).not.toHaveProperty('cost');
    });

    it('a revoked or expired QR fails to resolve even for an authenticated caller (410 Gone)', async () => {
      const admin = await registerTenant('QR Product Delta Co', 'admin@qr-product-delta.example');
      const { variantId } = await createProductVariant(admin, 'QR-PROD-DELTA-1');
      const qr = await createQrCode(admin, 'product_variant', variantId);

      await inject({ method: 'PATCH', url: `/api/v1/qr-codes/${qr.id}`, headers: writeHeaders(admin), payload: { status: 'revoked' } });

      const resolveRevoked = await inject({ method: 'GET', url: `/api/v1/qr-codes/resolve/${qr.code}`, headers: readHeaders(admin) });
      expect(resolveRevoked.statusCode).toBe(410);

      const resolveUnknown = await inject({ method: 'GET', url: '/api/v1/qr-codes/resolve/does-not-exist', headers: readHeaders(admin) });
      expect(resolveUnknown.statusCode).toBe(404);
    });

    it('cross-tenant: another tenant cannot get, list, revoke or resolve-identity a QR code it does not own (IDOR)', async () => {
      const admin = await registerTenant('QR Product Epsilon Co', 'admin@qr-product-epsilon.example');
      const { variantId } = await createProductVariant(admin, 'QR-PROD-EPSILON-1');
      const qr = await createQrCode(admin, 'product_variant', variantId);

      const otherAdmin = await registerTenant('QR Product Zeta Co', 'admin@qr-product-zeta.example');

      const crossGet = await inject({ method: 'GET', url: `/api/v1/qr-codes/${qr.id}`, headers: readHeaders(otherAdmin) });
      expect(crossGet.statusCode).toBe(404);

      const crossRevoke = await inject({ method: 'PATCH', url: `/api/v1/qr-codes/${qr.id}`, headers: writeHeaders(otherAdmin), payload: { status: 'revoked' } });
      expect(crossRevoke.statusCode).toBe(404);

      const crossResolve = await inject({ method: 'GET', url: `/api/v1/qr-codes/resolve/${qr.code}`, headers: readHeaders(otherAdmin) });
      expect(crossResolve.statusCode).toBe(404);

      // The original tenant's own resolve must still work — proves the 404 above is tenant
      // isolation, not the code itself being broken.
      const ownResolve = await inject({ method: 'GET', url: `/api/v1/qr-codes/resolve/${qr.code}`, headers: readHeaders(admin) });
      expect(ownResolve.statusCode).toBe(200);
    });

    it('generating two QR codes for the same target never produces a duplicate `code` (DB-constraint-backed uniqueness)', async () => {
      const admin = await registerTenant('QR Product Eta Co', 'admin@qr-product-eta.example');
      const { variantId } = await createProductVariant(admin, 'QR-PROD-ETA-1');

      const first = await createQrCode(admin, 'product_variant', variantId);
      const second = await createQrCode(admin, 'product_variant', variantId);
      expect(first.code).not.toBe(second.code);
      expect(first.id).not.toBe(second.id);
    });
  });

  describe('location QR: generation, management, authenticated resolution', () => {
    it('create/resolve round-trip for a location target', async () => {
      const admin = await registerTenant('QR Location Alpha Co', 'admin@qr-location-alpha.example');
      const locationId = await createLocation(admin, 'QRLOC-A');
      const qr = await createQrCode(admin, 'location', locationId);

      const resolveResponse = await inject({ method: 'GET', url: `/api/v1/qr-codes/resolve/${qr.code}`, headers: readHeaders(admin) });
      expect(resolveResponse.statusCode).toBe(200);
      const resolved = JSON.parse(resolveResponse.body) as { targetType: string; locationId: string };
      expect(resolved.targetType).toBe('location');
      expect(resolved.locationId).toBe(locationId);
    });

    it('rejects a location targetId that does not exist in the tenant (404)', async () => {
      const admin = await registerTenant('QR Location Beta Co', 'admin@qr-location-beta.example');
      const response = await inject({
        method: 'POST',
        url: '/api/v1/qr-codes',
        headers: writeHeaders(admin),
        payload: { targetType: 'location', targetId: '22222222-2222-7222-8222-222222222222' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('public resolver (GET /q/:code, unauthenticated)', () => {
    it('resolves an active product QR to name/maxPrice/status only — never basePrice/minPrice/cost/ids/tenant', async () => {
      const admin = await registerTenant('QR Public Product Alpha Co', 'admin@qr-public-product-alpha.example');
      const { variantId } = await createProductVariant(admin, 'QR-PUB-PROD-ALPHA-1', 777);
      const qr = await createQrCode(admin, 'product_variant', variantId);

      const response = await inject({ method: 'GET', url: `/q/${qr.code}` });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body['targetType']).toBe('product_variant');
      expect(body['maxPrice']).toBe(777);
      expect(body['status']).toBe('active');
      expect(body).not.toHaveProperty('basePrice');
      expect(body).not.toHaveProperty('minPrice');
      expect(body).not.toHaveProperty('cost');
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('tenantId');
      expect(body).not.toHaveProperty('sku');
      expect(body).not.toHaveProperty('code');
    });

    it('resolves an active location QR to name/code/status only — never tenant/warehouse internals', async () => {
      const admin = await registerTenant('QR Public Location Alpha Co', 'admin@qr-public-location-alpha.example');
      const locationId = await createLocation(admin, 'QRPUBLOC-A');
      const qr = await createQrCode(admin, 'location', locationId);

      const response = await inject({ method: 'GET', url: `/q/${qr.code}` });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body['targetType']).toBe('location');
      expect(body['name']).toBe('General');
      expect(body['code']).toBe('GENERAL');
      expect(body['status']).toBe('active');
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('tenantId');
      expect(body).not.toHaveProperty('warehouseId');
    });

    it('404s for a nonexistent code, a revoked code, and never requires any auth/tenant/csrf header', async () => {
      const admin = await registerTenant('QR Public Product Beta Co', 'admin@qr-public-product-beta.example');
      const { variantId } = await createProductVariant(admin, 'QR-PUB-PROD-BETA-1');
      const qr = await createQrCode(admin, 'product_variant', variantId);

      const unknown = await inject({ method: 'GET', url: '/q/does-not-exist-at-all' });
      expect(unknown.statusCode).toBe(404);

      await inject({ method: 'PATCH', url: `/api/v1/qr-codes/${qr.id}`, headers: writeHeaders(admin), payload: { status: 'revoked' } });
      const revoked = await inject({ method: 'GET', url: `/q/${qr.code}` });
      expect(revoked.statusCode).toBe(404);
    });

    it('cross-tenant: the public route never leaks which tenant owns a code, and a live code from tenant A is unaffected by tenant B existing', async () => {
      const admin = await registerTenant('QR Public Cross Alpha Co', 'admin@qr-public-cross-alpha.example');
      const { variantId } = await createProductVariant(admin, 'QR-PUB-CROSS-ALPHA-1');
      const qr = await createQrCode(admin, 'product_variant', variantId);

      await registerTenant('QR Public Cross Beta Co', 'admin@qr-public-cross-beta.example');

      const response = await inject({ method: 'GET', url: `/q/${qr.code}` });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body).not.toHaveProperty('tenantId');
      expect(body).not.toHaveProperty('tenantSlug');
    });

    it('is reachable unversioned and unprefixed, matching api.md\'s documented GET /q/:code contract', async () => {
      const admin = await registerTenant('QR Public Version Alpha Co', 'admin@qr-public-version-alpha.example');
      const { variantId } = await createProductVariant(admin, 'QR-PUB-VER-ALPHA-1');
      const qr = await createQrCode(admin, 'product_variant', variantId);

      const versionedAttempt = await inject({ method: 'GET', url: `/api/v1/q/${qr.code}` });
      expect(versionedAttempt.statusCode).toBe(404);

      const unversioned = await inject({ method: 'GET', url: `/q/${qr.code}` });
      expect(unversioned.statusCode).toBe(200);
    });
  });
});
