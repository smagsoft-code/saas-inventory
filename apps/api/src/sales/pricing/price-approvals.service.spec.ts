import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PriceApprovalsService } from './price-approvals.service';
import { SalesPricingService } from './sales-pricing.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() })),
}));

const TENANT = 'tenant-1';
const REQUESTER = 'user-req';
const APPROVER = 'user-appr';
const META = { correlationId: undefined, ipAddress: undefined };
const REQUEST_PERMS = ['pricing.discount.request'];
const APPROVE_PERMS = ['pricing.discount.approve'];

const ORDER_ITEM = {
  id: 'oi-1',
  tenantId: TENANT,
  orderId: 'order-1',
  productVariantId: 'v-1',
  skuSnapshot: 'SKU-1',
  productNameSnapshot: 'TV',
  maxPriceSnapshot: '120',
  basePriceSnapshot: '100',
  minPriceSnapshot: '80',
  unitPriceSnapshot: '70',
  unitCostSnapshot: null,
  quantity: '2',
  discountAmount: '100',
  isExceptionalDiscount: true,
  lineTotal: '140',
  createdAt: new Date(),
};

const PENDING_ROW = {
  id: 'pa-1',
  tenantId: TENANT,
  orderId: 'order-1',
  orderItemId: 'oi-1',
  requestedPrice: '70.00',
  minPriceAtRequest: '80.00',
  basePriceAtRequest: '100.00',
  maxPriceAtRequest: '120.00',
  discountAmount: '100.00',
  reason: 'loyal customer',
  requestedBy: REQUESTER,
  approvedBy: null,
  status: 'pending',
  requestedAt: new Date(),
  resolvedAt: null,
};

function build() {
  const priceApprovalsRepository = {
    create: vi.fn().mockResolvedValue(PENDING_ROW),
    findById: vi.fn(),
    lockById: vi.fn(),
    lockByOrder: vi.fn(),
    listByTenant: vi.fn(),
    findPendingByOrderItem: vi.fn().mockResolvedValue(undefined),
    cancelPendingByOrder: vi.fn(),
    resolveIfPending: vi.fn(),
  };
  const ordersRepository = {
    lockById: vi.fn().mockResolvedValue({ id: 'order-1', status: 'pending', tenantId: TENANT }),
    findById: vi.fn().mockResolvedValue({ id: 'order-1', orderNumber: 'ORD-000001', tenantId: TENANT, locationId: 'loc-1' }),
    updateTotals: vi.fn().mockResolvedValue(undefined),
  };
  const orderItemsRepository = {
    findById: vi.fn().mockResolvedValue(ORDER_ITEM),
    updatePriceWhilePending: vi.fn((_tx: unknown, _tenantId: string, _id: string, values: Record<string, unknown>) =>
      Promise.resolve({ ...ORDER_ITEM, ...values }),
    ),
    listByOrder: vi.fn().mockResolvedValue([ORDER_ITEM]),
    findLabelsByIds: vi.fn().mockResolvedValue(new Map([['oi-1', { sku: 'SKU-1', productName: 'Refrigerator' }]])),
  };
  const locationAuthorizationService = {
    resolveReadScope: vi.fn((_tx: unknown, _t: string, _u: string, loc?: string) => Promise.resolve(loc ? { locationId: loc } : {})),
    canAccess: vi.fn().mockResolvedValue(true),
  };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue({ timezone: 'America/Guayaquil' }) };
  const usersRepository = {
    findById: vi.fn((_tx: unknown, _tenantId: string, userId: string) =>
      Promise.resolve(userId === REQUESTER ? { id: REQUESTER, fullName: 'Jane Requester' } : { id: APPROVER, fullName: 'Alex Approver' }),
    ),
  };
  const pricePoliciesRepository = {
    getEffective: vi.fn().mockResolvedValue({ exceptionalDiscountRequiresApproval: true, maxDiscountBelowMinPercent: null }),
  };
  const auditLogService = { record: vi.fn() };
  const domainEventPublisher = { append: vi.fn() };
  const service = new PriceApprovalsService(
    priceApprovalsRepository as never,
    ordersRepository as never,
    orderItemsRepository as never,
    usersRepository as never,
    pricePoliciesRepository as never,
    new SalesPricingService(),
    auditLogService as never,
    domainEventPublisher as never,
    tenantSettingsRepository as never,
    locationAuthorizationService as never,
  );
  return {
    service,
    priceApprovalsRepository,
    ordersRepository,
    orderItemsRepository,
    usersRepository,
    pricePoliciesRepository,
    domainEventPublisher,
  };
}

describe('PriceApprovalsService.request', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending approval derived server-side from the frozen order line (§50)', async () => {
    const { service, priceApprovalsRepository } = build();
    await service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'loyal customer' }, META);
    const values = priceApprovalsRepository.create.mock.calls[0]![1] as Record<string, unknown>;
    expect(values.requestedPrice).toBe('70.00');
    expect(values.minPriceAtRequest).toBe('80.00');
    expect(values.basePriceAtRequest).toBe('100.00');
    expect(values.maxPriceAtRequest).toBe('120.00');
    // discountAmount is computed against max_price, not min_price (does not leak the floor).
    expect(values.discountAmount).toBe('100.00');
    expect(values.requestedBy).toBe(REQUESTER);
  });

  it('rejects when the parent order is not pending', async () => {
    const { service, ordersRepository } = build();
    ordersRepository.lockById.mockResolvedValue({ id: 'order-1', status: 'confirmed', tenantId: TENANT });
    await expect(
      service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'x reason' }, META),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects when the line is not an exceptional discount', async () => {
    const { service, orderItemsRepository } = build();
    orderItemsRepository.findById.mockResolvedValue({ ...ORDER_ITEM, isExceptionalDiscount: false });
    await expect(
      service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'x reason' }, META),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a client requestedPrice that does not match the order line (§92 / P10)', async () => {
    const { service } = build();
    await expect(
      service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'x reason', requestedPrice: 60 }, META),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a second pending request for the same line (409)', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.findPendingByOrderItem.mockResolvedValue(PENDING_ROW);
    await expect(
      service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'x reason' }, META),
    ).rejects.toThrow(ConflictException);
  });

  it('owner redesign: a resubmission can propose a new price for the line before filing', async () => {
    const { service, orderItemsRepository, ordersRepository, priceApprovalsRepository } = build();
    await service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'new price', newPrice: 85 }, META);
    expect(orderItemsRepository.updatePriceWhilePending).toHaveBeenCalledWith(expect.anything(), TENANT, 'oi-1', {
      unitPriceSnapshot: '85.00',
      lineTotal: '170.00',
      discountAmount: '70.00',
      isExceptionalDiscount: true,
    });
    expect(ordersRepository.updateTotals).toHaveBeenCalled();
    const values = priceApprovalsRepository.create.mock.calls[0]![1] as Record<string, unknown>;
    expect(values.requestedPrice).toBe('85.00');
  });

  it('a resubmission price that clears the exceptional-discount band needs no approval (422), after mutating the line', async () => {
    const { service, orderItemsRepository } = build();
    await expect(
      service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'raised price', newPrice: 100 }, META),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(orderItemsRepository.updatePriceWhilePending).toHaveBeenCalledWith(expect.anything(), TENANT, 'oi-1', {
      unitPriceSnapshot: '100.00',
      lineTotal: '200.00',
      discountAmount: '40.00',
      isExceptionalDiscount: false,
    });
  });

  it('leaves the line untouched when newPrice equals the price already on it', async () => {
    const { service, orderItemsRepository } = build();
    await service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'same price', newPrice: 70 }, META);
    expect(orderItemsRepository.updatePriceWhilePending).not.toHaveBeenCalled();
  });
});

describe('PriceApprovalsService.approve / reject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks the requester from approving their own request (§49 / P7)', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue(PENDING_ROW);
    await expect(service.approve(TENANT, REQUESTER, APPROVE_PERMS, 'pa-1', META)).rejects.toThrow(ForbiddenException);
  });

  it('lets the tenant administrator (pricing.policy.manage) approve their own request', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue(PENDING_ROW);
    priceApprovalsRepository.resolveIfPending.mockResolvedValue({ ...PENDING_ROW, status: 'approved', approvedBy: REQUESTER });
    const result = await service.approve(TENANT, REQUESTER, [...APPROVE_PERMS, 'pricing.policy.manage'], 'pa-1', META);
    expect(result.status).toBe('approved');
  });

  it('approves a pending request via the conditional update', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue(PENDING_ROW);
    priceApprovalsRepository.resolveIfPending.mockResolvedValue({ ...PENDING_ROW, status: 'approved', approvedBy: APPROVER });
    const result = await service.approve(TENANT, APPROVER, APPROVE_PERMS, 'pa-1', META);
    expect(result.status).toBe('approved');
    expect(priceApprovalsRepository.resolveIfPending).toHaveBeenCalledWith(expect.anything(), TENANT, 'pa-1', {
      status: 'approved',
      approvedBy: APPROVER,
    });
  });

  it('is idempotent when already resolved to the same status', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue({ ...PENDING_ROW, status: 'approved', approvedBy: APPROVER });
    const result = await service.approve(TENANT, APPROVER, APPROVE_PERMS, 'pa-1', META);
    expect(result.status).toBe('approved');
    expect(priceApprovalsRepository.resolveIfPending).not.toHaveBeenCalled();
  });

  it('409s when trying to approve an already-rejected request', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue({ ...PENDING_ROW, status: 'rejected', approvedBy: APPROVER });
    await expect(service.approve(TENANT, APPROVER, APPROVE_PERMS, 'pa-1', META)).rejects.toThrow(ConflictException);
  });

  it('404s an unknown approval', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue(undefined);
    await expect(service.reject(TENANT, APPROVER, APPROVE_PERMS, 'missing', META)).rejects.toThrow(NotFoundException);
  });

  it('owner redesign: editing = approving with that new price, atomically', async () => {
    const { service, priceApprovalsRepository, orderItemsRepository, ordersRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue(PENDING_ROW);
    priceApprovalsRepository.resolveIfPending.mockResolvedValue({
      ...PENDING_ROW,
      status: 'approved',
      approvedBy: APPROVER,
      requestedPrice: '90.00',
      discountAmount: '60.00',
    });
    const result = await service.approve(TENANT, APPROVER, APPROVE_PERMS, 'pa-1', META, 90);
    expect(result.status).toBe('approved');
    expect(priceApprovalsRepository.resolveIfPending).toHaveBeenCalledWith(expect.anything(), TENANT, 'pa-1', {
      status: 'approved',
      approvedBy: APPROVER,
      requestedPrice: '90.00',
      discountAmount: '60.00',
    });
    expect(orderItemsRepository.updatePriceWhilePending).toHaveBeenCalledWith(expect.anything(), TENANT, 'oi-1', {
      unitPriceSnapshot: '90.00',
      lineTotal: '180.00',
      discountAmount: '60.00',
      isExceptionalDiscount: true,
    });
    expect(ordersRepository.updateTotals).toHaveBeenCalled();
  });

  it('rejects an admin price edit that violates the tenant hard floor, writing nothing', async () => {
    const { service, priceApprovalsRepository, orderItemsRepository, ordersRepository, pricePoliciesRepository } = build();
    pricePoliciesRepository.getEffective.mockResolvedValue({ exceptionalDiscountRequiresApproval: true, maxDiscountBelowMinPercent: 10 });
    priceApprovalsRepository.lockById.mockResolvedValue(PENDING_ROW);
    await expect(service.approve(TENANT, APPROVER, APPROVE_PERMS, 'pa-1', META, 50)).rejects.toThrow(UnprocessableEntityException);
    expect(priceApprovalsRepository.resolveIfPending).not.toHaveBeenCalled();
    expect(orderItemsRepository.updatePriceWhilePending).not.toHaveBeenCalled();
    expect(ordersRepository.updateTotals).not.toHaveBeenCalled();
  });

  it('discards a computed price edit when the approval CAS loses the race', async () => {
    const { service, priceApprovalsRepository, orderItemsRepository, ordersRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue(PENDING_ROW);
    priceApprovalsRepository.resolveIfPending.mockResolvedValue(undefined);
    priceApprovalsRepository.findById.mockResolvedValue({ ...PENDING_ROW, status: 'rejected', approvedBy: APPROVER });
    await expect(service.approve(TENANT, APPROVER, APPROVE_PERMS, 'pa-1', META, 90)).rejects.toThrow(ConflictException);
    expect(orderItemsRepository.updatePriceWhilePending).not.toHaveBeenCalled();
    expect(ordersRepository.updateTotals).not.toHaveBeenCalled();
  });
});

describe('PriceApprovalsService — visibility & permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omits minPriceAtRequest for a caller without pricing.floor.view (§45 / P15)', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.findById.mockResolvedValue(PENDING_ROW);
    const withoutFloor = await service.getById(TENANT, REQUESTER, ['pricing.discount.approve'], 'pa-1');
    expect(withoutFloor.minPriceAtRequest).toBeUndefined();
    expect(withoutFloor.maxPriceAtRequest).toBe(120);
    expect(withoutFloor.basePriceAtRequest).toBe(100); // never gated — it's the trigger itself
    const withFloor = await service.getById(TENANT, REQUESTER, ['pricing.discount.approve', 'pricing.floor.view'], 'pa-1');
    expect(withFloor.minPriceAtRequest).toBe(80);
  });

  it('403s a caller with neither request nor approve permission', async () => {
    const { service } = build();
    await expect(service.getById(TENANT, REQUESTER, ['sales.orders.view'], 'pa-1')).rejects.toThrow(ForbiddenException);
  });

  it('resolves orderNumber + requestedByName server-side, never a raw id', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.findById.mockResolvedValue(PENDING_ROW);
    const result = await service.getById(TENANT, REQUESTER, APPROVE_PERMS, 'pa-1');
    expect(result.orderNumber).toBe('ORD-000001');
    expect(result.requestedByName).toBe('Jane Requester');
    expect(result.approvedByName).toBeUndefined();
  });

  it('resolves approvedByName once a request is resolved', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.findById.mockResolvedValue({ ...PENDING_ROW, status: 'approved', approvedBy: APPROVER });
    const result = await service.getById(TENANT, REQUESTER, APPROVE_PERMS, 'pa-1');
    expect(result.approvedByName).toBe('Alex Approver');
  });
});

describe('PriceApprovalsService.list — Almacén, product and business-day filter', () => {
  beforeEach(() => vi.clearAllMocks());
  const query = { page: 1, pageSize: 20 };

  it('adds the order location and the product name to each row, with one batched label lookup', async () => {
    const { service, priceApprovalsRepository, orderItemsRepository } = build();
    priceApprovalsRepository.listByTenant.mockResolvedValue({ rows: [PENDING_ROW, { ...PENDING_ROW, id: 'pa-2' }], total: 2 });
    const result = await service.list(TENANT, REQUESTER, REQUEST_PERMS, query as never);
    expect(orderItemsRepository.findLabelsByIds).toHaveBeenCalledTimes(1);
    expect(result.data[0]).toMatchObject({ locationId: 'loc-1', productName: 'Refrigerator', sku: 'SKU-1' });
  });

  it('resolves dateFrom to one tenant-local day on requested_at and passes locationId through', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
    await service.list(TENANT, REQUESTER, REQUEST_PERMS, { ...query, dateFrom: '2026-10-13', locationId: 'loc-1' } as never);
    const params = priceApprovalsRepository.listByTenant.mock.calls[0]![2] as { dayRange: { gte: Date; lt: Date }; locationId: string };
    expect(params.dayRange.gte.toISOString()).toBe('2026-10-13T05:00:00.000Z');
    expect(params.dayRange.lt.toISOString()).toBe('2026-10-14T05:00:00.000Z');
    expect(params.locationId).toBe('loc-1');
  });

  it('rejects dateTo without dateFrom', async () => {
    const { service } = build();
    await expect(service.list(TENANT, REQUESTER, REQUEST_PERMS, { ...query, dateTo: '2026-10-13' } as never)).rejects.toThrow('dateTo');
  });
});
