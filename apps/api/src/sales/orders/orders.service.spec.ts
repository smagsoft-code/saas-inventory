import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientStockError } from '../../inventory/stock-ledger.service';
import { SalesPricingService } from '../pricing/sales-pricing.service';
import { OrdersService } from './orders.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() })),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'user-1';
const META = { correlationId: undefined, ipAddress: undefined };
const KEY = 'idem-key-1';
const PERMS = ['sales.orders.create', 'pricing.floor.view'];

const CART = {
  id: 'cart-1',
  tenantId: TENANT_ID,
  locationId: 'loc-1',
  userId: ACTOR_ID,
  customerId: 'customer-1',
  orderId: null,
  status: 'open',
  version: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
};

const CUSTOMER = {
  id: 'customer-1',
  tenantId: TENANT_ID,
  type: 'ruc',
  firstName: 'Contoso',
  lastName: 'SA',
  displayName: 'Contoso SA',
  taxId: '1790012345001',
  email: 'ap@contoso.example',
  phone: '+59322222222',
  address: 'Av. Amazonas, Quito',
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const VARIANT = {
  id: 'variant-1',
  productId: 'product-1',
  productName: 'Refrigerator',
  sku: 'SKU-1',
  unit: 'unit',
  maxPrice: '120',
  basePrice: '100',
  minPrice: '80',
  cost: '60',
  status: 'active',
  isSerialized: false,
  isLotTracked: false,
};

const LOCATION = { id: 'loc-1', tenantId: TENANT_ID, status: 'active', isSellable: true };

function build() {
  const ordersRepository = {
    findById: vi.fn(),
    lockById: vi.fn(),
    listByTenant: vi.fn(),
    nextOrderNumber: vi.fn().mockResolvedValue('ORD-000001'),
    create: vi.fn(),
    updateStatus: vi.fn(),
  };
  const orderItemsRepository = { listByOrder: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue([]) };
  const cartsRepository = { lockById: vi.fn().mockResolvedValue(CART), update: vi.fn() };
  const cartItemsRepository = { listByCart: vi.fn().mockResolvedValue([{ productVariantId: 'variant-1', quantity: '2', negotiatedUnitPrice: '95' }]) };
  const customersRepository = { findById: vi.fn().mockResolvedValue(CUSTOMER) };
  const catalogLookup = { findVariantById: vi.fn().mockResolvedValue(VARIANT) };
  const locationsRepository = { findById: vi.fn().mockResolvedValue(LOCATION) };
  const locationAuthorizationService = {
    assertAccess: vi.fn(),
    resolveReadScope: vi.fn((_tx: unknown, _t: string, _u: string, loc?: string) => Promise.resolve(loc ? { locationId: loc } : {})),
    canAccess: vi.fn().mockResolvedValue(true),
  };
  const stockLedgerService = { applyMovement: vi.fn().mockResolvedValue({}) };
  const idempotencyRepository = { find: vi.fn().mockResolvedValue(undefined), create: vi.fn() };
  const pricePoliciesRepository = {
    getEffective: vi.fn().mockResolvedValue({ exceptionalDiscountRequiresApproval: true, maxDiscountBelowMinPercent: null }),
  };
  const priceApprovalsRepository = {
    lockByOrder: vi.fn().mockResolvedValue([]),
    cancelPendingByOrder: vi.fn().mockResolvedValue(0),
  };
  const orderNotificationsRepository = {
    listByOrder: vi.fn().mockResolvedValue([]),
    rollUpByOrders: vi.fn().mockResolvedValue(new Map()),
  };
  const usersRepository = { findNamesByIds: vi.fn().mockResolvedValue(new Map()) };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue({ timezone: 'America/Guayaquil' }) };
  const orderPaymentsRepository = { listByOrder: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue([]) };
  const auditLogService = { record: vi.fn() };
  const domainEventPublisher = { append: vi.fn() };

  const createdOrder = {
    id: 'order-1',
    tenantId: TENANT_ID,
    locationId: 'loc-1',
    customerId: 'customer-1',
    customerNameSnapshot: 'Contoso SA',
    customerTaxIdSnapshot: '1790012345001',
    customerEmailSnapshot: 'ap@contoso.example',
    customerPhoneSnapshot: '+59322222222',
    customerAddressSnapshot: { city: 'Quito' },
    orderNumber: 'ORD-000001',
    documentType: 'invoice',
    invoiceStatus: 'pending',
    status: 'pending',
    subtotal: '190.00',
    discountTotal: '50.00',
    taxTotal: '0.00',
    total: '190.00',
    currency: 'USD',
    placedByUserId: ACTOR_ID,
    correlationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  ordersRepository.create.mockResolvedValue(createdOrder);

  const service = new OrdersService(
    ordersRepository as never,
    orderItemsRepository as never,
    cartsRepository as never,
    cartItemsRepository as never,
    customersRepository as never,
    catalogLookup as never,
    locationsRepository as never,
    locationAuthorizationService as never,
    stockLedgerService as never,
    new SalesPricingService(),
    idempotencyRepository as never,
    pricePoliciesRepository as never,
    priceApprovalsRepository as never,
    orderNotificationsRepository as never,
    orderPaymentsRepository as never,
    usersRepository as never,
    tenantSettingsRepository as never,
    auditLogService as never,
    domainEventPublisher as never,
  );
  return {
    service,
    ordersRepository,
    orderItemsRepository,
    cartsRepository,
    cartItemsRepository,
    customersRepository,
    catalogLookup,
    locationsRepository,
    stockLedgerService,
    idempotencyRepository,
    pricePoliciesRepository,
    priceApprovalsRepository,
    orderPaymentsRepository,
    orderNotificationsRepository,
    usersRepository,
    createdOrder,
  };
}

/** Shorthand for a single-method `ConfirmOrderDto` payment that exactly covers `total` — most
 * confirm tests don't care about the split-payment shape itself, only that the sum check passes. */
function cashPayment(total: number): { payments: { paymentMethod: 'cash'; amount: number }[] } {
  return { payments: [{ paymentMethod: 'cash', amount: total }] };
}

describe('OrdersService.checkout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires an Idempotency-Key header (§57)', async () => {
    const { service } = build();
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns the cached result when the same key + same request is replayed (§60)', async () => {
    const { service, idempotencyRepository, ordersRepository } = build();
    idempotencyRepository.find.mockResolvedValue({ requestHash: 'x', responseBody: { id: 'order-1' } });
    // requestHash must match — recompute the way the service does.
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(JSON.stringify({ cartId: 'cart-1', documentType: 'sales_note' })).digest('hex');
    idempotencyRepository.find.mockResolvedValue({ requestHash: hash, responseBody: { id: 'order-1', orderNumber: 'ORD-000001' } });
    const result = await service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY);
    expect(result).toEqual({ id: 'order-1', orderNumber: 'ORD-000001' });
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('rejects the same key reused with a different request body (§59)', async () => {
    const { service, idempotencyRepository } = build();
    idempotencyRepository.find.mockResolvedValue({ requestHash: 'a-different-hash', responseBody: {} });
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'invoice' }, META, KEY),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an empty cart', async () => {
    const { service, cartItemsRepository } = build();
    cartItemsRepository.listByCart.mockResolvedValue([]);
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a cart owned by a different user (§40, IDOR)', async () => {
    const { service, cartsRepository } = build();
    cartsRepository.lockById.mockResolvedValue({ ...CART, userId: 'someone-else' });
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY),
    ).rejects.toThrow(NotFoundException);
  });

  // PROMPT 012-A §6: the SAME complete commercial customer data is required for BOTH document types.
  it.each([
    ['invoice', { taxId: null }, /taxId/],
    ['invoice', { email: null }, /email/],
    ['sales_note', { taxId: null }, /taxId/],
    ['sales_note', { email: null }, /email/],
    ['sales_note', { phone: null }, /phone/],
    ['sales_note', { address: null }, /address/],
    ['sales_note', { address: '' }, /address/],
  ] as const)('rejects %s when the customer is missing %o -> 422, no order (§10, §13-§16)', async (documentType, patch, messagePattern) => {
    const { service, customersRepository, ordersRepository, stockLedgerService, idempotencyRepository } = build();
    customersRepository.findById.mockResolvedValue({ ...CUSTOMER, ...patch });
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType }, META, KEY),
    ).rejects.toThrow(UnprocessableEntityException);
    try {
      await service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType }, META, KEY);
    } catch (error) {
      expect((error as Error).message).toMatch(messagePattern);
    }
    expect(ordersRepository.create).not.toHaveBeenCalled();
    expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    expect(idempotencyRepository.create).not.toHaveBeenCalled();
  });

  it('accepts a complete customer for sales_note (invoice_status null) and for invoice (invoice_status pending)', async () => {
    for (const documentType of ['sales_note', 'invoice'] as const) {
      const { service, ordersRepository } = build();
      await service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType }, META, KEY);
      const values = ordersRepository.create.mock.calls[0]![1] as { invoiceStatus: string | null; documentType: string };
      expect(values.documentType).toBe(documentType);
      expect(values.invoiceStatus).toBe(documentType === 'invoice' ? 'pending' : null);
    }
  });

  it('FASE 13: a below-min negotiated price creates a pending order with an exceptional line (no longer a 409)', async () => {
    const { service, cartItemsRepository, orderItemsRepository } = build();
    cartItemsRepository.listByCart.mockResolvedValue([{ productVariantId: 'variant-1', quantity: '1', negotiatedUnitPrice: '70' }]);
    await service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY);
    const itemValues = (orderItemsRepository.createMany.mock.calls[0]![1] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(itemValues.unitPriceSnapshot).toBe('70.00');
    expect(itemValues.isExceptionalDiscount).toBe(true);
  });

  it('FASE 13: a below-min price beyond the tenant hard floor is rejected outright (422, no order)', async () => {
    const { service, cartItemsRepository, pricePoliciesRepository, ordersRepository } = build();
    pricePoliciesRepository.getEffective.mockResolvedValue({ exceptionalDiscountRequiresApproval: true, maxDiscountBelowMinPercent: 10 });
    // min 80, 10% hard floor => 72; 40 is below it.
    cartItemsRepository.listByCart.mockResolvedValue([{ productVariantId: 'variant-1', quantity: '1', negotiatedUnitPrice: '40' }]);
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('still rejects a price above the maximum (400)', async () => {
    const { service, cartItemsRepository } = build();
    cartItemsRepository.listByCart.mockResolvedValue([{ productVariantId: 'variant-1', quantity: '1', negotiatedUnitPrice: '200' }]);
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a serialized / lot-tracked variant (deferred, §49-§51)', async () => {
    const { service, catalogLookup } = build();
    catalogLookup.findVariantById.mockResolvedValue({ ...VARIANT, isLotTracked: true });
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('freezes the customer snapshot from the validated row and computes totals server-side (§13, §27, §30) — never asks for a payment method here', async () => {
    const { service, ordersRepository, orderItemsRepository, stockLedgerService, cartsRepository, idempotencyRepository, orderPaymentsRepository } = build();
    await service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'invoice' }, META, KEY);

    const orderValues = ordersRepository.create.mock.calls[0]![1] as Record<string, unknown>;
    expect(orderValues.customerNameSnapshot).toBe('Contoso SA');
    expect(orderValues.customerTaxIdSnapshot).toBe('1790012345001');
    expect(orderValues.status).toBe('pending');
    expect(orderValues.invoiceStatus).toBe('pending');
    expect(orderValues.currency).toBe('USD');
    expect(orderValues.placedByUserId).toBe(ACTOR_ID);
    // 2 units at 95 negotiated => subtotal 190; (120-95)*2 = 50 discount; total = subtotal.
    expect(orderValues.subtotal).toBe('190.00');
    expect(orderValues.discountTotal).toBe('50.00');
    expect(orderValues.taxTotal).toBe('0.00');
    expect(orderValues.total).toBe('190.00');

    const itemValues = (orderItemsRepository.createMany.mock.calls[0]![1] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(itemValues.unitPriceSnapshot).toBe('95.00');
    expect(itemValues.minPriceSnapshot).toBe('80.00');
    expect(itemValues.lineTotal).toBe('190.00');
    // 95 < basePrice (100) — exceptional under the owner's policy change (trigger moved from
    // min_price to base_price), even though 95 is still above min_price (80).
    expect(itemValues.isExceptionalDiscount).toBe(true);

    expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ movementType: 'RESERVATION', quantity: 2, referenceType: 'order' }),
    );
    expect(cartsRepository.update).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 'cart-1', expect.objectContaining({ status: 'checked_out' }));
    expect(idempotencyRepository.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: 'orders.create', responseStatus: 201 }),
    );
    // Owner redesign: the payment method is picked at confirm, not here.
    expect(orderPaymentsRepository.createMany).not.toHaveBeenCalled();
  });

  it('maps an insufficient-stock reservation failure to 409 (§44)', async () => {
    const { service, stockLedgerService } = build();
    stockLedgerService.applyMovement.mockRejectedValueOnce(new InsufficientStockError('nope'));
    await expect(
      service.checkout(TENANT_ID, ACTOR_ID, PERMS, { cartId: 'cart-1', documentType: 'sales_note' }, META, KEY),
    ).rejects.toThrow(ConflictException);
  });
});

describe('OrdersService.confirm / cancel — state machine (§37, §54)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirm on a pending order releases the reservation and writes a SALE (commit boundary)', async () => {
    const { service, ordersRepository, orderItemsRepository, stockLedgerService } = build();
    ordersRepository.lockById.mockResolvedValue({ id: 'order-1', status: 'pending', locationId: 'loc-1', tenantId: TENANT_ID, total: '190.00' });
    orderItemsRepository.listByOrder.mockResolvedValue([{ productVariantId: 'variant-1', quantity: '2', skuSnapshot: 'SKU-1' }]);
    ordersRepository.updateStatus.mockResolvedValue({
      id: 'order-1',
      status: 'confirmed',
      locationId: 'loc-1',
      documentType: 'invoice',
      invoiceStatus: 'pending',
      orderNumber: 'ORD-000001',
      customerNameSnapshot: 'Contoso SA',
      subtotal: '190.00',
      discountTotal: '50.00',
      taxTotal: '0.00',
      total: '190.00',
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.confirm(TENANT_ID, ACTOR_ID, PERMS, 'order-1', cashPayment(190), META);
    const types = stockLedgerService.applyMovement.mock.calls.map((call) => (call[1] as { movementType: string }).movementType);
    expect(types).toEqual(['RESERVATION_RELEASE', 'SALE']);
  });

  it('rejects confirm when the sum of payments does not match the order total', async () => {
    const { service, ordersRepository, orderPaymentsRepository } = build();
    ordersRepository.lockById.mockResolvedValue({ id: 'order-1', status: 'pending', locationId: 'loc-1', tenantId: TENANT_ID, total: '190.00' });
    await expect(service.confirm(TENANT_ID, ACTOR_ID, PERMS, 'order-1', cashPayment(100), META)).rejects.toThrow(BadRequestException);
    expect(orderPaymentsRepository.createMany).not.toHaveBeenCalled();
  });

  it('accepts a split payment across multiple methods summing to the total, and persists every row', async () => {
    const { service, ordersRepository, orderItemsRepository, orderPaymentsRepository } = build();
    ordersRepository.lockById.mockResolvedValue({ id: 'order-1', status: 'pending', locationId: 'loc-1', tenantId: TENANT_ID, total: '190.00' });
    orderItemsRepository.listByOrder.mockResolvedValue([{ productVariantId: 'variant-1', quantity: '2', skuSnapshot: 'SKU-1' }]);
    ordersRepository.updateStatus.mockResolvedValue({
      id: 'order-1',
      status: 'confirmed',
      locationId: 'loc-1',
      documentType: 'invoice',
      invoiceStatus: 'pending',
      orderNumber: 'ORD-000001',
      customerNameSnapshot: 'Contoso SA',
      subtotal: '190.00',
      discountTotal: '0.00',
      taxTotal: '0.00',
      total: '190.00',
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const payments = {
      payments: [
        { paymentMethod: 'cash' as const, amount: 100 },
        { paymentMethod: 'card' as const, amount: 90 },
      ],
    };
    await service.confirm(TENANT_ID, ACTOR_ID, PERMS, 'order-1', payments, META);
    const values = orderPaymentsRepository.createMany.mock.calls[0]![1] as Record<string, unknown>[];
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({ paymentMethod: 'cash', amount: '100.00' });
    expect(values[1]).toMatchObject({ paymentMethod: 'card', amount: '90.00' });
  });

  it('confirm is idempotent — an already-confirmed order returns without touching stock or re-writing payments', async () => {
    const { service, ordersRepository, stockLedgerService, orderPaymentsRepository } = build();
    ordersRepository.lockById.mockResolvedValue({
      id: 'order-1',
      status: 'confirmed',
      locationId: 'loc-1',
      documentType: 'invoice',
      invoiceStatus: 'pending',
      orderNumber: 'ORD-000001',
      customerNameSnapshot: 'Contoso SA',
      subtotal: '190.00',
      discountTotal: '50.00',
      taxTotal: '0.00',
      total: '190.00',
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.confirm(TENANT_ID, ACTOR_ID, PERMS, 'order-1', cashPayment(190), META);
    expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    expect(orderPaymentsRepository.createMany).not.toHaveBeenCalled();
  });

  it('cancel of a confirmed order is rejected — that needs a sales return (FASE 13, §54)', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.lockById.mockResolvedValue({ id: 'order-1', status: 'confirmed', locationId: 'loc-1' });
    await expect(service.cancel(TENANT_ID, ACTOR_ID, PERMS, 'order-1', META)).rejects.toThrow(ConflictException);
  });

  it('cancel of a pending order releases every line reservation', async () => {
    const { service, ordersRepository, orderItemsRepository, stockLedgerService } = build();
    ordersRepository.lockById.mockResolvedValue({ id: 'order-1', status: 'pending', locationId: 'loc-1' });
    orderItemsRepository.listByOrder.mockResolvedValue([{ productVariantId: 'variant-1', quantity: '2' }]);
    ordersRepository.updateStatus.mockResolvedValue({
      id: 'order-1',
      status: 'cancelled',
      locationId: 'loc-1',
      documentType: 'sales_note',
      invoiceStatus: null,
      orderNumber: 'ORD-000001',
      customerNameSnapshot: 'X',
      subtotal: '0.00',
      discountTotal: '0.00',
      taxTotal: '0.00',
      total: '0.00',
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.cancel(TENANT_ID, ACTOR_ID, PERMS, 'order-1', META);
    expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ movementType: 'RESERVATION_RELEASE' }),
    );
  });
});

describe('OrdersService.list — business-day filter, seller and notification columns', () => {
  beforeEach(() => vi.clearAllMocks());

  const query = { page: 1, pageSize: 20 };

  it('resolves dateFrom (no dateTo) to exactly one tenant-local day, half-open', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
    await service.list(TENANT_ID, ACTOR_ID, PERMS, { ...query, dateFrom: '2026-10-13' });
    const params = ordersRepository.listByTenant.mock.calls[0]![2] as { dayRange: { gte: Date; lt: Date } };
    // America/Guayaquil is UTC-5 with no DST.
    expect(params.dayRange.gte.toISOString()).toBe('2026-10-13T05:00:00.000Z');
    expect(params.dayRange.lt.toISOString()).toBe('2026-10-14T05:00:00.000Z');
  });

  it('includes the whole final day for a multi-day range', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
    await service.list(TENANT_ID, ACTOR_ID, PERMS, { ...query, dateFrom: '2026-10-13', dateTo: '2026-10-15' });
    const params = ordersRepository.listByTenant.mock.calls[0]![2] as { dayRange: { gte: Date; lt: Date } };
    expect(params.dayRange.lt.toISOString()).toBe('2026-10-16T05:00:00.000Z');
  });

  it('passes the Almacén (locationId) filter through to the repository', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
    await service.list(TENANT_ID, ACTOR_ID, PERMS, { ...query, locationId: 'loc-1' });
    expect(ordersRepository.listByTenant.mock.calls[0]![2]).toMatchObject({ locationId: 'loc-1' });
  });

  it('rejects dateTo without dateFrom and an impossible calendar date', async () => {
    const { service } = build();
    await expect(service.list(TENANT_ID, ACTOR_ID, PERMS, { ...query, dateTo: '2026-10-13' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(TENANT_ID, ACTOR_ID, PERMS, { ...query, dateFrom: '2026-02-31' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds seller name and notification status with ONE batched lookup each (no N+1)', async () => {
    const { service, ordersRepository, usersRepository, orderNotificationsRepository, createdOrder } = build();
    const second = { ...createdOrder, id: 'order-2', placedByUserId: null };
    ordersRepository.listByTenant.mockResolvedValue({ rows: [createdOrder, second], total: 2 });
    usersRepository.findNamesByIds.mockResolvedValue(new Map([[ACTOR_ID, 'Ana Vendedora']]));
    orderNotificationsRepository.rollUpByOrders.mockResolvedValue(new Map([['order-1', 'delivered']]));
    const result = await service.list(TENANT_ID, ACTOR_ID, PERMS, query);
    expect(usersRepository.findNamesByIds).toHaveBeenCalledTimes(1);
    expect(orderNotificationsRepository.rollUpByOrders).toHaveBeenCalledTimes(1);
    expect(result.data[0]).toMatchObject({ placedByName: 'Ana Vendedora', notificationStatus: 'delivered' });
    expect(result.data[1]!.placedByName).toBeUndefined();
    expect(result.data[1]!.notificationStatus).toBe('none');
  });
});

describe('OrdersService — a seller only sees their own orders unless they hold sales.orders.view_all', () => {
  beforeEach(() => vi.clearAllMocks());

  const query = { page: 1, pageSize: 20 };

  it('list: scopes the query to the caller without view_all, and not with it', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });

    await service.list(TENANT_ID, ACTOR_ID, ['sales.orders.view'], query);
    expect(ordersRepository.listByTenant.mock.calls[0]![2]).toMatchObject({ placedByUserId: ACTOR_ID });

    await service.list(TENANT_ID, ACTOR_ID, ['sales.orders.view', 'sales.orders.view_all'], query);
    expect((ordersRepository.listByTenant.mock.calls[1]![2] as { placedByUserId?: string }).placedByUserId).toBeUndefined();
  });

  it('list: with view_all a placedByUserId filter narrows to that seller; without it the filter is ignored (always own)', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });

    await service.list(TENANT_ID, ACTOR_ID, ['sales.orders.view', 'sales.orders.view_all'], { ...query, placedByUserId: 'seller-9' });
    expect(ordersRepository.listByTenant.mock.calls[0]![2]).toMatchObject({ placedByUserId: 'seller-9' });

    await service.list(TENANT_ID, ACTOR_ID, ['sales.orders.view'], { ...query, placedByUserId: 'seller-9' });
    expect(ordersRepository.listByTenant.mock.calls[1]![2]).toMatchObject({ placedByUserId: ACTOR_ID });
  });

  it('list: passes the single search box (q) and the column filters + sort through to the repository', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
    await service.list(TENANT_ID, ACTOR_ID, ['sales.orders.view'], { ...query, q: 'ana', total: '200', sort: 'total', dir: 'asc' });
    expect(ordersRepository.listByTenant.mock.calls[0]![2]).toMatchObject({
      columnFilters: expect.objectContaining({ q: 'ana', total: '200' }),
      sort: 'total',
      dir: 'asc',
    });
  });

  it('list: passes the Sucursal (warehouseId) filter through to the repository', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
    await service.list(TENANT_ID, ACTOR_ID, ['sales.orders.view'], { ...query, warehouseId: 'wh-1' });
    expect(ordersRepository.listByTenant.mock.calls[0]![2]).toMatchObject({ warehouseId: 'wh-1' });
  });

  it('getById: another seller\'s order is a 404 (existence not revealed) without view_all; own order and view_all work', async () => {
    const { service, ordersRepository, createdOrder } = build();
    const others = { ...createdOrder, placedByUserId: 'someone-else' };
    ordersRepository.findById.mockResolvedValue(others);

    await expect(service.getById(TENANT_ID, ACTOR_ID, ['sales.orders.view'], 'order-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getById(TENANT_ID, ACTOR_ID, ['sales.orders.view', 'sales.orders.view_all'], 'order-1')).resolves.toMatchObject({ id: 'order-1' });

    ordersRepository.findById.mockResolvedValue(createdOrder); // placed by ACTOR_ID
    await expect(service.getById(TENANT_ID, ACTOR_ID, ['sales.orders.view'], 'order-1')).resolves.toMatchObject({ id: 'order-1' });
  });

  it('getNotifications: same rule — 404 for another seller\'s order without view_all', async () => {
    const { service, ordersRepository, createdOrder } = build();
    ordersRepository.findById.mockResolvedValue({ ...createdOrder, placedByUserId: 'someone-else' });
    await expect(service.getNotifications(TENANT_ID, ACTOR_ID, ['sales.orders.view'], 'order-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
