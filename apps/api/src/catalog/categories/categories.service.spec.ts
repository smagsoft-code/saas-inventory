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
  code: 'CAT-001',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const categoriesRepository = {
    findById: vi.fn(),
    listByTenant: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    nextCode: vi.fn().mockResolvedValue('CAT-007'),
  };
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
        service.create(TENANT_ID, ACTOR_ID, { name: 'Sub', code: 'SUB-1', parentCategoryId: 'foreign-id' }, META),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('maps a unique-code violation to ConflictException (both direct and .cause-wrapped shapes)', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.create.mockRejectedValueOnce({ code: '23505' });
      await expect(service.create(TENANT_ID, ACTOR_ID, { name: 'Motos', code: 'MOTOS' }, META)).rejects.toThrow(ConflictException);

      categoriesRepository.create.mockRejectedValueOnce(new Error('Failed query', { cause: { code: '23505' } }));
      await expect(service.create(TENANT_ID, ACTOR_ID, { name: 'Motos', code: 'MOTOS' }, META)).rejects.toThrow(ConflictException);
    });
  });

  describe('create — category code', () => {
    it('uses the code the caller typed (any case) as is', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.create.mockResolvedValue({ ...EXISTING_CATEGORY, code: 'Muebles-A' });
      await service.create(TENANT_ID, ACTOR_ID, { name: 'Muebles', code: 'Muebles-A' }, META);
      expect(categoriesRepository.nextCode).not.toHaveBeenCalled();
      expect(categoriesRepository.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'Muebles-A' }));
    });

    it('proposes the next automatic code (CAT-00X) when none is sent', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.create.mockResolvedValue({ ...EXISTING_CATEGORY, code: 'CAT-007' });
      const result = await service.create(TENANT_ID, ACTOR_ID, { name: 'Motos' }, META);
      expect(categoriesRepository.nextCode).toHaveBeenCalledTimes(1);
      expect(categoriesRepository.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'CAT-007' }));
      expect(result.code).toBe('CAT-007');
    });
  });

  describe('getNextCode', () => {
    it('previews the next automatic code without creating anything', async () => {
      const { service, categoriesRepository } = buildService();
      await expect(service.getNextCode(TENANT_ID)).resolves.toEqual({ code: 'CAT-007' });
      expect(categoriesRepository.create).not.toHaveBeenCalled();
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
