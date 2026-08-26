import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PriceApprovalsService } from './price-approvals.service';

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
  const ordersRepository = { lockById: vi.fn().mockResolvedValue({ id: 'order-1', status: 'pending', tenantId: TENANT }) };
  const orderItemsRepository = { findById: vi.fn().mockResolvedValue(ORDER_ITEM) };
  const auditLogService = { record: vi.fn() };
  const domainEventPublisher = { append: vi.fn() };
  const service = new PriceApprovalsService(
    priceApprovalsRepository as never,
    ordersRepository as never,
    orderItemsRepository as never,
    auditLogService as never,
    domainEventPublisher as never,
  );
  return { service, priceApprovalsRepository, ordersRepository, orderItemsRepository, domainEventPublisher };
}

describe('PriceApprovalsService.request', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending approval derived server-side from the frozen order line (§50)', async () => {
    const { service, priceApprovalsRepository } = build();
    await service.request(TENANT, REQUESTER, REQUEST_PERMS, { orderItemId: 'oi-1', reason: 'loyal customer' }, META);
    const values = priceApprovalsRepository.create.mock.calls[0]![1] as Record<string, unknown>;
    expect(values.requestedPrice).toBe('70.00');
    expect(values.minPriceAtRequest).toBe('80.00');
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
});

describe('PriceApprovalsService.approve / reject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks the requester from approving their own request (§49 / P7)', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.lockById.mockResolvedValue(PENDING_ROW);
    await expect(service.approve(TENANT, REQUESTER, APPROVE_PERMS, 'pa-1', META)).rejects.toThrow(ForbiddenException);
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
});

describe('PriceApprovalsService — visibility & permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omits minPriceAtRequest for a caller without pricing.floor.view (§45 / P15)', async () => {
    const { service, priceApprovalsRepository } = build();
    priceApprovalsRepository.findById.mockResolvedValue(PENDING_ROW);
    const withoutFloor = await service.getById(TENANT, ['pricing.discount.approve'], 'pa-1');
    expect(withoutFloor.minPriceAtRequest).toBeUndefined();
    expect(withoutFloor.maxPriceAtRequest).toBe(120);
    const withFloor = await service.getById(TENANT, ['pricing.discount.approve', 'pricing.floor.view'], 'pa-1');
    expect(withFloor.minPriceAtRequest).toBe(80);
  });

  it('403s a caller with neither request nor approve permission', async () => {
    const { service } = build();
    await expect(service.getById(TENANT, ['sales.orders.view'], 'pa-1')).rejects.toThrow(ForbiddenException);
  });
});
