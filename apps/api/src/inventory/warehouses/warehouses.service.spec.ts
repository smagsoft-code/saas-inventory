import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WarehousesService } from './warehouses.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const WAREHOUSE_ID = 'warehouse-1';
const META = { correlationId: undefined, ipAddress: undefined };

const EXISTING_WAREHOUSE = {
  id: WAREHOUSE_ID,
  tenantId: TENANT_ID,
  name: 'Bodega Principal',
  code: 'BP',
  address: null,
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const warehousesRepository = { findById: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), update: vi.fn() };
  const locationsRepository = { findById: vi.fn(), create: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new WarehousesService(warehousesRepository as never, locationsRepository as never, auditLogService as never);
  return { service, warehousesRepository, locationsRepository, auditLogService };
}

describe('WarehousesService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getById', () => {
    it('throws NotFoundException rather than leaking whether a foreign-tenant id exists', async () => {
      const { service, warehousesRepository } = buildService();
      warehousesRepository.findById.mockResolvedValue(undefined);
      await expect(service.getById(TENANT_ID, 'other-tenants-warehouse')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the default "General" location in the same transaction (database.md invariant)', async () => {
      const { service, warehousesRepository, locationsRepository } = buildService();
      warehousesRepository.create.mockResolvedValue(EXISTING_WAREHOUSE);
      locationsRepository.create.mockResolvedValue({ id: 'location-1', code: 'GENERAL', name: 'General' });

      await service.create(TENANT_ID, ACTOR_ID, { name: 'Bodega Principal', code: 'BP' }, META);

      expect(locationsRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ warehouseId: EXISTING_WAREHOUSE.id, name: 'General', code: 'GENERAL' }),
      );
    });

    it('maps a unique-code violation to ConflictException (both direct and .cause-wrapped shapes)', async () => {
      const { service, warehousesRepository } = buildService();
      warehousesRepository.create.mockRejectedValueOnce({ code: '23505' });
      await expect(service.create(TENANT_ID, ACTOR_ID, { name: 'Bodega', code: 'BP' }, META)).rejects.toThrow(ConflictException);

      warehousesRepository.create.mockRejectedValueOnce(new Error('Failed query', { cause: { code: '23505' } }));
      await expect(service.create(TENANT_ID, ACTOR_ID, { name: 'Bodega', code: 'BP' }, META)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the warehouse does not exist in this tenant', async () => {
      const { service, warehousesRepository } = buildService();
      warehousesRepository.findById.mockResolvedValue(undefined);
      await expect(service.update(TENANT_ID, ACTOR_ID, WAREHOUSE_ID, { name: 'X' }, META)).rejects.toThrow(NotFoundException);
    });
  });
});
