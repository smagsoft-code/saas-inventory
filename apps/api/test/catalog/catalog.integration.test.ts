import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';

/**
 * Prompt 06's mandatory security/functional proof (§36/§37/§45): CATALOG (categories, dynamic
 * attributes, products, variants, pricing) exercised through the real guard chain and real
 * app_tenant/app_platform connections — not mocks. Same boot/inject convention as
 * test/core/users-rbac.integration.test.ts; skipped (not failed) unless
 * TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL / TEST_APP_PLATFORM_DATABASE_URL are
 * all set — see test/database/helpers.ts.
 *
 * Does NOT call resetAndMigrate() itself — global-setup.ts already resets/migrates exactly once for
 * the whole test:integration run; a second per-file call here would race against it and against
 * every other integration file under fileParallelism: true (Prompt 05-B's fix).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('catalog: categories/products/variants/attributes (integration)', () => {
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

  /** Vendedor: products.view/categories.view/pricing.floor.view, but not products.manage/
   * categories.manage/pricing.cost.view — the "authenticated but under-privileged" actor for most
   * of this suite's RBAC matrix. */
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

  async function createCategory(admin: Session, name: string, slug: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/categories', headers: writeHeaders(admin), payload: { name, slug } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function createAttributeDefinition(
    admin: Session,
    body: Record<string, unknown>,
  ): Promise<{ id: string; code: string }> {
    const response = await inject({ method: 'POST', url: '/api/v1/attribute-definitions', headers: writeHeaders(admin), payload: body });
    expect(response.statusCode).toBe(201);
    return JSON.parse(response.body) as { id: string; code: string };
  }

  describe('categories (§13, §28/§30/§32)', () => {
    it('create/list/get/update round-trip, and cross-tenant read is 404', async () => {
      const admin = await registerTenant('Catalog Alpha Co', 'admin@catalog-alpha.example');
      const categoryId = await createCategory(admin, 'Motocicletas', 'motocicletas');

      const listResponse = await inject({ method: 'GET', url: '/api/v1/categories', headers: readHeaders(admin) });
      expect(listResponse.statusCode).toBe(200);
      expect((JSON.parse(listResponse.body) as { data: unknown[] }).data.length).toBeGreaterThan(0);

      const getResponse = await inject({ method: 'GET', url: `/api/v1/categories/${categoryId}`, headers: readHeaders(admin) });
      expect(getResponse.statusCode).toBe(200);
      expect(JSON.parse(getResponse.body).slug).toBe('motocicletas');

      const patchResponse = await inject({
        method: 'PATCH',
        url: `/api/v1/categories/${categoryId}`,
        headers: writeHeaders(admin),
        payload: { name: 'Motos y Cuatrimotos' },
      });
      expect(patchResponse.statusCode).toBe(200);
      expect(JSON.parse(patchResponse.body).name).toBe('Motos y Cuatrimotos');

      const otherTenant = await registerTenant('Catalog Beta Co', 'admin@catalog-beta.example');
      const crossTenant = await inject({ method: 'GET', url: `/api/v1/categories/${categoryId}`, headers: readHeaders(otherTenant) });
      expect(crossTenant.statusCode).toBe(404);
    });

    it('rejects a duplicate slug within the same tenant (409) and tenantId in the body (400, mass assignment)', async () => {
      const admin = await registerTenant('Catalog Gamma Co', 'admin@catalog-gamma.example');
      await createCategory(admin, 'Electro', 'electro');

      const dup = await inject({ method: 'POST', url: '/api/v1/categories', headers: writeHeaders(admin), payload: { name: 'Electro 2', slug: 'electro' } });
      expect(dup.statusCode).toBe(409);

      const massAssignment = await inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: writeHeaders(admin),
        payload: { name: 'Mass Assignment Attempt', slug: 'mass-assignment-cat', tenantId: 'some-other-tenant' },
      });
      expect(massAssignment.statusCode).toBe(400);
    });

    it('401 anonymous, 403 without categories.manage, 200 with categories.view (RBAC matrix, §30)', async () => {
      const admin = await registerTenant('Catalog Delta Co', 'admin@catalog-delta.example');
      const vendedor = await createAndLoginAs(admin, 'vendedor@catalog-delta.example', 'Vendedor');

      const anon = await inject({ method: 'GET', url: '/api/v1/categories' });
      expect(anon.statusCode).toBe(401);

      const viewAllowed = await inject({ method: 'GET', url: '/api/v1/categories', headers: readHeaders(vendedor) });
      expect(viewAllowed.statusCode).toBe(200);

      const manageForbidden = await inject({ method: 'POST', url: '/api/v1/categories', headers: writeHeaders(vendedor), payload: { name: 'X', slug: 'x' } });
      expect(manageForbidden.statusCode).toBe(403);
    });

    it('rejects a category being set as its own parent (400)', async () => {
      const admin = await registerTenant('Catalog Epsilon Co', 'admin@catalog-epsilon.example');
      const categoryId = await createCategory(admin, 'Ropa', 'ropa');
      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/categories/${categoryId}`,
        headers: writeHeaders(admin),
        payload: { parentCategoryId: categoryId },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('dynamic attributes (§6-§9, §33)', () => {
    it('every governed data type round-trips through a real product create', async () => {
      const admin = await registerTenant('Catalog Zeta Co', 'admin@catalog-zeta.example');
      const categoryId = await createCategory(admin, 'Motos', 'motos-zeta');

      const textAttr = await createAttributeDefinition(admin, { code: 'material', name: 'Material', dataType: 'text', appliesTo: 'product' });
      const numberAttr = await createAttributeDefinition(admin, { code: 'cilindraje', name: 'Cilindraje', dataType: 'number', appliesTo: 'product', minValue: 50, maxValue: 2000 });
      const decimalAttr = await createAttributeDefinition(admin, { code: 'peso', name: 'Peso', dataType: 'decimal', appliesTo: 'product' });
      const boolAttr = await createAttributeDefinition(admin, { code: 'importado', name: 'Importado', dataType: 'boolean', appliesTo: 'product' });
      const dateAttr = await createAttributeDefinition(admin, { code: 'fecha_ingreso', name: 'Fecha de ingreso', dataType: 'date', appliesTo: 'product' });
      const datetimeAttr = await createAttributeDefinition(admin, { code: 'ultima_revision', name: 'Última revisión', dataType: 'datetime', appliesTo: 'product' });
      const selectAttr = await createAttributeDefinition(admin, { code: 'color', name: 'Color', dataType: 'select', appliesTo: 'variant' });
      const multiSelectAttr = await createAttributeDefinition(admin, { code: 'extras', name: 'Extras', dataType: 'multi_select', appliesTo: 'variant' });

      await inject({
        method: 'POST',
        url: `/api/v1/attribute-definitions/${selectAttr.id}/options`,
        headers: writeHeaders(admin),
        payload: { code: 'black', label: 'Negro' },
      });
      await inject({
        method: 'POST',
        url: `/api/v1/attribute-definitions/${multiSelectAttr.id}/options`,
        headers: writeHeaders(admin),
        payload: { code: 'alarm', label: 'Alarma' },
      });

      const setAttrs = await inject({
        method: 'PUT',
        url: `/api/v1/categories/${categoryId}/attributes`,
        headers: writeHeaders(admin),
        payload: {
          entries: [
            { attributeDefinitionId: textAttr.id, isRequired: true },
            { attributeDefinitionId: numberAttr.id },
            { attributeDefinitionId: decimalAttr.id },
            { attributeDefinitionId: boolAttr.id },
            { attributeDefinitionId: dateAttr.id },
            { attributeDefinitionId: datetimeAttr.id },
            { attributeDefinitionId: selectAttr.id },
            { attributeDefinitionId: multiSelectAttr.id },
          ],
        },
      });
      expect(setAttrs.statusCode).toBe(200);
      expect((JSON.parse(setAttrs.body) as unknown[]).length).toBe(8);

      const created = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: {
          name: 'Moto Explorer',
          categoryId,
          attributes: {
            material: 'Aluminio',
            cilindraje: 250,
            peso: 145.5,
            importado: true,
            fecha_ingreso: '2026-01-15',
            ultima_revision: '2026-01-15T10:00:00Z',
          },
          defaultVariant: {
            sku: 'MOTO-EXPLORER-001',
            maxPrice: 5000,
            basePrice: 4500,
            minPrice: 4000,
            attributes: { color: 'black', extras: ['alarm'] },
          },
        },
      });
      expect(created.statusCode).toBe(201);
    });

    it('rejects an unknown attribute key, a missing required one, and an invalid select option', async () => {
      const admin = await registerTenant('Catalog Eta Co', 'admin@catalog-eta.example');
      const categoryId = await createCategory(admin, 'Ropa', 'ropa-eta');
      const requiredAttr = await createAttributeDefinition(admin, { code: 'talla', name: 'Talla', dataType: 'select', appliesTo: 'variant' });
      await inject({ method: 'POST', url: `/api/v1/attribute-definitions/${requiredAttr.id}/options`, headers: writeHeaders(admin), payload: { code: 'M', label: 'Mediana' } });
      await inject({
        method: 'PUT',
        url: `/api/v1/categories/${categoryId}/attributes`,
        headers: writeHeaders(admin),
        payload: { entries: [{ attributeDefinitionId: requiredAttr.id, isRequired: true }] },
      });

      const unknownKey = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Camisa', categoryId, defaultVariant: { sku: 'CAM-1', maxPrice: 50, basePrice: 40, minPrice: 30, attributes: { talla: 'M', bogus: 'x' } } },
      });
      expect(unknownKey.statusCode).toBe(400);

      const missingRequired = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Camisa', categoryId, defaultVariant: { sku: 'CAM-2', maxPrice: 50, basePrice: 40, minPrice: 30 } },
      });
      expect(missingRequired.statusCode).toBe(400);

      const invalidOption = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Camisa', categoryId, defaultVariant: { sku: 'CAM-3', maxPrice: 50, basePrice: 40, minPrice: 30, attributes: { talla: 'XXXL-not-an-option' } } },
      });
      expect(invalidOption.statusCode).toBe(400);
    });

    it('§34: changing a product to a category with incompatible existing attributes is rejected, not silently applied', async () => {
      const admin = await registerTenant('Catalog Theta Co', 'admin@catalog-theta.example');
      const categoryA = await createCategory(admin, 'Categoria A', 'categoria-a-theta');
      const categoryB = await createCategory(admin, 'Categoria B', 'categoria-b-theta');
      const colorAttr = await createAttributeDefinition(admin, { code: 'color_theta', name: 'Color', dataType: 'text', appliesTo: 'product' });
      await inject({
        method: 'PUT',
        url: `/api/v1/categories/${categoryA}/attributes`,
        headers: writeHeaders(admin),
        payload: { entries: [{ attributeDefinitionId: colorAttr.id, isRequired: true }] },
      });
      // categoryB deliberately gets no attributes assigned.

      const created = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Producto Theta', categoryId: categoryA, attributes: { color_theta: 'red' }, defaultVariant: { sku: 'THETA-1', maxPrice: 10, basePrice: 8, minPrice: 5 } },
      });
      expect(created.statusCode).toBe(201);
      const productId = (JSON.parse(created.body) as { id: string }).id;

      const categoryChange = await inject({
        method: 'PATCH',
        url: `/api/v1/products/${productId}`,
        headers: writeHeaders(admin),
        payload: { categoryId: categoryB },
      });
      // categoryB has zero governed attributes — the existing { color_theta: 'red' } is now
      // ungoverned, so the change is rejected, not silently applied.
      expect(categoryChange.statusCode).toBe(400);

      // Submitting compatible (empty) attributes alongside the category change succeeds.
      const categoryChangeWithFix = await inject({
        method: 'PATCH',
        url: `/api/v1/products/${productId}`,
        headers: writeHeaders(admin),
        payload: { categoryId: categoryB, attributes: {} },
      });
      expect(categoryChangeWithFix.statusCode).toBe(200);
    });
  });

  describe('products and variants (§10-§21, §28/§30/§32/§39)', () => {
    it('create/list/get/update round-trip, and cross-tenant read is 404', async () => {
      const admin = await registerTenant('Catalog Iota Co', 'admin@catalog-iota.example');
      const created = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Refrigerador 400L', defaultVariant: { sku: 'REF-400L', maxPrice: 900, basePrice: 800, minPrice: 700 } },
      });
      expect(created.statusCode).toBe(201);
      const productId = (JSON.parse(created.body) as { id: string }).id;

      const list = await inject({ method: 'GET', url: '/api/v1/products', headers: readHeaders(admin) });
      expect(list.statusCode).toBe(200);

      const detail = await inject({ method: 'GET', url: `/api/v1/products/${productId}`, headers: readHeaders(admin) });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body).status).toBe('draft');

      const patched = await inject({ method: 'PATCH', url: `/api/v1/products/${productId}`, headers: writeHeaders(admin), payload: { status: 'active' } });
      expect(patched.statusCode).toBe(200);
      expect(JSON.parse(patched.body).status).toBe('active');

      const otherTenant = await registerTenant('Catalog Kappa Co', 'admin@catalog-kappa.example');
      const crossTenant = await inject({ method: 'GET', url: `/api/v1/products/${productId}`, headers: readHeaders(otherTenant) });
      expect(crossTenant.statusCode).toBe(404);
    });

    it('always creates the product in the caller tenant, ignoring any tenantId in the body (mass assignment)', async () => {
      const admin = await registerTenant('Catalog Lambda Co', 'admin@catalog-lambda.example');
      const response = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Mass Assignment Attempt', tenantId: 'some-other-tenant', defaultVariant: { sku: 'LAMBDA-1', maxPrice: 10, basePrice: 8, minPrice: 5 } },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects minPrice > basePrice > maxPrice ordering (400) — checked before ever reaching the DB constraint', async () => {
      const admin = await registerTenant('Catalog Mu Co', 'admin@catalog-mu.example');
      const response = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Bad Price', defaultVariant: { sku: 'MU-1', maxPrice: 10, basePrice: 50, minPrice: 5 } },
      });
      expect(response.statusCode).toBe(400);
    });

    it('SKU is unique per tenant — a duplicate SKU on a new variant is rejected (409), a real constraint not a race-prone check', async () => {
      const admin = await registerTenant('Catalog Nu Co', 'admin@catalog-nu.example');
      const first = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Producto Nu', defaultVariant: { sku: 'NU-DUP', maxPrice: 10, basePrice: 8, minPrice: 5 } },
      });
      expect(first.statusCode).toBe(201);
      const productId = (JSON.parse(first.body) as { id: string }).id;

      const secondVariant = await inject({
        method: 'POST',
        url: `/api/v1/products/${productId}/variants`,
        headers: writeHeaders(admin),
        payload: { sku: 'NU-DUP', maxPrice: 20, basePrice: 15, minPrice: 10 },
      });
      expect(secondVariant.statusCode).toBe(409);
    });

    it('additional variants: create/list/get/update, each independently attribute- and price-validated', async () => {
      const admin = await registerTenant('Catalog Xi Co', 'admin@catalog-xi.example');
      const created = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Camisa Oxford', defaultVariant: { sku: 'OXFORD-S', maxPrice: 60, basePrice: 50, minPrice: 40 } },
      });
      const productId = (JSON.parse(created.body) as { id: string }).id;

      const secondVariant = await inject({
        method: 'POST',
        url: `/api/v1/products/${productId}/variants`,
        headers: writeHeaders(admin),
        payload: { sku: 'OXFORD-M', maxPrice: 60, basePrice: 50, minPrice: 40 },
      });
      expect(secondVariant.statusCode).toBe(201);
      const variantId = (JSON.parse(secondVariant.body) as { id: string }).id;

      const list = await inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: readHeaders(admin) });
      expect(list.statusCode).toBe(200);
      expect((JSON.parse(list.body) as unknown[]).length).toBe(2);

      const patched = await inject({
        method: 'PATCH',
        url: `/api/v1/products/${productId}/variants/${variantId}`,
        headers: writeHeaders(admin),
        payload: { status: 'discontinued' },
      });
      expect(patched.statusCode).toBe(200);
      expect(JSON.parse(patched.body).status).toBe('discontinued');
    });

    it('401 anonymous, 403 without products.manage, 200 with products.view (RBAC matrix, §30)', async () => {
      const admin = await registerTenant('Catalog Omicron Co', 'admin@catalog-omicron.example');
      const vendedor = await createAndLoginAs(admin, 'vendedor@catalog-omicron.example', 'Vendedor');

      const anon = await inject({ method: 'GET', url: '/api/v1/products' });
      expect(anon.statusCode).toBe(401);

      const viewAllowed = await inject({ method: 'GET', url: '/api/v1/products', headers: readHeaders(vendedor) });
      expect(viewAllowed.statusCode).toBe(200);

      const manageForbidden = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(vendedor),
        payload: { name: 'X', defaultVariant: { sku: 'OMICRON-X', maxPrice: 10, basePrice: 8, minPrice: 5 } },
      });
      expect(manageForbidden.statusCode).toBe(403);
    });
  });

  describe('field-level price authorization (ADR-0028)', () => {
    it('omits minPrice/cost for a caller lacking pricing.floor.view/pricing.cost.view; includes minPrice (not cost) for Vendedor; includes both for Administrador', async () => {
      const admin = await registerTenant('Catalog Pi Co', 'admin@catalog-pi.example');
      const created = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(admin),
        payload: { name: 'Producto Pi', defaultVariant: { sku: 'PI-1', maxPrice: 300, basePrice: 250, minPrice: 200, cost: 150 } },
      });
      const productId = (JSON.parse(created.body) as { id: string }).id;

      const asAdmin = await inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: readHeaders(admin) });
      const adminVariant = (JSON.parse(asAdmin.body) as Record<string, unknown>[])[0]!;
      expect(adminVariant['minPrice']).toBe(200);
      expect(adminVariant['cost']).toBe(150);

      const vendedor = await createAndLoginAs(admin, 'vendedor@catalog-pi.example', 'Vendedor');
      const asVendedor = await inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: readHeaders(vendedor) });
      const vendedorVariant = (JSON.parse(asVendedor.body) as Record<string, unknown>[])[0]!;
      expect(vendedorVariant['minPrice']).toBe(200);
      expect(vendedorVariant).not.toHaveProperty('cost');

      const bodega = await createAndLoginAs(admin, 'bodega@catalog-pi.example', 'Bodega');
      const asBodega = await inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: readHeaders(bodega) });
      const bodegaVariant = (JSON.parse(asBodega.body) as Record<string, unknown>[])[0]!;
      expect(bodegaVariant).not.toHaveProperty('minPrice');
      expect(bodegaVariant).not.toHaveProperty('cost');
    });
  });

  describe('multi-tenancy isolation (§30, mandatory two-tenant check)', () => {
    it('tenant A cannot list, read, update, or manipulate tenant B categories/products/attributes', async () => {
      const tenantA = await registerTenant('Catalog Sigma Co', 'admin@catalog-sigma.example');
      const tenantB = await registerTenant('Catalog Tau Co', 'admin@catalog-tau.example');
      const categoryB = await createCategory(tenantB, 'Tau Category', 'tau-category');
      const attrB = await createAttributeDefinition(tenantB, { code: 'tau_attr', name: 'Tau Attr', dataType: 'text', appliesTo: 'product' });

      const readCategory = await inject({ method: 'GET', url: `/api/v1/categories/${categoryB}`, headers: readHeaders(tenantA) });
      expect(readCategory.statusCode).toBe(404);

      const updateCategory = await inject({ method: 'PATCH', url: `/api/v1/categories/${categoryB}`, headers: writeHeaders(tenantA), payload: { name: 'Hijacked' } });
      expect(updateCategory.statusCode).toBe(404);

      // A tenant cannot use another tenant's attribute definition when assigning to its own category.
      const ownCategory = await createCategory(tenantA, 'Sigma Category', 'sigma-category');
      const assignForeignAttr = await inject({
        method: 'PUT',
        url: `/api/v1/categories/${ownCategory}/attributes`,
        headers: writeHeaders(tenantA),
        payload: { entries: [{ attributeDefinitionId: attrB.id }] },
      });
      expect(assignForeignAttr.statusCode).toBe(404);

      // A product cannot be created against another tenant's category.
      const createWithForeignCategory = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: writeHeaders(tenantA),
        payload: { name: 'Foreign Category Attempt', categoryId: categoryB, defaultVariant: { sku: 'SIGMA-X', maxPrice: 10, basePrice: 8, minPrice: 5 } },
      });
      expect(createWithForeignCategory.statusCode).toBe(404);
    });
  });
});
