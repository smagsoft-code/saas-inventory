import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantSettingsService } from './tenant-settings.service';

/** Same convention as core/users/users.service.spec.ts: every repository/service dependency
 * mocked. Tenant isolation/RLS is covered separately by the PostgreSQL-real integration suite. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const META = { actorId: ACTOR_ID, correlationId: undefined, ipAddress: undefined };

function buildService() {
  const tenantSettingsRepository = { find: vi.fn(), upsert: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new TenantSettingsService(tenantSettingsRepository as never, auditLogService as never);
  return { service, tenantSettingsRepository, auditLogService };
}

describe('TenantSettingsService', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  describe('getEffective', () => {
    it('returns system defaults with updatedAt=null when the tenant has never saved settings', async () => {
      harness.tenantSettingsRepository.find.mockResolvedValue(undefined);
      const result = await harness.service.getEffective(TENANT_ID);
      expect(result).toEqual({
        timezone: 'UTC',
        businessHours: [],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: null,
      });
    });

    it('returns the stored row when one exists', async () => {
      const updatedAt = new Date('2026-01-01T00:00:00Z');
      harness.tenantSettingsRepository.find.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'America/Bogota',
        businessHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
        transfersRequireApproval: false,
        transfersRequirePreparation: true,
        updatedAt,
      });
      const result = await harness.service.getEffective(TENANT_ID);
      expect(result.timezone).toBe('America/Bogota');
      expect(result.transfersRequireApproval).toBe(false);
      expect(result.transfersRequirePreparation).toBe(true);
      expect(result.updatedAt).toBe(updatedAt.toISOString());
    });
  });

  describe('update', () => {
    it('rejects a businessHours array with two entries for the same dayOfWeek', async () => {
      await expect(
        harness.service.update(
          TENANT_ID,
          { businessHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }, { dayOfWeek: 1, opensAt: '10:00', closesAt: '17:00' }] },
          META,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(harness.tenantSettingsRepository.upsert).not.toHaveBeenCalled();
    });

    it('rejects an entry where closesAt is not after opensAt', async () => {
      await expect(
        harness.service.update(TENANT_ID, { businessHours: [{ dayOfWeek: 1, opensAt: '18:00', closesAt: '09:00' }] }, META),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a closed-all-day entry with no opensAt/closesAt', async () => {
      harness.tenantSettingsRepository.find.mockResolvedValue(undefined);
      harness.tenantSettingsRepository.upsert.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'UTC',
        businessHours: [{ dayOfWeek: 0, isClosed: true }],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      await harness.service.update(TENANT_ID, { businessHours: [{ dayOfWeek: 0, isClosed: true }] }, META);
      expect(harness.tenantSettingsRepository.upsert).toHaveBeenCalledWith(
        {},
        TENANT_ID,
        expect.objectContaining({ businessHours: [{ dayOfWeek: 0, isClosed: true }] }),
      );
    });

    it('leaves timezone unchanged when omitted, carrying forward the previously effective value', async () => {
      harness.tenantSettingsRepository.find.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'America/Bogota',
        businessHours: [],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      harness.tenantSettingsRepository.upsert.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'America/Bogota',
        businessHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await harness.service.update(TENANT_ID, { businessHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }] }, META);

      expect(harness.tenantSettingsRepository.upsert).toHaveBeenCalledWith(
        {},
        TENANT_ID,
        expect.objectContaining({ timezone: 'America/Bogota' }),
      );
    });

    it('leaves the transfer-workflow flags unchanged when omitted, carrying forward the previously effective value', async () => {
      harness.tenantSettingsRepository.find.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'UTC',
        businessHours: [],
        transfersRequireApproval: false,
        transfersRequirePreparation: false,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      harness.tenantSettingsRepository.upsert.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'America/Bogota',
        businessHours: [],
        transfersRequireApproval: false,
        transfersRequirePreparation: false,
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await harness.service.update(TENANT_ID, { timezone: 'America/Bogota' }, META);

      expect(harness.tenantSettingsRepository.upsert).toHaveBeenCalledWith(
        {},
        TENANT_ID,
        expect.objectContaining({ transfersRequireApproval: false, transfersRequirePreparation: false }),
      );
    });

    it('updates the transfer-workflow flags independently of timezone/businessHours', async () => {
      harness.tenantSettingsRepository.find.mockResolvedValue(undefined);
      harness.tenantSettingsRepository.upsert.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'UTC',
        businessHours: [],
        transfersRequireApproval: false,
        transfersRequirePreparation: true,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await harness.service.update(TENANT_ID, { transfersRequireApproval: false }, META);

      expect(harness.tenantSettingsRepository.upsert).toHaveBeenCalledWith(
        {},
        TENANT_ID,
        expect.objectContaining({ transfersRequireApproval: false, transfersRequirePreparation: true }),
      );
      expect(result.transfersRequireApproval).toBe(false);
    });

    it('writes an audit entry with before/after state', async () => {
      harness.tenantSettingsRepository.find.mockResolvedValue(undefined);
      harness.tenantSettingsRepository.upsert.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'America/Bogota',
        businessHours: [],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      await harness.service.update(TENANT_ID, { timezone: 'America/Bogota' }, META);

      expect(harness.auditLogService.record).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          tenantId: TENANT_ID,
          actorId: ACTOR_ID,
          actionCode: 'tenant_settings.updated',
          entityType: 'tenant_settings',
          beforeState: { timezone: 'UTC', businessHours: [], transfersRequireApproval: true, transfersRequirePreparation: true },
          afterState: { timezone: 'America/Bogota', businessHours: [], transfersRequireApproval: true, transfersRequirePreparation: true },
        }),
      );
    });

    it('does not fail the request when the audit write throws', async () => {
      harness.tenantSettingsRepository.find.mockResolvedValue(undefined);
      harness.tenantSettingsRepository.upsert.mockResolvedValue({
        id: 'row-1',
        tenantId: TENANT_ID,
        timezone: 'UTC',
        businessHours: [],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      harness.auditLogService.record.mockRejectedValue(new Error('db down'));

      await expect(harness.service.update(TENANT_ID, { timezone: 'UTC' }, META)).resolves.toBeDefined();
    });
  });
});
