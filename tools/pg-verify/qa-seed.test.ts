import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// The REAL backend normalisation (catalog/upper-name.ts: `name.trim().toUpperCase()`), imported rather than re-implemented, so the fake cannot drift from it.
import { upperName } from '../../apps/api/src/catalog/upper-name';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ConfirmOrderDto, CreateAdjustmentDto, CreateCustomerDto, ReceiveTransferDto, contractErrors, dtoFor } from './qa-dto-contracts';
import { guardApi, guardUpload, paymentsFor, runQaSeed, standardizeName, type ApiFn } from './qa-seed';
import {
  assertLoopbackApi,
  assertOrderListIsComplete,
  parseSeedArgs,
  QA_SEED_MARKERS,
  resolveSeedConfig,
  SeedGuardError,
  type LoginResult,
  type SeedConfig,
  type SeedMode,
} from './qa-seed-guards';

/**
 * All of these run against `FakeTenantApi`, an in-memory stand-in for the subset of the HTTP API the seed uses. Nothing here starts
 * PostgreSQL, the API, the web app or S3, opens a socket, or reads a file.
 */

type Rec = Record<string, unknown> & { id: string };
interface Call {
  method: string;
  path: string;
  body?: unknown;
  idempotent?: boolean | undefined;
}

const LOGIN_PATH = '/api/v1/auth/login';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

class FakeTenantApi {
  calls: Call[] = [];
  uploads: string[] = [];
  slug = 'qa-dev-tenant';
  status = 'active';
  login: LoginResult = { status: 'authenticated', user: { tenantSlug: 'qa-dev-tenant', status: 'active', permissions: ['sales.orders.view_all'] } };
  /** What GET /inventory/location-scope answers (the caller's own operating scope). */
  scope: unknown = { unrestricted: true, locationIds: [] };
  /** Makes the scope request fail the way the HTTP client does for a non-2xx answer. */
  scopeError: string | undefined;
  /** Deliberately broken list responses, per path prefix. */
  listFault: { prefix: string; kind: 'no-meta' | 'short' | 'overflow' } | undefined;
  failOn: ((method: string, path: string) => boolean) | undefined;
  private seq = 0;
  warehouses: Rec[] = [];
  locations: Rec[] = [];
  categories: Rec[] = [];
  products: Rec[] = [];
  variants: Rec[] = [];
  movements: Rec[] = [];
  qrs: Rec[] = [];
  customers: Rec[] = [];
  orders: Rec[] = [];
  transfers: Rec[] = [];
  imageCount = new Map<string, number>();
  /** The vendor's open cart. Like the backend, POST /cart returns it if it exists (and ignores the body), else creates one. */
  openCartRec: (Rec & { items: Rec[] }) | undefined;
  /** SKUs the list hides but the unique constraint still holds (a soft-deleted product keeps its SKU). */
  hiddenSkus = new Set<string>();
  /** 'C' = a --locale=C cluster: ILIKE folds ASCII case only. 'unicode' = a locale that also folds accented letters. Neither ignores accents. */
  searchLocale: 'C' | 'unicode' = 'C';
  private get cart(): Rec[] {
    return this.openCartRec?.items ?? [];
  }

  id(prefix: string): string {
    this.seq += 1;
    const value = `${prefix}-${String(this.seq)}`;
    this.issued.add(value);
    return value;
  }

  private readonly issued = new Set<string>();
  /** Every request the fake refused because its body failed the REAL request DTO (the backend answers these with 400). */
  rejected: Call[] = [];
  /** The tenant's transfer workflow gates (tenant settings). Both required = every tenant's default. */
  workflow = { requireApproval: true, requirePreparation: true };

  /**
   * The fixtures use readable ids ("cat-f", "var-3") where the backend has UUIDs, and the real DTOs say `@IsUUID()`. For VALIDATION ONLY, a string that is the
   * id of a record the fake knows is replaced by a stable UUID derived from it; any other string stays as it is, so a name or a wrong field in a UUID
   * position is still caught. (The fake never sees the real UUIDs the backend would give, which is a stated limit of fakes.)
   */
  private forValidation(value: unknown): unknown {
    const known = new Set(this.issued);
    for (const collection of [this.warehouses, this.locations, this.categories, this.products, this.variants, this.customers, this.orders, this.transfers, this.movements, this.qrs]) {
      for (const record of collection) known.add(String(record.id));
    }
    if (this.openCartRec) known.add(String(this.openCartRec.id));
    const uuid = (s: string): string => {
      const h = createHash('sha1').update(s).digest('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    };
    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') return known.has(v) ? uuid(v) : v;
      if (Array.isArray(v)) return v.map(walk);
      if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    return walk(value);
  }

  /** The login is recorded like any request: it is a POST with technical side effects (last-login metadata, a session), not seed data. */
  readonly loginFn = (): Promise<LoginResult> => {
    this.calls.push({ method: 'POST', path: LOGIN_PATH });
    return Promise.resolve(this.login);
  };

  authWrites(): number {
    return this.calls.filter((c) => c.path === LOGIN_PATH).length;
  }

  /** Every recorded request except the login. */
  dataCalls(): Call[] {
    return this.calls.filter((c) => c.path !== LOGIN_PATH);
  }

  /** SEED-DATA writes: non-GET requests other than the login, plus image uploads. */
  writes(): number {
    return this.dataCalls().filter((c) => c.method !== 'GET').length + this.uploads.length;
  }

  private page(items: Rec[], params: URLSearchParams, filter: (r: Rec) => boolean = () => true): unknown {
    const rows = items.filter(filter);
    const size = Number(params.get('pageSize') ?? '20');
    const page = Number(params.get('page') ?? '1');
    const data = rows.slice((page - 1) * size, page * size);
    const fault = this.currentPath !== undefined && this.listFault && this.currentPath.startsWith(this.listFault.prefix) ? this.listFault.kind : undefined;
    if (fault === 'no-meta') return { data };
    if (fault === 'short') return { data: data.slice(0, 1), meta: { total: rows.length + 5, totalPages: 1 } }; // fewer rows than declared, on every page
    if (fault === 'overflow') return { data, meta: { total: 0, totalPages: 1 } };
    return { data, meta: { total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / size)) } };
  }
  private currentPath: string | undefined;
  /** PostgreSQL ILIKE '%needle%': case-insensitive, never accent-insensitive; in a C locale only ASCII letters fold. */
  ilike(haystack: string, needle: string): boolean {
    const fold = (s: string): string => (this.searchLocale === 'C' ? s.replace(/[A-Z]/g, (c) => c.toLowerCase()) : s.toLowerCase());
    return fold(haystack).includes(fold(needle));
  }
  /** What the backend stores as a product name. Overridable to prove the seed does not depend on it. */
  productName: (name: string) => string = upperName;

  readonly api: ApiFn = (async (method: string, rawPath: string, body?: unknown, opts?: { idempotent?: boolean }) => {
    const url = new URL(`http://fake${rawPath}`);
    const p = url.pathname;
    const q = url.searchParams;
    this.calls.push({ method, path: rawPath, body, idempotent: opts?.idempotent });
    this.currentPath = p;
    if (this.failOn?.(method, rawPath)) throw new Error(`injected failure: ${method} ${rawPath}`);
    const dto = dtoFor(method, p);
    if (dto) {
      const errors = contractErrors(dto, this.forValidation(body));
      if (errors.length > 0) {
        this.rejected.push({ method, path: rawPath, body });
        throw new Error(`${method} ${rawPath} -> 400: ${errors.join('; ')}`);
      }
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const m = (re: RegExp): RegExpMatchArray | null => p.match(re);
    if (method === 'GET' && p === '/api/v1/tenant') return { slug: this.slug, status: this.status };
    if (method === 'GET' && p === '/api/v1/inventory/location-scope') {
      if (this.scopeError) throw new Error(`GET ${rawPath} -> ${this.scopeError}`);
      return this.scope;
    }
    if (p === '/api/v1/warehouses') {
      if (method === 'GET') return this.page(this.warehouses, q);
      const w: Rec = { id: this.id('wh'), name: b['name'] as string, code: b['code'] as string };
      this.warehouses.push(w);
      this.locations.push({ id: this.id('loc'), warehouseId: w.id, name: 'General', code: `GL-${w.code as string}`, isSellable: true });
      return w;
    }
    if (p === '/api/v1/locations') {
      if (method === 'GET') return this.page(this.locations, q, (l) => l['warehouseId'] === q.get('warehouseId'));
      const l: Rec = { id: this.id('loc'), warehouseId: b['warehouseId'], name: b['name'], code: b['code'], isSellable: b['isSellable'] ?? true };
      this.locations.push(l);
      return l;
    }
    if (p === '/api/v1/categories') {
      if (method === 'GET') return this.page(this.categories, q);
      // Like the backend: the name is stored in UPPERCASE, the code is the caller's or an automatic CAT-nnn, and a code is unique per tenant.
      const code = (b['code'] as string | undefined) ?? `CAT-${String(this.categories.length + 1).padStart(3, '0')}`;
      if (this.categories.some((x) => String(x['code']).toUpperCase() === code.toUpperCase())) throw new Error('POST /api/v1/categories -> 409: duplicate code');
      const c: Rec = { id: this.id('cat'), name: (b['name'] as string).toUpperCase(), code };
      this.categories.push(c);
      return c;
    }
    if (p === '/api/v1/products') {
      if (method === 'GET') {
        // Like ProductsRepository.listByTenant: `q` is a case-insensitive substring over the name or any variant SKU.
        const needle = q.get('q') ?? undefined;
        const matches = (r: Rec): boolean =>
          needle === undefined || this.ilike(String(r['name']), needle) || this.variants.some((v) => v['productId'] === r.id && this.ilike(String(v['sku']), needle));
        return this.page(this.products, q, matches);
      }
      const dv = b['defaultVariant'] as Record<string, unknown>;
      // Unique SKU per tenant (product_variants_tenant_id_sku_key), case-sensitive like the column.
      if (this.variants.some((v) => v['sku'] === dv['sku']) || this.hiddenSkus.has(String(dv['sku']))) throw new Error('POST /api/v1/products -> 409: A variant with this SKU or barcode already exists.');
      const prod: Rec = { id: this.id('prod'), name: this.productName(b['name'] as string), categoryId: b['categoryId'] };
      this.products.push(prod);
      this.variants.push({ id: this.id('var'), productId: prod.id, sku: dv['sku'], maxPrice: dv['maxPrice'], basePrice: dv['basePrice'], minPrice: dv['minPrice'], cost: dv['cost'], status: 'active' });
      return prod;
    }
    let mm = m(/^\/api\/v1\/products\/([^/]+)\/variants$/);
    if (mm) {
      if (method === 'GET') return this.variants.filter((v) => v['productId'] === mm?.[1]);
      if (this.variants.some((x) => x['sku'] === b['sku'])) throw new Error('POST variants -> 409: A variant with this SKU or barcode already exists.');
      const v: Rec = { id: this.id('var'), productId: mm[1], sku: b['sku'], maxPrice: b['maxPrice'], basePrice: b['basePrice'], minPrice: b['minPrice'], cost: b['cost'], status: 'active' };
      this.variants.push(v);
      return v;
    }
    if (m(/^\/api\/v1\/products\/[^/]+(\/variants\/[^/]+)?$/) && method === 'PATCH') return {};
    mm = m(/^\/api\/v1\/products\/([^/]+)\/images$/);
    if (mm && method === 'GET') return Array.from({ length: this.imageCount.get(mm[1] ?? '') ?? 0 }, () => ({}));
    if (p === '/api/v1/inventory/movements') {
      return this.page(this.movements, q, (r) => !q.has('productVariantId') || (r['productVariantId'] === q.get('productVariantId') && r['locationId'] === q.get('locationId') && r['movementType'] === q.get('movementType')));
    }
    if (p === '/api/v1/inventory/adjustments') {
      this.movements.push({ id: this.id('mov'), productVariantId: b['productVariantId'], locationId: b['locationId'], movementType: b['movementType'], quantity: b['quantity'], unitCost: b['unitCost'], reason: b['reason'] });
      return {};
    }
    if (p === '/api/v1/qr-codes') {
      if (method === 'GET') return this.page(this.qrs, q, (r) => r['targetId'] === q.get('targetId'));
      this.qrs.push({ id: this.id('qr'), targetId: b['targetId'] });
      return {};
    }
    if (p === '/api/v1/customers') {
      if (method === 'GET') return this.page(this.customers, q);
      // Like CustomersService.create: names are standardised, displayName is derived "first last", tax id is unique per tenant (409).
      if (this.customers.some((x) => x['taxId'] === b['taxId'])) throw new Error('POST /api/v1/customers -> 409: A customer with this tax id already exists in this tenant.');
      const first = standardizeName(b['firstName'] as string);
      const last = standardizeName(b['lastName'] as string);
      const c: Rec = { id: this.id('cus'), type: b['type'], firstName: first, lastName: last, displayName: `${first} ${last}`, taxId: b['taxId'], email: b['email'], phone: b['phone'], address: b['address'] };
      this.customers.push(c);
      return c;
    }
    if (m(/^\/api\/v1\/customers\/[^/]+$/) && method === 'PATCH') return {};
    if (p === '/api/v1/cart') {
      this.openCartRec ??= { id: this.id('cart'), status: 'open', locationId: b['locationId'], customerId: b['customerId'], items: [] };
      return this.openCartRec;
    }
    if (p === '/api/v1/cart/items') {
      const variant = this.variants.find((v) => v.id === b['productVariantId']);
      this.cart.push({ id: this.id('ci'), sku: variant?.['sku'], quantity: b['quantity'], unitPrice: Number(variant?.['basePrice'] ?? 0) });
      return {};
    }
    if (p === '/api/v1/orders') {
      if (method === 'GET') return this.page(this.orders, q, (o) => !q.has('customerId') || o['customerId'] === q.get('customerId'));
      const customerId = this.openCartRec?.['customerId'];
      const total = Math.round(this.cart.reduce((sum, i) => sum + Number(i['quantity']) * Number(i['unitPrice']), 0) * 100) / 100;
      const o: Rec = { id: this.id('ord'), status: 'pending', customerId, total, items: this.cart.map((i) => ({ id: i.id, sku: i['sku'] })) };
      this.orders.push(o);
      this.openCartRec = undefined; // checkout closes the cart
      return o;
    }
    mm = m(/^\/api\/v1\/orders\/([^/]+)\/(confirm|cancel)$/);
    if (mm) {
      const o = this.orders.find((r) => r.id === mm?.[1]);
      if (o && mm[2] === 'confirm' && o['status'] === 'pending') {
        // OrdersService.confirm: the payments must add up to the order total exactly (roundMoney(sum) !== total -> 400).
        const paid = Math.round(((b['payments'] as Array<{ amount: number }>).reduce((sum, x) => sum + x.amount, 0) + Number.EPSILON) * 100) / 100;
        if (paid !== o['total']) throw new Error(`POST ${rawPath} -> 400: The sum of payments (${paid.toFixed(2)}) must equal the order total (${String(o['total'])}).`);
        o['payments'] = b['payments'];
      }
      if (o) o['status'] = mm[2] === 'confirm' ? 'confirmed' : 'cancelled';
      return o;
    }
    if (p === '/api/v1/sales-returns') return { id: this.id('ret'), items: [{ id: this.id('ri') }] };
    if (m(/^\/api\/v1\/sales-returns\/[^/]+\/(inspect|resolve)$/)) return {};
    if (p === '/api/v1/inventory/transfers') {
      if (method === 'GET') return this.page(this.transfers, q);
      // TransfersService: draft -> approved -> preparing -> dispatched -> partially_received | received; a gate the tenant turned off is passed at creation.
      let status = 'draft';
      if (this.workflow.requireApproval === false) status = 'approved';
      if (status === 'approved' && this.workflow.requirePreparation === false) status = 'preparing';
      const lines = (b['items'] as Array<{ quantityRequested: number }>).map((i) => ({ id: this.id('ti'), quantityRequested: i.quantityRequested, quantityDispatched: 0, quantityReceived: 0 }));
      const t: Rec = { id: this.id('trf'), notes: b['notes'], status, items: lines };
      this.transfers.push(t);
      return t;
    }
    mm = m(/^\/api\/v1\/inventory\/transfers\/([^/]+)\/(approve|prepare|dispatch|receive)$/);
    if (mm) {
      const tr = this.transfers.find((r) => r.id === mm?.[1]);
      if (!tr) throw new Error(`POST ${rawPath} -> 404: Transfer not found.`);
      const action = mm[2];
      const lines = tr['items'] as Array<{ id: string; quantityRequested: number; quantityDispatched: number; quantityReceived: number }>;
      const need = (...allowed: string[]): void => {
        if (!allowed.includes(String(tr['status']))) throw new Error(`POST ${rawPath} -> 409: Transfer must be "${allowed.join('" or "')}" to ${String(action)} (currently "${String(tr['status'])}").`);
      };
      if (action === 'approve') { need('draft'); tr['status'] = 'approved'; }
      if (action === 'prepare') { need('approved'); tr['status'] = 'preparing'; }
      if (action === 'dispatch') { need('preparing'); for (const l of lines) l.quantityDispatched = l.quantityRequested; tr['status'] = 'dispatched'; }
      if (action === 'receive') {
        need('dispatched', 'partially_received');
        for (const line of b['items'] as Array<{ transferItemId: string; quantityReceived: number }>) {
          const item = lines.find((l) => l.id === line.transferItemId);
          if (!item) throw new Error(`POST ${rawPath} -> 404: Transfer item ${line.transferItemId} not found on this transfer.`);
          if (line.quantityReceived > item.quantityDispatched - item.quantityReceived) throw new Error(`POST ${rawPath} -> 400: Cannot receive ${String(line.quantityReceived)} for item ${item.id}.`);
          item.quantityReceived += line.quantityReceived;
        }
        tr['status'] = lines.every((l) => l.quantityReceived === l.quantityDispatched) ? 'received' : 'partially_received';
      }
      return { id: tr.id, status: tr['status'], items: lines };
    }
    throw new Error(`FakeTenantApi: unrouted ${method} ${rawPath}`);
  }) as ApiFn;

  readonly upload = (productId: string): Promise<void> => {
    this.uploads.push(productId);
    this.imageCount.set(productId, (this.imageCount.get(productId) ?? 0) + 1);
    return Promise.resolve();
  };
}

const cfg = (mode: SeedMode, over: Partial<SeedConfig> = {}): SeedConfig => ({ mode, yes: mode !== 'check', tenantSlug: 'qa-dev-tenant', apiBase: 'http://127.0.0.1:4000', ...over });
const run = (fake: FakeTenantApi, config: SeedConfig) =>
  runQaSeed({ api: fake.api, login: fake.loginFn, uploadImage: fake.upload, config, log: () => undefined });
const refusal = (re?: RegExp) => (e: unknown): boolean => e instanceof SeedGuardError && (re === undefined || re.test(e.message));

async function seeded(): Promise<FakeTenantApi> {
  const fake = new FakeTenantApi();
  await run(fake, cfg('create'));
  return fake;
}

describe('configuration: explicit tenant, loopback API, confirmation', () => {
  it('1. refuses to run without QA_SEED_TENANT_SLUG, with no fallback to qa-tenant or anything else', () => {
    assert.throws(() => resolveSeedConfig({}, parseSeedArgs(['--yes'])), refusal(/QA_SEED_TENANT_SLUG/));
    assert.throws(() => resolveSeedConfig({ QA_SEED_TENANT_SLUG: '  ' }, parseSeedArgs(['--check'])), refusal(/QA_SEED_TENANT_SLUG/));
    assert.throws(() => resolveSeedConfig({ QA_SEED_TENANT_SLUG: 'Not A Slug!' }, parseSeedArgs(['--check'])), SeedGuardError);
    assert.equal(resolveSeedConfig({ QA_SEED_TENANT_SLUG: 'qa-dev-tenant' }, parseSeedArgs(['--check'])).tenantSlug, 'qa-dev-tenant');
  });
  it('6. rejects every non-loopback API URL, however it is spelled, and accepts only 127.0.0.1 / localhost', () => {
    for (const bad of ['http://example.com', 'https://api.prod.example', 'http://10.0.0.5:4000', 'http://127.0.0.1.evil.com', 'http://localhost@evil.com', 'http://user:pw@127.0.0.1', 'ftp://127.0.0.1', 'not a url', 'http://192.168.1.10:4000']) {
      assert.throws(() => assertLoopbackApi(bad), SeedGuardError, bad);
      assert.throws(() => resolveSeedConfig({ QA_SEED_TENANT_SLUG: 'qa-dev-tenant', QA_SEED_API_URL: bad }, parseSeedArgs(['--check'])), SeedGuardError, bad);
    }
    assert.equal(resolveSeedConfig({ QA_SEED_TENANT_SLUG: 'qa-dev-tenant' }, parseSeedArgs(['--check'])).apiBase, 'http://127.0.0.1:4000');
    assert.equal(resolveSeedConfig({ QA_SEED_TENANT_SLUG: 'qa-dev-tenant', QA_SEED_API_URL: 'http://localhost:4100' }, parseSeedArgs(['--check'])).apiBase, 'http://localhost:4100');
  });
  it('8. a writing run without --yes is refused; --check needs no confirmation and rejects --yes', () => {
    const env = { QA_SEED_TENANT_SLUG: 'qa-dev-tenant' };
    assert.throws(() => resolveSeedConfig(env, parseSeedArgs([])), refusal(/--yes/));
    assert.throws(() => resolveSeedConfig(env, parseSeedArgs(['--create'])), refusal(/--yes/));
    assert.doesNotThrow(() => resolveSeedConfig(env, parseSeedArgs(['--yes'])));
    assert.doesNotThrow(() => resolveSeedConfig(env, parseSeedArgs(['--create', '--yes'])));
    assert.doesNotThrow(() => resolveSeedConfig(env, parseSeedArgs(['--check'])));
    assert.throws(() => parseSeedArgs(['--check', '--yes']), SeedGuardError);
  });
  it('parses the flags strictly', () => {
    assert.deepEqual(parseSeedArgs([]), { mode: 'normal', yes: false });
    assert.deepEqual(parseSeedArgs(['--create', '--yes']), { mode: 'create', yes: true });
    assert.throws(() => parseSeedArgs(['--check', '--create']), SeedGuardError);
    assert.throws(() => parseSeedArgs(['--repair']), SeedGuardError);
    assert.throws(() => parseSeedArgs(['--force']), SeedGuardError);
    assert.deepEqual(parseSeedArgs(['--', '--check']), { mode: 'check', yes: false }); // pnpm forwards a bare --
  });
});

describe('session and tenant verification (nothing is written before it passes)', () => {
  it('2. rejects a session whose tenant slug differs from the requested one, before any API call', async () => {
    const fake = new FakeTenantApi();
    fake.login = { status: 'authenticated', user: { tenantSlug: 'muebleria-elegante', status: 'active' } };
    await assert.rejects(run(fake, cfg('normal')), refusal(/not to the requested/));
    assert.equal(fake.authWrites(), 1);
    assert.equal(fake.dataCalls().length, 0); // not even a GET after the mismatching login
    assert.equal(fake.writes(), 0);
  });
  it('2b. rejects when GET /tenant reports another slug', async () => {
    const fake = new FakeTenantApi();
    fake.slug = 'qa-dev-tenant-3d3920';
    await assert.rejects(run(fake, cfg('normal')), refusal(/not "qa-dev-tenant"/));
    assert.equal(fake.writes(), 0);
  });
  it('3. rejects a suspended tenant and never reactivates it', async () => {
    const fake = new FakeTenantApi();
    fake.status = 'suspended';
    await assert.rejects(run(fake, cfg('normal')), refusal(/not active/));
    assert.equal(fake.writes(), 0);
    assert.equal(fake.calls.some((c) => /suspend|activate/i.test(c.path)), false);
  });
  it('4. rejects when the login yields no session (inactive membership / suspended tenant)', async () => {
    const fake = new FakeTenantApi();
    fake.login = { status: 'invalid' };
    await assert.rejects(run(fake, cfg('normal')), refusal(/did not produce a session/));
    assert.equal(fake.writes(), 0);
    fake.login = { status: 'authenticated' };
    await assert.rejects(run(fake, cfg('normal')), SeedGuardError);
  });
  it('4b. rejects an inactive QA user', async () => {
    const fake = new FakeTenantApi();
    fake.login = { status: 'authenticated', user: { tenantSlug: 'qa-dev-tenant', status: 'disabled' } };
    await assert.rejects(run(fake, cfg('normal')), refusal(/not active/));
  });
  it('5. rejects an ambiguous login (several active memberships) and never chooses a tenant', async () => {
    const fake = new FakeTenantApi();
    fake.login = { status: 'tenant_selection_required', availableTenants: [{}, {}] };
    await assert.rejects(run(fake, cfg('normal')), refusal(/more than one active membership/));
    assert.equal(fake.authWrites(), 1);
    assert.equal(fake.dataCalls().length, 0);
    assert.equal(fake.calls.some((c) => c.path.includes('select-tenant')), false);
  });
  it('the seed never calls registration, identity, membership, password or platform endpoints', async () => {
    const fake = await seeded();
    await run(fake, cfg('normal'));
    assert.equal(fake.calls.some((c) => /auth\/register|\/platform\/|\/users|identit|membership|password/i.test(c.path)), false);
  });
});

describe('modes', () => {
  it('7. --check writes no seed data: the login is the only POST (a technical write), everything after it is a GET — empty and populated tenant', async () => {
    const empty = new FakeTenantApi();
    await run(empty, cfg('check'));
    assert.equal(empty.authWrites(), 1, 'the login is recorded: it creates a session and updates last-login metadata');
    assert.equal(empty.writes(), 0, 'zero seed-data writes');
    assert.deepEqual(empty.dataCalls().filter((c) => c.method !== 'GET'), []);
    assert.equal(empty.uploads.length, 0);
    assert.equal(empty.calls[0]?.path, LOGIN_PATH, 'the login comes first');

    const full = await seeded();
    const authBefore = full.authWrites();
    const before = full.calls.length;
    const uploadsBefore = full.uploads.length;
    await run(full, cfg('check'));
    const during = full.calls.slice(before);
    assert.equal(full.authWrites() - authBefore, 1);
    assert.deepEqual(during.filter((c) => c.method !== 'GET' && c.path !== LOGIN_PATH), [], 'no create, update or delete of any seed resource');
    assert.ok(during.some((c) => c.method === 'GET'), 'the inspection really read something');
    assert.equal(full.uploads.length, uploadsBefore, 'no upload');
  });
  it('7b. guardApi refuses any non-GET call in read-only mode, even if a future edit tries one', async () => {
    const fake = new FakeTenantApi();
    const ro = guardApi(fake.api, false);
    await assert.rejects(async () => ro('POST', '/api/v1/warehouses', {}), refusal(/read-only/));
    await assert.rejects(async () => ro('PATCH', '/api/v1/customers/x', {}), SeedGuardError);
    await assert.rejects(async () => ro('DELETE', '/api/v1/products/x'), SeedGuardError);
    assert.equal(fake.calls.length, 0);
  });
  it('9. --create refuses a tenant that has any operational data, before writing', async () => {
    for (const mutate of [
      (f: FakeTenantApi) => f.products.push({ id: 'p' }),
      (f: FakeTenantApi) => f.warehouses.push({ id: 'w' }),
      (f: FakeTenantApi) => f.customers.push({ id: 'c' }),
      (f: FakeTenantApi) => f.orders.push({ id: 'o' }),
      (f: FakeTenantApi) => f.movements.push({ id: 'm' }),
    ]) {
      const fake = new FakeTenantApi();
      mutate(fake);
      await assert.rejects(run(fake, cfg('create')), refusal(/--create refused/));
      assert.equal(fake.writes(), 0);
    }
  });
  it('--create builds the dataset in an empty tenant and writes only creates (no PATCH on customers, no DELETE)', async () => {
    const fake = new FakeTenantApi();
    const result = await run(fake, cfg('create'));
    assert.equal(fake.products.length, 6);
    assert.equal(fake.variants.length, 7);
    assert.equal(fake.customers.length, 2);
    assert.equal(fake.orders.length, 3);
    assert.equal(fake.transfers.length, 2);
    assert.equal(fake.uploads.length, 6);
    assert.equal(fake.calls.filter((c) => c.method === 'DELETE').length, 0);
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH' && c.path.includes('/customers/')).length, 0);
    assert.equal(result.created['stock receipts'], 6);
    assert.ok(fake.movements.every((m) => m['reason'] === QA_SEED_MARKERS.stockReason));
    assert.deepEqual(fake.transfers.map((t) => t['notes']), [...QA_SEED_MARKERS.transferNotes]);
  });
});

describe('idempotence and existing data', () => {
  it('10. repeating the seed duplicates nothing: zero writes, zero uploads, identical record counts', async () => {
    const fake = await seeded();
    const counts = () => [fake.warehouses.length, fake.locations.length, fake.categories.length, fake.products.length, fake.variants.length, fake.movements.length, fake.qrs.length, fake.customers.length, fake.orders.length, fake.transfers.length, fake.uploads.length];
    const before = counts();
    const callsBefore = fake.calls.length;
    const second = await run(fake, cfg('normal'));
    assert.deepEqual(counts(), before);
    assert.equal(fake.calls.slice(callsBefore).filter((c) => c.method !== 'GET' && c.path !== LOGIN_PATH).length, 0);
    assert.deepEqual(second.created, {});
    await run(fake, cfg('normal'));
    assert.deepEqual(counts(), before);
    // and --create is now refused: the tenant is no longer empty
    await assert.rejects(run(fake, cfg('create')), refusal(/--create refused/));
  });
  it('recognises the stock written by the first version of the seed (legacy reason) and does not add a second RECEIPT', async () => {
    const fake = await seeded();
    for (const m of fake.movements) m['reason'] = QA_SEED_MARKERS.legacyStockReason;
    const before = fake.movements.length;
    await run(fake, cfg('normal'));
    assert.equal(fake.movements.length, before);
  });
  it('recognises the transfers written by the first version of the seed (legacy notes)', async () => {
    const fake = await seeded();
    fake.transfers.forEach((t, i) => (t['notes'] = QA_SEED_MARKERS.legacyTransferNotes[i]));
    await run(fake, cfg('normal'));
    assert.equal(fake.transfers.length, 2);
  });
  it('does not insert an image into a product that already has one, and uploads only where none exists', async () => {
    const fake = await seeded();
    const first = fake.products[0]?.id as string;
    const second = fake.products[1]?.id as string;
    fake.imageCount.set(second, 0);
    fake.uploads = [];
    await run(fake, cfg('normal'));
    assert.deepEqual(fake.uploads, [second]);
    assert.equal(fake.imageCount.get(first), 1);
  });
  it('11. an existing customer is never overwritten: no PATCH, its own data (a different e-mail) is kept', async () => {
    const fake = new FakeTenantApi();
    fake.customers.push({ id: 'cus-existing', displayName: 'Juan Pérez', taxId: '1710000001', phone: '0990000000', email: 'otro@correo.example', address: 'Su calle, Cuenca' });
    await run(fake, cfg('normal'));
    const juan = fake.customers.find((c) => c.id === 'cus-existing');
    assert.equal(juan?.['email'], 'otro@correo.example');
    assert.equal(juan?.['phone'], '0990000000');
    assert.equal(fake.customers.length, 2);
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH' && c.path.includes('/customers/')).length, 0);
  });
  it('11b. a seed customer that exists without phone or address stops the run instead of being patched', async () => {
    const fake = new FakeTenantApi();
    fake.customers.push({ id: 'cus-x', displayName: 'Juan Pérez', taxId: '1710000001' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/no longer patches existing customers/));
    // (the products created earlier in the same run are activated with a PATCH; a customer never is)
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH' && c.path.includes('/customers/')).length, 0);
    assert.equal(fake.customers.length, 1);
    assert.equal(fake.orders.length, 0);
  });
  it('11c. a customer that matches only the tax id (or only the name) is ambiguous: the run stops, nothing is reused', async () => {
    const byTax = new FakeTenantApi();
    byTax.customers.push({ id: 'c1', displayName: 'Otra Persona', taxId: '1710000001', phone: '1', address: 'a' });
    await assert.rejects(run(byTax, cfg('normal')), refusal(/not the seed's/));
    const byName = new FakeTenantApi();
    byName.customers.push({ id: 'c2', displayName: 'Juan Pérez', taxId: '9999999999', phone: '1', address: 'a' });
    await assert.rejects(run(byName, cfg('normal')), refusal(/not the seed's/));
  });
  it('a warehouse with the seed code but another name is never reused', async () => {
    const fake = new FakeTenantApi();
    fake.warehouses.push({ id: 'w1', name: 'Bodega Real', code: 'SUC-PRIN' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/not the seed's/));
    assert.equal(fake.warehouses.length, 1);
    assert.equal(fake.writes(), 0);
  });
  it('existing orders of the seed customers are left alone and no order, cart or return is created', async () => {
    const fake = new FakeTenantApi();
    fake.customers.push({ id: 'cus-juan', displayName: 'Juan Pérez', taxId: '1710000001', phone: '1', address: 'a' });
    fake.orders.push({ id: 'ord-real', customerId: 'cus-juan', status: 'confirmed', items: [] });
    const result = await run(fake, cfg('normal'));
    assert.equal(fake.orders.length, 1);
    assert.equal(fake.calls.some((c) => c.path.startsWith('/api/v1/cart') || c.path.startsWith('/api/v1/sales-returns') || (c.path.startsWith('/api/v1/orders') && c.method !== 'GET')), false);
    assert.ok(result.skipped.includes('orders+returns'));
  });
});

describe('failure handling', () => {
  it('14. an error stops the run where it is: the original error surfaces, nothing after the failing call is requested, nothing is retried or repaired', async () => {
    const fake = new FakeTenantApi();
    fake.failOn = (method, path) => method === 'POST' && path === '/api/v1/inventory/adjustments';
    // the original error reaches the caller, unchanged and not turned into a success
    await assert.rejects(run(fake, cfg('normal')), /injected failure: POST \/api\/v1\/inventory\/adjustments/);
    // let any dangling work (a step that kept running after the rejection) show itself before measuring
    await new Promise((resolve) => setTimeout(resolve, 10));
    // the failing call is the last request ever made, and it was made once: no retry, no skipping ahead to the next stock line
    assert.equal(fake.calls.at(-1)?.path, '/api/v1/inventory/adjustments');
    assert.equal(fake.calls.filter((c) => c.path === '/api/v1/inventory/adjustments').length, 1);
    // none of the later steps (images, QR, customers, cart, orders, returns, transfers) was reached, and nothing was uploaded
    const later = /\/qr-codes|\/customers|\/cart|\/orders|\/sales-returns|\/inventory\/transfers|\/images/;
    assert.deepEqual(fake.calls.filter((c) => c.method !== 'GET' && later.test(c.path)), []);
    assert.equal(fake.uploads.length, 0);
    // no stock was recorded for the failed line, and no repair/compensation (DELETE, or a PATCH that is not the activation of a new product)
    assert.equal(fake.movements.length, 0);
    assert.equal(fake.calls.filter((c) => c.method === 'DELETE').length, 0);
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH' && !c.path.startsWith('/api/v1/products/')).length, 0);
    // what was created before the failure stays exactly as it was; the rest was never created
    assert.equal(fake.products.length, 6);
    assert.equal(fake.customers.length, 0);
    assert.equal(fake.orders.length, 0);
    assert.equal(fake.transfers.length, 0);
  });
  it('14a. the error message is controlled: it carries the request line, never the QA password or a session cookie', async () => {
    const fake = new FakeTenantApi();
    fake.failOn = (method, path) => method === 'POST' && path === '/api/v1/customers';
    await assert.rejects(run(fake, cfg('normal')), (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /POST \/api\/v1\/customers/);
      assert.equal(/password|cookie|authorization|csrf/i.test(message), false);
      return true;
    });
  });
  it('14b. after a partial failure the next normal run completes only what is missing', async () => {
    const fake = new FakeTenantApi();
    fake.failOn = (method, path) => method === 'POST' && path === '/api/v1/customers';
    await assert.rejects(run(fake, cfg('normal')), /injected failure/);
    const products = fake.products.length;
    fake.failOn = undefined;
    await run(fake, cfg('normal'));
    assert.equal(fake.products.length, products);
    assert.equal(fake.customers.length, 2);
    assert.equal(fake.orders.length, 3);
  });
});

describe('B1 - no upload outside a writing run', () => {
  it('guardUpload refuses in read-only mode without calling the upload, and passes through in a writing run', async () => {
    let calls = 0;
    const upload = (): Promise<void> => {
      calls += 1;
      return Promise.resolve();
    };
    assert.throws(() => guardUpload(upload, false)('p1'), refusal(/read-only/));
    assert.equal(calls, 0);
    await guardUpload(upload, true)('p1');
    assert.equal(calls, 1);
  });
  it('--check never uploads, even in a tenant whose products have no image (the case that would upload in a normal run)', async () => {
    const fake = await seeded();
    fake.imageCount.clear();
    fake.uploads = [];
    const writesBefore = fake.writes();
    await run(fake, cfg('check'));
    assert.equal(fake.uploads.length, 0);
    assert.equal(fake.writes(), writesBefore, 'the check added no write at all');
  });
  it('a refusal before the writes (wrong tenant, incomplete order visibility) produces no upload', async () => {
    const wrongTenant = new FakeTenantApi();
    wrongTenant.slug = 'otro';
    await assert.rejects(run(wrongTenant, cfg('normal')), SeedGuardError);
    const noPermission = new FakeTenantApi();
    noPermission.login = { status: 'authenticated', user: { tenantSlug: 'qa-dev-tenant', status: 'active', permissions: [] } };
    await assert.rejects(run(noPermission, cfg('normal')), SeedGuardError);
    assert.equal(wrongTenant.uploads.length + noPermission.uploads.length, 0);
  });
  it('a writing run still uploads exactly one image per product that has none', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    assert.equal(fake.uploads.length, 6);
  });
});

describe('B4 - a category is the seed own only if it carries the seed code', () => {
  const FERR = { name: 'Ferretería', code: 'QA-SEED-FERRETERIA' };
  it('creates the categories with the reserved codes when none exists', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('normal'));
    assert.deepEqual(fake.categories.map((c) => c['code']).sort(), ['QA-SEED-ELECTRONICA', 'QA-SEED-FERRETERIA']);
  });
  it('reuses a category the seed created earlier (stored name is uppercase, code is the seed code) and creates no duplicate', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'cat-own', name: 'FERRETERÍA', code: FERR.code }, { id: 'cat-own2', name: 'ELECTRÓNICA', code: 'QA-SEED-ELECTRONICA' });
    await run(fake, cfg('normal'));
    assert.equal(fake.categories.length, 2);
  });
  it('a repeated run does not duplicate the seed categories', async () => {
    const fake = await seeded();
    const before = fake.categories.length;
    await run(fake, cfg('normal'));
    await run(fake, cfg('normal'));
    assert.equal(fake.categories.length, before);
  });
  it('stops on a category with the same name but another code (automatic or hand-made): not provably the seed, nothing is written', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'cat-real', name: 'FERRETERÍA', code: 'CAT-001' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/not provably the seed's/));
    assert.equal(fake.categories.length, 1);
    assert.equal(fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/categories').length, 0);
    assert.equal(fake.products.length, 0);
  });
  it('stops on a category that holds the seed code but another name', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'cat-x', name: 'ALGO DISTINTO', code: 'QA-SEED-FERRETERIA' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/not provably the seed's/));
    assert.equal(fake.categories.length, 1);
  });
  it('stops when several categories match (name on one, code on another)', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'a', name: 'FERRETERÍA', code: 'CAT-001' }, { id: 'b', name: 'OTRA', code: 'QA-SEED-FERRETERIA' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/more than one existing record/));
  });
  it('stops on an incomplete list: a category without a code (or a name) could be hiding the seed code', async () => {
    for (const broken of [{ id: 'a', name: 'FERRETERÍA' }, { id: 'b', code: 'QA-SEED-FERRETERIA' }]) {
      const fake = new FakeTenantApi();
      fake.categories.push(broken);
      await assert.rejects(run(fake, cfg('normal')), refusal(/ownership cannot be proven/));
      assert.equal(fake.categories.length, 1, 'no category was created');
      assert.equal(fake.products.length, 0);
    }
  });
  it('stops if the created category does not echo the seed code', async () => {
    const fake = new FakeTenantApi();
    const original = fake.api;
    const lying: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
      const result = await original(method, path, body, opts);
      return method === 'POST' && path === '/api/v1/categories' ? { id: (result as Rec).id } : result;
    }) as ApiFn;
    await assert.rejects(runQaSeed({ api: lying, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), refusal(/does not echo the seed code/));
  });
  it('--check applies the same ownership rule and writes nothing', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'cat-real', name: 'FERRETERÍA', code: 'CAT-001' });
    await assert.rejects(run(fake, cfg('check')), refusal(/not provably the seed's/));
    assert.equal(fake.writes(), 0);
  });
});

describe('B5 - the order list must be provably complete before the seed reasons about orders', () => {
  const noOrdersCreated = (fake: FakeTenantApi): void => {
    assert.equal(fake.writes(), 0, 'no write of any kind');
    assert.equal(fake.calls.some((c) => c.path.startsWith('/api/v1/cart') || (c.path.startsWith('/api/v1/orders') && c.method !== 'GET')), false);
  };
  it('proceeds (and creates the orders once) only with sales.orders.view_all and an unrestricted scope', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('normal'));
    assert.equal(fake.orders.length, 3);
  });
  it('a seller without sales.orders.view_all: GET /orders would show only their own orders, so stop before ANY write', async () => {
    const fake = new FakeTenantApi();
    fake.login = { status: 'authenticated', user: { tenantSlug: 'qa-dev-tenant', status: 'active', permissions: ['sales.orders.view', 'sales.orders.create'] } };
    await assert.rejects(run(fake, cfg('normal')), refusal(/sales\.orders\.view_all/));
    noOrdersCreated(fake);
    assert.equal(fake.orders.length, 0);
  });
  it('permissions missing from the session: stop', async () => {
    const fake = new FakeTenantApi();
    fake.login = { status: 'authenticated', user: { tenantSlug: 'qa-dev-tenant', status: 'active' } };
    await assert.rejects(run(fake, cfg('normal')), refusal(/did not report its permissions/));
    noOrdersCreated(fake);
  });
  it('restricted to some locations: GET /orders omits the others, so stop', async () => {
    const fake = new FakeTenantApi();
    fake.scope = { unrestricted: false, locationIds: ['loc-1'] };
    await assert.rejects(run(fake, cfg('normal')), refusal(/restricted to some locations/));
    noOrdersCreated(fake);
  });
  it('a malformed or partial scope answer: stop', async () => {
    for (const scope of [undefined, null, {}, { unrestricted: 'yes' }, 'ok']) {
      const fake = new FakeTenantApi();
      fake.scope = scope;
      await assert.rejects(run(fake, cfg('normal')), SeedGuardError);
      noOrdersCreated(fake);
    }
  });
  it('403 / failure of the scope request: stop with a generic message that repeats nothing from the response', async () => {
    const fake = new FakeTenantApi();
    fake.scopeError = '403: secret-looking-detail';
    await assert.rejects(run(fake, cfg('normal')), (error: unknown) => error instanceof SeedGuardError && /could not be read/.test(error.message) && !/secret-looking-detail|403/.test(error.message));
    noOrdersCreated(fake);
  });
  it('a list without meta.total is incomplete: stop (an empty-looking list is never taken as "no orders")', async () => {
    const fake = new FakeTenantApi();
    fake.listFault = { prefix: '/api/v1/orders', kind: 'no-meta' };
    await assert.rejects(run(fake, cfg('normal')), refusal(/cannot be trusted to be complete/));
    assert.equal(fake.orders.length, 0);
    assert.equal(fake.calls.some((c) => c.path.startsWith('/api/v1/cart')), false);
  });
  it('a paginated list that returns fewer rows than it declares is incomplete: stop', async () => {
    const fake = new FakeTenantApi();
    fake.listFault = { prefix: '/api/v1/warehouses', kind: 'short' };
    await assert.rejects(run(fake, cfg('normal')), refusal(/records received/));
  });
  it('a list that returns more rows than it declares is ambiguous: stop', async () => {
    const fake = new FakeTenantApi();
    fake.warehouses.push({ id: 'w', name: 'X', code: 'X' });
    fake.listFault = { prefix: '/api/v1/warehouses', kind: 'overflow' };
    await assert.rejects(run(fake, cfg('normal')), refusal(/records received/));
  });
  it('rows that belong to another customer (the filter was ignored) are ambiguous: stop, no order is created', async () => {
    const fake = new FakeTenantApi();
    const original = fake.api;
    const ignoring: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
      if (method === 'GET' && path.startsWith('/api/v1/orders?customerId=')) return { data: [{ id: 'o', customerId: 'someone-else' }], meta: { total: 1, totalPages: 1 } };
      return original(method, path, body, opts);
    }) as ApiFn;
    await assert.rejects(runQaSeed({ api: ignoring, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), refusal(/filter was not honoured/));
    assert.equal(fake.orders.length, 0);
  });
  it('earlier orders of the seed customers are found (complete list) and nothing is duplicated; repeating the run adds none', async () => {
    const fake = await seeded();
    const ordersBefore = fake.orders.length;
    await run(fake, cfg('normal'));
    await run(fake, cfg('normal'));
    assert.equal(fake.orders.length, ordersBefore);
  });
  it('--create also needs a complete order list before it claims the tenant has no orders', async () => {
    const fake = new FakeTenantApi();
    fake.login = { status: 'authenticated', user: { tenantSlug: 'qa-dev-tenant', status: 'active', permissions: [] } };
    await assert.rejects(run(fake, cfg('create')), refusal(/sales\.orders\.view_all/));
    noOrdersCreated(fake);
  });
  it('--check does not refuse but reports that the orders are NOT VERIFIABLE, and writes nothing', async () => {
    const fake = new FakeTenantApi();
    fake.scope = { unrestricted: false, locationIds: [] };
    const lines: string[] = [];
    await runQaSeed({ api: fake.api, login: fake.loginFn, uploadImage: fake.upload, config: cfg('check'), log: (l) => lines.push(l) });
    assert.ok(lines.some((l) => /NOT VERIFIABLE/.test(l)));
    assert.equal(fake.writes(), 0);
  });
  it('assertOrderListIsComplete: the pure rule', () => {
    assert.doesNotThrow(() => assertOrderListIsComplete(['sales.orders.view_all'], { unrestricted: true }));
    assert.throws(() => assertOrderListIsComplete(undefined, { unrestricted: true }), SeedGuardError);
    assert.throws(() => assertOrderListIsComplete([], { unrestricted: true }), SeedGuardError);
    assert.throws(() => assertOrderListIsComplete(['sales.orders.view_all'], { unrestricted: false }), SeedGuardError);
    assert.throws(() => assertOrderListIsComplete(['sales.orders.view_all'], undefined), SeedGuardError);
  });
});

describe('B4.6 - products are identified by SKU, through the backend normalisation', () => {
  const productPosts = (fake: FakeTenantApi): number => fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/products').length;
  const variantPosts = (fake: FakeTenantApi): number => fake.calls.filter((c) => c.method === 'POST' && /\/products\/[^/]+\/variants$/.test(c.path)).length;
  const seedCategory = (fake: FakeTenantApi, key: 'FERRETERÍA' | 'ELECTRÓNICA'): Rec => fake.categories.find((c) => c['name'] === key) as Rec;

  it('the fake applies the real normalisation: names are stored uppercase', async () => {
    const fake = await seeded();
    assert.ok(fake.products.length > 0);
    assert.ok(fake.products.every((p) => p['name'] === upperName(p['name'] as string)));
    assert.ok(fake.products.some((p) => p['name'] === 'TALADRO INALÁMBRICO 20V'));
  });
  it('1. first run creates the six products, each exactly once, with the seed category and prices', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('normal'));
    assert.equal(productPosts(fake), 6);
    assert.equal(fake.products.length, 6);
    const taladro = fake.products.find((p) => p['name'] === 'TALADRO INALÁMBRICO 20V') as Rec;
    assert.equal(taladro['categoryId'], seedCategory(fake, 'FERRETERÍA').id);
    const variant = fake.variants.find((v) => v['productId'] === taladro.id) as Rec;
    assert.deepEqual([variant['sku'], variant['maxPrice'], variant['basePrice'], variant['minPrice'], variant['cost']], ['TAL-20V-001', 150, 120, 100, 70]);
  });
  it('2 and 3. the second run recognises every product despite the uppercase names: no POST of a product or variant at all, SKU-based queries', async () => {
    const fake = await seeded();
    const before = fake.calls.length;
    const second = await run(fake, cfg('normal'));
    const during = fake.calls.slice(before);
    assert.equal(fake.products.length, 6);
    assert.equal(fake.variants.length, 7);
    assert.equal(during.filter((c) => c.method === 'POST' && c.path.startsWith('/api/v1/products')).length, 0);
    assert.equal(during.filter((c) => c.method === 'PATCH').length, 0, 'no PATCH either: nothing is re-activated');
    assert.deepEqual(second.created, {});
    // the lookups really were by SKU (and by name), through the backend's own search
    const queries = during.filter((c) => c.path.startsWith('/api/v1/products?q=')).map((c) => decodeURIComponent(c.path));
    assert.ok(queries.some((q) => q.includes('q=TAL-20V-001')));
    assert.ok(queries.some((q) => q.includes('q=TALADRO INALÁMBRICO 20V')), 'the name as the backend stores it');
    assert.ok(queries.some((q) => q.includes('q=Inal')) === false, 'no accented fragment is searched alone');
    assert.ok(queries.some((q) => q.includes('q=Taladro')), 'and its longest plain-ASCII word');
  });
  it('3b. the old exact-case comparison would NOT have recognised them (this is the defect): the stored name differs from the seed text', async () => {
    const fake = await seeded();
    assert.equal(fake.products.some((p) => p['name'] === 'Taladro Inalámbrico 20V'), false);
  });
  it('3c. a backend that did not change case would work too (the seed does not depend on the transformation being applied)', async () => {
    const fake = new FakeTenantApi();
    fake.productName = (name) => name;
    await run(fake, cfg('normal'));
    const before = fake.products.length;
    await run(fake, cfg('normal'));
    assert.equal(fake.products.length, before);
  });
  it('4. an existing SKU with compatible attributes is reused (and nothing is created or modified)', async () => {
    const fake = new FakeTenantApi();
    const cat = { id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' };
    fake.categories.push(cat, { id: 'cat-e', name: 'ELECTRÓNICA', code: 'QA-SEED-ELECTRONICA' });
    fake.products.push({ id: 'p-casco', name: 'CASCO DE SEGURIDAD', categoryId: 'cat-f' });
    fake.variants.push({ id: 'v-casco', productId: 'p-casco', sku: 'CASCO-001', maxPrice: '25.00', basePrice: '18.00', minPrice: '15.00', cost: '9.00', status: 'active' }); // numeric strings, as a decimal column would give
    await run(fake, cfg('normal'));
    assert.equal(fake.products.filter((p) => p['name'] === 'CASCO DE SEGURIDAD').length, 1);
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/products/p-casco').length, 0);
    assert.equal(fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/products' && (c.body as Rec)['name'] === 'Casco de Seguridad').length, 0);
  });
  it('5. an existing seed SKU with incompatible attributes stops the run before any product is written', async () => {
    for (const [what, mutate] of [
      ['price', (v: Rec) => (v['basePrice'] = 99)],
      ['max price', (v: Rec) => (v['maxPrice'] = 999)],
      ['cost', (v: Rec) => (v['cost'] = 1)],
    ] as const) {
      const fake = new FakeTenantApi();
      fake.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' }, { id: 'cat-e', name: 'ELECTRÓNICA', code: 'QA-SEED-ELECTRONICA' });
      fake.products.push({ id: 'p1', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-f' });
      const v: Rec = { id: 'v1', productId: 'p1', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120, minPrice: 100, cost: 70 };
      mutate(v);
      fake.variants.push(v);
      await assert.rejects(run(fake, cfg('normal')), refusal(/differs from the seed's product/), what);
      assert.equal(productPosts(fake), 0, what);
      assert.equal(fake.calls.filter((c) => c.method === 'PATCH').length, 0, what);
    }
  });
  it('5b. a seed SKU held by a product in another category (or whose category is not reported) is incompatible', async () => {
    for (const categoryId of ['cat-other', undefined]) {
      const fake = new FakeTenantApi();
      fake.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' }, { id: 'cat-e', name: 'ELECTRÓNICA', code: 'QA-SEED-ELECTRONICA' });
      fake.products.push({ id: 'p1', name: 'TALADRO INALÁMBRICO 20V', ...(categoryId ? { categoryId } : {}) });
      fake.variants.push({ id: 'v1', productId: 'p1', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120, minPrice: 100, cost: 70 });
      await assert.rejects(run(fake, cfg('normal')), refusal(/category/));
      assert.equal(productPosts(fake), 0);
    }
  });
  it('6. a product with the seed name but a different SKU is not the same product: it is not reused and no namesake is created', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
    fake.products.push({ id: 'p-real', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-f' });
    fake.variants.push({ id: 'v-real', productId: 'p-real', sku: 'OTRO-SKU', maxPrice: 1, basePrice: 1 });
    await assert.rejects(run(fake, cfg('normal')), refusal(/under another SKU/));
    assert.equal(fake.products.length, 1);
    assert.equal(productPosts(fake), 0);
  });
  it('7. the seed SKU on a product with another name is not accepted silently', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
    fake.products.push({ id: 'p-x', name: 'ALGO TOTALMENTE DISTINTO', categoryId: 'cat-f' });
    fake.variants.push({ id: 'v-x', productId: 'p-x', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120, minPrice: 100, cost: 70 });
    await assert.rejects(run(fake, cfg('normal')), refusal(/differs from the seed's product \(name\)/));
    assert.equal(productPosts(fake), 0);
  });
  it('7b. a SKU that differs only in letter case is ambiguous and stops the run', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
    fake.products.push({ id: 'p-l', name: 'OTRA COSA', categoryId: 'cat-f' });
    fake.variants.push({ id: 'v-l', productId: 'p-l', sku: 'tal-20v-001', maxPrice: 1, basePrice: 1 });
    await assert.rejects(run(fake, cfg('normal')), refusal(/differs only in letter case/));
    assert.equal(productPosts(fake), 0);
  });
  it('8. an ambiguous backend answer stops the run: two variants reporting the same SKU, or a variants answer that is not a list', async () => {
    const dup = new FakeTenantApi();
    dup.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
    dup.products.push({ id: 'p1', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-f' }, { id: 'p2', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-f' });
    dup.variants.push({ id: 'v1', productId: 'p1', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120 }, { id: 'v2', productId: 'p2', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120 });
    await assert.rejects(run(dup, cfg('normal')), refusal(/more than one variant reports it/));
    assert.equal(productPosts(dup), 0);

    const notAList = new FakeTenantApi();
    notAList.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
    notAList.products.push({ id: 'p1', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-f' });
    const original = notAList.api;
    const broken: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) =>
      method === 'GET' && /\/products\/p1\/variants$/.test(path) ? { data: [] } : original(method, path, body, opts)) as ApiFn;
    await assert.rejects(runQaSeed({ api: broken, login: notAList.loginFn, uploadImage: notAList.upload, config: cfg('normal'), log: () => undefined }), refusal(/variants answer is incomplete/));
    assert.equal(productPosts(notAList), 0);
  });
  it('8b. an incomplete answer is never judged: a variant without prices, a listed product without a name', async () => {
    const noPrice = new FakeTenantApi();
    noPrice.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
    noPrice.products.push({ id: 'p1', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-f' });
    noPrice.variants.push({ id: 'v1', productId: 'p1', sku: 'TAL-20V-001' });
    await assert.rejects(run(noPrice, cfg('normal')), refusal(/does not report maxPrice/));
    const noName = new FakeTenantApi();
    noName.products.push({ id: 'p9' });
    noName.variants.push({ id: 'v9', productId: 'p9', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120 }); // found through its SKU, but reports no name
    await assert.rejects(run(noName, cfg('normal')), refusal(/no id or name/));
    assert.equal(productPosts(noPrice) + productPosts(noName), 0);
  });
  it('9. a creation that comes back incomplete or with another name is not a success: the run stops before activating or stocking it', async () => {
    for (const lie of [(r: Rec) => ({ id: r.id }), (r: Rec) => ({ ...r, name: 'OTRO' }), () => ({})]) {
      const fake = new FakeTenantApi();
      const original = fake.api;
      const lying: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
        const result = await original(method, path, body, opts);
        return method === 'POST' && path === '/api/v1/products' ? lie(result as Rec) : result;
      }) as ApiFn;
      await assert.rejects(runQaSeed({ api: lying, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), refusal(/created record is incomplete/));
      assert.equal(fake.calls.filter((c) => c.method === 'PATCH').length, 0, 'not activated');
      assert.equal(fake.movements.length, 0);
    }
  });
  it('10. an error while identifying a product causes no write after it', async () => {
    const fake = new FakeTenantApi();
    fake.failOn = (method, path) => method === 'GET' && path.startsWith('/api/v1/products?q=');
    const writesBefore = (): number => fake.dataCalls().filter((c) => c.method !== 'GET').length;
    await assert.rejects(run(fake, cfg('normal')), /injected failure/);
    const atFailure = writesBefore();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fake.calls.at(-1)?.path.startsWith('/api/v1/products?q='), true, 'the failing lookup is the last request');
    assert.equal(writesBefore(), atFailure, 'nothing was written after it');
    assert.equal(fake.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/products'), false);
    assert.equal(fake.products.length, 0);
    assert.equal(fake.uploads.length, 0);
  });
  it('--check applies the same identification (present / refuses) and writes nothing', async () => {
    const full = await seeded();
    const lines: string[] = [];
    const writes = full.writes();
    await runQaSeed({ api: full.api, login: full.loginFn, uploadImage: full.upload, config: cfg('check'), log: (l) => lines.push(l) });
    assert.equal(full.writes(), writes);
    assert.equal(lines.filter((l) => /product .*: present/.test(l)).length, 6);
    const empty = new FakeTenantApi();
    const out: string[] = [];
    await runQaSeed({ api: empty.api, login: empty.loginFn, uploadImage: empty.upload, config: cfg('check'), log: (l) => out.push(l) });
    assert.equal(out.filter((l) => /product .*: missing/.test(l)).length, 6);
    const clash = new FakeTenantApi();
    clash.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
    clash.products.push({ id: 'p1', name: 'OTRO', categoryId: 'cat-f' });
    clash.variants.push({ id: 'v1', productId: 'p1', sku: 'CASCO-001', maxPrice: 25, basePrice: 18 });
    await assert.rejects(run(clash, cfg('check')), refusal(/differs from the seed's product/));
    assert.equal(clash.writes(), 0);
  });
  it('the second variant of the gloves is created once (SKU-based) and a repeat adds nothing', async () => {
    const fake = await seeded();
    assert.equal(variantPosts(fake), 1);
    await run(fake, cfg('normal'));
    assert.equal(variantPosts(fake), 1);
    assert.equal(fake.variants.filter((v) => v['sku'] === 'GUANTE-L').length, 1);
  });
});

describe('B4.7 - historical categories and products: described, never adopted', () => {
  const noCategoryWrites = (fake: FakeTenantApi): void => {
    assert.equal(fake.calls.filter((c) => c.path.startsWith('/api/v1/categories') && c.method !== 'GET').length, 0, 'no create, update, merge or delete of any category');
  };
  const cat = (id: string, name: string, code: string): Rec => ({ id, name, code });

  it('a historical category (automatic code) blocks the run, is described with id, code and name, and the message says what a person must do', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push(cat('cat-hist', 'FERRETERÍA', 'CAT-004'));
    await assert.rejects(run(fake, cfg('normal')), (error: unknown) => {
      assert.ok(error instanceof SeedGuardError);
      assert.match(error.message, /id cat-hist, code CAT-004, name "FERRETERÍA"/);
      assert.match(error.message, /QA-SEED-FERRETERIA/);
      assert.match(error.message, /Resolve it by hand/);
      return true;
    });
    noCategoryWrites(fake);
    assert.equal(fake.categories.length, 1);
  });
  it('a category with the seed name typed WITHOUT the accent is a near-namesake: it blocks, it is not ignored and no second category is created', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push(cat('cat-x', 'FERRETERIA', 'CAT-009'));
    await assert.rejects(run(fake, cfg('normal')), refusal(/not provably the seed's/));
    noCategoryWrites(fake);
  });
  it('a category made by a person that holds the reserved code with another name blocks and is never renamed', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push(cat('cat-user', 'HERRAMIENTAS DE MANO', 'QA-SEED-FERRETERIA'));
    await assert.rejects(run(fake, cfg('normal')), refusal(/id cat-user, code QA-SEED-FERRETERIA/));
    noCategoryWrites(fake);
    assert.equal(fake.categories[0]?.['name'], 'HERRAMIENTAS DE MANO');
  });
  it('two ambiguous records (one by name, one by code) are all listed and the run stops', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push(cat('a', 'FERRETERÍA', 'CAT-001'), cat('b', 'OTRA', 'QA-SEED-FERRETERIA'));
    await assert.rejects(run(fake, cfg('normal')), refusal(/id a, .*\| id b,/));
    noCategoryWrites(fake);
  });
  it('--check reports EVERY blocking record (category, product, customer) with what to do, then ends non-zero, writing nothing', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push(cat('cat-hist', 'ELECTRÓNICA', 'CAT-002'));
    fake.categories.push(cat('cat-ok', 'FERRETERÍA', 'QA-SEED-FERRETERIA'));
    fake.products.push({ id: 'p1', name: 'OTRO NOMBRE', categoryId: 'cat-ok' });
    fake.variants.push({ id: 'v1', productId: 'p1', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120 });
    fake.customers.push({ id: 'c1', displayName: 'Otra Persona', taxId: '1710000001', phone: '1', address: 'a' });
    const lines: string[] = [];
    const before = fake.writes();
    await assert.rejects(runQaSeed({ api: fake.api, login: fake.loginFn, uploadImage: fake.upload, config: cfg('check'), log: (l) => lines.push(l) }), (error: unknown) => {
      assert.ok(error instanceof SeedGuardError);
      assert.match(error.message, /found 3 record\(s\)/);
      assert.match(error.message, /category "Electrónica"/);
      assert.match(error.message, /SKU TAL-20V-001/);
      assert.match(error.message, /customer "Juan Pérez"/);
      return true;
    });
    assert.equal(lines.filter((l) => /BLOCKER/.test(l)).length, 3);
    assert.equal(fake.writes(), before);
  });

  it('a soft-deleted product keeps its SKU: the list hides it, the create answers 409, and the run stops with an explanation and no product', async () => {
    const fake = new FakeTenantApi();
    fake.hiddenSkus.add('TAL-20V-001');
    await assert.rejects(run(fake, cfg('normal')), refusal(/soft-deleted product keeps its SKU/));
    assert.equal(fake.products.length, 0);
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH').length, 0);
    assert.equal(fake.uploads.length, 0);
  });
  it('a product with the seed name and NO variants is a namesake under no SKU of ours: blocks, is not adopted', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push(cat('cat-f', 'FERRETERÍA', 'QA-SEED-FERRETERIA'));
    fake.products.push({ id: 'p-empty', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-f' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/under another SKU.*product p-empty/));
    assert.equal(fake.products.length, 1);
    assert.equal(fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/products').length, 0);
  });
  it('a historical product in a non-seed category that holds a seed SKU is described (product, variant, name) and not adopted', async () => {
    const fake = new FakeTenantApi();
    fake.categories.push(cat('cat-f', 'FERRETERÍA', 'QA-SEED-FERRETERIA'), cat('cat-e', 'ELECTRÓNICA', 'QA-SEED-ELECTRONICA'));
    fake.products.push({ id: 'p-hist', name: 'TALADRO INALÁMBRICO 20V', categoryId: 'cat-historic' });
    fake.variants.push({ id: 'v-hist', productId: 'p-hist', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120, minPrice: 100, cost: 70 });
    await assert.rejects(run(fake, cfg('normal')), refusal(/\(category\) — product p-hist, variant v-hist, name "TALADRO INALÁMBRICO 20V".*Resolve it by hand/));
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH' || c.method === 'DELETE').length, 0);
  });
});

describe('B4.7 - name search under the real ILIKE semantics (case-insensitive, never accent-insensitive)', () => {
  it('the fake reproduces the limitation: in a C locale an accented name does not match its uppercase stored form, in no locale does it match without the accent', () => {
    const fake = new FakeTenantApi();
    fake.searchLocale = 'C';
    assert.equal(fake.ilike('TALADRO INALÁMBRICO 20V', 'Taladro Inalámbrico 20V'), false, 'B4.6 searched this way: it missed the seed\'s own stored name');
    assert.equal(fake.ilike('TALADRO INALÁMBRICO 20V', 'TALADRO INALÁMBRICO 20V'), true, 'the stored form matches under any locale');
    assert.equal(fake.ilike('TALADRO INALÁMBRICO 20V', 'Taladro'), true, 'a plain-ASCII word matches');
    fake.searchLocale = 'unicode';
    assert.equal(fake.ilike('TALADRO INALÁMBRICO 20V', 'Taladro Inalámbrico 20V'), true);
    assert.equal(fake.ilike('TALADRO INALAMBRICO 20V', 'Inalámbrico'), false, 'accents are never ignored');
  });
  for (const locale of ['C', 'unicode'] as const) {
    it('[' + locale + '] a homonym typed without the accent under another SKU is found and blocks (the search does not depend on accent handling)', async () => {
      const fake = new FakeTenantApi();
      fake.searchLocale = locale;
      fake.categories.push({ id: 'cat-f', name: 'FERRETERÍA', code: 'QA-SEED-FERRETERIA' });
      fake.products.push({ id: 'p-noacc', name: 'TALADRO INALAMBRICO 20V', categoryId: 'cat-f' });
      fake.variants.push({ id: 'v-noacc', productId: 'p-noacc', sku: 'OTRO-SKU', maxPrice: 1, basePrice: 1 });
      await assert.rejects(run(fake, cfg('normal')), refusal(/same name without accents.*product p-noacc/));
      assert.equal(fake.products.length, 1);
    });
    it('[' + locale + '] the seed recognises its own accented products on a second run (by SKU) and writes no product', async () => {
      const fake = new FakeTenantApi();
      fake.searchLocale = locale;
      await run(fake, cfg('normal'));
      const products = fake.products.length;
      const before = fake.calls.length;
      await run(fake, cfg('normal'));
      assert.equal(fake.products.length, products);
      assert.equal(fake.calls.slice(before).filter((c) => c.method === 'POST' && c.path.startsWith('/api/v1/products')).length, 0);
    });
  }
  it('every seed product has a plain-ASCII word to search by, and each of the three queries is issued', async () => {
    const fake = await seeded();
    const before = fake.calls.length;
    await run(fake, cfg('normal'));
    const queries = fake.calls.slice(before).filter((c) => c.path.startsWith('/api/v1/products?q=')).map((c) => decodeURIComponent(c.path.split('?q=')[1]?.split('&')[0] ?? ''));
    for (const expected of ['TAL-20V-001', 'TALADRO INALÁMBRICO 20V', 'Taladro', 'MULTÍMETRO DIGITAL', 'Digital', 'GUANTES DE TRABAJO', 'CABLE UTP CAT6 (ROLLO 100M)']) {
      assert.ok(queries.includes(expected), 'missing query ' + expected);
    }
  });
});

describe('B4.7 - the open cart of the QA account (POST /cart returns the existing one)', () => {
  it('the fake reproduces the contract: a second POST /cart returns the same cart and ignores the body', async () => {
    const fake = new FakeTenantApi();
    const first = (await fake.api('POST', '/api/v1/cart', { locationId: UUID_A, customerId: UUID_B })) as Rec;
    const second = (await fake.api('POST', '/api/v1/cart', { locationId: UUID_C, customerId: UUID_D })) as Rec;
    assert.equal(first.id, second.id);
    assert.equal(second['customerId'], UUID_B);
  });
  it('a pre-existing open cart with items is never used: no item is added, no order is created, and the message says what to do', async () => {
    const fake = new FakeTenantApi();
    fake.openCartRec = { id: 'cart-old', status: 'open', locationId: 'x', customerId: 'y', items: [{ id: 'i1', sku: 'FOREIGN' }] };
    await assert.rejects(run(fake, cfg('normal')), (error: unknown) => {
      assert.ok(error instanceof SeedGuardError);
      assert.match(error.message, /already has an open cart \(id cart-old\)/);
      assert.match(error.message, /Complete or discard that cart by hand/);
      return true;
    });
    assert.equal(fake.calls.some((c) => c.path === '/api/v1/cart/items'), false);
    assert.equal(fake.orders.length, 0);
    assert.equal(fake.openCartRec?.items.length, 1, 'the foreign cart is untouched');
    assert.equal(fake.calls.some((c) => c.method !== 'GET' && /cart\/[^/]+$/.test(c.path)), false, 'not edited, not abandoned');
  });
  it('an EMPTY open cart for another customer is not used either', async () => {
    const fake = new FakeTenantApi();
    fake.openCartRec = { id: 'cart-empty', status: 'open', locationId: 'x', customerId: 'y', items: [] };
    await assert.rejects(run(fake, cfg('normal')), refusal(/open cart/));
    assert.equal(fake.orders.length, 0);
  });
});

describe('B4.9 - the bodies the seed sends satisfy the REAL request DTOs', () => {
  it('a full run: every body of every call passed the real DTOs (the fake answers 400 otherwise), none was rejected, and the three fixed routes were really exercised', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    assert.deepEqual(fake.rejected, []);
    const dtoCalls = fake.calls.filter((c) => c.body !== undefined && dtoFor(c.method, c.path.split('?')[0] ?? ''));
    for (const route of ['/api/v1/inventory/adjustments', '/api/v1/customers', '/confirm', '/receive', '/dispatch', '/api/v1/sales-returns', '/api/v1/orders']) {
      assert.ok(dtoCalls.some((c) => c.path.includes(route)), 'no validated call for ' + route);
    }
  });
  it('coverage guard: every request the seed sends with a body has a DTO in the route table (so the fake validates it)', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    const unvalidated = fake.calls.filter((c) => c.path !== LOGIN_PATH && c.method !== 'GET' && c.body !== undefined && dtoFor(c.method, c.path.split('?')[0] ?? '') === undefined);
    assert.deepEqual(unvalidated.map((c) => c.method + ' ' + c.path), []);
  });

  // ---- RECEIPT / unitCost
  it('RECEIPT: every stock receipt carries the unitCost the seed defined for that product — positive, never 0, never a price', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    const receipts = fake.calls.filter((c) => c.path === '/api/v1/inventory/adjustments');
    assert.equal(receipts.length, 6);
    const costOfVariant = (variantId: unknown): number => {
      const sku = fake.variants.find((v) => v.id === variantId)?.['sku'];
      return { 'TAL-20V-001': 70, 'CASCO-001': 9, 'MULTI-001': 18, 'CABLE-UTP6': 30, 'GUANTE-M': 4 }[String(sku)] ?? Number.NaN;
    };
    for (const call of receipts) {
      const body = call.body as Record<string, unknown>;
      assert.equal(body['movementType'], 'RECEIPT');
      assert.equal(body['unitCost'], costOfVariant(body['productVariantId']));
      assert.ok((body['unitCost'] as number) > 0);
    }
  });
  it('RECEIPT contract (real DTO): without unitCost, with a negative or non-numeric one → rejected; ADJUSTMENT_IN / ADJUSTMENT_OUT without it → accepted', () => {
    const base = { productVariantId: UUID_A, locationId: UUID_B, quantity: 5, reason: 'x' };
    assert.deepEqual(contractErrors(CreateAdjustmentDto, { ...base, movementType: 'RECEIPT', unitCost: 7 }), []);
    assert.ok(contractErrors(CreateAdjustmentDto, { ...base, movementType: 'RECEIPT' }).some((e) => /unitCost/.test(e)));
    assert.ok(contractErrors(CreateAdjustmentDto, { ...base, movementType: 'RECEIPT', unitCost: -1 }).some((e) => /unitCost/.test(e)));
    assert.ok(contractErrors(CreateAdjustmentDto, { ...base, movementType: 'RECEIPT', unitCost: 'siete' }).some((e) => /unitCost/.test(e)));
    assert.deepEqual(contractErrors(CreateAdjustmentDto, { ...base, movementType: 'ADJUSTMENT_IN' }), []);
    assert.deepEqual(contractErrors(CreateAdjustmentDto, { ...base, movementType: 'ADJUSTMENT_OUT' }), []);
  });
  it('the fake refuses the pre-B4.9 receipt (no unitCost) with a 400 and records it', async () => {
    const fake = new FakeTenantApi();
    const oldBody = { productVariantId: UUID_A, locationId: UUID_B, movementType: 'RECEIPT', quantity: 3, reason: 'seed-qa:v1:stock' };
    await assert.rejects(fake.api('POST', '/api/v1/inventory/adjustments', oldBody), /-> 400.*unitCost/);
    assert.equal(fake.rejected.length, 1);
    assert.equal(fake.movements.length, 0);
  });
  it('a 400 on the first receipt stops the run: no images, QR, customers, cart, orders, returns or transfers follow', async () => {
    const fake = new FakeTenantApi();
    const original = fake.api;
    const strict: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
      if (method === 'POST' && path === '/api/v1/inventory/adjustments') throw new Error('POST ' + path + ' -> 400: unitCost must be a number');
      return original(method, path, body, opts);
    }) as ApiFn;
    await assert.rejects(runQaSeed({ api: strict, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), /-> 400/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fake.uploads.length, 0);
    assert.equal(fake.customers.length + fake.orders.length + fake.transfers.length + fake.qrs.length, 0);
    assert.equal(fake.calls.some((c) => /\/qr-codes|\/customers|\/cart|\/orders|\/sales-returns|\/transfers/.test(c.path)), false);
  });

  // ---- customers
  it('customers: the body is exactly the DTO (type, firstName, lastName, taxId, email, phone, address) — cedula / ruc, address as text, no displayName', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    const bodies = fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/customers').map((c) => c.body as Record<string, unknown>);
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      assert.deepEqual(Object.keys(body).sort(), ['address', 'email', 'firstName', 'lastName', 'phone', 'taxId', 'type']);
      assert.equal(typeof body['address'], 'string');
      assert.equal('displayName' in body, false);
    }
    assert.deepEqual(bodies.map((b) => [b['type'], String(b['taxId']).length]), [['cedula', 10], ['ruc', 13]]);
    assert.deepEqual(fake.customers.map((c) => c['displayName']), ['Juan Pérez', 'Ferretería El Tornillo']);
  });
  it('customers contract (real DTO): valid cedula and ruc accepted; wrong type, missing names, address object, displayName, bad tax id lengths rejected', () => {
    const ok = { type: 'cedula', firstName: 'Juan', lastName: 'Pérez', taxId: '1710000001', email: 'a@b.example', phone: '1', address: 'Calle 1' };
    assert.deepEqual(contractErrors(CreateCustomerDto, ok), []);
    assert.deepEqual(contractErrors(CreateCustomerDto, { ...ok, type: 'ruc', taxId: '1790000000001' }), []);
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, type: 'individual' }).some((e) => /type/.test(e)));
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, type: 'business' }).some((e) => /type/.test(e)));
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, firstName: undefined }).some((e) => /firstName/.test(e)));
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, lastName: '' }).some((e) => /lastName/.test(e)));
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, address: { line1: 'x' } }).some((e) => /address/.test(e)));
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, displayName: 'Juan Pérez' }).some((e) => /displayName should not exist/.test(e)));
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, taxId: '12345' }).some((e) => /taxId/.test(e)));
    assert.ok(contractErrors(CreateCustomerDto, { ...ok, type: 'ruc' }).some((e) => /taxId/.test(e)), 'a 10-digit id is not a ruc');
  });
  it('the fake refuses the pre-B4.9 customer body with a 400 and creates nothing', async () => {
    const fake = new FakeTenantApi();
    const oldBody = { type: 'individual', displayName: 'Juan Pérez', taxId: '1710000001', email: 'a@b.example', phone: '1', address: { line1: 'x', city: 'Quito' } };
    await assert.rejects(fake.api('POST', '/api/v1/customers', oldBody), /-> 400/);
    assert.equal(fake.customers.length, 0);
    assert.equal(fake.rejected.length, 1);
  });
  it('a customer name that the backend would re-case is never sent: the seed fixtures survive standardizeName unchanged, and that function is the backend one', () => {
    for (const name of ['Juan', 'Pérez', 'Ferretería', 'El Tornillo']) assert.equal(standardizeName(name), name);
    assert.equal(standardizeName('S.A.'), 'S.a.', 'why the old "S.A." suffix could not be kept');
    const source = readFileSync(new URL('../../apps/api/src/sales/customers/customers.service.ts', import.meta.url), 'utf8');
    const backslash = String.fromCharCode(92);
    for (const fragment of ['.trim()', '.split(/' + backslash + 's+/)', "word.charAt(0).toLocaleUpperCase('es') + word.slice(1).toLocaleLowerCase('es')", ".join(' ')"]) {
      assert.ok(source.includes(fragment), 'backend standardizeName no longer contains: ' + fragment);
    }
  });
  it('a customer with the seed tax id but another name (RUC already used) is not the seed customer: stop, no POST, nothing patched', async () => {
    const fake = new FakeTenantApi();
    fake.customers.push({ id: 'c-other', displayName: 'Otra Empresa', type: 'ruc', taxId: '1790000000001', phone: '1', address: 'a' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/not the seed's/));
    const posted = fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/customers').map((c) => (c.body as Record<string, unknown>)['taxId']);
    assert.ok(!posted.includes('1790000000001'), 'the customer holding that tax id is never created again');
    assert.equal(fake.customers.filter((c) => c['taxId'] === '1790000000001').length, 1, 'and the existing one is untouched');
    assert.equal(fake.orders.length, 0, 'no order is created');
  });
  it('a customer with the seed name and tax id but another identification type is incompatible: stop', async () => {
    const fake = new FakeTenantApi();
    fake.customers.push({ id: 'c-j', displayName: 'Juan Pérez', type: 'ruc', taxId: '1710000001', phone: '1', address: 'a' });
    await assert.rejects(run(fake, cfg('normal')), refusal(/not the seed's/));
    assert.equal(fake.customers.length, 1);
  });
  it('a compatible existing customer (same name, tax id and type) is reused without any write to it', async () => {
    const fake = new FakeTenantApi();
    fake.customers.push({ id: 'c-j', displayName: 'Juan Pérez', type: 'cedula', taxId: '1710000001', phone: '0990000000', address: 'Su casa' });
    await run(fake, cfg('normal'));
    assert.equal(fake.customers.filter((c) => c['taxId'] === '1710000001').length, 1);
    assert.equal(fake.calls.filter((c) => c.method === 'PATCH' && c.path.includes('/customers')).length, 0);
  });
  it('a tax id conflict reported by the backend (409) stops the run without creating the orders that depend on the customer', async () => {
    const fake = new FakeTenantApi();
    const original = fake.api;
    const conflict: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
      if (method === 'POST' && path === '/api/v1/customers') throw new Error('POST ' + path + ' -> 409: A customer with this tax id already exists in this tenant.');
      return original(method, path, body, opts);
    }) as ApiFn;
    await assert.rejects(runQaSeed({ api: conflict, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), /-> 409/);
    assert.equal(fake.orders.length, 0);
    assert.equal(fake.calls.some((c) => c.path.startsWith('/api/v1/cart')), false);
  });

  // ---- payments
  it('confirm: each order is confirmed with ONE cash payment equal to the total the backend reported, and the fake accepted the sum', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    const confirms = fake.calls.filter((c) => /\/orders\/[^/]+\/confirm$/.test(c.path));
    assert.equal(confirms.length, 1, 'only order 1 is confirmed');
    const order1 = fake.orders[0] as Rec;
    assert.deepEqual(confirms[0]?.body, { payments: [{ paymentMethod: 'cash', amount: order1['total'] }] });
    assert.equal(order1['total'], 2 * 120 + 3 * 18, 'taladro x2 + casco x3 at base price');
    assert.equal(order1['status'], 'confirmed');
    assert.deepEqual(order1['payments'], [{ paymentMethod: 'cash', amount: 294 }]);
  });
  it('confirm contract (real DTO): valid single and mixed payments accepted; missing, empty, bad method, zero, negative, non-numeric amounts rejected', () => {
    assert.deepEqual(contractErrors(ConfirmOrderDto, { payments: [{ paymentMethod: 'cash', amount: 294 }] }), []);
    assert.deepEqual(contractErrors(ConfirmOrderDto, { payments: [{ paymentMethod: 'cash', amount: 100.5 }, { paymentMethod: 'card', amount: 193.5 }] }), []);
    assert.ok(contractErrors(ConfirmOrderDto, undefined).length > 0, 'no body');
    assert.ok(contractErrors(ConfirmOrderDto, {}).some((e) => /payments/.test(e)));
    assert.ok(contractErrors(ConfirmOrderDto, { payments: [] }).some((e) => /at least 1/.test(e)));
    assert.ok(contractErrors(ConfirmOrderDto, { payments: [{ paymentMethod: 'bitcoin', amount: 1 }] }).some((e) => /paymentMethod/.test(e)));
    assert.ok(contractErrors(ConfirmOrderDto, { payments: [{ paymentMethod: 'cash', amount: 0 }] }).some((e) => /amount/.test(e)));
    assert.ok(contractErrors(ConfirmOrderDto, { payments: [{ paymentMethod: 'cash', amount: -5 }] }).some((e) => /amount/.test(e)));
    assert.ok(contractErrors(ConfirmOrderDto, { payments: [{ paymentMethod: 'cash', amount: '294' }] }).some((e) => /amount/.test(e)));
    assert.ok(contractErrors(ConfirmOrderDto, { payments: [{ paymentMethod: 'cash', amount: 1, tip: 2 }] }).some((e) => /tip should not exist/.test(e)));
  });
  it('the SERVICE rule the DTO cannot express — payments must add up to the total — is enforced by the fake exactly like the backend: short, over and exact', async () => {
    const make = async (): Promise<{ fake: FakeTenantApi; orderId: string }> => {
      const fake = new FakeTenantApi();
      await run(fake, cfg('normal'));
      const pending = fake.orders.find((o) => o['status'] === 'pending') as Rec;
      return { fake, orderId: pending.id };
    };
    for (const amount of [-0.01, 0.01, 1]) {
      const { fake, orderId } = await make();
      const total = Number((fake.orders.find((o) => o.id === orderId) as Rec)['total']);
      await assert.rejects(fake.api('POST', '/api/v1/orders/' + orderId + '/confirm', { payments: [{ paymentMethod: 'cash', amount: total + amount }] }), /-> 400.*must equal the order total/);
      assert.equal((fake.orders.find((o) => o.id === orderId) as Rec)['status'], 'pending');
    }
    const { fake, orderId } = await make();
    const total = Number((fake.orders.find((o) => o.id === orderId) as Rec)['total']);
    await fake.api('POST', '/api/v1/orders/' + orderId + '/confirm', { payments: [{ paymentMethod: 'cash', amount: total / 2 }, { paymentMethod: 'transfer', amount: total / 2 }] });
    assert.equal((fake.orders.find((o) => o.id === orderId) as Rec)['status'], 'confirmed');
  });
  it('paymentsFor: the amount is the reported total, unchanged; a missing, zero, negative, NaN or 3-decimal total is refused — never rounded or invented', () => {
    assert.deepEqual(paymentsFor({ id: 'o', total: 294 }), [{ paymentMethod: 'cash', amount: 294 }]);
    assert.deepEqual(paymentsFor({ id: 'o', total: 100.5 }), [{ paymentMethod: 'cash', amount: 100.5 }]);
    for (const total of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, 10.005, 0.001]) {
      assert.throws(() => paymentsFor({ id: 'o', total: total as number }), refusal(/will not invent or round a payment amount/));
    }
  });
  it('an order whose total cannot be paid exactly is NOT confirmed: no confirm request, no later order, return or transfer', async () => {
    const fake = new FakeTenantApi();
    const original = fake.api;
    const noTotal: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
      const result = await original(method, path, body, opts);
      if (method === 'POST' && path === '/api/v1/orders') return { ...(result as Rec), total: undefined };
      return result;
    }) as ApiFn;
    await assert.rejects(runQaSeed({ api: noTotal, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), refusal(/will not invent or round a payment amount/));
    assert.equal(fake.calls.some((c) => /\/confirm$/.test(c.path)), false);
    assert.equal(fake.orders.length, 1, 'only the order that was already created; nothing after it');
    assert.equal(fake.calls.some((c) => c.path.startsWith('/api/v1/sales-returns') || c.path.startsWith('/api/v1/inventory/transfers')), false);
  });

  // ---- transfers
  it('transfers: the receive body is the DTO (items with transferItemId and quantityReceived equal to what was dispatched), sent with an Idempotency-Key', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    const receive = fake.calls.filter((c) => /\/receive$/.test(c.path));
    assert.equal(receive.length, 1);
    const body = receive[0]?.body as { items: Array<{ transferItemId: string; quantityReceived: number }> };
    assert.deepEqual(Object.keys(body), ['items']);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.quantityReceived, 5);
    assert.equal(receive[0]?.idempotent, true);
    assert.equal((fake.transfers[0] as Rec)['status'], 'received');
    assert.equal((fake.transfers[1] as Rec)['status'], 'approved', 'the second transfer is left approved, never dispatched');
  });
  it('the other state-changing calls that must be idempotent are sent with a key (order, returns)', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    const keyed = fake.calls.filter((c) => c.idempotent === true).map((c) => c.path.replace(/[0-9a-f-]{8,}|[a-z]+-\d+/g, ':id'));
    for (const expected of ['/api/v1/orders', '/api/v1/sales-returns', '/api/v1/sales-returns/:id/resolve', '/api/v1/inventory/transfers/:id/receive']) {
      assert.ok(keyed.includes(expected), 'no Idempotency-Key on ' + expected);
    }
  });
  it('receive contract (real DTO): partial and full receipts accepted; no items, empty items, zero or negative quantity, bad incident type rejected', () => {
    const line = { transferItemId: UUID_A, quantityReceived: 3 };
    assert.deepEqual(contractErrors(ReceiveTransferDto, { items: [line] }), []);
    assert.deepEqual(contractErrors(ReceiveTransferDto, { items: [{ ...line, incidentType: 'shortage', incidentNotes: 'faltaron 2' }], notes: 'ok' }), []);
    assert.ok(contractErrors(ReceiveTransferDto, {}).some((e) => /items/.test(e)));
    assert.ok(contractErrors(ReceiveTransferDto, { items: [] }).some((e) => /at least 1/.test(e)));
    assert.ok(contractErrors(ReceiveTransferDto, { items: [{ ...line, quantityReceived: 0 }] }).some((e) => /quantityReceived/.test(e)));
    assert.ok(contractErrors(ReceiveTransferDto, { items: [{ ...line, quantityReceived: -2 }] }).some((e) => /quantityReceived/.test(e)));
    assert.ok(contractErrors(ReceiveTransferDto, { items: [{ ...line, incidentType: 'lost' }] }).some((e) => /incidentType/.test(e)));
    assert.ok(contractErrors(ReceiveTransferDto, { items: [{ transferItemId: 'x', quantityReceived: 1 }] }).some((e) => /transferItemId/.test(e)));
  });
  it('receive SERVICE rules (status, remaining quantity, item belongs to the transfer) hold in the fake: over-receiving, receiving twice and an unknown item are refused', async () => {
    const fake = new FakeTenantApi();
    await run(fake, cfg('create'));
    const transfer1 = fake.transfers[0] as Rec & { items: Array<{ id: string }> };
    const itemId = transfer1.items[0]?.id as string;
    await assert.rejects(fake.api('POST', '/api/v1/inventory/transfers/' + transfer1.id + '/receive', { items: [{ transferItemId: itemId, quantityReceived: 1 }] }), /-> 409/);
    const transfer2 = fake.transfers[1] as Rec;
    await assert.rejects(fake.api('POST', '/api/v1/inventory/transfers/' + transfer2.id + '/receive', { items: [{ transferItemId: itemId, quantityReceived: 1 }] }), /-> 409.*dispatched/);
  });
  it('workflow gates: with approval and preparation both disabled the seed makes no approve/prepare call, and still dispatches and receives transfer 1', async () => {
    const fake = new FakeTenantApi();
    fake.workflow = { requireApproval: false, requirePreparation: false };
    await run(fake, cfg('create'));
    assert.equal(fake.calls.some((c) => /\/(approve|prepare)$/.test(c.path)), false);
    assert.equal((fake.transfers[0] as Rec)['status'], 'received');
    assert.equal((fake.transfers[1] as Rec)['status'], 'preparing', 'left wherever creation put it; never dispatched');
  });
  it('workflow gates: with only the approval disabled the seed prepares but does not approve', async () => {
    const fake = new FakeTenantApi();
    fake.workflow = { requireApproval: false, requirePreparation: true };
    await run(fake, cfg('create'));
    assert.equal(fake.calls.filter((c) => /\/approve$/.test(c.path)).length, 0);
    assert.equal(fake.calls.filter((c) => /\/prepare$/.test(c.path)).length, 1);
    assert.equal((fake.transfers[0] as Rec)['status'], 'received');
  });
  it('a transition that answers an unexpected status stops the transfer there: no dispatch, no receive', async () => {
    const fake = new FakeTenantApi();
    const original = fake.api;
    const odd: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
      const result = await original(method, path, body, opts);
      return method === 'POST' && /\/approve$/.test(path) ? { ...(result as Rec), status: 'cancelled' } : result;
    }) as ApiFn;
    await assert.rejects(runQaSeed({ api: odd, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), refusal(/expected "approved"/));
    assert.equal(fake.calls.some((c) => /\/(dispatch|receive)$/.test(c.path)), false);
  });
  it('a transfer created already dispatched or received is not continued', async () => {
    const fake = new FakeTenantApi();
    const original = fake.api;
    const odd: ApiFn = (async (method: string, path: string, body?: unknown, opts?: { idempotent?: boolean }) => {
      const result = await original(method, path, body, opts);
      return method === 'POST' && path === '/api/v1/inventory/transfers' ? { ...(result as Rec), status: 'dispatched' } : result;
    }) as ApiFn;
    await assert.rejects(runQaSeed({ api: odd, login: fake.loginFn, uploadImage: fake.upload, config: cfg('normal'), log: () => undefined }), refusal(/starts as draft, approved or preparing/));
    assert.equal(fake.calls.some((c) => /\/(approve|prepare|dispatch|receive)$/.test(c.path)), false);
  });
});
