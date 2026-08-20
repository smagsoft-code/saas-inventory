import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationsService } from './locations.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const WAREHOUSE_ID = 'warehouse-1';
const LOCATION_ID = 'location-1';
const META = { correlationId: undefined, ipAddress: undefined };

const EXISTING_WAREHOUSE = { id: WAREHOUSE_ID, tenantId: TENANT_ID, name: 'Bodega Principal', code: 'BP', status: 'active' };

const EXISTING_LOCATION = {
  id: LOCATION_ID,
  tenantId: TENANT_ID,
  warehouseId: WAREHOUSE_ID,
  parentLocationId: null,
  name: 'Zona A',
  code: 'ZONA-A',
  isSellable: true,
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const locationsRepository = { findById: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), update: vi.fn() };
  const warehousesRepository = { findById: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new LocationsService(locationsRepository as never, warehousesRepository as never, auditLogService as never);
  return { service, locationsRepository, warehousesRepository, auditLogService };
}

describe('LocationsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create', () => {
    it('rejects an unknown warehouseId in the current tenant', async () => {
      const { service, warehousesRepository } = buildService();
      warehousesRepository.findById.mockResolvedValue(undefined);
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { warehouseId: 'foreign-warehouse', name: 'Zona A', code: 'ZONA-A' }, META),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a parentLocationId belonging to a different warehouse', async () => {
      const { service, warehousesRepository, locationsRepository } = buildService();
      warehousesRepository.findById.mockResolvedValue(EXISTING_WAREHOUSE);
      locationsRepository.findById.mockResolvedValue({ ...EXISTING_LOCATION, warehouseId: 'other-warehouse' });
      await expect(
        service.create(
          TENANT_ID,
          ACTOR_ID,
          { warehouseId: WAREHOUSE_ID, parentLocationId: LOCATION_ID, name: 'Estante 1', code: 'EST-1' },
          META,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a unique-code violation to ConflictException (both direct and .cause-wrapped shapes)', async () => {
      const { service, warehousesRepository, locationsRepository } = buildService();
      warehousesRepository.findById.mockResolvedValue(EXISTING_WAREHOUSE);
      locationsRepository.create.mockRejectedValueOnce({ code: '23505' });
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { warehouseId: WAREHOUSE_ID, name: 'Zona A', code: 'ZONA-A' }, META),
      ).rejects.toThrow(ConflictException);

      locationsRepository.create.mockRejectedValueOnce(new Error('Failed query', { cause: { code: '23505' } }));
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { warehouseId: WAREHOUSE_ID, name: 'Zona A', code: 'ZONA-A' }, META),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update — self-parent and cross-warehouse guards', () => {
    it('rejects a location being set as its own parent', async () => {
      const { service, locationsRepository } = buildService();
      locationsRepository.findById.mockResolvedValue(EXISTING_LOCATION);
      await expect(
        service.update(TENANT_ID, ACTOR_ID, LOCATION_ID, { parentLocationId: LOCATION_ID }, META),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reparenting to a location in a different warehouse', async () => {
      const { service, locationsRepository } = buildService();
      const otherLocationId = 'location-2';
      locationsRepository.findById.mockImplementation((_tx: unknown, _tenantId: string, id: string) => {
        if (id === LOCATION_ID) return Promise.resolve(EXISTING_LOCATION);
        if (id === otherLocationId) return Promise.resolve({ ...EXISTING_LOCATION, id: otherLocationId, warehouseId: 'other-warehouse' });
        return Promise.resolve(undefined);
      });
      await expect(
        service.update(TENANT_ID, ACTOR_ID, LOCATION_ID, { parentLocationId: otherLocationId }, META),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
