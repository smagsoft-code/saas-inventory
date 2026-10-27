import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, uniq, xlsxText } from './iso-helpers';

/**
 * FASE 19 — seller scope on the inventory LEDGER reads (`GET /inventory/movements`, `GET /reports/kardex` and its xlsx/pdf export).
 *
 * `inventory.view` is held by sellers, supervisors and warehouse staff, and the ledger labels order / return movements with the
 * document number (`Venta #ORD-…`, `Devolución #DEV-…`) and carries the raw `referenceId` (the order uuid) and the actor. ADR-0040
 * says a document derived from an order is subject to the seller scope of the order: a seller without `sales.orders.view_all` must
 * not learn the number, id or actor of ANOTHER seller's order through the ledger. The stock arithmetic itself (quantities, balances,
 * cost) stays visible to every `inventory.view` holder — only the commercial reference is masked; the row stays, with a generic label.
 *
 * Rule under test: an order-derived movement shows its reference to the caller who placed the order or holds `sales.orders.view_all`;
 * a return movement additionally to the warehouse (`inventory.returns.manage`, who process returns).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('seller scope — inventory ledger (movements / Kardex / export) (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  let admin: Session;
  let locationId: string;
  let variantId: string;
  let customerId: string;
  let owner: Session;
  let other: Session;
  let viewAllFn: Session;
  let supervisor: Session;
  let bodega: Session;
  let noPerm: Session;
  let foreignAdmin: Session;

  // fixture: owner's confirmed sale + owner's resolved return + owner's pending order; other's confirmed sale
  const ownerDoc = { orderId: '', orderNumber: '', pendingOrderId: '', pendingOrderNumber: '', returnId: '', returnNumber: '' };
  const otherDoc = { orderId: '', orderNumber: '' };

  const SELLER_CODES = [...DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes];
  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');

  async function roleUser(roleName: string, codes: string[]): Promise<Session> {
    await c.createRole(admin, roleName, [...new Set(codes)]);
    const s = await c.createAndLoginAs(admin, `${stamp()}-${roleName.toLowerCase().replace(/\W+/g, '')}@example.com`, roleName);
    await c.setUserLocations(admin, s.user.id, [locationId]);
    return s;
  }
  const post = (s: Session, url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    c.inject({ method: 'POST', url, headers: c.writeHeaders(s, extra), ...(payload !== undefined ? { payload } : {}) });
  const get = (s: Session | undefined, url: string) => c.inject({ method: 'GET', url, headers: s ? c.readHeaders(s) : {} });
  const json = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;

  async function placeAndMaybeConfirm(s: Session, confirm: boolean): Promise<{ id: string; itemId: string; total: number; orderNumber: string }> {
    const cart = await post(s, '/api/v1/cart', { locationId, customerId });
    expect([200, 201], cart.body).toContain(cart.statusCode);
    const item = await post(s, '/api/v1/cart/items', { productVariantId: variantId, quantity: 4, negotiatedUnitPrice: 110 });
    expect(item.statusCode, item.body).toBe(200);
    const order = await post(s, '/api/v1/orders', { cartId: json<{ id: string }>(cart).id, documentType: 'sales_note' }, { 'idempotency-key': randomUUID() });
    expect(order.statusCode, order.body).toBe(201);
    const body = json<{ id: string; total: number; orderNumber: string; items: Array<{ id: string }> }>(order);
    if (confirm) {
      const res = await post(s, `/api/v1/orders/${body.id}/confirm`, { payments: [{ paymentMethod: 'cash', amount: body.total }] });
      expect(res.statusCode, res.body).toBe(200);
    }
    return { id: body.id, itemId: body.items[0]!.id, total: body.total, orderNumber: body.orderNumber };
  }

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);

    admin = await c.registerTenant(`Iso Ledger ${stamp()}`, `iso-ledger-${stamp()}@example.com`);
    const warehouseId = await c.createWarehouse(admin, `ISOWL-${stamp()}`);
    locationId = await c.createLocation(admin, warehouseId, `ISOLL-${stamp()}`);
    ({ variantId } = await c.createProductVariant(admin, { sku: `ISOLG-${stamp()}`.toUpperCase(), maxPrice: 120, basePrice: 100, minPrice: 80 }));
    await c.receiveStock(admin, variantId, locationId, 1000);
    customerId = await c.createCustomer(admin, c.fullCustomer(`isolg${stamp()}`));

    owner = await roleUser('Vendedor propietario', SELLER_CODES);
    other = await roleUser('Vendedor otro', SELLER_CODES);
    viewAllFn = await roleUser('Vendedor vista total', [...SELLER_CODES, 'sales.orders.view_all']);
    noPerm = await roleUser('Sin permisos', []);
    supervisor = await c.createAndLoginAs(admin, `${stamp()}-supervisor@example.com`, 'Supervisor');
    await c.setUserLocations(admin, supervisor.user.id, [locationId]);
    bodega = await c.createAndLoginAs(admin, `${stamp()}-bodega@example.com`, 'Bodega');
    await c.setUserLocations(admin, bodega.user.id, [locationId]);
    foreignAdmin = await c.registerTenant(`Iso Ledger X ${stamp()}`, `iso-ledgerx-${stamp()}@example.com`);

    const sale = await placeAndMaybeConfirm(owner, true);
    ownerDoc.orderId = sale.id;
    ownerDoc.orderNumber = sale.orderNumber;
    const pending = await placeAndMaybeConfirm(owner, false);
    ownerDoc.pendingOrderId = pending.id;
    ownerDoc.pendingOrderNumber = pending.orderNumber;
    const foreign = await placeAndMaybeConfirm(other, true);
    otherDoc.orderId = foreign.id;
    otherDoc.orderNumber = foreign.orderNumber;

    const ret = await post(owner, '/api/v1/sales-returns', { orderId: sale.id, locationId, reason: 'cliente devuelve el producto', items: [{ orderItemId: sale.itemId, quantity: 1 }] }, { 'idempotency-key': randomUUID() });
    expect(ret.statusCode, ret.body).toBe(201);
    const retBody = json<{ id: string; returnNumber: string; items: Array<{ id: string }> }>(ret);
    ownerDoc.returnId = retBody.id;
    ownerDoc.returnNumber = retBody.returnNumber;
    expect(retBody.returnNumber, 'fixture: return number').toBeTruthy();
    const insp = await post(bodega, `/api/v1/sales-returns/${retBody.id}/inspect`, { items: [{ returnItemId: retBody.items[0]!.id, disposition: 'restock', dispositionLocationId: locationId }] });
    expect(insp.statusCode, insp.body).toBe(200);
    const res = await post(bodega, `/api/v1/sales-returns/${retBody.id}/resolve`, undefined, { 'idempotency-key': randomUUID() });
    expect(res.statusCode, res.body).toBe(200);
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  /** `ORD-000012` must not match inside `ORD-000123`. */
  const mentions = (text: string, token: string): boolean => new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`, 'i').test(text);

  const movementsUrl = () => `/api/v1/inventory/movements?productVariantId=${variantId}&pageSize=100`;
  const kardexUrl = () => `/api/v1/reports/kardex?productVariantId=${variantId}&locationId=${locationId}`;
  const exportUrl = (format: 'xlsx' | 'pdf') => `/api/v1/reports/kardex/export?format=${format}&productVariantId=${variantId}&locationId=${locationId}`;

  type Row = { id: string; movementType: string; quantity: number; balanceAfter: number; referenceType?: string; referenceId?: string; reason?: string; referenceLabel?: string; actorId?: string };
  const movements = async (s: Session): Promise<{ rows: Row[]; text: string }> => {
    const res = await get(s, movementsUrl());
    expect(res.statusCode, res.body).toBe(200);
    return { rows: json<{ data: Row[] }>(res).data, text: res.body };
  };

  const OWN_LEAKS = (): string[] => [ownerDoc.orderNumber, ownerDoc.orderId, ownerDoc.pendingOrderNumber, ownerDoc.pendingOrderId, ownerDoc.returnNumber];

  // Who sees what. `ownerDocs`: the owner's order/return references; `otherDocs`: the other seller's order reference.
  const viewers: Array<{ name: string; who: () => Session; ownerDocs: boolean; otherDocs: boolean; ownerReturn: boolean }> = [
    { name: 'owner', who: () => owner, ownerDocs: true, otherDocs: false, ownerReturn: true },
    { name: 'other seller', who: () => other, ownerDocs: false, otherDocs: true, ownerReturn: false },
    { name: 'Vendedor + view_all', who: () => viewAllFn, ownerDocs: true, otherDocs: true, ownerReturn: true },
    { name: 'Administrador', who: () => admin, ownerDocs: true, otherDocs: true, ownerReturn: true },
    { name: 'Supervisor (no view_all)', who: () => supervisor, ownerDocs: false, otherDocs: false, ownerReturn: true },
    { name: 'Bodega', who: () => bodega, ownerDocs: false, otherDocs: false, ownerReturn: true },
  ];

  it('ISO-LED-01 GET /inventory/movements — the order/return reference (number, uuid, reason, actor) is shown only to its owner, view_all and (for returns) the warehouse', async () => {
    for (const v of viewers) {
      const { rows, text } = await movements(v.who());
      const label = `${v.name}`;
      // the sale of the owner's order and the other seller's order are in the ledger for everyone (stock truth)
      expect(rows.filter((r) => r.movementType === 'SALE').length, `${label}: both SALE rows present`).toBe(2);
      expect(mentions(text, ownerDoc.orderNumber), `${label} sees owner's order number`).toBe(v.ownerDocs);
      expect(text.includes(ownerDoc.orderId), `${label} sees owner's order uuid`).toBe(v.ownerDocs);
      expect(mentions(text, ownerDoc.pendingOrderNumber), `${label} sees owner's pending order number`).toBe(v.ownerDocs);
      expect(text.includes(ownerDoc.pendingOrderId), `${label} sees owner's pending order uuid`).toBe(v.ownerDocs);
      expect(mentions(text, otherDoc.orderNumber), `${label} sees the other seller's order number`).toBe(v.otherDocs);
      expect(text.includes(otherDoc.orderId), `${label} sees the other seller's order uuid`).toBe(v.otherDocs);
      expect(mentions(text, ownerDoc.returnNumber), `${label} sees the owner's return number`).toBe(v.ownerReturn);
    }
  });

  it('ISO-LED-02 a masked movement keeps its row and the stock arithmetic (type, quantity, balance) and gets a generic label — nothing is hidden that is not commercial', async () => {
    const full = await movements(admin);
    const masked = await movements(other);
    expect(masked.rows.map((r) => r.id)).toEqual(full.rows.map((r) => r.id));
    const byId = new Map(full.rows.map((r) => [r.id, r]));
    for (const row of masked.rows) {
      const truth = byId.get(row.id)!;
      expect({ t: row.movementType, q: row.quantity, b: row.balanceAfter }).toEqual({ t: truth.movementType, q: truth.quantity, b: truth.balanceAfter });
    }
    const hiddenSale = masked.rows.find((r) => r.movementType === 'SALE' && r.id === full.rows.find((f) => f.referenceId === ownerDoc.orderId && f.movementType === 'SALE')!.id)!;
    expect(hiddenSale.referenceId).toBeUndefined();
    expect(hiddenSale.reason).toBeUndefined();
    expect(hiddenSale.actorId, 'who rang up the sale is commercial metadata too').toBeUndefined();
    expect(hiddenSale.referenceLabel === undefined || /^(Venta|Pedido|Devolución)$/.test(hiddenSale.referenceLabel), `generic label, got ${hiddenSale.referenceLabel}`).toBe(true);
    // a movement with no commercial document (the manual receipt) is untouched for everyone
    const receipt = masked.rows.find((r) => r.movementType === 'RECEIPT');
    expect(receipt).toBeDefined();
  });

  it('ISO-LED-03 GET /reports/kardex — same scope on the label; balances, opening/closing and stockByLocation are unchanged', async () => {
    const fullRes = await get(admin, kardexUrl());
    expect(fullRes.statusCode, fullRes.body).toBe(200);
    const full = json<{ rows: Array<{ movementId: string; label: string; stockAfter: number; entrada: number; salida: number }>; closing: { stockUnits: number }; stockByLocation: unknown }>(fullRes);
    for (const v of viewers) {
      const res = await get(v.who(), kardexUrl());
      expect(res.statusCode, res.body).toBe(200);
      const body = json<typeof full>(res);
      // the owner's order has a SALE row (order scope) and a RETURN row labelled with the same order number (order scope or warehouse)
      expect(mentions(res.body, ownerDoc.orderNumber), `${v.name} sees owner's order number in Kardex`).toBe(v.ownerDocs || v.ownerReturn);
      expect(mentions(res.body, otherDoc.orderNumber), `${v.name} sees the other seller's order number in Kardex`).toBe(v.otherDocs);
      // RETURN rows are labelled with the ORDER number of the return — ownerReturn (warehouse) or the order's seller/view_all
      expect(body.rows.map((r) => [r.movementId, r.stockAfter, r.entrada, r.salida])).toEqual(full.rows.map((r) => [r.movementId, r.stockAfter, r.entrada, r.salida]));
      expect(body.closing.stockUnits).toBe(full.closing.stockUnits);
      expect(body.stockByLocation).toEqual(full.stockByLocation);
    }
  });

  it('ISO-LED-04 Kardex export (xlsx) carries the same scope as the JSON — a seller cannot get another seller\'s document number from the file', async () => {
    for (const v of viewers) {
      const res = await get(v.who(), exportUrl('xlsx'));
      expect(res.statusCode, `${v.name}`).toBe(200);
      const text = await xlsxText(res.rawPayload);
      expect(mentions(text, ownerDoc.orderNumber), `${v.name}: owner's order number in xlsx`).toBe(v.ownerDocs || v.ownerReturn);
      expect(mentions(text, otherDoc.orderNumber), `${v.name}: other seller's order number in xlsx`).toBe(v.otherDocs);
    }
  });

  it('ISO-LED-05 Kardex export (pdf) is produced from the same scoped data (200, a PDF) for a seller', async () => {
    const res = await get(other, exportUrl('pdf'));
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('ISO-LED-06 list filters cannot be used to probe a hidden document: filtering by movementType / location still masks the reference', async () => {
    for (const url of [`${movementsUrl()}&movementType=SALE`, `${movementsUrl()}&locationId=${locationId}`, `${movementsUrl()}&movementType=RETURN`]) {
      const res = await get(other, url);
      expect(res.statusCode, res.body).toBe(200);
      for (const marker of OWN_LEAKS()) expect(mentions(res.body, marker), `${url} leaks ${marker}`).toBe(false);
    }
  });

  it('ISO-LED-07 no permission / anonymous / other tenant / malformed ids', async () => {
    expectDenied(await get(noPerm, movementsUrl()), [403], 'no permission movements');
    expectDenied(await get(noPerm, kardexUrl()), [403], 'no permission kardex');
    expectDenied(await get(noPerm, exportUrl('xlsx')), [403], 'no permission export');
    expectDenied(await get(undefined, movementsUrl()), [401], 'anonymous movements');
    expectDenied(await get(undefined, kardexUrl()), [401], 'anonymous kardex');
    expectDenied(await get(undefined, exportUrl('xlsx')), [401], 'anonymous export');
    expectDenied(await get(other, '/api/v1/inventory/movements?productVariantId=nope'), [400], 'malformed variant');
    expectDenied(await get(other, '/api/v1/reports/kardex?productVariantId=nope&locationId=nope'), [400], 'malformed kardex ids');
    // another tenant sees nothing of this tenant's ledger, whatever it asks for
    const res = await get(foreignAdmin, movementsUrl());
    if (res.statusCode === 200) {
      expect(json<{ data: unknown[] }>(res).data).toHaveLength(0);
      expect(res.body.includes(variantId) && res.body.includes(ownerDoc.orderId)).toBe(false);
    }
    const k = await get(foreignAdmin, kardexUrl());
    for (const marker of [ownerDoc.orderNumber, otherDoc.orderNumber, ownerDoc.returnNumber]) expect(mentions(k.body, marker), `foreign kardex leaks ${marker}`).toBe(false);
  });
});
