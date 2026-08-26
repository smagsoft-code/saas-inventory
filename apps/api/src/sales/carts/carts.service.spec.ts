import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesPricingService } from '../pricing/sales-pricing.service';
import { CartsService } from './carts.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';
const META = { correlationId: undefined, ipAddress: undefined };
const PERMS: string[] = ['sales.carts.manage'];

const OPEN_CART = {
  id: 'cart-1',
  tenantId: TENANT_ID,
  locationId: 'loc-1',
  userId: USER_ID,
  customerId: null,
  orderId: null,
  status: 'open',
  version: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: null,
};

const ACTIVE_VARIANT = {
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

function buildService() {
  const cartsRepository = {
    findOpenByUser: vi.fn(),
    lockById: vi.fn(),
    findById: vi.fn().mockResolvedValue(OPEN_CART),
    acquireUserCartLock: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(OPEN_CART),
  };
  const cartItemsRepository = { listByCart: vi.fn().mockResolvedValue([]), findById: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const customersRepository = { findById: vi.fn() };
  const catalogLookup = { findVariantById: vi.fn() };
  const balancesRepository = { findByVariantAndLocation: vi.fn().mockResolvedValue(undefined) };
  const locationsRepository = { findById: vi.fn() };
  const locationAuthorizationService = { assertAccess: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new CartsService(
    cartsRepository as never,
    cartItemsRepository as never,
    customersRepository as never,
    catalogLookup as never,
    balancesRepository as never,
    locationsRepository as never,
    locationAuthorizationService as never,
    new SalesPricingService(),
    auditLogService as never,
  );
  return { service, cartsRepository, cartItemsRepository, catalogLookup, locationsRepository, locationAuthorizationService };
}

describe('CartsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getActive throws NotFound when the caller has no open cart', async () => {
    const { service, cartsRepository } = buildService();
    cartsRepository.findOpenByUser.mockResolvedValue(undefined);
    await expect(service.getActive(TENANT_ID, USER_ID, PERMS)).rejects.toThrow(NotFoundException);
  });

  it('createOrGetActive returns the existing open cart instead of creating a second one (§17)', async () => {
    const { service, cartsRepository } = buildService();
    cartsRepository.findOpenByUser.mockResolvedValue(OPEN_CART);
    await service.createOrGetActive(TENANT_ID, USER_ID, PERMS, { locationId: 'loc-1' }, META);
    expect(cartsRepository.acquireUserCartLock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, USER_ID);
    expect(cartsRepository.create).not.toHaveBeenCalled();
  });

  it('createOrGetActive rejects a non-sellable location (409)', async () => {
    const { service, cartsRepository, locationsRepository } = buildService();
    cartsRepository.findOpenByUser.mockResolvedValue(undefined);
    locationsRepository.findById.mockResolvedValue({ id: 'loc-1', status: 'active', isSellable: false });
    await expect(service.createOrGetActive(TENANT_ID, USER_ID, PERMS, { locationId: 'loc-1' }, META)).rejects.toThrow(ConflictException);
  });

  describe('addItem', () => {
    beforeEach(() => {});

    it('rejects an inactive variant (§20)', async () => {
      const { service, cartsRepository, catalogLookup } = buildService();
      cartsRepository.findOpenByUser.mockResolvedValue(OPEN_CART);
      cartsRepository.lockById.mockResolvedValue(OPEN_CART);
      catalogLookup.findVariantById.mockResolvedValue({ ...ACTIVE_VARIANT, status: 'discontinued' });
      await expect(
        service.addItem(TENANT_ID, USER_ID, PERMS, { productVariantId: 'variant-1', quantity: 1 }, META),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a serialized / lot-tracked variant — deferred to a later phase (§49-§51)', async () => {
      const { service, cartsRepository, catalogLookup } = buildService();
      cartsRepository.findOpenByUser.mockResolvedValue(OPEN_CART);
      cartsRepository.lockById.mockResolvedValue(OPEN_CART);
      catalogLookup.findVariantById.mockResolvedValue({ ...ACTIVE_VARIANT, isSerialized: true });
      await expect(
        service.addItem(TENANT_ID, USER_ID, PERMS, { productVariantId: 'variant-1', quantity: 1 }, META),
      ).rejects.toThrow(/serialized or lot-tracked/i);
    });

    it('FASE 13: allows staging a below-floor negotiated price (checkout turns it into an exceptional-discount flow)', async () => {
      const { service, cartsRepository, cartItemsRepository, catalogLookup } = buildService();
      cartsRepository.findOpenByUser.mockResolvedValue(OPEN_CART);
      cartsRepository.lockById.mockResolvedValue(OPEN_CART);
      catalogLookup.findVariantById.mockResolvedValue(ACTIVE_VARIANT);
      await service.addItem(TENANT_ID, USER_ID, PERMS, { productVariantId: 'variant-1', quantity: 1, negotiatedUnitPrice: 50 }, META);
      expect(cartItemsRepository.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ negotiatedUnitPrice: 50 }),
      );
    });

    it('still rejects a negotiated price above the maximum (400)', async () => {
      const { service, cartsRepository, catalogLookup } = buildService();
      cartsRepository.findOpenByUser.mockResolvedValue(OPEN_CART);
      cartsRepository.lockById.mockResolvedValue(OPEN_CART);
      catalogLookup.findVariantById.mockResolvedValue(ACTIVE_VARIANT);
      await expect(
        service.addItem(TENANT_ID, USER_ID, PERMS, { productVariantId: 'variant-1', quantity: 1, negotiatedUnitPrice: 500 }, META),
      ).rejects.toThrow(/maximum authorized price/i);
    });

    it('accepts a negotiated price within the authorized range and upserts the line', async () => {
      const { service, cartsRepository, cartItemsRepository, catalogLookup } = buildService();
      cartsRepository.findOpenByUser.mockResolvedValue(OPEN_CART);
      cartsRepository.lockById.mockResolvedValue(OPEN_CART);
      catalogLookup.findVariantById.mockResolvedValue(ACTIVE_VARIANT);
      await service.addItem(TENANT_ID, USER_ID, PERMS, { productVariantId: 'variant-1', quantity: 2, negotiatedUnitPrice: 90 }, META);
      expect(cartItemsRepository.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ productVariantId: 'variant-1', quantityDelta: 2, negotiatedUnitPrice: 90 }),
      );
    });
  });
});
