import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationAssignmentsService } from './location-assignments.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const USER_ID = 'user-1';
const META = { correlationId: undefined, ipAddress: undefined };

function buildService() {
  const userLocationAssignmentsRepository = { listByUser: vi.fn(), replaceForUser: vi.fn() };
  const locationsRepository = { findById: vi.fn() };
  const usersRepository = { findById: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new LocationAssignmentsService(
    userLocationAssignmentsRepository as never,
    locationsRepository as never,
    usersRepository as never,
    auditLogService as never,
  );
  return { service, userLocationAssignmentsRepository, locationsRepository, usersRepository, auditLogService };
}

describe('LocationAssignmentsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('list/replace', () => {
    it('throws NotFoundException rather than leaking whether a foreign-tenant user id exists', async () => {
      const { service, usersRepository } = buildService();
      usersRepository.findById.mockResolvedValue(undefined);
      await expect(service.list(TENANT_ID, 'other-tenants-user')).rejects.toThrow(NotFoundException);
      await expect(service.replace(TENANT_ID, ACTOR_ID, 'other-tenants-user', { locationIds: [] }, META)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a locationId that does not resolve in the current tenant', async () => {
      const { service, usersRepository, locationsRepository } = buildService();
      usersRepository.findById.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID });
      locationsRepository.findById.mockResolvedValue(undefined);
      await expect(
        service.replace(TENANT_ID, ACTOR_ID, USER_ID, { locationIds: ['foreign-location'] }, META),
      ).rejects.toThrow(NotFoundException);
    });

    it('an empty locationIds array is valid — ADR-0024 zero rows means unrestricted', async () => {
      const { service, usersRepository, userLocationAssignmentsRepository } = buildService();
      usersRepository.findById.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID });
      userLocationAssignmentsRepository.replaceForUser.mockResolvedValue([]);

      const result = await service.replace(TENANT_ID, ACTOR_ID, USER_ID, { locationIds: [] }, META);

      expect(result).toEqual([]);
      expect(userLocationAssignmentsRepository.replaceForUser).toHaveBeenCalledWith(expect.anything(), TENANT_ID, USER_ID, [], ACTOR_ID);
    });
  });
});
