import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersService } from './customers.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const META = { correlationId: undefined, ipAddress: undefined };

const EXISTING = {
  id: 'customer-1',
  tenantId: TENANT_ID,
  type: 'individual',
  displayName: 'Ada Lovelace',
  taxId: '0102030405',
  email: 'ada@example.com',
  phone: '+593999999999',
  address: { city: 'Quito' },
  status: 'active',
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

function buildService() {
  const customersRepository = { findById: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), update: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new CustomersService(customersRepository as never, auditLogService as never);
  return { service, customersRepository, auditLogService };
}

describe('CustomersService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getById throws NotFound rather than leaking whether a foreign-tenant id exists (§48)', async () => {
    const { service, customersRepository } = buildService();
    customersRepository.findById.mockResolvedValue(undefined);
    await expect(service.getById(TENANT_ID, 'foreign-id')).rejects.toThrow(NotFoundException);
  });

  it('create maps a per-tenant tax-id unique violation to 409 (both direct and .cause-wrapped)', async () => {
    const { service, customersRepository } = buildService();
    customersRepository.create.mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.create(TENANT_ID, ACTOR_ID, { type: 'individual', displayName: 'X', taxId: '0102030405' }, META),
    ).rejects.toThrow(ConflictException);

    customersRepository.create.mockRejectedValueOnce(new Error('Failed query', { cause: { code: '23505' } }));
    await expect(
      service.create(TENANT_ID, ACTOR_ID, { type: 'individual', displayName: 'X', taxId: '0102030405' }, META),
    ).rejects.toThrow(ConflictException);
  });

  it('create drops empty address fields and passes tenant + status server-side only', async () => {
    const { service, customersRepository, auditLogService } = buildService();
    customersRepository.create.mockResolvedValue(EXISTING);
    await service.create(
      TENANT_ID,
      ACTOR_ID,
      { type: 'individual', displayName: 'Ada', address: { city: 'Quito', state: '', country: undefined } as never },
      META,
    );
    const values = customersRepository.create.mock.calls[0]![1] as { tenantId: string; address: unknown };
    expect(values.tenantId).toBe(TENANT_ID);
    expect(values.address).toEqual({ city: 'Quito' });
    expect(auditLogService.record).toHaveBeenCalled();
  });

  it('update on a missing customer throws NotFound and never calls the repo update', async () => {
    const { service, customersRepository } = buildService();
    customersRepository.findById.mockResolvedValue(undefined);
    await expect(service.update(TENANT_ID, ACTOR_ID, 'customer-1', { phone: '+1' }, META)).rejects.toThrow(NotFoundException);
    expect(customersRepository.update).not.toHaveBeenCalled();
  });

  it('update writes a before/after audit entry — editing a customer is an audited mutation (§71)', async () => {
    const { service, customersRepository, auditLogService } = buildService();
    customersRepository.findById.mockResolvedValue(EXISTING);
    customersRepository.update.mockResolvedValue({ ...EXISTING, phone: '+593000' });
    await service.update(TENANT_ID, ACTOR_ID, 'customer-1', { phone: '+593000' }, META);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionCode: 'customer.updated', entityType: 'customer', entityId: 'customer-1' }),
    );
  });
});
