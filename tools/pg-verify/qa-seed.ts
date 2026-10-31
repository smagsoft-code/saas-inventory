import {
  assertOrderListIsComplete,
  assertSessionMatchesTenant,
  assertTenantActive,
  assertTenantOperationallyEmpty,
  QA_SEED_MARKERS,
  SeedGuardError,
  type LoginResult,
  type OperatingScope,
  type SeedConfig,
} from './qa-seed-guards';

/**
 * Core of the QA seed (D-8E.26-B4.1). `seed-qa-data.ts` is only the command-line wrapper (HTTP client, credentials, PNG); everything that
 * decides WHAT is written lives here, behind an injected `api`, so it can be tested with an in-memory fake and never needs a database.
 *
 * Principles:
 *  - the tenant is named by the operator (`QA_SEED_TENANT_SLUG`) and verified twice (login session, `GET /tenant`); never inferred;
 *  - `--check` writes no seed data: every request after the login is a GET (`guardApi` and `guardUpload` refuse anything else, and the CLI gives
 *    a `--check` run a read-only HTTP client). The login itself is a POST and is not free of side effects (last-login metadata, a session): it is
 *    the backend's normal authentication, not bypassed. `--create` runs only in a tenant with no operational data; the normal run
 *    completes what is missing and nothing else;
 *  - every record is recognised by a stable natural key (category code / product SKU / taxId / warehouse code) or by a marker the seed wrote
 *    (`reason`, `notes`).
 *    A record that matches a key but is not exactly the seed's is NEVER reused, patched or repaired: the run stops;
 *  - existing data is never updated: no PATCH on existing records, no DELETE anywhere, no reactivation, no identity/membership/password calls;
 *  - an error stops the run where it is; there is no rollback and no repair.
 */

export type ApiFn = <T = unknown>(method: string, urlPath: string, body?: unknown, opts?: { idempotent?: boolean }) => Promise<T>;

export interface SeedDeps {
  readonly api: ApiFn;
  /** POST /auth/login with the QA credentials (the core never sees the password). */
  readonly login: () => Promise<LoginResult>;
  readonly uploadImage: (productId: string) => Promise<void>;
  readonly config: SeedConfig;
  readonly log: (line: string) => void;
}

export interface SeedResult {
  /** Records the run created, by kind. Empty for `--check`. */
  readonly created: Readonly<Record<string, number>>;
  /** Steps left alone because their data already exists (or could not be proven to be the seed's). */
  readonly skipped: readonly string[];
}

interface Page<T> {
  data: T[];
  meta?: { total?: number; totalPages?: number };
}
interface Warehouse { id: string; name: string; code: string }
interface Location { id: string; name: string; code: string; warehouseId: string; isSellable?: boolean }
interface Category { id: string; name: string; code?: string }
interface Product { id: string; name: string; categoryId?: string }
interface Variant { id: string; productId: string; sku: string; maxPrice?: number | string; basePrice?: number | string; minPrice?: number | string; cost?: number | string | null }
interface Customer { id: string; displayName: string; type?: string; taxId?: string; phone?: string; address?: string }
interface Cart { id: string; status?: string; locationId?: string; customerId?: string; items?: unknown[] }
interface Order { id: string; status: string; total?: number; items: Array<{ id: string; sku: string }> }
interface ReturnRecord { id: string; items: Array<{ id: string }> }
interface Transfer { id: string; status?: string; notes?: string; items: Array<{ id: string }> }
interface Movement { reason?: string }

const WAREHOUSES = {
  principal: { name: 'Sucursal Principal QA', code: 'SUC-PRIN' },
  norte: { name: 'Sucursal Norte QA', code: 'SUC-NORTE' },
} as const;
const LOCATIONS = {
  principal: { name: 'Almacén Principal', code: 'ALM-PRIN' },
  cuarentena: { name: 'Cuarentena QA', code: 'CUAR-QA' },
} as const;
/**
 * B4 (D-8E.26-B4.5). A category is the seed's only if it carries the seed's own CODE. Categories have a client-settable, per-tenant unique
 * `code` (CreateCategoryDto) and the seed always creates them with these reserved codes; a category whose code was assigned automatically
 * (CAT-001 …) or by a person is never the seed's, whatever its name. The backend stores names in UPPERCASE, so names are compared normalised.
 */
const CATEGORIES = {
  ferreteria: { name: 'Ferretería', code: 'QA-SEED-FERRETERIA' },
  electronica: { name: 'Electrónica', code: 'QA-SEED-ELECTRONICA' },
} as const;
/** The backend stores product and category names as `name.trim().toUpperCase()` (catalog/upper-name.ts); this is the same transformation. */
const storedName = (name: string): string => name.trim().toUpperCase();
const sameText = (a: string, b: string): boolean => storedName(a) === storedName(b);
/** Case AND accent insensitive form, used only to DETECT near-namesakes ("FERRETERIA" vs "FERRETERÍA"), never to accept a record as the seed's. */
const foldText = (value: string): string => storedName(value).normalize('NFD').replace(/\p{M}/gu, '');
/** What a person has to do about a record that blocks the seed. The seed itself never resolves it. */
const MANUAL =
  'Resolve it by hand (rename or recode it yourself, or leave it and use another tenant); the seed never adopts, recodes, merges, deletes or edits an existing record.';
const PRODUCTS = {
  taladro: { name: 'Taladro Inalámbrico 20V', sku: 'TAL-20V-001', maxPrice: 150, basePrice: 120, minPrice: 100, cost: 70 },
  casco: { name: 'Casco de Seguridad', sku: 'CASCO-001', maxPrice: 25, basePrice: 18, minPrice: 15, cost: 9 },
  multimetro: { name: 'Multímetro Digital', sku: 'MULTI-001', maxPrice: 45, basePrice: 35, minPrice: 28, cost: 18 },
  cable: { name: 'Cable UTP Cat6 (rollo 100m)', sku: 'CABLE-UTP6', maxPrice: 60, basePrice: 48, minPrice: 40, cost: 30 },
  linterna: { name: 'Linterna LED Recargable', sku: 'LINT-001', maxPrice: 20, basePrice: 15, minPrice: 12, cost: 7 },
  guantes: { name: 'Guantes de Trabajo', sku: 'GUANTE-M', maxPrice: 12, basePrice: 9, minPrice: 7, cost: 4 },
} as const;
/**
 * B4.9. The shape of `CreateCustomerDto` (sales/customers/dto/create-customer.dto.ts) — the contract, not the seed's earlier guess: `type` is the
 * identification document (cedula | ruc | pasaporte, with a 10 / 13 digit / alphanumeric `taxId`), `firstName` AND `lastName` are both required, `address`
 * is ONE text line, and there is no `displayName` on create (the backend derives it as `first last`, and stores both names standardised to Title Case).
 * The contract has no company-name field and the web form asks every customer for "Nombres" and "Apellidos", so the business customer is a RUC customer
 * whose two name fields are "Ferretería" / "El Tornillo": the earlier "S.A." suffix cannot survive (the standardisation would store it as "S.a.").
 */
const CUSTOMERS = {
  juan: {
    type: 'cedula',
    firstName: 'Juan',
    lastName: 'Pérez',
    taxId: '1710000001',
    email: 'juan.perez@example.com',
    phone: '0991234567',
    address: 'Calle Los Álamos 456, Quito, Ecuador',
  },
  tornillo: {
    type: 'ruc',
    firstName: 'Ferretería',
    lastName: 'El Tornillo',
    taxId: '1790000000001',
    email: 'compras@eltornillo.example',
    phone: '022345678',
    address: 'Av. Amazonas 123, Quito, Ecuador',
  },
} as const;
type CustomerDef = (typeof CUSTOMERS)[keyof typeof CUSTOMERS];
const customerDisplayName = (def: CustomerDef): string => `${def.firstName} ${def.lastName}`;

/** CustomersService.standardizeName (sales/customers/customers.service.ts), verbatim — pinned to the backend source by a test. */
export function standardizeName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase('es') + word.slice(1).toLocaleLowerCase('es'))
    .join(' ');
}

/** The exact body of `POST /customers`: the DTO's fields and nothing else. Names must already be in the form the backend will store. */
function customerBody(def: CustomerDef): Record<string, string> {
  for (const name of [def.firstName, def.lastName]) {
    if (standardizeName(name) !== name) throw new SeedGuardError(`customer name "${name}" would be altered by the backend's name standardisation; refusing to send it.`);
  }
  return { type: def.type, firstName: def.firstName, lastName: def.lastName, taxId: def.taxId, email: def.email, phone: def.phone, address: def.address };
}

/** Wraps the API so that a read-only run cannot write, whatever a later edit of this file does. */
export function guardApi(api: ApiFn, writable: boolean): ApiFn {
  return ((method: string, urlPath: string, body?: unknown, opts?: { idempotent?: boolean }) => {
    if (!writable && method !== 'GET') throw new SeedGuardError(`A write was attempted in read-only mode: ${method} ${urlPath}`);
    return api(method, urlPath, body, opts);
  }) as ApiFn;
}

/**
 * The same rule as `guardApi`, for the one write that does not go through `api` (the multipart image upload). Applied to `deps.uploadImage`
 * at the top of `runQaSeed`, so no step below can reach an upload in a read-only run, whatever the control flow does (B1).
 */
export function guardUpload(upload: SeedDeps['uploadImage'], writable: boolean): SeedDeps['uploadImage'] {
  return (productId: string) => {
    if (!writable) throw new SeedGuardError('An image upload was attempted in read-only mode.');
    return upload(productId);
  };
}

const withQuery = (path: string, query: string): string => `${path}${path.includes('?') ? '&' : '?'}${query}`;

const incomplete = (path: string, why: string): SeedGuardError =>
  new SeedGuardError(`The list ${path} cannot be trusted to be complete (${why}); refusing to reason about what exists.`);

/** The declared total of a list response. A response without a numeric `meta.total` is refused: it cannot be told apart from a partial one. */
function declaredTotal(res: Page<unknown>, path: string): number {
  if (!Array.isArray(res.data)) throw incomplete(path, 'no data array');
  const total = res.meta?.total;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) throw incomplete(path, 'no numeric meta.total');
  return total;
}

/** Every record of a paginated list, proven complete: it walks the pages until it holds exactly `meta.total` records, else it stops. */
async function listEvery<T>(api: ApiFn, path: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await api<Page<T>>('GET', withQuery(path, `pageSize=100&page=${String(page)}`));
    const total = declaredTotal(res, path);
    all.push(...res.data);
    if (all.length === total) return all;
    if (all.length > total || res.data.length === 0) throw incomplete(path, `${String(all.length)} records received, ${String(total)} declared`);
  }
  throw new SeedGuardError(`Too many pages to inspect safely: ${path}`);
}

async function totalOf(api: ApiFn, path: string): Promise<number> {
  return declaredTotal(await api<Page<unknown>>('GET', withQuery(path, 'pageSize=1')), path);
}

/**
 * Finds the existing record for `label`. No candidate → `undefined` (the caller may create it). Several candidates, or one that matches a key
 * but is not exactly the seed's record → the run stops: it is never reused, patched or "repaired".
 */
function pickStrict<T>(label: string, items: readonly T[], isCandidate: (item: T) => boolean, isExact: (item: T) => boolean): T | undefined {
  const candidates = items.filter(isCandidate);
  if (candidates.length > 1) throw new SeedGuardError(`${label}: more than one existing record matches; refusing to choose one.`);
  const found = candidates[0];
  if (found === undefined) return undefined;
  if (!isExact(found)) throw new SeedGuardError(`${label}: a record with this name or code exists but is not the seed's; refusing to reuse or modify it.`);
  return found;
}

const hasSeedStockMarker = (movements: readonly Movement[]): boolean =>
  movements.some((m) => m.reason === QA_SEED_MARKERS.stockReason || m.reason === QA_SEED_MARKERS.legacyStockReason);

const transferMarker = (notes: string | undefined, index: 0 | 1): boolean =>
  notes === QA_SEED_MARKERS.transferNotes[index] || notes === QA_SEED_MARKERS.legacyTransferNotes[index];

/** The order of the checks: URL and flags are validated before this runs (resolveSeedConfig); everything below happens after a verified session. */
export async function runQaSeed(deps: SeedDeps): Promise<SeedResult> {
  const { config, log } = deps;
  const writable = config.mode !== 'check';
  const api = guardApi(deps.api, writable);
  const uploadImage = guardUpload(deps.uploadImage, writable);
  const created: Record<string, number> = {};
  const skipped: string[] = [];
  const bump = (kind: string): void => {
    created[kind] = (created[kind] ?? 0) + 1;
  };
  const section = (title: string): void => log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);

  section(`QA seed — mode: ${config.mode} — tenant: ${config.tenantSlug}`);
  const login = await deps.login();
  assertSessionMatchesTenant(login, config.tenantSlug);
  assertTenantActive(await api<{ slug?: string; status?: string }>('GET', '/api/v1/tenant'), config.tenantSlug);
  log(`  verified: session and GET /tenant both say "${config.tenantSlug}", active`);

  if (config.mode === 'check') {
    // Precise wording (D-8E.26-B4.3): no seed data is written, but authentication is not free of side effects — the backend updates the
    // identity's last-login metadata and creates a refresh-token row when it issues the session. That is the normal login, not bypassed.
    log('  --check writes no seed data. Authentication itself may have updated last-login metadata and created a session.');
    await inspect(api, log, skipped, login);
    return { created, skipped };
  }
  // B5: before ANY write, prove that GET /orders lists every order of the tenant. Otherwise the order block could not tell "none exist" from
  // "I cannot see them" and might duplicate sales. The permission and the scope are the account's own; nothing is granted or widened for the seed.
  await assertOrdersAreFullyVisible(api, login);
  log('  verified: sales.orders.view_all and an unrestricted location scope — GET /orders is complete');
  if (config.mode === 'create') {
    assertTenantOperationallyEmpty(
      {
        products: await totalOf(api, '/api/v1/products'),
        warehouses: await totalOf(api, '/api/v1/warehouses'),
        customers: await totalOf(api, '/api/v1/customers'),
        orders: await totalOf(api, '/api/v1/orders'),
        movements: await totalOf(api, '/api/v1/inventory/movements'),
      },
      config.tenantSlug,
    );
    log('  --create: the tenant has no operational data');
  }

  section('2. Warehouses + locations');
  const warehouses = await listEvery<Warehouse>(api, '/api/v1/warehouses');
  async function ensureWarehouse(def: { name: string; code: string }): Promise<Warehouse> {
    const found = pickStrict(`warehouse "${def.name}"`, warehouses, (w) => w.name === def.name || w.code === def.code, (w) => w.name === def.name && w.code === def.code);
    if (found) return found;
    const made = await api<Warehouse>('POST', '/api/v1/warehouses', { name: def.name, code: def.code });
    bump('warehouses');
    return made;
  }
  const whPrincipal = await ensureWarehouse(WAREHOUSES.principal);
  const whNorte = await ensureWarehouse(WAREHOUSES.norte);
  const principalLocations = await listEvery<Location>(api, `/api/v1/locations?warehouseId=${whPrincipal.id}`);
  async function ensureLocation(def: { name: string; code: string }, extra: Record<string, unknown> = {}, sellable?: boolean): Promise<Location> {
    const found = pickStrict(
      `location "${def.name}"`,
      principalLocations,
      (l) => l.name === def.name || l.code === def.code,
      (l) => l.name === def.name && l.code === def.code && (sellable === undefined || l.isSellable === sellable),
    );
    if (found) return found;
    const made = await api<Location>('POST', '/api/v1/locations', { warehouseId: whPrincipal.id, name: def.name, code: def.code, ...extra });
    bump('locations');
    return made;
  }
  const almacenPrincipal = await ensureLocation(LOCATIONS.principal);
  const cuarentena = await ensureLocation(LOCATIONS.cuarentena, { isSellable: false }, false);
  const norteLocations = await listEvery<Location>(api, `/api/v1/locations?warehouseId=${whNorte.id}`);
  const almacenNorte = norteLocations.length === 1 ? norteLocations[0] : norteLocations.find((l) => l.name === 'General');
  if (!almacenNorte) throw new SeedGuardError('Sucursal Norte QA: cannot tell which location is its default one; refusing to choose.');

  section('3. Categories');
  const categories = await listEvery<Category>(api, '/api/v1/categories');
  // A category without a readable name and code makes the whole list unusable as evidence (it could be hiding the seed code).
  assertCategoriesIdentifiable(categories);
  async function ensureCategory(def: { name: string; code: string }): Promise<Category> {
    const found = pickCategory(categories, def);
    if (found) return found;
    const made = await api<Category>('POST', '/api/v1/categories', { name: def.name, code: def.code });
    if (typeof made.id !== 'string' || typeof made.code !== 'string' || !sameText(made.code, def.code)) {
      throw new SeedGuardError(`category "${def.name}": the created record does not echo the seed code; refusing to continue.`);
    }
    bump('categories');
    return made;
  }
  const catFerreteria = await ensureCategory(CATEGORIES.ferreteria);
  const catElectronica = await ensureCategory(CATEGORIES.electronica);

  section('4. Products + variants');
  async function ensureProduct(def: ProductDef, categoryId: string): Promise<{ product: Product; variant: Variant; isNew: boolean }> {
    const existing = await findSeedProduct(api, def, categoryId);
    if (existing) {
      log(`  ${def.name} (${def.sku}) — already present`);
      return { ...existing, isNew: false };
    }
    let product: Product;
    try {
      product = await api<Product>('POST', '/api/v1/products', {
        name: def.name,
        categoryId,
        defaultVariant: { sku: def.sku, maxPrice: def.maxPrice, basePrice: def.basePrice, minPrice: def.minPrice, cost: def.cost },
      });
    } catch (error) {
      // The lookup found no holder of the SKU, yet the backend says it exists: a soft-deleted product keeps its SKU (the list hides it).
      if (error instanceof Error && /-> 409\b/.test(error.message)) {
        throw new SeedGuardError(`product "${def.name}": the backend refuses SKU ${def.sku} (409) although no visible product holds it — a soft-deleted product keeps its SKU. Nothing was changed by this step. ${MANUAL}`);
      }
      throw error;
    }
    // A creation that does not come back as a complete record is not a success (the backend always answers with id and the stored name).
    if (typeof product.id !== 'string' || typeof product.name !== 'string' || !sameText(product.name, def.name)) {
      throw new SeedGuardError(`product "${def.name}": the created record is incomplete or does not match; refusing to continue.`);
    }
    await api('PATCH', `/api/v1/products/${product.id}`, { status: 'active' }); // only on a product this run just created
    bump('products');
    const variant = (await variantsOf(api, product.id)).find((v) => v.sku === def.sku);
    if (!variant) throw new SeedGuardError(`product "${def.name}" was created but has no variant ${def.sku}; refusing to continue.`);
    log(`  ${def.name} (${def.sku}) — created`);
    return { product, variant, isNew: true };
  }
  const taladro = await ensureProduct(PRODUCTS.taladro, catFerreteria.id);
  const casco = await ensureProduct(PRODUCTS.casco, catFerreteria.id);
  const multimetro = await ensureProduct(PRODUCTS.multimetro, catElectronica.id);
  const cable = await ensureProduct(PRODUCTS.cable, catElectronica.id);
  const linterna = await ensureProduct(PRODUCTS.linterna, catElectronica.id);
  if (linterna.isNew) {
    await api('PATCH', `/api/v1/products/${linterna.product.id}/variants/${linterna.variant.id}`, { status: 'discontinued' });
  }
  const guantes = await ensureProduct(PRODUCTS.guantes, catFerreteria.id);
  const guanteVariants = await api<Variant[]>('GET', `/api/v1/products/${guantes.product.id}/variants`);
  if (!guanteVariants.some((v) => v.sku === 'GUANTE-L')) {
    await api<Variant>('POST', `/api/v1/products/${guantes.product.id}/variants`, { sku: 'GUANTE-L', maxPrice: 12, basePrice: 9, minPrice: 7, cost: 4 });
    bump('variants');
  }

  section('5. Initial stock (POST /inventory/adjustments, RECEIPT, marked)');
  // RECEIPT carries a MANDATORY unit cost (CreateAdjustmentDto: @ValidateIf RECEIPT -> @IsNumber @Min(0)). It is the cost the seed itself defined for the
  // product (the same value it created the variant with and compared on reuse) — never 0, never a price.
  async function stock(def: ProductDef, variantId: string, locationId: string, quantity: number): Promise<void> {
    if (!Number.isFinite(def.cost) || def.cost <= 0) throw new SeedGuardError(`product ${def.sku}: no usable unit cost to receive stock with; refusing.`);
    const prior = await listEvery<Movement>(api, `/api/v1/inventory/movements?productVariantId=${variantId}&locationId=${locationId}&movementType=RECEIPT`);
    if (hasSeedStockMarker(prior)) {
      skipped.push(`stock ${variantId}@${locationId}`);
      return;
    }
    await api('POST', '/api/v1/inventory/adjustments', { productVariantId: variantId, locationId, movementType: 'RECEIPT', quantity, unitCost: def.cost, reason: QA_SEED_MARKERS.stockReason });
    bump('stock receipts');
  }
  await stock(PRODUCTS.taladro, taladro.variant.id, almacenPrincipal.id, 25);
  await stock(PRODUCTS.taladro, taladro.variant.id, cuarentena.id, 1);
  await stock(PRODUCTS.casco, casco.variant.id, almacenPrincipal.id, 40);
  await stock(PRODUCTS.multimetro, multimetro.variant.id, almacenPrincipal.id, 12);
  await stock(PRODUCTS.cable, cable.variant.id, almacenPrincipal.id, 8);
  await stock(PRODUCTS.guantes, guantes.variant.id, almacenPrincipal.id, 15);

  section('6. Product images (only a product that has none)');
  for (const { product } of [taladro, casco, multimetro, cable, linterna, guantes]) {
    const images = await api<unknown[]>('GET', `/api/v1/products/${product.id}/images`);
    if (images.length > 0) {
      skipped.push(`image ${product.id}`);
      continue;
    }
    await uploadImage(product.id);
    bump('images');
  }

  section('7. QR codes (only a variant that has none)');
  for (const variant of [taladro.variant, casco.variant, multimetro.variant]) {
    if ((await totalOf(api, `/api/v1/qr-codes?targetType=product_variant&targetId=${variant.id}`)) > 0) {
      skipped.push(`qr ${variant.id}`);
      continue;
    }
    await api('POST', '/api/v1/qr-codes', { targetType: 'product_variant', targetId: variant.id });
    bump('qr codes');
  }

  section('8. Customers (created complete; an existing one is never patched)');
  const customers = await listEvery<Customer>(api, '/api/v1/customers');
  async function ensureCustomer(def: CustomerDef): Promise<Customer> {
    const found = pickCustomer(customers, def);
    if (found) {
      if (!found.phone || !found.address) {
        throw new SeedGuardError(`customer "${customerDisplayName(def)}" exists without phone or address; the seed no longer patches existing customers. Fix it by hand or leave it.`);
      }
      return found;
    }
    const made = await api<Customer>('POST', '/api/v1/customers', customerBody(def));
    if (typeof made.id !== 'string' || made.taxId !== def.taxId) {
      throw new SeedGuardError(`customer "${customerDisplayName(def)}": the created record is incomplete or does not match; refusing to continue.`);
    }
    bump('customers');
    return made;
  }
  const customer1 = await ensureCustomer(CUSTOMERS.juan);
  const customer2 = await ensureCustomer(CUSTOMERS.tornillo);

  section('9. Sales orders');
  const priorOrders = (await ordersOfCustomer(api, customer1.id)) + (await ordersOfCustomer(api, customer2.id));
  let order1Confirmed: Order | undefined;
  if (priorOrders > 0) {
    skipped.push('orders+returns');
    log('  skipped: the seed customers already have orders. An order carries no seed marker, so the seed cannot prove they are its own and creates none.');
  } else {
    // POST /cart is "create or get the ACTIVE cart" of the vendor (carts.service.createOrGetActive): if the QA account already has an open cart, the
    // backend returns THAT one and ignores the body. Items added to it would end up in a seed order, so the cart is verified before it is used.
    const openCart = async (locationId: string, customerId: string): Promise<Cart> => {
      const cart = await api<Cart>('POST', '/api/v1/cart', { locationId, customerId });
      if (cart.status !== 'open' || cart.locationId !== locationId || cart.customerId !== customerId || !Array.isArray(cart.items) || cart.items.length > 0) {
        throw new SeedGuardError(
          `The QA account already has an open cart (id ${String(cart.id)}) that is not an empty cart for this seed order; adding items to it would put foreign lines in a seed order. ` +
            'Complete or discard that cart by hand (the seed never edits or abandons an existing cart), then run again. Orders created so far in this run are left as they are.',
        );
      }
      return cart;
    };
    const addItem = (variantId: string, quantity: number): Promise<unknown> => api('POST', '/api/v1/cart/items', { productVariantId: variantId, quantity });
    const cart1 = await openCart(almacenPrincipal.id, customer1.id);
    await addItem(taladro.variant.id, 2);
    await addItem(casco.variant.id, 3);
    const order1 = await api<Order>('POST', '/api/v1/orders', { cartId: cart1.id, documentType: 'sales_note' }, { idempotent: true });
    order1Confirmed = await confirmOrder(api, order1);
    const cart2 = await openCart(almacenPrincipal.id, customer2.id);
    await addItem(multimetro.variant.id, 1);
    await addItem(cable.variant.id, 1);
    await api<Order>('POST', '/api/v1/orders', { cartId: cart2.id, documentType: 'invoice' }, { idempotent: true });
    const cart3 = await openCart(almacenPrincipal.id, customer1.id);
    await addItem(casco.variant.id, 1);
    const order3 = await api<Order>('POST', '/api/v1/orders', { cartId: cart3.id, documentType: 'sales_note' }, { idempotent: true });
    await api('POST', `/api/v1/orders/${order3.id}/cancel`);
    for (let i = 0; i < 3; i += 1) bump('orders');
  }

  section('10. Returns (only on the orders this run created)');
  if (!order1Confirmed) {
    skipped.push('returns');
  } else {
    const taladroLine = order1Confirmed.items.find((item) => item.sku === taladro.variant.sku);
    const cascoLine = order1Confirmed.items.find((item) => item.sku === casco.variant.sku);
    if (!taladroLine || !cascoLine) throw new SeedGuardError('Could not find order 1 line items by SKU for the returns step.');
    const return1 = await api<ReturnRecord>(
      'POST',
      '/api/v1/sales-returns',
      { orderId: order1Confirmed.id, locationId: almacenPrincipal.id, reason: 'Cliente devolvió por cambio de opinión', items: [{ orderItemId: taladroLine.id, quantity: 1 }] },
      { idempotent: true },
    );
    const return1Item = return1.items[0];
    if (!return1Item) throw new SeedGuardError('return 1 has no items after creation.');
    await api('POST', `/api/v1/sales-returns/${return1.id}/inspect`, { items: [{ returnItemId: return1Item.id, disposition: 'restock', dispositionLocationId: almacenPrincipal.id }] });
    await api('POST', `/api/v1/sales-returns/${return1.id}/resolve`, undefined, { idempotent: true });
    await api(
      'POST',
      '/api/v1/sales-returns',
      { orderId: order1Confirmed.id, locationId: almacenPrincipal.id, reason: 'Producto con defecto de fábrica', items: [{ orderItemId: cascoLine.id, quantity: 1 }] },
      { idempotent: true },
    );
    bump('returns');
    bump('returns');
  }

  section('11. Transfers (recognised by their notes marker)');
  const transfers = await listEvery<Transfer>(api, '/api/v1/inventory/transfers');
  // The tenant decides whether a transfer needs approval and preparation (tenant settings; a disabled gate is passed automatically when the transfer is
  // created). So each step is taken only if the transfer is at the status that step starts from, and every answer must report the status it reached.
  const step = async (transfer: Transfer, action: 'approve' | 'prepare', from: string, to: string): Promise<Transfer> => {
    if (transfer.status !== from) return transfer;
    const next = await api<Transfer>('POST', `/api/v1/inventory/transfers/${transfer.id}/${action}`);
    if (next.status !== to) throw new SeedGuardError(`transfer ${transfer.id}: after ${action} it reports status "${String(next.status)}", expected "${to}"; stopping.`);
    return { ...transfer, status: next.status };
  };
  const knownStatus = (transfer: Transfer): void => {
    if (!['draft', 'approved', 'preparing'].includes(String(transfer.status))) {
      throw new SeedGuardError(`transfer ${transfer.id} was created with status "${String(transfer.status)}"; the seed only continues a transfer that starts as draft, approved or preparing.`);
    }
  };
  if (transfers.some((t) => transferMarker(t.notes, 0))) {
    skipped.push('transfer 1');
  } else {
    let transfer1 = await api<Transfer>('POST', '/api/v1/inventory/transfers', {
      sourceLocationId: almacenPrincipal.id,
      destinationLocationId: almacenNorte.id,
      items: [{ productVariantId: taladro.variant.id, quantityRequested: 5 }],
      notes: QA_SEED_MARKERS.transferNotes[0],
    });
    knownStatus(transfer1);
    transfer1 = await step(transfer1, 'approve', 'draft', 'approved');
    transfer1 = await step(transfer1, 'prepare', 'approved', 'preparing');
    // dispatch with no items = everything requested (DispatchTransferDto.items is optional); receive takes exactly what was dispatched
    const dispatched = await api<Transfer>('POST', `/api/v1/inventory/transfers/${transfer1.id}/dispatch`, {});
    if (dispatched.status !== 'dispatched') throw new SeedGuardError(`transfer ${transfer1.id}: after dispatch it reports status "${String(dispatched.status)}", expected "dispatched"; stopping.`);
    const item = transfer1.items[0];
    if (!item) throw new SeedGuardError('transfer 1 has no items after creation.');
    await api('POST', `/api/v1/inventory/transfers/${transfer1.id}/receive`, { items: [{ transferItemId: item.id, quantityReceived: 5 }] }, { idempotent: true });
    bump('transfers');
  }
  if (transfers.some((t) => transferMarker(t.notes, 1))) {
    skipped.push('transfer 2');
  } else {
    const transfer2 = await api<Transfer>('POST', '/api/v1/inventory/transfers', {
      sourceLocationId: almacenPrincipal.id,
      destinationLocationId: almacenNorte.id,
      items: [{ productVariantId: casco.variant.id, quantityRequested: 5 }],
      notes: QA_SEED_MARKERS.transferNotes[1],
    });
    knownStatus(transfer2);
    await step(transfer2, 'approve', 'draft', 'approved'); // left approved (or wherever creation put it if the tenant skips gates): never dispatched
    bump('transfers');
  }
  section('DONE');
  log(`  created: ${JSON.stringify(created)}`);
  log(`  left alone (already present or not provably the seed's): ${skipped.length} step(s)`);
  return { created, skipped };
}

type ProductDef = (typeof PRODUCTS)[keyof typeof PRODUCTS];
/** Which seed category each seed product belongs to (the category is part of what makes an existing product "the seed's"). */
const PRODUCT_CATEGORY: Record<keyof typeof PRODUCTS, keyof typeof CATEGORIES> = {
  taladro: 'ferreteria',
  casco: 'ferreteria',
  multimetro: 'electronica',
  cable: 'electronica',
  linterna: 'electronica',
  guantes: 'ferreteria',
};

/** The variants of a product. An answer that is not an array of variants with an id and a SKU is incomplete and stops the run. */
async function variantsOf(api: ApiFn, productId: string): Promise<Variant[]> {
  const variants = await api<Variant[]>('GET', `/api/v1/products/${productId}/variants`);
  if (!Array.isArray(variants) || variants.some((v) => typeof v.id !== 'string' || typeof v.sku !== 'string')) {
    throw new SeedGuardError(`product ${productId}: the variants answer is incomplete; refusing to reason about its SKUs.`);
  }
  return variants;
}

const asNumber = (value: unknown): number => (typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN);

/**
 * An existing record holding the seed's SKU is the seed's only if what it says matches the seed's definition: the (normalised) name, the seed
 * category, and the prices the account can see. Anything else is a different product that happens to use the SKU: the run stops, and nothing
 * is reused, patched or repaired. `maxPrice`/`basePrice` are always reported by the backend; their absence means the answer is incomplete.
 * `minPrice`/`cost` are compared only when present (they are hidden from an account without the pricing permissions).
 */
function assertCompatibleProduct(def: ProductDef, product: Product, variant: Variant, expectedCategoryId: string | undefined): void {
  if (variant.productId !== undefined && variant.productId !== product.id) {
    throw new SeedGuardError(`SKU ${def.sku}: the variant does not belong to the product that reported it; refusing.`);
  }
  for (const field of ['maxPrice', 'basePrice'] as const) {
    if (!Number.isFinite(asNumber(variant[field]))) throw new SeedGuardError(`SKU ${def.sku}: the variant answer does not report ${field}; refusing to judge it.`);
  }
  const problems: string[] = [];
  if (!sameText(product.name, def.name)) problems.push('name');
  if (expectedCategoryId === undefined || product.categoryId !== expectedCategoryId) problems.push('category');
  for (const field of ['maxPrice', 'basePrice', 'minPrice', 'cost'] as const) {
    const seen = variant[field];
    if (seen !== undefined && seen !== null && asNumber(seen) !== def[field]) problems.push(field);
  }
  if (problems.length > 0) {
    throw new SeedGuardError(
      `SKU ${def.sku} exists but differs from the seed's product (${problems.join(', ')}) — product ${product.id}, variant ${variant.id}, name "${product.name}"; ` +
        `it is not provably the seed's, so it is neither reused nor modified. ${MANUAL}`,
    );
  }
}

/**
 * The seed's product for `def`, identified by its SKU (unique per tenant): the products that match the SKU or the name are listed (the backend's
 * `q` is a case-insensitive substring over name, SKU and barcode), and their variants are read. No candidate holds the SKU → `undefined` (it may be
 * created) unless a product with the same name exists under another SKU (a namesake, never reused and never duplicated). One holder → it must be
 * compatible (see above). More than one holder, or a SKU that differs only in case, is ambiguous and stops the run.
 */
async function findSeedProduct(api: ApiFn, def: ProductDef, expectedCategoryId: string | undefined): Promise<{ product: Product; variant: Variant } | undefined> {
  const candidates = new Map<string, Product>();
  for (const q of searchTermsFor(def)) {
    for (const product of await listEvery<Product>(api, `/api/v1/products?q=${encodeURIComponent(q)}`)) {
      if (typeof product.id !== 'string' || typeof product.name !== 'string') throw new SeedGuardError(`products: a listed product has no id or name, so SKU ${def.sku} cannot be checked; refusing.`);
      candidates.set(product.id, product);
    }
  }
  const holders: Array<{ product: Product; variant: Variant }> = [];
  for (const product of candidates.values()) {
    for (const variant of await variantsOf(api, product.id)) {
      if (variant.sku === def.sku) holders.push({ product, variant });
      else if (variant.sku.toUpperCase() === def.sku.toUpperCase()) throw new SeedGuardError(`SKU ${def.sku}: a variant exists whose SKU differs only in letter case; ambiguous, refusing.`);
    }
  }
  if (holders.length > 1) throw new SeedGuardError(`SKU ${def.sku}: more than one variant reports it; refusing to choose one.`);
  const holder = holders[0];
  if (holder) {
    assertCompatibleProduct(def, holder.product, holder.variant, expectedCategoryId);
    return holder;
  }
  // Namesakes are compared case- AND accent-insensitively: "TALADRO INALAMBRICO 20V" typed without the accent is the same thing to a person.
  const namesakes = [...candidates.values()].filter((p) => foldText(p.name) === foldText(def.name));
  if (namesakes.length > 0) {
    throw new SeedGuardError(
      `product "${def.name}": a product with this name (or the same name without accents) exists under another SKU — ${namesakes.map((p) => `product ${p.id} "${p.name}"`).join('; ')}. ` +
        `A name alone does not make it the seed's, and the seed will not create a namesake. ${MANUAL}`,
    );
  }
  return undefined;
}

/**
 * The search terms used to find candidates (the backend's `q` = ILIKE '%q%' over name, SKU and barcode). ILIKE ignores case but NEVER accents, and
 * whether it even folds the case of "á"/"Á" depends on the database's LC_CTYPE (a C-locale cluster folds ASCII only; `tools/pg-verify` creates its
 * testing cluster with --locale=C). So the name is searched in three locale-proof ways: the SKU; the name exactly as the backend STORES it
 * (identical bytes match under any locale); and the longest purely-ASCII word of the name, which also finds a homonym typed with other accents.
 * Matching is then decided in code, not by the database.
 */
function searchTermsFor(def: ProductDef): string[] {
  const asciiWord = (def.name.match(/[A-Za-z0-9]+/g) ?? []).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length)[0];
  if (asciiWord === undefined) throw new SeedGuardError(`product "${def.name}" has no plain-ASCII word to search by; the seed cannot look for namesakes reliably.`);
  return [def.sku, storedName(def.name), asciiWord];
}

/**
 * The seed's customer, by name AND tax id (unique per tenant). Only one of the two matching, or a different identification type, is not the seed's:
 * the run stops and nothing is patched. (The backend answers `displayName` = "first last".)
 */
function pickCustomer(customers: readonly Customer[], def: CustomerDef): Customer | undefined {
  const name = customerDisplayName(def);
  return pickStrict(
    `customer "${name}"`,
    customers,
    (c) => c.displayName === name || c.taxId === def.taxId,
    (c) => c.displayName === name && c.taxId === def.taxId && (c.type === undefined || c.type === def.type),
  );
}

/**
 * POST /orders/:id/confirm needs `payments` (ConfirmOrderDto: at least one { paymentMethod, amount > 0 }), and the backend rejects the confirmation unless
 * roundMoney(sum of amounts) equals the order total exactly (orders.service.ts). The seed pays the whole total, once, in cash: the amount is the total the backend
 * itself reported for the order, sent unchanged. A total that is missing, not positive, or not already a 2-decimal amount is NOT rounded or guessed: the
 * run stops before confirming anything.
 */
export function paymentsFor(order: { id: string; total?: number }): Array<{ paymentMethod: 'cash'; amount: number }> {
  const total = order.total;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0 || Math.round((total + Number.EPSILON) * 100) / 100 !== total) {
    throw new SeedGuardError(`order ${order.id} does not report a positive total with at most two decimals; the seed will not invent or round a payment amount, so it does not confirm it.`);
  }
  return [{ paymentMethod: 'cash', amount: total }];
}

async function confirmOrder(api: ApiFn, order: Order): Promise<Order> {
  const payments = paymentsFor(order);
  return api<Order>('POST', `/api/v1/orders/${order.id}/confirm`, { payments });
}

function assertCategoriesIdentifiable(categories: readonly Category[]): void {
  if (categories.some((c) => typeof c.name !== 'string' || typeof c.code !== 'string')) {
    throw new SeedGuardError('categories: the list does not report name and code for every category, so ownership cannot be proven; refusing.');
  }
}

const describeCategory = (c: Category): string => `id ${c.id}, code ${String(c.code)}, name "${c.name}"`;

/**
 * The seed's category, or undefined if there is none. It is the seed's only with BOTH the reserved code and the exact (normalised) name. Anything
 * that matches by code, by name or by name-without-accents but is not that — a historical category with an automatic code, a person's category,
 * a near-namesake — stops the run and is described (id, code, name) so a person can deal with it. It is never adopted, recoded or merged.
 */
function pickCategory(categories: readonly Category[], def: { name: string; code: string }): Category | undefined {
  const candidates = categories.filter((c) => foldText(c.name) === foldText(def.name) || sameText(c.code ?? '', def.code));
  if (candidates.length > 1) {
    throw new SeedGuardError(`category "${def.name}": more than one existing record matches by name or code (${candidates.map(describeCategory).join(' | ')}); refusing to choose one. ${MANUAL}`);
  }
  const found = candidates[0];
  if (found === undefined) return undefined;
  if (!(sameText(found.name, def.name) && sameText(found.code ?? '', def.code))) {
    throw new SeedGuardError(
      `category "${def.name}": an existing category (${describeCategory(found)}) matches by name or code but is not provably the seed's — ` +
        `the seed's category has code ${def.code} AND this exact name; refusing to reuse, recode or modify it. ${MANUAL}`,
    );
  }
  return found;
}

/**
 * The caller's own permissions (from the login) and operating scope (`GET /inventory/location-scope`, the caller's own data, open to any
 * authenticated user). Any failure to read either one stops the run with a generic message (the response text is not repeated).
 */
async function assertOrdersAreFullyVisible(api: ApiFn, login: LoginResult): Promise<void> {
  let scope: OperatingScope | undefined;
  try {
    scope = await api<OperatingScope>('GET', '/api/v1/inventory/location-scope');
  } catch {
    throw new SeedGuardError('The location scope of the QA account could not be read (the request failed), so the completeness of GET /orders cannot be proven. Nothing was changed.');
  }
  assertOrderListIsComplete(login.user?.permissions, scope);
}

/** Number of orders of one customer. Refuses a response without a total, with rows of another customer (filter not honoured) or a total without rows. */
async function ordersOfCustomer(api: ApiFn, customerId: string): Promise<number> {
  const path = `/api/v1/orders?customerId=${customerId}`;
  const res = await api<Page<{ customerId?: string }>>('GET', withQuery(path, 'pageSize=1'));
  const total = declaredTotal(res, path);
  const first = res.data[0];
  if (first?.customerId !== undefined && first.customerId !== customerId) throw incomplete(path, 'the customer filter was not honoured');
  if (total > 0 && res.data.length === 0) throw incomplete(path, 'a total without rows');
  return total;
}

/** `--check`: GET-only report of what exists and what a normal run would still have to create. Writes nothing. */
async function inspect(api: ApiFn, log: (line: string) => void, skipped: string[], login: LoginResult): Promise<void> {
  const say = (label: string, state: string): void => log(`  ${label}: ${state}`);
  // A record that would stop a writing run is REPORTED here (all of them, with what a person must do) instead of ending the check at the first one.
  // Only the seed's own refusals are collected; a transport error or an incomplete list still aborts the check at once.
  const blockers: string[] = [];
  const probe = async <T>(label: string, work: () => T | Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof SeedGuardError)) throw error;
      blockers.push(error.message);
      say(label, 'BLOCKER (see the list at the end)');
      return undefined;
    }
  };
  const warehouses = await listEvery<Warehouse>(api, '/api/v1/warehouses');
  for (const def of Object.values(WAREHOUSES)) {
    const before = blockers.length;
    const found = await probe(`warehouse ${def.code}`, () => pickStrict(`warehouse "${def.name}"`, warehouses, (w) => w.name === def.name || w.code === def.code, (w) => w.name === def.name && w.code === def.code));
    if (blockers.length === before) say(`warehouse ${def.code}`, found ? 'present' : 'missing');
  }
  const categories = await listEvery<Category>(api, '/api/v1/categories');
  assertCategoriesIdentifiable(categories);
  const categoryIds = new Map<string, string | undefined>();
  for (const [key, def] of Object.entries(CATEGORIES) as Array<[keyof typeof CATEGORIES, { name: string; code: string }]>) {
    const before = blockers.length;
    const found = await probe(`category ${def.code}`, () => pickCategory(categories, def));
    categoryIds.set(key, found?.id);
    if (blockers.length === before) say(`category ${def.code}`, found ? 'present' : 'missing');
  }
  for (const [key, def] of Object.entries(PRODUCTS) as Array<[keyof typeof PRODUCTS, ProductDef]>) {
    const before = blockers.length;
    const found = await probe(`product ${def.sku}`, () => findSeedProduct(api, def, categoryIds.get(PRODUCT_CATEGORY[key])));
    if (blockers.length === before) say(`product ${def.sku}`, found ? 'present' : 'missing');
  }
  const customers = await listEvery<Customer>(api, '/api/v1/customers');
  for (const def of Object.values(CUSTOMERS)) {
    const before = blockers.length;
    const found = await probe(`customer ${customerDisplayName(def)}`, () => pickCustomer(customers, def));
    if (blockers.length === before) say(`customer ${customerDisplayName(def)}`, found ? 'present' : 'missing');
  }
  const transfers = await listEvery<Transfer>(api, '/api/v1/inventory/transfers');
  say('transfer 1', transfers.some((t) => transferMarker(t.notes, 0)) ? 'present' : 'missing');
  say('transfer 2', transfers.some((t) => transferMarker(t.notes, 1)) ? 'present' : 'missing');
  for (const [name, path] of [['products', '/api/v1/products'], ['movements', '/api/v1/inventory/movements']] as const) {
    say(`total ${name}`, String(await totalOf(api, path)));
  }
  try {
    await assertOrdersAreFullyVisible(api, login);
    say('total orders', String(await totalOf(api, '/api/v1/orders')));
  } catch (error) {
    // Reported, not fatal: --check writes nothing. A normal or --create run would refuse at this point.
    say('orders', `NOT VERIFIABLE (a writing run would refuse). ${error instanceof SeedGuardError ? error.message : 'The orders could not be read.'}`);
  }
  skipped.push('check: nothing written');
  if (blockers.length > 0) {
    throw new SeedGuardError(`--check found ${String(blockers.length)} record(s) that would stop a writing run (nothing was changed):\n${blockers.map((b) => `  - ${b}`).join('\n')}`);
  }
}
