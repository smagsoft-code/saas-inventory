import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoriesService } from './categories.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const CATEGORY_ID = 'category-1';
const META = { correlationId: undefined, ipAddress: undefined };

const EXISTING_CATEGORY = {
  id: CATEGORY_ID,
  tenantId: TENANT_ID,
  parentCategoryId: null,
  name: 'Motos',
  slug: 'motos',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const categoriesRepository = { findById: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), update: vi.fn() };
  const attributesRepository = {
    listCategoryAttributes: vi.fn().mockResolvedValue([]),
    listDefinitionsByTenant: vi.fn().mockResolvedValue([]),
    findDefinitionById: vi.fn(),
    replaceCategoryAttributes: vi.fn(),
  };
  const auditLogService = { record: vi.fn() };
  const service = new CategoriesService(categoriesRepository as never, attributesRepository as never, auditLogService as never);
  return { service, categoriesRepository, attributesRepository, auditLogService };
}

describe('CategoriesService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('cross-tenant/nonexistent (§28 scenario A)', () => {
    it('getById throws NotFoundException rather than leaking whether a foreign-tenant id exists', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.findById.mockResolvedValue(undefined);
      await expect(service.getById(TENANT_ID, 'other-tenants-category')).rejects.toThrow(NotFoundException);
    });

    it('create rejects a parentCategoryId that does not resolve in the current tenant', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.findById.mockResolvedValue(undefined);
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { name: 'Sub', slug: 'sub', parentCategoryId: 'foreign-id' }, META),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('maps a unique-slug violation to ConflictException (both direct and .cause-wrapped shapes)', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.create.mockRejectedValueOnce({ code: '23505' });
      await expect(service.create(TENANT_ID, ACTOR_ID, { name: 'Motos', slug: 'motos' }, META)).rejects.toThrow(ConflictException);

      categoriesRepository.create.mockRejectedValueOnce(new Error('Failed query', { cause: { code: '23505' } }));
      await expect(service.create(TENANT_ID, ACTOR_ID, { name: 'Motos', slug: 'motos' }, META)).rejects.toThrow(ConflictException);
    });
  });

  describe('update — self-parent (§34-adjacent structural guard)', () => {
    it('rejects a category being set as its own parent', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.findById.mockResolvedValue(EXISTING_CATEGORY);
      await expect(
        service.update(TENANT_ID, ACTOR_ID, CATEGORY_ID, { parentCategoryId: CATEGORY_ID }, META),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
