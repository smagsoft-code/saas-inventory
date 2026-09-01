import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

/**
 * Unit tests with every repository/service dependency mocked — same convention as
 * auth/services/auth.service.spec.ts. These exercise UsersService's own authorization branching
 * (the §16/§21/§22 self-administration and role-assignment rules), not the persistence layer or
 * RLS — that's covered by test/core/users-rbac.integration.test.ts (HTTP-level, requires a real
 * Postgres instance) and test/database/multi-tenancy-rls.integration.test.ts.
 */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const TARGET_ID = 'target-1';

const EXISTING_USER = {
  id: TARGET_ID,
  tenantId: TENANT_ID,
  email: 'member@example.com',
  passwordHash: 'stored-hash',
  fullName: 'Member User',
  status: 'active',
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const SOME_ROLE = { id: 'role-1', name: 'Vendedor', description: null, isSystemDefault: true };

function buildService() {
  const usersRepository = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    touchLastLogin: vi.fn(),
    findManyByTenant: vi.fn(),
    updateProfile: vi.fn(),
  };
  const rolesRepository = {
    findById: vi.fn(),
    listByTenant: vi.fn(),
    roleNamesForUsers: vi.fn().mockResolvedValue(new Map()),
    setUserRole: vi.fn(),
  };
  const passwordService = { hash: vi.fn().mockResolvedValue('new-hash'), verify: vi.fn() };
  const identityProvisioningService = { provisionMembership: vi.fn().mockResolvedValue({ identityId: 'identity-1' }) };
  const auditLogService = { record: vi.fn() };

  const service = new UsersService(
    usersRepository as never,
    rolesRepository as never,
    passwordService as never,
    identityProvisioningService as never,
    auditLogService as never,
  );

  return { service, usersRepository, rolesRepository, passwordService, identityProvisioningService, auditLogService };
}

const META = { correlationId: undefined, ipAddress: undefined };

describe('UsersService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('update — self-administration (§16/§21)', () => {
    it('rejects a user attempting to change their own role, even if they hold core.roles.assign', async () => {
      const { service } = buildService();

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ['core.roles.assign'], ACTOR_ID, { roleId: SOME_ROLE.id }, META),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a user attempting to change their own status, even if they hold core.users.update', async () => {
      const { service } = buildService();

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ['core.users.update'], ACTOR_ID, { status: 'disabled' }, META),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a user to change their own fullName', async () => {
      const { service, usersRepository, rolesRepository } = buildService();
      usersRepository.findById.mockResolvedValue({ ...EXISTING_USER, id: ACTOR_ID });
      usersRepository.updateProfile.mockResolvedValue({ ...EXISTING_USER, id: ACTOR_ID, fullName: 'New Name' });
      rolesRepository.roleNamesForUsers.mockResolvedValue(new Map());

      const result = await service.update(TENANT_ID, ACTOR_ID, [], ACTOR_ID, { fullName: 'New Name' }, META);
      expect(result.fullName).toBe('New Name');
    });
  });

  describe('update — role assignment requires core.roles.assign (§17/§20)', () => {
    it('rejects changing another user role without core.roles.assign, even with core.users.update', async () => {
      const { service } = buildService();

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ['core.users.update'], TARGET_ID, { roleId: SOME_ROLE.id }, META),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows changing another user role with core.roles.assign', async () => {
      const { service, usersRepository, rolesRepository } = buildService();
      usersRepository.findById.mockResolvedValue(EXISTING_USER);
      rolesRepository.findById.mockResolvedValue(SOME_ROLE);
      rolesRepository.roleNamesForUsers.mockResolvedValue(new Map([[TARGET_ID, [SOME_ROLE.name]]]));

      const result = await service.update(
        TENANT_ID,
        ACTOR_ID,
        ['core.roles.assign'],
        TARGET_ID,
        { roleId: SOME_ROLE.id },
        META,
      );
      expect(rolesRepository.setUserRole).toHaveBeenCalledWith(expect.anything(), TENANT_ID, TARGET_ID, SOME_ROLE.id, ACTOR_ID);
      expect(result.roleNames).toContain(SOME_ROLE.name);
    });

    it('rejects a roleId that does not resolve within the tenant (cross-tenant/nonexistent — §28 scenario D)', async () => {
      const { service, usersRepository, rolesRepository } = buildService();
      usersRepository.findById.mockResolvedValue(EXISTING_USER);
      rolesRepository.findById.mockResolvedValue(undefined);

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ['core.roles.assign'], TARGET_ID, { roleId: 'foreign-role' }, META),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update — target not found', () => {
    it('throws NotFoundException for a user id that does not resolve in this tenant (§12/§28 scenario A)', async () => {
      const { service, usersRepository } = buildService();
      usersRepository.findById.mockResolvedValue(undefined);

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ['core.users.update'], 'someone-else', { fullName: 'X' }, META),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create — role assignment requires core.roles.assign (§13)', () => {
    it('rejects creating a user with a roleId when the actor lacks core.roles.assign', async () => {
      const { service } = buildService();

      await expect(
        service.create(
          TENANT_ID,
          ACTOR_ID,
          ['core.users.create'],
          { email: 'new@example.com', fullName: 'New User', password: 'a-long-enough-password', roleId: SOME_ROLE.id },
          META,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a user without a role when none is requested, regardless of permissions held', async () => {
      const { service, usersRepository } = buildService();
      usersRepository.create.mockResolvedValue({ ...EXISTING_USER, id: 'new-user' });

      const result = await service.create(
        TENANT_ID,
        ACTOR_ID,
        ['core.users.create'],
        { email: 'new@example.com', fullName: 'New User', password: 'a-long-enough-password' },
        META,
      );
      expect(result.roleNames).toEqual([]);
    });

    it('maps a unique-violation on create to ConflictException, not a raw DB error', async () => {
      const { service, usersRepository } = buildService();
      usersRepository.create.mockRejectedValue({ code: '23505' });

      await expect(
        service.create(
          TENANT_ID,
          ACTOR_ID,
          ['core.users.create'],
          { email: 'dup@example.com', fullName: 'Dup User', password: 'a-long-enough-password' },
          META,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a unique-violation wrapped as DrizzleQueryError.cause to ConflictException too', async () => {
      // The real shape drizzle-orm's postgres-js driver actually throws — the Postgres error
      // (carrying .code) lives on .cause, never on the thrown error directly. A mock using only
      // the flat { code: '23505' } shape above would not have caught this (Prompt 05-B: found by
      // running this path for real against PostgreSQL, where it fell through to a raw 500).
      const { service, usersRepository } = buildService();
      usersRepository.create.mockRejectedValue(new Error('Failed query', { cause: { code: '23505' } }));

      await expect(
        service.create(
          TENANT_ID,
          ACTOR_ID,
          ['core.users.create'],
          { email: 'dup@example.com', fullName: 'Dup User', password: 'a-long-enough-password' },
          META,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getById — cross-tenant/nonexistent (§12/§28 scenario A)', () => {
    it('throws NotFoundException rather than leaking whether the id exists in another tenant', async () => {
      const { service, usersRepository } = buildService();
      usersRepository.findById.mockResolvedValue(undefined);

      await expect(service.getById(TENANT_ID, 'foreign-user-id')).rejects.toThrow(NotFoundException);
    });
  });
});
