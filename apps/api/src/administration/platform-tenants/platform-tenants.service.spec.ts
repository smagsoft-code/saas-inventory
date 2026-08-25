import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformTenantsService } from './platform-tenants.service';

const TENANT_ID = 'tenant-1';
const ADMIN_ID = 'admin-1';
const META = { actorId: ADMIN_ID, correlationId: undefined, ipAddress: undefined };

const ACTIVE_TENANT = {
  id: TENANT_ID,
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  isDemo: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const tenantsPlatformRepository = { list: vi.fn(), findById: vi.fn(), setStatus: vi.fn() };
  const platformAuditLogService = { record: vi.fn() };
  const service = new PlatformTenantsService(tenantsPlatformRepository as never, platformAuditLogService as never);
  return { service, tenantsPlatformRepository, platformAuditLogService };
}

describe('PlatformTenantsService', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  it('lists every tenant regardless of status', async () => {
    harness.tenantsPlatformRepository.list.mockResolvedValue([ACTIVE_TENANT]);
    await expect(harness.service.list()).resolves.toEqual([ACTIVE_TENANT]);
  });

  it('getById throws NotFoundException for an unknown tenant', async () => {
    harness.tenantsPlatformRepository.findById.mockResolvedValue(undefined);
    await expect(harness.service.getById('missing')).rejects.toThrow(NotFoundException);
  });

  it('suspend transitions an active tenant to suspended and writes a platform audit entry', async () => {
    harness.tenantsPlatformRepository.findById.mockResolvedValue(ACTIVE_TENANT);
    harness.tenantsPlatformRepository.setStatus.mockResolvedValue({ ...ACTIVE_TENANT, status: 'suspended' });

    const result = await harness.service.suspend(TENANT_ID, META);

    expect(result.status).toBe('suspended');
    expect(harness.tenantsPlatformRepository.setStatus).toHaveBeenCalledWith(TENANT_ID, 'suspended');
    expect(harness.platformAuditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorId: ADMIN_ID,
        actionCode: 'tenant.suspended',
        entityType: 'tenant',
        entityId: TENANT_ID,
        beforeState: { status: 'active' },
        afterState: { status: 'suspended' },
      }),
    );
  });

  it('activate transitions a suspended tenant back to active', async () => {
    const suspended = { ...ACTIVE_TENANT, status: 'suspended' };
    harness.tenantsPlatformRepository.findById.mockResolvedValue(suspended);
    harness.tenantsPlatformRepository.setStatus.mockResolvedValue(ACTIVE_TENANT);

    const result = await harness.service.activate(TENANT_ID, META);

    expect(result.status).toBe('active');
    expect(harness.platformAuditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: 'tenant.activated', beforeState: { status: 'suspended' }, afterState: { status: 'active' } }),
    );
  });

  it('does not write an audit entry when the status does not actually change (idempotent no-op)', async () => {
    harness.tenantsPlatformRepository.findById.mockResolvedValue(ACTIVE_TENANT);
    harness.tenantsPlatformRepository.setStatus.mockResolvedValue(ACTIVE_TENANT);

    await harness.service.activate(TENANT_ID, META);

    expect(harness.platformAuditLogService.record).not.toHaveBeenCalled();
  });

  it('does not fail the request when the platform audit write throws', async () => {
    harness.tenantsPlatformRepository.findById.mockResolvedValue(ACTIVE_TENANT);
    harness.tenantsPlatformRepository.setStatus.mockResolvedValue({ ...ACTIVE_TENANT, status: 'suspended' });
    harness.platformAuditLogService.record.mockRejectedValue(new Error('db down'));

    await expect(harness.service.suspend(TENANT_ID, META)).resolves.toBeDefined();
  });
});
