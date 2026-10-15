/**
 * QA visual-data seed — NOT part of the application runtime, NOT the CI verification harness.
 * Populates the tenant `dev-server.ts` already provisioned (qa-admin@dev.local) with one
 * realistic, connected dataset spanning every module the Products/Inventory/Sales/Returns screens
 * need to actually show something: warehouses/locations, categories, products with variants (incl.
 * a multi-variant product), stock, product images (a hand-rolled placeholder PNG, uploaded via the
 * real multipart endpoint), QR codes, customers, sales orders in different statuses, returns (one
 * full lifecycle, one left pending), and transfers (one full lifecycle, one left mid-flight).
 *
 * Deliberately goes through the REAL HTTP API only — never a direct DB connection (this process
 * never imports `postgres`/`drizzle-orm` at all) — the same "seeded via the real HTTP API"
 * convention `dev-server.ts`'s own QA-admin registration and CLAUDE.md's earlier visual-QA passes
 * already use. Idempotency: warehouses/locations/categories are get-or-create (safe to resume after
 * a partial failure); everything from products onward is a pure create, so a full second run
 * duplicates that part of the dataset — this is a throwaway dev script, not `database/seeds/`.
 *
 * Usage: pnpm --filter @saas-inventory/pg-verify seed:qa   (dev-server.ts must already be running)
 */
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const API_BASE = 'http://127.0.0.1:4000';

const QA_ADMIN = { email: 'qa-admin@dev.local', password: 'DevPassword123!' };

function section(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

// --- A tiny cookie-jar HTTP client (session + CSRF, exactly the double-submit pattern
// common/guards/csrf.guard.ts implements) — httpOnly only blocks browser JS, never a server-side
// HTTP client from reading Set-Cookie, so this can hold the real session like any other client. ---
const jar = new Map<string, string>();

function absorbSetCookies(response: Response): void {
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const cookie of raw) {
    const [pair] = cookie.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (!pair || eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function api<T = unknown>(
  method: string,
  urlPath: string,
  body?: unknown,
  opts: { idempotent?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar.size > 0) headers['cookie'] = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = jar.get('csrf_token');
    if (csrf) headers['x-csrf-token'] = csrf;
    if (opts.idempotent) headers['idempotency-key'] = randomUUID();
  }

  const response = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  absorbSetCookies(response);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${method} ${urlPath} -> ${response.status}: ${text}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- Response shape slivers (only the fields this script actually reads) ---
interface Paginated<T> {
  data: T[];
}
interface Warehouse {
  id: string;
  name: string;
}
interface Location {
  id: string;
  name: string;
  warehouseId: string;
}
interface Category {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
}
interface Variant {
  id: string;
  productId: string;
  sku: string;
}
interface Customer {
  id: string;
  displayName: string;
}
interface Cart {
  id: string;
}
interface OrderItem {
  id: string;
  sku: string;
}
interface Order {
  id: string;
  status: string;
  items: OrderItem[];
}
interface ReturnItem {
  id: string;
}
interface ReturnRecord {
  id: string;
  items: ReturnItem[];
}
interface TransferItem {
  id: string;
}
interface Transfer {
  id: string;
  items: TransferItem[];
}

/** get-or-create by name — makes the warehouse/location/category steps safe to resume after a
 * partial failed run (this script has no other idempotency guard; everything past categories is a
 * pure create, since a failure here always happens before any of that runs). */
async function getOrCreate<T extends { id: string }>(
  listPath: string,
  matches: (item: T) => boolean,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await api<Paginated<T>>('GET', listPath);
  const found = existing.data.find(matches);
  if (found) return found;
  return create();
}

async function login(): Promise<{ tenantSlug: string }> {
  const result = await api<{ status: string; user?: { tenantSlug: string } }>('POST', '/api/v1/auth/login', QA_ADMIN);
  if (result.status !== 'authenticated' || !result.user) {
    throw new Error(`Unexpected login result: ${JSON.stringify(result)} — did dev-server.ts register ${QA_ADMIN.email}?`);
  }
  return { tenantSlug: result.user.tenantSlug };
}

async function main(): Promise<void> {
  section('1. Logging in as the QA admin');
  const { tenantSlug } = await login();
  console.log(`  logged in — tenant slug: ${tenantSlug}`);

  section('2. Warehouses ("Sucursal") + Locations ("Almacén", GL-1)');
  const whPrincipal = await getOrCreate<Warehouse>(
    '/api/v1/warehouses?pageSize=100',
    (w) => w.name === 'Sucursal Principal QA',
    () => api('POST', '/api/v1/warehouses', { name: 'Sucursal Principal QA', code: 'SUC-PRIN' }),
  );
  const whNorte = await getOrCreate<Warehouse>(
    '/api/v1/warehouses?pageSize=100',
    (w) => w.name === 'Sucursal Norte QA',
    () => api('POST', '/api/v1/warehouses', { name: 'Sucursal Norte QA', code: 'SUC-NORTE' }),
  );
  const almacenPrincipal = await getOrCreate<Location>(
    `/api/v1/locations?warehouseId=${whPrincipal.id}&pageSize=100`,
    (l) => l.name === 'Almacén Principal',
    () => api('POST', '/api/v1/locations', { warehouseId: whPrincipal.id, name: 'Almacén Principal', code: 'ALM-PRIN' }),
  );
  const cuarentena = await getOrCreate<Location>(
    `/api/v1/locations?warehouseId=${whPrincipal.id}&pageSize=100`,
    (l) => l.name === 'Cuarentena QA',
    () =>
      api('POST', '/api/v1/locations', {
        warehouseId: whPrincipal.id,
        name: 'Cuarentena QA',
        code: 'CUAR-QA',
        isSellable: false,
      }),
  );
  const norteLocations = await api<Paginated<Location>>('GET', `/api/v1/locations?warehouseId=${whNorte.id}&pageSize=100`);
  const almacenNorte = norteLocations.data[0];
  if (!almacenNorte) throw new Error('Sucursal Norte QA has no auto-created default location.');
  console.log(`  ${whPrincipal.name}: Almacén Principal, Cuarentena QA`);
  console.log(`  ${whNorte.name}: ${almacenNorte.name}`);

  section('3. Categories');
  const catFerreteria = await getOrCreate<Category>(
    '/api/v1/categories?pageSize=100',
    (c) => c.name === 'Ferretería',
    () => api('POST', '/api/v1/categories', { name: 'Ferretería' }),
  );
  const catElectronica = await getOrCreate<Category>(
    '/api/v1/categories?pageSize=100',
    (c) => c.name === 'Electrónica',
    () => api('POST', '/api/v1/categories', { name: 'Electrónica' }),
  );

  section('4. Products + variants');
  const existingProducts = await api<Paginated<Product>>('GET', '/api/v1/products?pageSize=100');

  async function createProduct(input: {
    name: string;
    categoryId: string;
    sku: string;
    maxPrice: number;
    basePrice: number;
    minPrice: number;
    cost: number;
  }): Promise<{ product: Product; variant: Variant }> {
    let product = existingProducts.data.find((p) => p.name === input.name);
    if (!product) {
      product = await api<Product>('POST', '/api/v1/products', {
        name: input.name,
        categoryId: input.categoryId,
        defaultVariant: {
          sku: input.sku,
          maxPrice: input.maxPrice,
          basePrice: input.basePrice,
          minPrice: input.minPrice,
          cost: input.cost,
        },
      });
      await api('PATCH', `/api/v1/products/${product.id}`, { status: 'active' });
    }
    const variants = await api<Variant[]>('GET', `/api/v1/products/${product.id}/variants`);
    const variant = variants.find((v) => v.sku === input.sku) ?? variants[0];
    if (!variant) throw new Error(`Product "${input.name}" has no variant after creation.`);
    console.log(`  ${input.name} (${input.sku})`);
    return { product, variant };
  }

  const taladro = await createProduct({
    name: 'Taladro Inalámbrico 20V',
    categoryId: catFerreteria.id,
    sku: 'TAL-20V-001',
    maxPrice: 150,
    basePrice: 120,
    minPrice: 100,
    cost: 70,
  });
  const casco = await createProduct({
    name: 'Casco de Seguridad',
    categoryId: catFerreteria.id,
    sku: 'CASCO-001',
    maxPrice: 25,
    basePrice: 18,
    minPrice: 15,
    cost: 9,
  });
  const multimetro = await createProduct({
    name: 'Multímetro Digital',
    categoryId: catElectronica.id,
    sku: 'MULTI-001',
    maxPrice: 45,
    basePrice: 35,
    minPrice: 28,
    cost: 18,
  });
  const cable = await createProduct({
    name: 'Cable UTP Cat6 (rollo 100m)',
    categoryId: catElectronica.id,
    sku: 'CABLE-UTP6',
    maxPrice: 60,
    basePrice: 48,
    minPrice: 40,
    cost: 30,
  });
  const linterna = await createProduct({
    name: 'Linterna LED Recargable',
    categoryId: catElectronica.id,
    sku: 'LINT-001',
    maxPrice: 20,
    basePrice: 15,
    minPrice: 12,
    cost: 7,
  });
  await api('PATCH', `/api/v1/products/${linterna.product.id}/variants/${linterna.variant.id}`, { status: 'discontinued' });
  console.log('  Linterna LED Recargable — variant marked discontinued, no stock (filter test case)');

  const guantes = await createProduct({
    name: 'Guantes de Trabajo',
    categoryId: catFerreteria.id,
    sku: 'GUANTE-M',
    maxPrice: 12,
    basePrice: 9,
    minPrice: 7,
    cost: 4,
  });
  const guanteVariants = await api<Variant[]>('GET', `/api/v1/products/${guantes.product.id}/variants`);
  if (!guanteVariants.some((v) => v.sku === 'GUANTE-L')) {
    await api<Variant>('POST', `/api/v1/products/${guantes.product.id}/variants`, {
      sku: 'GUANTE-L',
      maxPrice: 12,
      basePrice: 9,
      minPrice: 7,
      cost: 4,
    });
  }
  console.log('  Guantes de Trabajo — 2 variants (GUANTE-M, GUANTE-L; one row per variant)');

  section('5. Initial stock (POST /inventory/adjustments, RECEIPT)');
  async function stock(variantId: string, locationId: string, quantity: number): Promise<void> {
    await api('POST', '/api/v1/inventory/adjustments', {
      productVariantId: variantId,
      locationId,
      movementType: 'RECEIPT',
      quantity,
      reason: 'Existencia inicial — dataset de pruebas QA',
    });
  }
  await stock(taladro.variant.id, almacenPrincipal.id, 25);
  await stock(taladro.variant.id, cuarentena.id, 1); // mirrors the reference "Existencias" screenshot row
  await stock(casco.variant.id, almacenPrincipal.id, 40);
  await stock(multimetro.variant.id, almacenPrincipal.id, 12);
  await stock(cable.variant.id, almacenPrincipal.id, 8);
  await stock(guantes.variant.id, almacenPrincipal.id, 15);
  // linterna and guanteL are left with zero stock on purpose — "Sin Stock" filter test cases.
  console.log('  stocked every variant except Linterna LED and Guantes de Trabajo (talla L) — zero-stock test cases');

  section('6. Product images (shared placeholder, real multipart upload — POST /products/:id/images)');
  const placeholderPng = buildPlaceholderPng();
  for (const { product } of [taladro, casco, multimetro, cable, linterna, guantes]) {
    await uploadProductImage(product.id, placeholderPng);
  }
  console.log('  uploaded the same placeholder image to all 6 products');

  section('7. QR codes');
  for (const variant of [taladro.variant, casco.variant, multimetro.variant]) {
    await api('POST', '/api/v1/qr-codes', { targetType: 'product_variant', targetId: variant.id });
  }
  console.log('  QR generated for Taladro, Casco and Multímetro — the rest show "Generar"');

  section('8. Customers');
  // Both need taxId + address on file — OrdersService requires it to checkout regardless of
  // documentType (not only for documentType: 'invoice', as CreateOrderDto's own doc comment
  // implies — confirmed against the real 422 this produced when customer1 had neither).
  const customer1 = await getOrCreate<Customer>(
    '/api/v1/customers?pageSize=100',
    (c) => c.displayName === 'Juan Pérez',
    () =>
      api('POST', '/api/v1/customers', {
        type: 'individual',
        displayName: 'Juan Pérez',
        taxId: '1710000001',
        email: 'juan.perez@example.com',
        phone: '0991234567',
        address: { line1: 'Calle Los Álamos 456', city: 'Quito', country: 'Ecuador' },
      }),
  );
  const customer2 = await getOrCreate<Customer>(
    '/api/v1/customers?pageSize=100',
    (c) => c.displayName === 'Ferretería El Tornillo S.A.',
    () =>
      api('POST', '/api/v1/customers', {
        type: 'business',
        displayName: 'Ferretería El Tornillo S.A.',
        taxId: '1790000000001',
        email: 'compras@eltornillo.example',
        phone: '022345678',
        address: { line1: 'Av. Amazonas 123', city: 'Quito', country: 'Ecuador' },
      }),
  );
  // Both patched unconditionally, even when reused from a previous partial run — a run that failed
  // before this fix existed could have left one on file missing a field OrdersService.checkout
  // requires (confirmed against real 422s: taxId, address, then phone — all required regardless of
  // documentType, not only for documentType: 'invoice' as CreateOrderDto's doc comment implies).
  await api('PATCH', `/api/v1/customers/${customer1.id}`, {
    taxId: '1710000001',
    phone: '0991234567',
    address: { line1: 'Calle Los Álamos 456', city: 'Quito', country: 'Ecuador' },
  });
  await api('PATCH', `/api/v1/customers/${customer2.id}`, {
    taxId: '1790000000001',
    phone: '022345678',
    address: { line1: 'Av. Amazonas 123', city: 'Quito', country: 'Ecuador' },
  });
  console.log(`  ${customer1.displayName}, ${customer2.displayName}`);

  section('9. Sales orders (one confirmed, one pending, one cancelled)');
  async function openCart(locationId: string, customerId: string): Promise<Cart> {
    return api<Cart>('POST', '/api/v1/cart', { locationId, customerId });
  }
  async function addItem(variantId: string, quantity: number): Promise<void> {
    await api('POST', '/api/v1/cart/items', { productVariantId: variantId, quantity });
  }

  const cart1 = await openCart(almacenPrincipal.id, customer1.id);
  await addItem(taladro.variant.id, 2);
  await addItem(casco.variant.id, 3);
  const order1 = await api<Order>('POST', '/api/v1/orders', { cartId: cart1.id, documentType: 'sales_note' }, { idempotent: true });
  const order1Confirmed = await api<Order>('POST', `/api/v1/orders/${order1.id}/confirm`);
  console.log(`  order 1 (${order1Confirmed.status}): Taladro x2, Casco x3 — customer ${customer1.displayName}`);

  const cart2 = await openCart(almacenPrincipal.id, customer2.id);
  await addItem(multimetro.variant.id, 1);
  await addItem(cable.variant.id, 1);
  const order2 = await api<Order>('POST', '/api/v1/orders', { cartId: cart2.id, documentType: 'invoice' }, { idempotent: true });
  console.log(`  order 2 (${order2.status}): Multímetro x1, Cable x1 — customer ${customer2.displayName}, left unconfirmed`);

  const cart3 = await openCart(almacenPrincipal.id, customer1.id);
  await addItem(casco.variant.id, 1);
  const order3 = await api<Order>('POST', '/api/v1/orders', { cartId: cart3.id, documentType: 'sales_note' }, { idempotent: true });
  await api('POST', `/api/v1/orders/${order3.id}/cancel`);
  console.log(`  order 3: cancelled — customer ${customer1.displayName}`);

  section('10. Returns (one resolved, one left pending inspection)');
  const taladroLine = order1Confirmed.items.find((item) => item.sku === taladro.variant.sku);
  const cascoLine = order1Confirmed.items.find((item) => item.sku === casco.variant.sku);
  if (!taladroLine || !cascoLine) throw new Error('Could not find order1 line items by SKU for the returns step.');

  const return1 = await api<ReturnRecord>(
    'POST',
    '/api/v1/sales-returns',
    {
      orderId: order1Confirmed.id,
      locationId: almacenPrincipal.id,
      reason: 'Cliente devolvió por cambio de opinión',
      items: [{ orderItemId: taladroLine.id, quantity: 1 }],
    },
    { idempotent: true },
  );
  const return1Item = return1.items[0];
  if (!return1Item) throw new Error('return1 has no items after creation.');
  await api('POST', `/api/v1/sales-returns/${return1.id}/inspect`, {
    items: [{ returnItemId: return1Item.id, disposition: 'restock', dispositionLocationId: almacenPrincipal.id }],
  });
  await api('POST', `/api/v1/sales-returns/${return1.id}/resolve`, undefined, { idempotent: true });
  console.log('  return 1: resolved (1 Taladro restocked to Almacén Principal)');

  await api(
    'POST',
    '/api/v1/sales-returns',
    {
      orderId: order1Confirmed.id,
      locationId: almacenPrincipal.id,
      reason: 'Producto con defecto de fábrica',
      items: [{ orderItemId: cascoLine.id, quantity: 1 }],
    },
    { idempotent: true },
  );
  console.log('  return 2: left "requested" — pending inspection');

  section('11. Transfers (one received, one left approved)');
  const transfer1 = await api<Transfer>('POST', '/api/v1/inventory/transfers', {
    sourceLocationId: almacenPrincipal.id,
    destinationLocationId: almacenNorte.id,
    items: [{ productVariantId: taladro.variant.id, quantityRequested: 5 }],
    notes: 'Reposición Sucursal Norte QA',
  });
  await api('POST', `/api/v1/inventory/transfers/${transfer1.id}/approve`);
  await api('POST', `/api/v1/inventory/transfers/${transfer1.id}/prepare`);
  await api('POST', `/api/v1/inventory/transfers/${transfer1.id}/dispatch`, {});
  const transfer1Item = transfer1.items[0];
  if (!transfer1Item) throw new Error('transfer1 has no items after creation.');
  await api(
    'POST',
    `/api/v1/inventory/transfers/${transfer1.id}/receive`,
    { items: [{ transferItemId: transfer1Item.id, quantityReceived: 5 }] },
    { idempotent: true },
  );
  console.log('  transfer 1: received (5x Taladro, Almacén Principal -> Sucursal Norte QA)');

  const transfer2 = await api<Transfer>('POST', '/api/v1/inventory/transfers', {
    sourceLocationId: almacenPrincipal.id,
    destinationLocationId: almacenNorte.id,
    items: [{ productVariantId: casco.variant.id, quantityRequested: 5 }],
    notes: 'Segunda reposición — pendiente de despacho',
  });
  await api('POST', `/api/v1/inventory/transfers/${transfer2.id}/approve`);
  console.log('  transfer 2: left "approved" — not dispatched yet');

  section('DONE');
  console.log('  Log in at http://localhost:3000/login as qa-admin@dev.local / DevPassword123! and browse:');
  console.log('    /products    — 7 variants across 6 products, thumbnails, stock/status/QR mix');
  console.log('    /warehouses, /locations — 2 sucursales, 3 almacenes (one non-sellable: Cuarentena QA)');
  console.log('    /sales       — 1 confirmed, 1 pending, 1 cancelled order');
  console.log('    /returns     — 1 resolved, 1 pending inspection');
  console.log('    /inventory/transfers — 1 received, 1 approved (not dispatched)');
}

/** Hand-rolled minimal valid PNG (IHDR/IDAT/IEND + table-based CRC32) — a flat `#2F6FED` square,
 * same approach `seed-test-product-images.ts` uses, so this script has no image-library dependency
 * for a one-off dev seed. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function buildPlaceholderPng(size = 128): Buffer {
  const [r, g, b] = [0x2f, 0x6f, 0xed];
  const rowBytes = size * 3;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = r;
      raw[pixelStart + 1] = g;
      raw[pixelStart + 2] = b;
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(raw);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Real multipart upload against `POST /products/:productId/images` — bypasses the JSON-only
 * `api()` helper (fetch sets its own multipart boundary when the body is a `FormData`), but reuses
 * the same cookie jar + CSRF header the session needs. */
async function uploadProductImage(productId: string, png: Buffer): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'placeholder.png');
  const headers: Record<string, string> = {};
  if (jar.size > 0) headers['cookie'] = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const csrf = jar.get('csrf_token');
  if (csrf) headers['x-csrf-token'] = csrf;

  const response = await fetch(`${API_BASE}/api/v1/products/${productId}/images`, { method: 'POST', headers, body: form });
  absorbSetCookies(response);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST /api/v1/products/${productId}/images -> ${response.status}: ${text}`);
  }
}

main().catch((error: unknown) => {
  console.error('\nseed-qa-data failed:', error);
  process.exitCode = 1;
});
