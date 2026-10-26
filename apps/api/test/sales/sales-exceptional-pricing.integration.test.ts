import { randomUUID } from 'node:crypto';
import { generateId } from '@saas-inventory/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, inventoryMovements, tenantPricePolicies } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * FASE 13 Part B — exceptional-discount pricing, order-first (ADR-0022 / database.md#orders).
 * Covers prompt tests P1-P18. No mocks — PostgreSQL manages the locks; movement / audit rows are
 * read straight from the database, never inferred from the HTTP response.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: exceptional pricing approvals (integration)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  interface Fixture {
    admin: Session;
    tenantId: string;
    locationId: string;
    productId: string;
    variantId: string;
    customerId: string;
  }

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
    const { productId, variantId } = await c.createProductVariant(admin, {
      sku: `SKU-${uniq()}`,
      maxPrice: 120,
      basePrice: 100,
      minPrice: 80,
    });
    await c.receiveStock(admin, variantId, locationId, 50);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, tenantId, locationId, productId, variantId, customerId };
  }

  /** Creates a `pending` order with one line at the given unit price (below min => exceptional). */
  async function pendingOrder(
    f: Fixture,
    session: Session,
    opts: { variantId?: string; unitPrice?: number; quantity?: number } = {},
  ): Promise<{ orderId: string; orderItemId: string; isExceptional: boolean; total: number }> {
    const variantId = opts.variantId ?? f.variantId;
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(session), payload: { locationId: f.locationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: c.writeHeaders(session),
      payload: { productVariantId: variantId, quantity: opts.quantity ?? 1, ...(opts.unitPrice === undefined ? {} : { negotiatedUnitPrice: opts.unitPrice }) },
    });
    expect(added.statusCode, added.body).toBe(200);
    const subtotal = (JSON.parse(added.body) as { subtotal: number }).subtotal;
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(session, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    const body = JSON.parse(order.body) as { id: string; items: { id: string; isExceptionalDiscount: boolean }[] };
    return { orderId: body.id, orderItemId: body.items[0]!.id, isExceptional: body.items[0]!.isExceptionalDiscount, total: subtotal };
  }

  // Owner redesign: the payment method is now picked at confirm — callers pass the `total` their
  // own `pendingOrder()` call returned.
  const confirm = (session: Session, orderId: string, amount: number) =>
    c.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/confirm`,
      headers: c.writeHeaders(session),
      payload: { payments: [{ paymentMethod: 'cash', amount }] },
    });

  const requestApproval = (session: Session, payload: Record<string, unknown>) =>
    c.inject({ method: 'POST', url: '/api/v1/price-approvals', headers: c.writeHeaders(session), payload });

  const approve = (session: Session, id: string) =>
    c.inject({ method: 'POST', url: `/api/v1/price-approvals/${id}/approve`, headers: c.writeHeaders(session) });

  const reject = (session: Session, id: string) =>
    c.inject({ method: 'POST', url: `/api/v1/price-approvals/${id}/reject`, headers: c.writeHeaders(session) });

  /** ADR-0035: a non-founding user with zero location assignments is denied — grant the fixture's location. */
  async function grantLocation(f: Fixture, session: Session): Promise<void> {
    const assign = await c.inject({
      method: 'PUT',
      url: `/api/v1/users/${session.user.id}/locations`,
      headers: c.writeHeaders(f.admin),
      payload: { locationIds: [f.locationId] },
    });
    expect(assign.statusCode, assign.body).toBe(200);
  }

  async function movementTypes(tenantId: string, orderId: string): Promise<string[]> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ movementType: inventoryMovements.movementType })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.referenceType, 'order'), eq(inventoryMovements.referenceId, orderId)));
      return rows.map((r) => r.movementType);
    } finally {
      await client.end();
    }
  }

  async function auditActions(tenantId: string, entityId: string): Promise<string[]> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ actionCode: auditLog.actionCode })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityType, 'price_approval'), eq(auditLog.entityId, entityId)));
      return rows.map((r) => r.actionCode);
    } finally {
      await client.end();
    }
  }

  // ---- P1 --------------------------------------------------------------------
  it('P1: a normal (>= base_price) line confirms without any approval — FASE 12 unchanged', async () => {
    const f = await seed('P1 Co', `p1-${uniq()}@ex.com`);
    const { orderId, isExceptional, total } = await pendingOrder(f, f.admin, { unitPrice: 110 });
    expect(isExceptional).toBe(false);
    const r = await confirm(f.admin, orderId, total);
    expect(r.statusCode, r.body).toBe(200);
    expect(JSON.parse(r.body).status).toBe('confirmed');
  });

  // ---- owner policy change: [min_price, base_price) is now exceptional too -----------------
  it('a line in [min_price, base_price) is exceptional (new trigger), but the hard floor never applies to it', async () => {
    const f = await seed('Band Co', `band-${uniq()}@ex.com`);
    // 90 is between min_price (80) and base_price (100) — below base_price now, still above min_price.
    const { orderId, isExceptional, total } = await pendingOrder(f, f.admin, { unitPrice: 90 });
    expect(isExceptional).toBe(true);
    const blocked = await confirm(f.admin, orderId, total);
    expect(blocked.statusCode).toBe(409); // still needs approval despite never going below min_price
  });

  // ---- P2 --------------------------------------------------------------------
  it('P2: a below-min line creates a pending exceptional order; confirm is blocked (409) with no approval', async () => {
    const f = await seed('P2 Co', `p2-${uniq()}@ex.com`);
    const { orderId, isExceptional, total } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    expect(isExceptional).toBe(true);
    const r = await confirm(f.admin, orderId, total);
    expect(r.statusCode).toBe(409);
    expect(await movementTypes(f.tenantId, orderId)).toEqual(['RESERVATION']); // reserved, never SALE
  });

  // ---- P3 / P5 / P9 --------------------------------------------------------------------
  it('P3+P5+P9: request -> approve -> confirm succeeds; snapshot frozen; SALE exactly once; audit present', async () => {
    const f = await seed('P9 Co', `p9-${uniq()}@ex.com`);
    const seller = await c.createAndLoginAs(f.admin, `seller-${uniq()}@ex.com`, 'Vendedor');
    // Vendedor needs to sell at the location:
    await c.setUserLocations(f.admin, seller.user.id, [f.locationId]);
    const { orderId, orderItemId, total } = await pendingOrder(f, seller, { unitPrice: 70 });

    const req = await requestApproval(seller, { orderItemId, reason: 'long-standing customer, matched competitor quote' });
    expect(req.statusCode, req.body).toBe(201);
    const approvalId = (JSON.parse(req.body) as { id: string }).id;

    // The requester cannot confirm yet.
    expect((await confirm(seller, orderId, total)).statusCode).toBe(409);

    // A supervisor (has pricing.discount.approve) approves.
    const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.com`, 'Supervisor');
    const ap = await approve(supervisor, approvalId);
    expect(ap.statusCode, ap.body).toBe(200);
    expect(JSON.parse(ap.body).status).toBe('approved');

    const done = await confirm(seller, orderId, total);
    expect(done.statusCode, done.body).toBe(200);
    const order = JSON.parse(done.body) as { status: string; items: { isExceptionalDiscount: boolean; unitPrice: number }[] };
    expect(order.status).toBe('confirmed');
    expect(order.items[0]!.isExceptionalDiscount).toBe(true);
    expect(order.items[0]!.unitPrice).toBe(70);

    const types = await movementTypes(f.tenantId, orderId);
    expect(types.filter((t) => t === 'SALE')).toHaveLength(1);
    expect(types.filter((t) => t === 'RESERVATION')).toHaveLength(1);
    expect(await auditActions(f.tenantId, approvalId)).toContain('price_approval.approved');
  });

  // ---- P4 --------------------------------------------------------------------
  it('P4: requesting an approval without pricing.discount.request -> 403', async () => {
    const f = await seed('P4 Co', `p4-${uniq()}@ex.com`);
    const bodega = await c.createAndLoginAs(f.admin, `bod-${uniq()}@ex.com`, 'Bodega'); // no pricing.discount.request
    const { orderItemId } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const r = await requestApproval(bodega, { orderItemId, reason: 'trying without permission' });
    expect(r.statusCode).toBe(403);
  });

  // ---- P6 / P12 --------------------------------------------------------------------
  it('P6+P12: a rejected approval never authorizes confirm', async () => {
    const f = await seed('P6 Co', `p6-${uniq()}@ex.com`);
    const { orderId, orderItemId, total } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'please' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    const supervisor = await c.createAndLoginAs(f.admin, `sup6-${uniq()}@ex.com`, 'Supervisor');
    expect((await reject(supervisor, approvalId)).statusCode).toBe(200);
    expect((await confirm(f.admin, orderId, total)).statusCode).toBe(409);
    // Cannot re-approve a rejected request.
    expect((await approve(supervisor, approvalId)).statusCode).toBe(409);
  });

  // ---- P7 --------------------------------------------------------------------
  it('P7: a holder of pricing.discount.approve can resolve their own request (ADR-0022 amendment, 2026-10-26); it is audited', async () => {
    const f = await seed('P7 Co', `p7-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'self' });
    expect(req.statusCode, req.body).toBe(201);
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    // The Administrador holds both pricing.discount.request and pricing.discount.approve (a
    // Supervisor holds only .approve, so it cannot file a request at all).
    expect((await approve(f.admin, approvalId)).statusCode).toBe(200);
    expect(await auditActions(f.tenantId, approvalId)).toContain('price_approval.approved');
  });

  it('P7b: a requester WITHOUT pricing.discount.approve still cannot resolve a request (403 at the route)', async () => {
    const f = await seed('P7b Co', `p7b-${uniq()}@ex.com`);
    const seller = await c.createAndLoginAs(f.admin, `sel7b-${uniq()}@ex.com`, 'Vendedor');
    await grantLocation(f, seller);
    const { orderItemId } = await pendingOrder(f, seller, { unitPrice: 70 });
    const req = await requestApproval(seller, { orderItemId, reason: 'seller asks' });
    expect(req.statusCode, req.body).toBe(201);
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    expect((await approve(seller, approvalId)).statusCode).toBe(403);
    expect((await reject(seller, approvalId)).statusCode).toBe(403);
  });

  // ---- P8 --------------------------------------------------------------------
  it('P8: tenant A cannot read / approve / reject tenant B’s approval (404)', async () => {
    const a = await seed('P8 A', `p8a-${uniq()}@ex.com`);
    const b = await seed('P8 B', `p8b-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(a, a.admin, { unitPrice: 70 });
    const req = await requestApproval(a.admin, { orderItemId, reason: 'cross-tenant' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    expect((await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(b.admin) })).statusCode).toBe(404);
    expect((await approve(b.admin, approvalId)).statusCode).toBe(404);
    expect((await reject(b.admin, approvalId)).statusCode).toBe(404);
  });

  // ---- P10 --------------------------------------------------------------------
  it('P10: a client requestedPrice that does not match the order line is rejected (422)', async () => {
    const f = await seed('P10 Co', `p10-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const r = await requestApproval(f.admin, { orderItemId, reason: 'mismatch', requestedPrice: 60 });
    expect(r.statusCode).toBe(422);
  });

  // ---- P11 --------------------------------------------------------------------
  it('P11: an approval cannot be requested for a line that is not an exceptional discount (422)', async () => {
    const f = await seed('P11 Co', `p11-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(f, f.admin, { unitPrice: 110 }); // within range (>= base_price)
    const r = await requestApproval(f.admin, { orderItemId, reason: 'not needed' });
    expect(r.statusCode).toBe(422);
  });

  // ---- P13 --------------------------------------------------------------------
  it('P13: an approval is bound to one order line — after confirm it stays approved and cannot re-authorize', async () => {
    const f = await seed('P13 Co', `p13-${uniq()}@ex.com`);
    const supervisor = await c.createAndLoginAs(f.admin, `sup13-${uniq()}@ex.com`, 'Supervisor');
    const { orderId, orderItemId, total } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'once' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    expect((await approve(supervisor, approvalId)).statusCode).toBe(200);
    expect((await confirm(f.admin, orderId, total)).statusCode).toBe(200);
    // Confirm again is idempotent (already confirmed) and never writes a second SALE.
    expect((await confirm(f.admin, orderId, total)).statusCode).toBe(200);
    const types = await movementTypes(f.tenantId, orderId);
    expect(types.filter((t) => t === 'SALE')).toHaveLength(1);
    // The approval row is still just "approved" — there is no separate "used" state to leak.
    const get = await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(supervisor) });
    expect(JSON.parse(get.body).status).toBe('approved');
    // A second exceptional order for the same variant needs its OWN approval.
    const second = await pendingOrder(f, f.admin, { unitPrice: 70 });
    expect((await confirm(f.admin, second.orderId, second.total)).statusCode).toBe(409);
  });

  // ---- P14 --------------------------------------------------------------------
  it('P14: two concurrent confirms of one approved exceptional order -> exactly one SALE per line', async () => {
    const f = await seed('P14 Co', `p14-${uniq()}@ex.com`);
    const supervisor = await c.createAndLoginAs(f.admin, `sup14-${uniq()}@ex.com`, 'Supervisor');
    const { orderId, orderItemId, total } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'race' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    expect((await approve(supervisor, approvalId)).statusCode).toBe(200);
    const [r1, r2] = await Promise.all([confirm(f.admin, orderId, total), confirm(f.admin, orderId, total)]);
    expect([r1.statusCode, r2.statusCode].filter((s) => s === 200)).toHaveLength(2); // one confirms, one idempotent
    const types = await movementTypes(f.tenantId, orderId);
    expect(types.filter((t) => t === 'SALE')).toHaveLength(1);
    expect(types.filter((t) => t === 'RESERVATION_RELEASE')).toHaveLength(1);
  });

  // ---- P15 --------------------------------------------------------------------
  it('P15: min_price visibility is gated on pricing.floor.view (approver has it, plain viewer does not)', async () => {
    const f = await seed('P15 Co', `p15-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'floor visibility' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;

    // Supervisor has pricing.floor.view + pricing.discount.approve -> sees minPriceAtRequest.
    const supervisor = await c.createAndLoginAs(f.admin, `sup15-${uniq()}@ex.com`, 'Supervisor');
    const withFloor = JSON.parse(
      (await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(supervisor) })).body,
    );
    expect(withFloor.minPriceAtRequest).toBe(80);
    expect(withFloor.maxPriceAtRequest).toBe(120);

    // A Bodega user (neither pricing.discount.request nor pricing.discount.approve) cannot even read
    // the queue -> 403 (so min_price is never reachable). The exact field-omission for a caller that
    // CAN read but lacks pricing.floor.view is covered by the unit test.
    const bodega = await c.createAndLoginAs(f.admin, `bod15-${uniq()}@ex.com`, 'Bodega');
    expect(
      (await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(bodega) })).statusCode,
    ).toBe(403);
  });

  // ---- P16 --------------------------------------------------------------------
  it('P16: cost never appears in a price-approval response', async () => {
    const f = await seed('P16 Co', `p16-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'no cost leak' });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('cost');
    expect(Object.keys(body)).not.toContain('unitCost');
  });

  // ---- P17 --------------------------------------------------------------------
  it('P17: repricing the variant after checkout does not change the frozen line or break confirm', async () => {
    const f = await seed('P17 Co', `p17-${uniq()}@ex.com`);
    const supervisor = await c.createAndLoginAs(f.admin, `sup17-${uniq()}@ex.com`, 'Supervisor');
    const { orderId, orderItemId, total } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'freeze' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    // Move the catalog min_price to 100 (above the requested 70).
    const patch = await c.inject({
      method: 'PATCH',
      url: `/api/v1/products/${f.productId}/variants/${f.variantId}`,
      headers: c.writeHeaders(f.admin),
      payload: { minPrice: 100, basePrice: 110, maxPrice: 130 },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect((await approve(supervisor, approvalId)).statusCode).toBe(200);
    const done = await confirm(f.admin, orderId, total);
    expect(done.statusCode, done.body).toBe(200);
    expect(JSON.parse(done.body).items[0].unitPrice).toBe(70); // frozen at checkout, never recomputed
  });

  // ---- P18 --------------------------------------------------------------------
  it('P18: a disabled user is blocked (403) on price-approval routes before any mutation', async () => {
    const f = await seed('P18 Co', `p18-${uniq()}@ex.com`);
    const seller = await c.createAndLoginAs(f.admin, `p18s-${uniq()}@ex.com`, 'Vendedor');
    await c.setUserLocations(f.admin, seller.user.id, [f.locationId]);
    const { orderItemId } = await pendingOrder(f, seller, { unitPrice: 70 });
    // Disable the seller.
    const disable = await c.inject({
      method: 'PATCH',
      url: `/api/v1/users/${seller.user.id}`,
      headers: c.writeHeaders(f.admin),
      payload: { status: 'disabled' },
    });
    expect(disable.statusCode, disable.body).toBe(200);
    const r = await requestApproval(seller, { orderItemId, reason: 'disabled now' });
    expect(r.statusCode).toBe(403);
  });

  // ---- GAP-APPROVALS-PERMISSION (F17-09) -------------------------------------
  it('GET /price-approvals is gated by @RequireAnyPermission — requester OR approver reads it, neither is 403', async () => {
    const f = await seed('AP Co', `ap-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(f, f.admin, { unitPrice: 70 });
    const req = await requestApproval(f.admin, { orderItemId, reason: 'permission gate' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;

    // Vendedor holds pricing.discount.request (not .approve) — can read the queue and the row.
    const seller = await c.createAndLoginAs(f.admin, `ap-seller-${uniq()}@ex.com`, 'Vendedor');
    expect((await c.inject({ method: 'GET', url: '/api/v1/price-approvals', headers: c.readHeaders(seller) })).statusCode).toBe(200);
    expect(
      (await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(seller) })).statusCode,
    ).toBe(200);

    // Supervisor holds pricing.discount.approve (not .request) — also reads it.
    const supervisor = await c.createAndLoginAs(f.admin, `ap-sup-${uniq()}@ex.com`, 'Supervisor');
    expect((await c.inject({ method: 'GET', url: '/api/v1/price-approvals', headers: c.readHeaders(supervisor) })).statusCode).toBe(200);

    // Bodega holds neither — 403 on the list and the row (was previously only enforced in the service).
    const bodega = await c.createAndLoginAs(f.admin, `ap-bod-${uniq()}@ex.com`, 'Bodega');
    expect((await c.inject({ method: 'GET', url: '/api/v1/price-approvals', headers: c.readHeaders(bodega) })).statusCode).toBe(403);
    expect(
      (await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(bodega) })).statusCode,
    ).toBe(403);
  });

  it('GET /price-approvals never crosses tenants even for an authorized reader', async () => {
    const a = await seed('AP-ISO A', `apisoa-${uniq()}@ex.com`);
    const b = await seed('AP-ISO B', `apisob-${uniq()}@ex.com`);
    const { orderItemId } = await pendingOrder(a, a.admin, { unitPrice: 70 });
    const req = await requestApproval(a.admin, { orderItemId, reason: 'isolation' });
    const approvalId = (JSON.parse(req.body) as { id: string }).id;
    // b.admin is an authorized reader in tenant B but must not see tenant A's row.
    const list = await c.inject({ method: 'GET', url: '/api/v1/price-approvals', headers: c.readHeaders(b.admin) });
    expect(list.statusCode).toBe(200);
    expect((JSON.parse(list.body) as { data: { id: string }[] }).data.map((r) => r.id)).not.toContain(approvalId);
    expect(
      (await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(b.admin) })).statusCode,
    ).toBe(404);
  });

  // ---- hard floor (tenant_price_policies, read-only w/ direct row) ------------
  it('hard floor: a below-min price beyond max_discount_below_min_percent is rejected at checkout (422, no order)', async () => {
    const f = await seed('HF Co', `hf-${uniq()}@ex.com`);
    const { client, db } = getMigratorDb();
    try {
      await db.insert(tenantPricePolicies).values({
        id: generateId(),
        tenantId: f.tenantId,
        exceptionalDiscountRequiresApproval: true,
        maxDiscountBelowMinPercent: '10', // min 80 => hard floor 72
      });
    } finally {
      await client.end();
    }
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity: 1, negotiatedUnitPrice: 50 } });
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode).toBe(422);
    // A price still within the floor (e.g. 75) succeeds.
    const ok = await pendingOrder(f, f.admin, { unitPrice: 75 });
    expect(ok.isExceptional).toBe(true);
  });
});
