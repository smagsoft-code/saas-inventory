import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnsService } from './returns.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() })),
}));

const TENANT = 'tenant-1';
const ACTOR = 'user-1';
const PERMS = ['sales.returns.create'];
const OTHER_SELLER = 'user-9';
const READ_ALL = ['sales.returns.view', 'inventory.returns.manage'];
const SELLER_READ = ['sales.returns.view'];
const META = { correlationId: undefined, ipAddress: undefined };
const KEY = 'idem-1';

const CONFIRMED_ORDER = { id: 'order-1', tenantId: TENANT, status: 'confirmed', locationId: 'loc-1', placedByUserId: ACTOR };
const ORDER_ITEM = { id: 'oi-1', tenantId: TENANT, orderId: 'order-1', productVariantId: 'v-1', quantity: '5', skuSnapshot: 'SKU-1', unitCostSnapshot: '4' };
const RECEIVING_LOCATION = { id: 'loc-recv', tenantId: TENANT, status: 'active', isSellable: true };
const SELLABLE_LOCATION = { id: 'loc-sell', tenantId: TENANT, status: 'active', isSellable: true };
const NON_SELLABLE_LOCATION = { id: 'loc-quar', tenantId: TENANT, status: 'active', isSellable: false };

const RETURN_ROW = {
  id: 'ret-1',
  returnNumber: 'DEV-001',
  tenantId: TENANT,
  orderId: 'order-1',
  locationId: 'loc-recv',
  status: 'requested',
  requestedBy: ACTOR,
  receivedBy: null,
  reason: 'defective',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const RETURN_ITEM = {
  id: 'ri-1',
  tenantId: TENANT,
  returnId: 'ret-1',
  orderItemId: 'oi-1',
  productVariantId: 'v-1',
  quantityReturned: '2',
  disposition: null as string | null,
  dispositionLocationId: null as string | null,
  inspectedBy: null,
  inspectedAt: null,
  notes: null,
  createdAt: new Date(),
};

function build() {
  const returnsRepository = {
    create: vi.fn().mockResolvedValue(RETURN_ROW),
    nextReturnNumber: vi.fn().mockResolvedValue('DEV-001'),
    findById: vi.fn(),
    lockById: vi.fn(),
    listByTenant: vi.fn(),
    updateStatus: vi.fn((_tx: unknown, _t: string, _id: string, v: { status: string }) => Promise.resolve({ ...RETURN_ROW, ...v })),
  };
  const returnItemsRepository = {
    createMany: vi.fn().mockResolvedValue([RETURN_ITEM]),
    listByReturn: vi.fn().mockResolvedValue([RETURN_ITEM]),
    listByReturns: vi.fn().mockResolvedValue([RETURN_ITEM]),
    sumReturnedByOrder: vi.fn().mockResolvedValue(new Map()),
    recordInspection: vi.fn(),
  };
  const ordersRepository = {
    lockById: vi.fn().mockResolvedValue(CONFIRMED_ORDER),
    findById: vi.fn().mockResolvedValue(CONFIRMED_ORDER),
    findNumbersByIds: vi.fn().mockResolvedValue(new Map()),
  };
  const orderItemsRepository = { listByOrder: vi.fn().mockResolvedValue([ORDER_ITEM]), findById: vi.fn().mockResolvedValue(ORDER_ITEM),
    findLabelsByIds: vi.fn().mockResolvedValue(new Map()),
  };
  const locationsRepository = { findById: vi.fn().mockResolvedValue(RECEIVING_LOCATION) };
  const locationAuthorizationService = {
    assertAccess: vi.fn(),
    resolveReadScope: vi.fn((_tx: unknown, _t: string, _u: string, loc?: string) => Promise.resolve(loc ? { locationId: loc } : {})),
    canAccess: vi.fn().mockResolvedValue(true),
  };
  const stockLedgerService = { applyMovement: vi.fn().mockResolvedValue({}) };
  const idempotencyRepository = { find: vi.fn().mockResolvedValue(undefined), create: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const domainEventPublisher = { append: vi.fn() };
  const usersRepository = { findNamesByIds: vi.fn().mockResolvedValue(new Map()) };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue({ timezone: 'America/Guayaquil' }) };
  const movingAverageCostService = { getSaleUnitCost: vi.fn().mockResolvedValue(undefined) };

  const service = new ReturnsService(
    returnsRepository as never,
    returnItemsRepository as never,
    ordersRepository as never,
    orderItemsRepository as never,
    locationsRepository as never,
    locationAuthorizationService as never,
    stockLedgerService as never,
    idempotencyRepository as never,
    auditLogService as never,
    domainEventPublisher as never,
    usersRepository as never,
    tenantSettingsRepository as never,
    movingAverageCostService as never,
  );
  return {
    movingAverageCostService,
    service,
    usersRepository,
    returnsRepository,
    returnItemsRepository,
    ordersRepository,
    orderItemsRepository,
    locationsRepository,
    locationAuthorizationService,
    stockLedgerService,
    idempotencyRepository,
  };
}

describe('ReturnsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires an Idempotency-Key header', async () => {
    const { service } = build();
    await expect(
      service.create(TENANT, ACTOR, PERMS, { orderId: 'order-1', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] }, META, undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a requested return against a confirmed order', async () => {
    const { service, returnsRepository, returnItemsRepository } = build();
    await service.create(
      TENANT,
      ACTOR,
      PERMS,
      { orderId: 'order-1', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] },
      META,
      KEY,
    );
    expect(returnsRepository.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'order-1', status: 'requested', requestedBy: ACTOR }),
    );
    expect(returnItemsRepository.createMany).toHaveBeenCalled();
  });

  it('refuses a receiving location outside the caller scope (it could not be opened afterwards) and stores nothing', async () => {
    const { service, returnsRepository, locationAuthorizationService } = build();
    locationAuthorizationService.assertAccess.mockRejectedValueOnce(new (await import('@nestjs/common')).ForbiddenException('nope'));
    await expect(
      service.create(
        TENANT,
        ACTOR,
        PERMS,
        { orderId: 'order-1', locationId: 'loc-other', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] },
        META,
        KEY,
      ),
    ).rejects.toThrow();
    expect(locationAuthorizationService.assertAccess).toHaveBeenCalledWith(expect.anything(), TENANT, ACTOR, 'loc-other');
    expect(returnsRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a return against a non-confirmed order (§8 / R5)', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.lockById.mockResolvedValue({ ...CONFIRMED_ORDER, status: 'pending' });
    await expect(
      service.create(TENANT, ACTOR, PERMS, { orderId: 'order-1', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] }, META, KEY),
    ).rejects.toThrow(ConflictException);
  });

  it('404s an order from another tenant (RLS returns nothing) (§10 / R6)', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.lockById.mockResolvedValue(undefined);
    await expect(
      service.create(TENANT, ACTOR, PERMS, { orderId: 'order-x', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] }, META, KEY),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects over-return: sold 5, already returned 4, new request 2 (§11 / R3)', async () => {
    const { service, returnItemsRepository } = build();
    returnItemsRepository.sumReturnedByOrder.mockResolvedValue(new Map([['oi-1', 4]]));
    await expect(
      service.create(TENANT, ACTOR, PERMS, { orderId: 'order-1', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] }, META, KEY),
    ).rejects.toThrow(ConflictException);
  });

  it('sums duplicate lines for one order item before the returnable check', async () => {
    const { service, returnItemsRepository } = build();
    returnItemsRepository.sumReturnedByOrder.mockResolvedValue(new Map([['oi-1', 4]]));
    await expect(
      service.create(
        TENANT,
        ACTOR,
        PERMS,
        { orderId: 'order-1', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 1 }, { orderItemId: 'oi-1', quantity: 1 }] },
        META,
        KEY,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ReturnsService.inspect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a sellable location for a restock disposition (ADR-0021)', async () => {
    const { service, returnsRepository, locationsRepository } = build();
    returnsRepository.lockById.mockResolvedValue(RETURN_ROW);
    locationsRepository.findById.mockResolvedValue(NON_SELLABLE_LOCATION);
    await expect(
      service.inspect(TENANT, ACTOR, 'ret-1', { items: [{ returnItemId: 'ri-1', disposition: 'restock', dispositionLocationId: 'loc-quar' }] }, META),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('requires a non-sellable location for a quarantine disposition (ADR-0021)', async () => {
    const { service, returnsRepository, locationsRepository } = build();
    returnsRepository.lockById.mockResolvedValue(RETURN_ROW);
    locationsRepository.findById.mockResolvedValue(SELLABLE_LOCATION);
    await expect(
      service.inspect(TENANT, ACTOR, 'ret-1', { items: [{ returnItemId: 'ri-1', disposition: 'quarantine', dispositionLocationId: 'loc-sell' }] }, META),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('records the disposition and moves the return to inspecting', async () => {
    const { service, returnsRepository, returnItemsRepository, locationsRepository } = build();
    returnsRepository.lockById.mockResolvedValue(RETURN_ROW);
    locationsRepository.findById.mockResolvedValue(SELLABLE_LOCATION);
    await service.inspect(TENANT, ACTOR, 'ret-1', { items: [{ returnItemId: 'ri-1', disposition: 'restock', dispositionLocationId: 'loc-sell' }] }, META);
    expect(returnItemsRepository.recordInspection).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      'ri-1',
      expect.objectContaining({ disposition: 'restock', dispositionLocationId: 'loc-sell', inspectedBy: ACTOR }),
    );
    expect(returnsRepository.updateStatus).toHaveBeenCalledWith(expect.anything(), TENANT, 'ret-1', expect.objectContaining({ status: 'inspecting' }));
  });

  it('rejects inspecting a resolved return', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'resolved' });
    await expect(
      service.inspect(TENANT, ACTOR, 'ret-1', { items: [{ returnItemId: 'ri-1', disposition: 'restock', dispositionLocationId: 'loc-sell' }] }, META),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ReturnsService.resolve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes one RETURN movement per inspected line through StockLedgerService (§18 / R7)', async () => {
    const { service, returnsRepository, returnItemsRepository, stockLedgerService } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'inspecting' });
    returnItemsRepository.listByReturn.mockResolvedValue([
      { ...RETURN_ITEM, disposition: 'restock', dispositionLocationId: 'loc-sell', quantityReturned: '2' },
    ]);
    await service.resolve(TENANT, ACTOR, 'ret-1', META, KEY);
    expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        movementType: 'RETURN',
        locationId: 'loc-sell',
        quantity: 2,
        referenceType: 'sales_return_item',
        idempotencyKey: 'sales-return:ri-1',
      }),
    );
    expect(returnsRepository.updateStatus).toHaveBeenCalledWith(expect.anything(), TENANT, 'ret-1', expect.objectContaining({ status: 'resolved' }));
  });

  it('values the RETURN at the cost the original SALE drew at (Kardex average), not the variant cost snapshot', async () => {
    const { service, returnsRepository, returnItemsRepository, stockLedgerService, orderItemsRepository, movingAverageCostService } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'inspecting' });
    returnItemsRepository.listByReturn.mockResolvedValue([
      { ...RETURN_ITEM, disposition: 'restock', dispositionLocationId: 'loc-sell', quantityReturned: '1' },
    ]);
    orderItemsRepository.findById.mockResolvedValue({ ...ORDER_ITEM, unitCostSnapshot: '8' });
    movingAverageCostService.getSaleUnitCost.mockResolvedValue(11.73);
    await service.resolve(TENANT, ACTOR, 'ret-1', META, KEY);
    expect(movingAverageCostService.getSaleUnitCost).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({ orderId: CONFIRMED_ORDER.id, locationId: CONFIRMED_ORDER.locationId }),
    );
    expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ movementType: 'RETURN', unitCost: 11.73 }),
    );
  });

  it('falls back to the order line cost snapshot only when the sale has no SALE movement to read', async () => {
    const { service, returnsRepository, returnItemsRepository, stockLedgerService, orderItemsRepository } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'inspecting' });
    returnItemsRepository.listByReturn.mockResolvedValue([
      { ...RETURN_ITEM, disposition: 'restock', dispositionLocationId: 'loc-sell', quantityReturned: '1' },
    ]);
    orderItemsRepository.findById.mockResolvedValue({ ...ORDER_ITEM, unitCostSnapshot: '8' });
    await service.resolve(TENANT, ACTOR, 'ret-1', META, KEY);
    expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ movementType: 'RETURN', unitCost: 8 }),
    );
  });

  it('requires every line to be inspected first', async () => {
    const { service, returnsRepository, returnItemsRepository } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'inspecting' });
    returnItemsRepository.listByReturn.mockResolvedValue([{ ...RETURN_ITEM, disposition: null, dispositionLocationId: null }]);
    await expect(service.resolve(TENANT, ACTOR, 'ret-1', META, KEY)).rejects.toThrow(UnprocessableEntityException);
  });

  it('is idempotent — resolving an already-resolved return returns without new movements', async () => {
    const { service, returnsRepository, stockLedgerService } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'resolved' });
    await service.resolve(TENANT, ACTOR, 'ret-1', META, KEY);
    expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
  });

  it('rejects resolving a return that has not been inspected (status requested)', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'requested' });
    await expect(service.resolve(TENANT, ACTOR, 'ret-1', META, KEY)).rejects.toThrow(ConflictException);
  });

  it('enforces location authorization before re-entering stock (§21 / R9)', async () => {
    const { service, returnsRepository, returnItemsRepository, locationAuthorizationService, stockLedgerService } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'inspecting' });
    returnItemsRepository.listByReturn.mockResolvedValue([
      { ...RETURN_ITEM, disposition: 'restock', dispositionLocationId: 'loc-sell' },
    ]);
    locationAuthorizationService.assertAccess.mockRejectedValue(new (await import('@nestjs/common')).ForbiddenException('nope'));
    await expect(service.resolve(TENANT, ACTOR, 'ret-1', META, KEY)).rejects.toThrow();
    expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
  });
});

describe('ReturnsService.cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects cancelling a resolved return', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.lockById.mockResolvedValue({ ...RETURN_ROW, status: 'resolved' });
    await expect(service.cancel(TENANT, ACTOR, PERMS, 'ret-1', META)).rejects.toThrow(ConflictException);
  });

  it('cancels a requested return', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.lockById.mockResolvedValue(RETURN_ROW);
    await service.cancel(TENANT, ACTOR, PERMS, 'ret-1', META);
    expect(returnsRepository.updateStatus).toHaveBeenCalledWith(expect.anything(), TENANT, 'ret-1', { status: 'cancelled' });
  });
});

describe('ReturnsService.list — number, names, products and filters', () => {
  beforeEach(() => vi.clearAllMocks());
  const query = { page: 1, pageSize: 20 };

  it('enriches a page with ONE batched lookup each: order number, product labels, user names', async () => {
    const { service, returnsRepository, returnItemsRepository, ordersRepository, orderItemsRepository, usersRepository } = build();
    const second = { ...RETURN_ROW, id: 'ret-2', returnNumber: 'DEV-002', receivedBy: 'user-9' };
    returnsRepository.listByTenant.mockResolvedValue({ rows: [{ ...RETURN_ROW, returnNumber: 'DEV-001' }, second], total: 2 });
    returnItemsRepository.listByReturns.mockResolvedValue([RETURN_ITEM, { ...RETURN_ITEM, id: 'ri-2', returnId: 'ret-2' }]);
    ordersRepository.findNumbersByIds.mockResolvedValue(new Map([[RETURN_ROW.orderId, 'ORD-000007']]));
    orderItemsRepository.findLabelsByIds.mockResolvedValue(new Map([['oi-1', { sku: 'SKU-1', productName: 'Refrigerator' }]]));
    usersRepository.findNamesByIds.mockResolvedValue(new Map([[RETURN_ROW.requestedBy, 'Ana'], ['user-9', 'Luis']]));

    const result = await service.list(TENANT, 'user-1', READ_ALL, query);

    expect(returnItemsRepository.listByReturns).toHaveBeenCalledTimes(1);
    expect(ordersRepository.findNumbersByIds).toHaveBeenCalledTimes(1);
    expect(orderItemsRepository.findLabelsByIds).toHaveBeenCalledTimes(1);
    expect(usersRepository.findNamesByIds).toHaveBeenCalledTimes(1);
    expect(result.data[0]).toMatchObject({ returnNumber: 'DEV-001', orderNumber: 'ORD-000007', requestedByName: 'Ana' });
    expect(result.data[0]!.receivedByName).toBeUndefined();
    expect(result.data[0]!.items[0]).toMatchObject({ sku: 'SKU-1', productName: 'Refrigerator' });
    expect(result.data[1]).toMatchObject({ returnNumber: 'DEV-002', receivedByName: 'Luis' });
  });

  it('resolves dateFrom to one tenant-local day and passes locationId through', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
    await service.list(TENANT, 'user-1', READ_ALL, { ...query, dateFrom: '2026-10-13', locationId: 'loc-1' });
    const params = returnsRepository.listByTenant.mock.calls[0]![2] as { dayRange: { gte: Date; lt: Date }; locationId: string };
    expect(params.dayRange.gte.toISOString()).toBe('2026-10-13T05:00:00.000Z');
    expect(params.dayRange.lt.toISOString()).toBe('2026-10-14T05:00:00.000Z');
    expect(params.locationId).toBe('loc-1');
  });

  it('rejects dateTo without dateFrom', async () => {
    const { service } = build();
    await expect(service.list(TENANT, 'user-1', READ_ALL, { ...query, dateTo: '2026-10-13' })).rejects.toThrow('dateTo');
  });

  it('create asks the repository for the next DEV number and stores it', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.nextReturnNumber.mockResolvedValue('DEV-1000');
    await service.create(
      TENANT,
      ACTOR,
      PERMS,
      { orderId: 'order-1', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] },
      META,
      KEY,
    );
    expect(returnsRepository.nextReturnNumber).toHaveBeenCalledTimes(1);
    expect(returnsRepository.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ returnNumber: 'DEV-1000' }));
  });
});

describe('ReturnsService — seller scope (FINDING-SELLER-SCOPE-APPROVALS-RETURNS)', () => {
  beforeEach(() => vi.clearAllMocks());
  const PAYLOAD = { orderId: 'order-1', locationId: 'loc-recv', reason: 'defective', items: [{ orderItemId: 'oi-1', quantity: 2 }] };
  const OTHERS_ORDER = { ...CONFIRMED_ORDER, placedByUserId: OTHER_SELLER };

  it('create: a seller without view_all cannot register a return for another seller\'s order — 404, nothing written', async () => {
    const { service, ordersRepository, returnsRepository, returnItemsRepository, idempotencyRepository } = build();
    ordersRepository.lockById.mockResolvedValue(OTHERS_ORDER);
    await expect(service.create(TENANT, ACTOR, PERMS, PAYLOAD, META, KEY)).rejects.toThrow(NotFoundException);
    expect(returnsRepository.create).not.toHaveBeenCalled();
    expect(returnItemsRepository.createMany).not.toHaveBeenCalled();
    expect(idempotencyRepository.create).not.toHaveBeenCalled();
  });

  it('create: the scope answer comes before any status answer (a pending order of another seller is a 404, not a 409)', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.lockById.mockResolvedValue({ ...OTHERS_ORDER, status: 'pending' });
    await expect(service.create(TENANT, ACTOR, PERMS, PAYLOAD, META, KEY)).rejects.toThrow(NotFoundException);
  });

  it('create: with sales.orders.view_all (plus the functional permission) the same actor can', async () => {
    const { service, ordersRepository, returnsRepository } = build();
    ordersRepository.lockById.mockResolvedValue(OTHERS_ORDER);
    await service.create(TENANT, ACTOR, [...PERMS, 'sales.orders.view_all'], PAYLOAD, META, KEY);
    expect(returnsRepository.create).toHaveBeenCalled();
  });

  it('create: the idempotency record belongs to its actor — another user replaying the same key gets a conflict, not the stored return', async () => {
    const { service, idempotencyRepository, returnsRepository } = build();
    await service.create(TENANT, ACTOR, PERMS, PAYLOAD, META, KEY);
    const stored = idempotencyRepository.create.mock.calls[0]?.[1] as { requestHash: string };
    expect(stored.requestHash).toBeTruthy();
    idempotencyRepository.find.mockResolvedValue({ requestHash: stored.requestHash, responseBody: { id: 'ret-owner' } });
    returnsRepository.create.mockClear();
    // the owner's own replay still returns the stored response
    await expect(service.create(TENANT, ACTOR, PERMS, PAYLOAD, META, KEY)).resolves.toEqual({ id: 'ret-owner' });
    // another user with the same key and payload does not
    await expect(service.create(TENANT, OTHER_SELLER, [...PERMS, 'sales.orders.view_all'], PAYLOAD, META, KEY)).rejects.toThrow(ConflictException);
    expect(returnsRepository.create).not.toHaveBeenCalled();
  });

  it('cancel: a seller without view_all cannot cancel a return of another seller\'s order — 404, status untouched', async () => {
    const { service, returnsRepository, ordersRepository } = build();
    returnsRepository.lockById.mockResolvedValue(RETURN_ROW);
    ordersRepository.findById.mockResolvedValue(OTHERS_ORDER);
    await expect(service.cancel(TENANT, ACTOR, PERMS, 'ret-1', META)).rejects.toThrow(NotFoundException);
    expect(returnsRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('cancel: the owner of the order, and a view_all holder, can', async () => {
    const { service, returnsRepository, ordersRepository } = build();
    returnsRepository.lockById.mockResolvedValue(RETURN_ROW);
    ordersRepository.findById.mockResolvedValue(CONFIRMED_ORDER);
    await service.cancel(TENANT, ACTOR, PERMS, 'ret-1', META);
    ordersRepository.findById.mockResolvedValue(OTHERS_ORDER);
    await service.cancel(TENANT, ACTOR, [...PERMS, 'sales.orders.view_all'], 'ret-1', META);
    expect(returnsRepository.updateStatus).toHaveBeenCalledTimes(2);
  });
});

describe('ReturnsService — read scope (owner decision: seller own / view_all / warehouse)', () => {
  beforeEach(() => vi.clearAllMocks());
  const QUERY = { page: 1, pageSize: 20 } as never;

  const EMPTY_PAGE = { rows: [], total: 0 };

  it('list: a seller without view_all / warehouse rights is filtered to the returns of THEIR orders (in SQL, so totals are scoped too)', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.listByTenant.mockResolvedValue(EMPTY_PAGE);
    await service.list(TENANT, ACTOR, SELLER_READ, QUERY);
    expect(returnsRepository.listByTenant.mock.calls[0]![2]).toMatchObject({ placedByUserId: ACTOR });
  });

  it('list: view_all and the warehouse workflow (inventory.returns.manage) read every return — no seller filter', async () => {
    const { service, returnsRepository } = build();
    returnsRepository.listByTenant.mockResolvedValue(EMPTY_PAGE);
    await service.list(TENANT, ACTOR, [...SELLER_READ, 'sales.orders.view_all'], QUERY);
    await service.list(TENANT, ACTOR, [...SELLER_READ, 'inventory.returns.manage'], QUERY);
    for (const call of returnsRepository.listByTenant.mock.calls) {
      expect((call[2] as { placedByUserId?: string }).placedByUserId).toBeUndefined();
    }
  });

  it('getById: a seller sees the return of their own order, but another seller\'s is a 404 identical to a missing one', async () => {
    const { service, returnsRepository, ordersRepository } = build();
    returnsRepository.findById.mockResolvedValue(RETURN_ROW);
    ordersRepository.findById.mockResolvedValue({ ...CONFIRMED_ORDER, placedByUserId: ACTOR });
    await expect(service.getById(TENANT, ACTOR, SELLER_READ, 'ret-1')).resolves.toBeDefined();

    ordersRepository.findById.mockResolvedValue({ ...CONFIRMED_ORDER, placedByUserId: OTHER_SELLER });
    const hidden = await service.getById(TENANT, ACTOR, SELLER_READ, 'ret-1').catch((e: Error) => e);
    returnsRepository.findById.mockResolvedValue(undefined);
    const missing = await service.getById(TENANT, ACTOR, SELLER_READ, 'ret-x').catch((e: Error) => e);
    expect(hidden).toBeInstanceOf(NotFoundException);
    expect((hidden as Error).message).toBe((missing as Error).message);
  });

  it('getById: view_all and the warehouse read another seller\'s return', async () => {
    const { service, returnsRepository, ordersRepository } = build();
    returnsRepository.findById.mockResolvedValue(RETURN_ROW);
    ordersRepository.findById.mockResolvedValue({ ...CONFIRMED_ORDER, placedByUserId: OTHER_SELLER });
    await expect(service.getById(TENANT, ACTOR, [...SELLER_READ, 'sales.orders.view_all'], 'ret-1')).resolves.toBeDefined();
    await expect(service.getById(TENANT, ACTOR, [...SELLER_READ, 'inventory.returns.manage'], 'ret-1')).resolves.toBeDefined();
  });
});
