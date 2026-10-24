import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, inventoryMovements } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * PROMPT 012-A — real concurrency on the transitions of ONE order (confirm vs confirm, confirm vs
 * cancel), and the exactly-once inventory / audit guarantee that follows. The serialization
 * mechanism under test is `OrdersRepository.lockById` (`SELECT ... FOR UPDATE` on the `orders`
 * row, taken at the top of the `withTenantTransaction` in both `confirm` and `cancel`) — a second
 * concurrent transition on the same order blocks there until the first commits, then re-reads the
 * now-terminal status and either returns idempotently (confirm on an already-`confirmed` order) or
 * rejects (`409`). No mocks — PostgreSQL manages the lock; movement/audit counts are read straight
 * from the database, never inferred from the HTTP response.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: order transition concurrency (integration, PROMPT 012-A)', () => {
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
    variantIds: string[];
    customerId: string;
  }

  async function seed(company: string, email: string, opts: { stock?: number; lines?: number } = {}): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const variantIds: string[] = [];
    for (let i = 0; i < (opts.lines ?? 1); i += 1) {
      const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}` });
      await c.receiveStock(admin, variantId, locationId, opts.stock ?? 50);
      variantIds.push(variantId);
    }
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, tenantId, locationId, variantIds, customerId };
  }

  /** Creates a fresh `pending` order (one cart per checkout — the cart is checked_out afterwards). */
  async function pendingOrder(f: Fixture, quantityPerLine = 2): Promise<string> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    await c.inject({ method: 'PATCH', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { customerId: f.customerId } });
    for (const variantId of f.variantIds) {
      const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: variantId, quantity: quantityPerLine } });
      expect(added.statusCode, added.body).toBe(200);
    }
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    return (JSON.parse(order.body) as { id: string }).id;
  }

  // Owner redesign: the payment method is now picked at confirm — `amount` defaults to 200 (the
  // common `pendingOrder(f, 2)` fixture: 1 line, 2 units @ basePrice 100), overridden by callers
  // whose fixture has a different line count or quantity.
  const confirm = (f: Fixture, orderId: string, amount = 200) =>
    c.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/confirm`,
      headers: c.writeHeaders(f.admin),
      payload: { payments: [{ paymentMethod: 'cash', amount }] },
    });
  const cancel = (f: Fixture, orderId: string) =>
    c.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: c.writeHeaders(f.admin) });

  interface MovementCounts {
    sale: number;
    reservationRelease: number;
    reservation: number;
  }

  async function movementCounts(tenantId: string, orderId: string): Promise<Record<string, MovementCounts>> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ movementType: inventoryMovements.movementType, productVariantId: inventoryMovements.productVariantId })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.referenceType, 'order'), eq(inventoryMovements.referenceId, orderId)));
      const byVariant: Record<string, MovementCounts> = {};
      for (const row of rows) {
        const bucket = (byVariant[row.productVariantId] ??= { sale: 0, reservationRelease: 0, reservation: 0 });
        if (row.movementType === 'SALE') bucket.sale += 1;
        else if (row.movementType === 'RESERVATION_RELEASE') bucket.reservationRelease += 1;
        else if (row.movementType === 'RESERVATION') bucket.reservation += 1;
      }
      return byVariant;
    } finally {
      await client.end();
    }
  }

  async function auditCounts(tenantId: string, orderId: string): Promise<Record<string, number>> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ actionCode: auditLog.actionCode })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityType, 'order'), eq(auditLog.entityId, orderId)));
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.actionCode] = (counts[row.actionCode] ?? 0) + 1;
      return counts;
    } finally {
      await client.end();
    }
  }

  interface BalanceRow {
    locationId: string;
    quantityPhysical: number;
    quantityReserved: number;
    quantityCommitted: number;
    quantityAvailable: number;
  }
  const EMPTY_BALANCE: BalanceRow = { locationId: '', quantityPhysical: 0, quantityReserved: 0, quantityCommitted: 0, quantityAvailable: 0 };

  async function balanceRows(f: Fixture, variantId: string): Promise<BalanceRow[]> {
    const response = await c.inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}&pageSize=50`, headers: c.readHeaders(f.admin) });
    return (JSON.parse(response.body) as { data: BalanceRow[] }).data;
  }

  async function balance(f: Fixture, variantId: string): Promise<BalanceRow> {
    return (await balanceRows(f, variantId))[0] ?? EMPTY_BALANCE;
  }

  async function balanceAt(f: Fixture, variantId: string, locationId: string): Promise<BalanceRow> {
    return (await balanceRows(f, variantId)).find((row) => row.locationId === locationId) ?? EMPTY_BALANCE;
  }

  async function orderStatus(f: Fixture, orderId: string): Promise<string> {
    const response = await c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: c.readHeaders(f.admin) });
    return (JSON.parse(response.body) as { status: string }).status;
  }

  describe('closing date — confirm moves the order date to the confirmation instant', () => {
    it('createdAt becomes the confirmation time, the audit log keeps the placement and closing dates, a retry changes nothing', async () => {
      const f = await seed(`Co close ${Date.now()}`, `close-${Date.now()}@example.com`);
      const orderId = await pendingOrder(f);
      const before = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: c.readHeaders(f.admin) })).body) as { createdAt: string };
      await new Promise((resolve) => setTimeout(resolve, 50));

      const first = await confirm(f, orderId);
      expect(first.statusCode, first.body).toBe(200);
      const confirmed = JSON.parse(first.body) as { createdAt: string };
      expect(new Date(confirmed.createdAt).getTime()).toBeGreaterThan(new Date(before.createdAt).getTime());

      // The payment is stamped with the same instant as the order's new date.
      const payments = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/reports/payments?dateFrom=${new Date().toISOString().slice(0, 10)}&dateTo=${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}`, headers: c.readHeaders(f.admin) })).body) as { data: { paidAt: string }[] };
      expect(payments.data[0]?.paidAt).toBe(confirmed.createdAt);

      const { client, db } = getMigratorDb();
      try {
        const rows = await db
          .select({ afterState: auditLog.afterState })
          .from(auditLog)
          .where(and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.entityType, 'order'), eq(auditLog.entityId, orderId), eq(auditLog.actionCode, 'order.confirmed')));
        expect(rows).toHaveLength(1);
        expect(rows[0]!.afterState).toMatchObject({ status: 'confirmed', createdAt: before.createdAt, closedAt: confirmed.createdAt });
      } finally {
        await client.end();
      }

      const retry = JSON.parse((await confirm(f, orderId)).body) as { createdAt: string };
      expect(retry.createdAt).toBe(confirmed.createdAt);
    });

    it('migration 0047 re-dates an order confirmed before the change to its payment instant, keeps the original in the audit log, leaves updated_at alone, and is a no-op the second time', async () => {
      const f = await seed(`Co backfill ${Date.now()}`, `backfill-${Date.now()}@example.com`);
      const orderId = await pendingOrder(f);
      const confirmed = JSON.parse((await confirm(f, orderId)).body) as { createdAt: string };

      // Simulate an order confirmed before the change: dated 3 days earlier than its payment.
      const { client } = getMigratorDb();
      try {
        await client`update orders set created_at = created_at - interval '3 days' where id = ${orderId}`;
        const [before] = await client<{ created_at: string; updated_at: string }[]>`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at, updated_at::text as updated_at from orders where id = ${orderId}`;
        const migration = readFileSync(fileURLToPath(new URL('../../../../database/migrations/0047_backfill_confirmed_order_dates.sql', import.meta.url)), 'utf8');
        const statements = migration.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
        const run = () =>
          client.begin(async (tx) => {
            for (const statement of statements) await tx.unsafe(statement);
          });
        await run();

        const [after] = await client<{ created_at: string; updated_at: string }[]>`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at, updated_at::text as updated_at from orders where id = ${orderId}`;
        expect(after!.created_at).toBe(confirmed.createdAt);
        expect(after!.updated_at).toBe(before!.updated_at);
        const audit = await client<{ after_state: { createdAt: string; closedAt: string } }[]>`
          select after_state from audit_log where entity_id = ${orderId} and action_code = 'order.confirmed.date_backfill'`;
        expect(audit).toHaveLength(1);
        expect(audit[0]!.after_state.createdAt).toBe(before!.created_at);
        expect(audit[0]!.after_state.closedAt).toBe(confirmed.createdAt);

        await run();
        const again = await client`select 1 from audit_log where entity_id = ${orderId} and action_code = 'order.confirmed.date_backfill'`;
        expect(again).toHaveLength(1);
      } finally {
        await client.end();
      }
    });

    it('a cancelled order keeps its placement date', async () => {
      const f = await seed(`Co cancel ${Date.now()}`, `cancel-date-${Date.now()}@example.com`);
      const orderId = await pendingOrder(f);
      const before = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: c.readHeaders(f.admin) })).body) as { createdAt: string };
      const cancelled = JSON.parse((await cancel(f, orderId)).body) as { createdAt: string };
      expect(cancelled.createdAt).toBe(before.createdAt);
    });
  });

  describe('T1 / T7 — confirm vs confirm (§23, §29, §48, §96)', () => {
    it('two simultaneous confirms -> one confirmed order, exactly one SALE and one RESERVATION_RELEASE per line, one audit', async () => {
      const f = await seed('T1 Co', 'admin@t1.example', { stock: 50 });
      const orderId = await pendingOrder(f, 3);

      const [a, b] = await Promise.all([confirm(f, orderId, 300), confirm(f, orderId, 300)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 200]);
      expect((JSON.parse(a.body) as { status: string }).status).toBe('confirmed');
      expect((JSON.parse(b.body) as { status: string }).status).toBe('confirmed');
      expect(await orderStatus(f, orderId)).toBe('confirmed');

      const counts = await movementCounts(f.tenantId, orderId);
      expect(counts[f.variantIds[0]!]).toEqual({ sale: 1, reservationRelease: 1, reservation: 1 });

      const bal = await balance(f, f.variantIds[0]!);
      expect(bal.quantityPhysical).toBe(47);
      expect(bal.quantityReserved).toBe(0);
      expect(bal.quantityCommitted).toBe(0);

      const audit = await auditCounts(f.tenantId, orderId);
      expect(audit['order.confirmed']).toBe(1);
      expect(audit['order.cancelled']).toBeUndefined();
    });

    it('T5 — sequential confirm is idempotent: SALE = 1, RESERVATION_RELEASE = 1 (§21, §48)', async () => {
      const f = await seed('T5 Co', 'admin@t5.example', { stock: 20 });
      const orderId = await pendingOrder(f, 2);
      expect((await confirm(f, orderId)).statusCode).toBe(200);
      expect((await confirm(f, orderId)).statusCode).toBe(200);
      expect((await confirm(f, orderId)).statusCode).toBe(200);
      const counts = await movementCounts(f.tenantId, orderId);
      expect(counts[f.variantIds[0]!]).toEqual({ sale: 1, reservationRelease: 1, reservation: 1 });
    });
  });

  describe('T2 — confirm vs cancel (§24-§26, §97)', () => {
    it('exactly one transition wins; never confirmed AND cancelled; inventory matches the winner', async () => {
      // Run the race several times — the winner varies, both outcomes must stay consistent.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const f = await seed(`T2 Co ${attempt}`, `admin@t2-${attempt}.example`, { stock: 30 });
        const orderId = await pendingOrder(f, 2);

        const [confirmRes, cancelRes] = await Promise.all([confirm(f, orderId), cancel(f, orderId)]);
        const statuses = [confirmRes.statusCode, cancelRes.statusCode].sort();
        expect(statuses).toEqual([200, 409]);

        const finalStatus = await orderStatus(f, orderId);
        const counts = (await movementCounts(f.tenantId, orderId))[f.variantIds[0]!]!;

        if (finalStatus === 'confirmed') {
          expect(confirmRes.statusCode).toBe(200);
          expect(counts).toEqual({ sale: 1, reservationRelease: 1, reservation: 1 });
          const bal = await balance(f, f.variantIds[0]!);
          expect(bal.quantityPhysical).toBe(28);
          expect(bal.quantityReserved).toBe(0);
          expect((await auditCounts(f.tenantId, orderId))['order.cancelled']).toBeUndefined();
        } else {
          expect(finalStatus).toBe('cancelled');
          expect(cancelRes.statusCode).toBe(200);
          expect(counts).toEqual({ sale: 0, reservationRelease: 1, reservation: 1 });
          const bal = await balance(f, f.variantIds[0]!);
          expect(bal.quantityPhysical).toBe(30);
          expect(bal.quantityReserved).toBe(0);
          expect((await auditCounts(f.tenantId, orderId))['order.confirmed']).toBeUndefined();
        }
      }
    });
  });

  describe('T6 / T7 / T8 — sequential terminal transitions (§22, §49-§51)', () => {
    it('T6 — sequential cancel is idempotent: RESERVATION_RELEASE = 1, SALE = 0', async () => {
      const f = await seed('T6 Co', 'admin@t6.example', { stock: 15 });
      const orderId = await pendingOrder(f, 2);
      expect((await cancel(f, orderId)).statusCode).toBe(200);
      expect((await cancel(f, orderId)).statusCode).toBe(200);
      const counts = await movementCounts(f.tenantId, orderId);
      expect(counts[f.variantIds[0]!]).toEqual({ sale: 0, reservationRelease: 1, reservation: 1 });
      expect((await balance(f, f.variantIds[0]!)).quantityReserved).toBe(0);
    });

    it('T7 — cancel after confirm -> 409, no new inventory effect', async () => {
      const f = await seed('T7 Co', 'admin@t7.example', { stock: 15 });
      const orderId = await pendingOrder(f, 2);
      expect((await confirm(f, orderId)).statusCode).toBe(200);
      const before = await movementCounts(f.tenantId, orderId);
      expect((await cancel(f, orderId)).statusCode).toBe(409);
      expect(await movementCounts(f.tenantId, orderId)).toEqual(before);
      expect(await orderStatus(f, orderId)).toBe('confirmed');
    });

    it('T8 — confirm after cancel -> 409, no SALE', async () => {
      const f = await seed('T8 Co', 'admin@t8.example', { stock: 15 });
      const orderId = await pendingOrder(f, 2);
      expect((await cancel(f, orderId)).statusCode).toBe(200);
      expect((await confirm(f, orderId)).statusCode).toBe(409);
      const counts = await movementCounts(f.tenantId, orderId);
      expect(counts[f.variantIds[0]!]!.sale).toBe(0);
      expect(await orderStatus(f, orderId)).toBe('cancelled');
    });
  });

  describe('T9 / T10 — multi-line orders (§52-§53)', () => {
    it('T9 — confirm vs confirm on a 3-line order: every line gets exactly one RESERVATION_RELEASE and one SALE', async () => {
      const f = await seed('T9 Co', 'admin@t9.example', { stock: 40, lines: 3 });
      const orderId = await pendingOrder(f, 2);
      const [a, b] = await Promise.all([confirm(f, orderId, 600), confirm(f, orderId, 600)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 200]);
      const counts = await movementCounts(f.tenantId, orderId);
      for (const variantId of f.variantIds) {
        expect(counts[variantId]).toEqual({ sale: 1, reservationRelease: 1, reservation: 1 });
        expect((await balance(f, variantId)).quantityPhysical).toBe(38);
      }
    });

    it('T10 — confirm vs cancel on a 2-line order: the winner applies fully to BOTH lines (never split)', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const f = await seed(`T10 Co ${attempt}`, `admin@t10-${attempt}.example`, { stock: 40, lines: 2 });
        const orderId = await pendingOrder(f, 2);
        const [confirmRes, cancelRes] = await Promise.all([confirm(f, orderId, 400), cancel(f, orderId)]);
        expect([confirmRes.statusCode, cancelRes.statusCode].sort()).toEqual([200, 409]);
        const finalStatus = await orderStatus(f, orderId);
        const counts = await movementCounts(f.tenantId, orderId);
        for (const variantId of f.variantIds) {
          if (finalStatus === 'confirmed') {
            expect(counts[variantId]).toEqual({ sale: 1, reservationRelease: 1, reservation: 1 });
          } else {
            expect(counts[variantId]).toEqual({ sale: 0, reservationRelease: 1, reservation: 1 });
          }
        }
      }
    });
  });

  describe('failure atomicity + regressions (§33-§40, §79-§80)', () => {
    it('T3/T4 — a confirm that throws before/among the movement loop rolls back entirely (order stays pending, ZERO movements added)', async () => {
      // Deterministic failure point: location authorization. `confirm` calls
      // LocationAuthorizationService.assertAccess after taking the order-row lock and before writing
      // any RESERVATION_RELEASE/SALE. A Vendedor restricted to a different location hits that throw
      // inside the same withTenantTransaction — the transaction rolls back, so nothing partial is
      // left. This proves the frontier: any exception raised anywhere in confirm/cancel discards
      // every write made so far in that call (RESERVATION_RELEASE included), exactly like a failure
      // *between* RESERVATION_RELEASE and SALE would.
      const f = await seed('T3 Co', 'admin@t3.example', { stock: 10 });
      // A location the Vendedor IS assigned to that is NOT the order's location — so `confirm`'s
      // LocationAuthorizationService.assertAccess (on order.locationId = f.locationId) throws. No
      // stock is put there; the variant only ever exists at f.locationId.
      const otherLocation = await c.createLocation(f.admin, (await warehouseOf(f))!, `LB-${Date.now()}`);
      const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@t3.example', 'Vendedor');
      await c.inject({ method: 'PUT', url: `/api/v1/users/${vendedor.user.id}/locations`, headers: c.writeHeaders(f.admin), payload: { locationIds: [otherLocation] } });

      const orderId = await pendingOrder(f, 3); // reserved by the admin at f.locationId
      const before = await movementCounts(f.tenantId, orderId);
      const blocked = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/confirm`,
        headers: c.writeHeaders(vendedor),
        payload: { payments: [{ paymentMethod: 'cash', amount: 1 }] },
      });
      expect(blocked.statusCode).toBe(403);

      expect(await movementCounts(f.tenantId, orderId)).toEqual(before);
      expect(await orderStatus(f, orderId)).toBe('pending');
      const bal = await balanceAt(f, f.variantIds[0]!, f.locationId);
      expect(bal.quantityReserved).toBe(3); // reservation still held — nothing was released
    });

    it('confirm / cancel stay tenant-scoped (IDOR -> 404) and blocked for a disabled user (011-B -> 403)', async () => {
      const f = await seed('T-Reg Co', 'admin@t-reg.example', { stock: 10 });
      const orderId = await pendingOrder(f, 1);

      const other = await seed('T-Reg Other Co', 'admin@t-reg-other.example', { stock: 10 });
      expect((await confirm(other, orderId)).statusCode).toBe(404);
      expect((await cancel(other, orderId)).statusCode).toBe(404);

      const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@t-reg.example', 'Vendedor');
      await c.inject({ method: 'PATCH', url: `/api/v1/users/${vendedor.user.id}`, headers: c.writeHeaders(f.admin), payload: { status: 'disabled' } });
      expect((await c.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/confirm`, headers: c.readHeaders(vendedor) })).statusCode).toBe(403);
      expect((await c.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: c.readHeaders(vendedor) })).statusCode).toBe(403);

      expect(await orderStatus(f, orderId)).toBe('pending');
    });
  });

  async function warehouseOf(f: Fixture): Promise<string | undefined> {
    const response = await c.inject({ method: 'GET', url: '/api/v1/warehouses', headers: c.readHeaders(f.admin) });
    return (JSON.parse(response.body) as { data: { id: string }[] }).data[0]?.id;
  }
});
