import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BalancesService } from './balances.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const BALANCE_ID = 'balance-1';

const EXISTING_BALANCE = {
  id: BALANCE_ID,
  tenantId: TENANT_ID,
  productVariantId: 'variant-1',
  locationId: 'location-1',
  quantityPhysical: '10',
  quantityReserved: '2',
  quantityCommitted: '1',
  quantityAvailable: '7',
  version: 3,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const balancesRepository = { findById: vi.fn(), listByTenant: vi.fn() };
  const service = new BalancesService(balancesRepository as never);
  return { service, balancesRepository };
}

describe('BalancesService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getById', () => {
    it('throws NotFoundException rather than leaking whether a foreign-tenant balance exists', async () => {
      const { service, balancesRepository } = buildService();
      balancesRepository.findById.mockResolvedValue(undefined);
      await expect(service.getById(TENANT_ID, 'other-tenants-balance')).rejects.toThrow(NotFoundException);
    });

    it('converts numeric string columns to numbers in the response', async () => {
      const { service, balancesRepository } = buildService();
      balancesRepository.findById.mockResolvedValue(EXISTING_BALANCE);
      const result = await service.getById(TENANT_ID, BALANCE_ID);
      expect(result).toEqual(
        expect.objectContaining({ quantityPhysical: 10, quantityReserved: 2, quantityCommitted: 1, quantityAvailable: 7, version: 3 }),
      );
    });
  });

  describe('list', () => {
    it('passes filters through to the repository and paginates the response', async () => {
      const { service, balancesRepository } = buildService();
      balancesRepository.listByTenant.mockResolvedValue({ rows: [EXISTING_BALANCE], total: 1 });

      const result = await service.list(TENANT_ID, { page: 1, pageSize: 20, productVariantId: 'variant-1' });

      expect(balancesRepository.listByTenant).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        expect.objectContaining({ page: 1, pageSize: 20, productVariantId: 'variant-1' }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
