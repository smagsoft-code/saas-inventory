import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

/**
 * Shared HTTP/session/seed helpers for the SALES integration suite (test/sales/*.integration.test.ts).
 * Every suite boots the real `buildApp()` (src/main.ts) against real PostgreSQL — no mocks, per
 * CLAUDE.md §7.9 / prompt §120. Mirrors the inline helper set in
 * test/inventory/inventory-stock.integration.test.ts, extracted here since three SALES files need it.
 */

export interface Session {
  user: { id: string; tenantId: string; tenantSlug: string };
  accessToken: string;
  csrfToken: string;
}

export function setIntegrationEnv(): void {
  process.env['DATABASE_URL'] = process.env['TEST_APP_TENANT_DATABASE_URL'];
  process.env['APP_PLATFORM_DATABASE_URL'] = process.env['TEST_APP_PLATFORM_DATABASE_URL'];
  process.env['APP_PUBLIC_RESOLVER_DATABASE_URL'] = process.env['TEST_APP_PUBLIC_RESOLVER_DATABASE_URL'];
  process.env['JWT_SECRET'] = 'integration-test-jwt-secret';
  process.env['JWT_REFRESH_SECRET'] = 'integration-test-refresh-pepper';
  process.env['CORS_ORIGINS'] = 'http://localhost:3000';
  process.env['ARGON2_MEMORY_COST_KIB'] = '8192';
  process.env['ARGON2_TIME_COST'] = '2';
  process.env['ARGON2_PARALLELISM'] = '1';
  process.env['AUTH_RATE_LIMIT_MAX'] = '5000';
  process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';
}

export function makeClient(app: NestFastifyApplication) {
  const inject = (options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse> =>
    app.getHttpAdapter().getInstance().inject(options as InjectOptions);

  const cookieValue = (response: LightMyRequestResponse, name: string): string | undefined => {
    const raw = response.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) return value;
    }
    return undefined;
  };

  const cookieHeader = (cookies: Record<string, string | undefined>): string =>
    Object.entries(cookies)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

  const readHeaders = (session: Session): Record<string, string> => ({ cookie: cookieHeader({ access_token: session.accessToken }) });

  const writeHeaders = (session: Session, extra: Record<string, string> = {}): Record<string, string> => ({
    cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
    'x-csrf-token': session.csrfToken,
    ...extra,
  });

  async function registerTenant(companyName: string, email: string): Promise<Session> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' },
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function loginAs(email: string, password = 'a-very-long-password'): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(response.statusCode, response.body).toBe(200);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function roleIdByName(admin: Session, name: string): Promise<string> {
    const response = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    expect(response.statusCode).toBe(200);
    const roles = JSON.parse(response.body) as { id: string; name: string }[];
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`Role "${name}" not found`);
    return role.id;
  }

  async function createAndLoginAs(admin: Session, email: string, roleName: string): Promise<Session> {
    const roleId = await roleIdByName(admin, roleName);
    const created = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: `${roleName} User`, password: 'a-very-long-password', roleId },
    });
    expect(created.statusCode, created.body).toBe(201);
    return loginAs(email);
  }

  /** Codes must be uppercase alphanumeric, optionally hyphen-separated (catalog/inventory DTO rule). */
  const asCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  async function createWarehouse(admin: Session, code: string): Promise<string> {
    const value = asCode(code);
    const response = await inject({ method: 'POST', url: '/api/v1/warehouses', headers: writeHeaders(admin), payload: { name: `WH ${value}`, code: value } });
    expect(response.statusCode, response.body).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function createLocation(
    admin: Session,
    warehouseId: string,
    code: string,
    opts: { isSellable?: boolean } = {},
  ): Promise<string> {
    const value = asCode(code);
    const response = await inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: writeHeaders(admin),
      payload: {
        warehouseId,
        name: `Loc ${value}`,
        code: value,
        ...(opts.isSellable === undefined ? {} : { isSellable: opts.isSellable }),
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  /** Restrict a user to exactly the given locations (ADR-0035: zero rows denies, except the
   * tenant's founding, system-default Administrador role). */
  async function setUserLocations(admin: Session, userId: string, locationIds: string[]): Promise<void> {
    const response = await inject({
      method: 'PUT',
      url: `/api/v1/users/${userId}/locations`,
      headers: writeHeaders(admin),
      payload: { locationIds },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function createProductVariant(
    admin: Session,
    opts: {
      sku: string;
      maxPrice?: number | undefined;
      basePrice?: number | undefined;
      minPrice?: number | undefined;
      isSerialized?: boolean | undefined;
      isLotTracked?: boolean | undefined;
    },
  ): Promise<{ productId: string; variantId: string }> {
    const created = await inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(admin),
      payload: {
        name: `Product ${opts.sku}`,
        defaultVariant: {
          sku: opts.sku,
          maxPrice: opts.maxPrice ?? 120,
          basePrice: opts.basePrice ?? 100,
          minPrice: opts.minPrice ?? 80,
          ...(opts.isSerialized ? { isSerialized: true } : {}),
          ...(opts.isLotTracked ? { isLotTracked: true } : {}),
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const productId = (JSON.parse(created.body) as { id: string }).id;
    const variants = await inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: readHeaders(admin) });
    expect(variants.statusCode).toBe(200);
    return { productId, variantId: (JSON.parse(variants.body) as { id: string }[])[0]!.id };
  }

  async function receiveStock(admin: Session, variantId: string, locationId: string, quantity: number): Promise<void> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: writeHeaders(admin),
      payload: { productVariantId: variantId, locationId, movementType: 'RECEIPT', quantity, unitCost: 10, reason: 'Test stock' },
    });
    expect(response.statusCode, response.body).toBe(201);
  }

  async function createCustomer(session: Session, payload: Record<string, unknown>): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/customers', headers: writeHeaders(session), payload });
    expect(response.statusCode, response.body).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  /** A customer with the full commercial data every sale (invoice AND sales_note) requires
   * (PROMPT 012-A). `taxId` is made unique per call so two full customers in the same tenant never
   * collide on `customers_tenant_id_tax_id_key`. */
  let taxIdSeq = 0;
  const fullCustomer = (suffix: string) => {
    taxIdSeq += 1;
    return {
      type: 'cedula',
      firstName: `Customer`,
      lastName: suffix,
      // cedula = exactly 10 digits, unique per tenant (7 time digits + 3 sequence digits).
      taxId: `${String(Date.now()).slice(-7)}${String(taxIdSeq).padStart(3, '0')}`,
      email: `customer-${suffix}-${taxIdSeq}@example.com`,
      phone: '+59322222222',
      address: 'Av. Siempre Viva 742, Quito',
    };
  };

  return {
    inject,
    cookieValue,
    readHeaders,
    writeHeaders,
    registerTenant,
    loginAs,
    createAndLoginAs,
    createWarehouse,
    createLocation,
    setUserLocations,
    createProductVariant,
    receiveStock,
    createCustomer,
    fullCustomer,
  };
}
