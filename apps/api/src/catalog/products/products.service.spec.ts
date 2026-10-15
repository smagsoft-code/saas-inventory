import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const PRODUCT_ID = 'product-1';
const CATEGORY_ID = 'category-1';
const META = { correlationId: undefined, ipAddress: undefined };

const EXISTING_CATEGORY = { id: CATEGORY_ID, tenantId: TENANT_ID, parentCategoryId: null, name: 'Motos', slug: 'motos', status: 'active', createdAt: new Date(), updatedAt: new Date() };

const EXISTING_PRODUCT = {
  id: PRODUCT_ID,
  tenantId: TENANT_ID,
  categoryId: CATEGORY_ID,
  brandId: null,
  supplierId: null,
  name: 'Moto XR',
  description: null,
  status: 'draft',
  warrantyMonths: null,
  attributes: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const VALID_VARIANT_FIELDS = { sku: 'SKU-1', maxPrice: 100, basePrice: 80, minPrice: 60 };

function buildService() {
  const productsRepository = {
    findById: vi.fn(),
    listByTenant: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findVariantById: vi.fn(),
    listVariantsByProduct: vi.fn(),
    createVariant: vi.fn(),
    nextSku: vi.fn(),
    updateVariant: vi.fn(),
    recordPriceChange: vi.fn(),
    brandExists: vi.fn(),
    supplierExists: vi.fn(),
  };
  const categoriesRepository = { findById: vi.fn() };
  const attributeValidationService = { validate: vi.fn().mockResolvedValue(undefined) };
  const auditLogService = { record: vi.fn() };
  const variantStock = { totalPhysicalStock: vi.fn().mockResolvedValue(0) };
  const service = new ProductsService(
    productsRepository as never,
    categoriesRepository as never,
    attributeValidationService as never,
    auditLogService as never,
    variantStock as never,
  );
  return { service, productsRepository, categoriesRepository, attributeValidationService, auditLogService, variantStock };
}

describe('ProductsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('cross-tenant/nonexistent (§28 scenario A)', () => {
    it('getById throws NotFoundException rather than leaking whether a foreign-tenant id exists', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.findById.mockResolvedValue(undefined);
      await expect(service.getById(TENANT_ID, 'other-tenants-product')).rejects.toThrow(NotFoundException);
    });

    it('create rejects a categoryId that does not resolve in the current tenant', async () => {
      const { service, categoriesRepository } = buildService();
      categoriesRepository.findById.mockResolvedValue(undefined);
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { name: 'Moto', categoryId: 'foreign-category', defaultVariant: VALID_VARIANT_FIELDS }, META),
      ).rejects.toThrow(NotFoundException);
    });

    it('create rejects a brandId/supplierId that does not resolve in the current tenant', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.brandExists.mockResolvedValue(false);
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { name: 'Moto', brandId: 'foreign-brand', defaultVariant: VALID_VARIANT_FIELDS }, META),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('price tier (database.md CHECK, enforced pre-DB too)', () => {
    it('rejects minPrice > basePrice before ever calling the repository', async () => {
      const { service, productsRepository } = buildService();
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { name: 'Moto', defaultVariant: { sku: 'S', maxPrice: 100, basePrice: 50, minPrice: 60 } }, META),
      ).rejects.toThrow(BadRequestException);
      expect(productsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects basePrice > maxPrice', async () => {
      const { service } = buildService();
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { name: 'Moto', defaultVariant: { sku: 'S', maxPrice: 100, basePrice: 150, minPrice: 50 } }, META),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('automatic product code (SKU) — <CAT>-00X, sequence per prefix across categories', () => {
    it('the prefix is the category\'s first three letters and the sequence is asked for that prefix', async () => {
      const { service, productsRepository, categoriesRepository } = buildService();
      categoriesRepository.findById.mockResolvedValue({ id: CATEGORY_ID, name: 'ARMARIO SIN MALETERO' });
      productsRepository.nextSku.mockResolvedValue('ARM-002');
      await expect(service.getNextSku(TENANT_ID, CATEGORY_ID)).resolves.toEqual({ code: 'ARM-002' });
      expect(productsRepository.nextSku).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 'ARM');
    });

    it('without a category the prefix is PRD', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.nextSku.mockResolvedValue('PRD-001');
      await service.getNextSku(TENANT_ID);
      expect(productsRepository.nextSku).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 'PRD');
    });

    it('create with a category and no SKU numbers it under that category\'s prefix', async () => {
      const { service, productsRepository, categoriesRepository } = buildService();
      categoriesRepository.findById.mockResolvedValue({ id: CATEGORY_ID, name: 'Armario con maletero' });
      productsRepository.nextSku.mockResolvedValue('ARM-007');
      productsRepository.create.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockRejectedValueOnce({ code: '23505' });
      const noSku = { maxPrice: 100, basePrice: 80, minPrice: 60 };
      await service.create(TENANT_ID, ACTOR_ID, { name: 'Armario', categoryId: CATEGORY_ID, defaultVariant: noSku }, META).catch(() => undefined);
      expect(productsRepository.nextSku).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 'ARM');
      expect(productsRepository.createVariant).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sku: 'ARM-007', barcode: 'COD-ARM-007' }),
      );
    });

    it('create without a SKU takes the next PRD code and derives the barcode from it', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.nextSku.mockResolvedValue('PRD-042');
      productsRepository.create.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockRejectedValueOnce({ code: '23505' }); // stop after the variant insert
      const noSku = { maxPrice: 100, basePrice: 80, minPrice: 60 };
      await service.create(TENANT_ID, ACTOR_ID, { name: 'Armario', defaultVariant: noSku }, META).catch(() => undefined);
      expect(productsRepository.nextSku).toHaveBeenCalledTimes(1);
      expect(productsRepository.createVariant).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sku: 'PRD-042', barcode: 'COD-PRD-042' }),
      );
    });

    it('create with a SKU typed by the user keeps it as is and never touches the sequence', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.create.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockRejectedValueOnce({ code: '23505' });
      await service.create(TENANT_ID, ACTOR_ID, { name: 'Armario', defaultVariant: VALID_VARIANT_FIELDS }, META).catch(() => undefined);
      expect(productsRepository.nextSku).not.toHaveBeenCalled();
      expect(productsRepository.createVariant).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sku: 'SKU-1', barcode: undefined }),
      );
    });

    it('an additional variant without a SKU also gets the next PRD code', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.nextSku.mockResolvedValue('PRD-043');
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockRejectedValueOnce({ code: '23505' });
      const noSku = { maxPrice: 100, basePrice: 80, minPrice: 60 };
      await service.createVariant(TENANT_ID, ACTOR_ID, [], PRODUCT_ID, noSku, META).catch(() => undefined);
      expect(productsRepository.createVariant).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sku: 'PRD-043', barcode: 'COD-PRD-043' }),
      );
    });

    it('getNextSku previews the next code without creating anything', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.nextSku.mockResolvedValue('PRD-001');
      await expect(service.getNextSku(TENANT_ID)).resolves.toEqual({ code: 'PRD-001' });
      expect(productsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('create — initial status', () => {
    it('a new product starts active (sellable straight away), not draft', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.create.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockRejectedValueOnce({ code: '23505' }); // stop after the product insert
      await service
        .create(TENANT_ID, ACTOR_ID, { name: 'Armario', defaultVariant: VALID_VARIANT_FIELDS }, META)
        .catch(() => undefined);
      expect(productsRepository.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'active' }));
    });
  });

  describe('create — unique SKU/barcode violation (§39 concurrency)', () => {
    it('maps a unique violation on variant insert to ConflictException (both direct and .cause-wrapped shapes)', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.create.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockRejectedValueOnce({ code: '23505' });
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { name: 'Moto', defaultVariant: VALID_VARIANT_FIELDS }, META),
      ).rejects.toThrow(ConflictException);

      productsRepository.createVariant.mockRejectedValueOnce(new Error('Failed query', { cause: { code: '23505' } }));
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { name: 'Moto', defaultVariant: VALID_VARIANT_FIELDS }, META),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update — §34 category-change re-validation', () => {
    it('re-validates attributes against the new category when categoryId changes, even if attributes are not resent', async () => {
      const { service, productsRepository, categoriesRepository, attributeValidationService } = buildService();
      productsRepository.findById.mockResolvedValue({ ...EXISTING_PRODUCT, attributes: { color: 'red' } });
      categoriesRepository.findById.mockResolvedValue({ ...EXISTING_CATEGORY, id: 'new-category' });
      productsRepository.update.mockResolvedValue({ ...EXISTING_PRODUCT, categoryId: 'new-category' });

      await service.update(TENANT_ID, ACTOR_ID, PRODUCT_ID, { categoryId: 'new-category' }, META);

      expect(attributeValidationService.validate).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 'new-category', 'product', { color: 'red' });
    });

    it('propagates AttributeValidationService rejection — the category change itself is blocked, not silently applied', async () => {
      const { service, productsRepository, categoriesRepository, attributeValidationService } = buildService();
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      categoriesRepository.findById.mockResolvedValue({ ...EXISTING_CATEGORY, id: 'new-category' });
      attributeValidationService.validate.mockRejectedValue(new BadRequestException('Invalid attributes.'));

      await expect(service.update(TENANT_ID, ACTOR_ID, PRODUCT_ID, { categoryId: 'new-category' }, META)).rejects.toThrow(BadRequestException);
      expect(productsRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('field-level price authorization (ADR-0028)', () => {
    it('omits minPrice/cost from the response when the actor lacks pricing.floor.view/pricing.cost.view', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockResolvedValue({
        id: 'variant-1',
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        sku: 'SKU-1',
        barcode: null,
        unit: 'unit',
        maxPrice: '100',
        basePrice: '80',
        minPrice: '60',
        cost: '40',
        status: 'active',
        isSerialized: false,
        isLotTracked: false,
        attributes: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createVariant(TENANT_ID, ACTOR_ID, [], PRODUCT_ID, VALID_VARIANT_FIELDS, META);

      expect(result.maxPrice).toBe(100);
      expect(result).not.toHaveProperty('minPrice');
      expect(result).not.toHaveProperty('cost');
    });

    it('includes minPrice/cost when the actor holds both permissions', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.createVariant.mockResolvedValue({
        id: 'variant-1',
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        sku: 'SKU-1',
        barcode: null,
        unit: 'unit',
        maxPrice: '100',
        basePrice: '80',
        minPrice: '60',
        cost: '40',
        status: 'active',
        isSerialized: false,
        isLotTracked: false,
        attributes: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createVariant(
        TENANT_ID,
        ACTOR_ID,
        ['pricing.floor.view', 'pricing.cost.view'],
        PRODUCT_ID,
        VALID_VARIANT_FIELDS,
        META,
      );

      expect(result.minPrice).toBe(60);
      expect(result.cost).toBe(40);
    });
  });

  describe('updateVariant — deactivation stock guard (GAP: API must reject discontinued while physical stock > 0)', () => {
    const EXISTING_VARIANT = {
      id: 'variant-1',
      tenantId: TENANT_ID,
      productId: PRODUCT_ID,
      sku: 'SKU-1',
      barcode: null,
      unit: 'unit',
      maxPrice: '100',
      basePrice: '80',
      minPrice: '60',
      cost: '40',
      status: 'active',
      isSerialized: false,
      isLotTracked: false,
      attributes: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('rejects discontinuing a variant that still has physical stock, without writing anything', async () => {
      const { service, productsRepository, variantStock } = buildService();
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.findVariantById.mockResolvedValue(EXISTING_VARIANT);
      variantStock.totalPhysicalStock.mockResolvedValue(12);

      await expect(
        service.updateVariant(TENANT_ID, ACTOR_ID, [], PRODUCT_ID, 'variant-1', { status: 'discontinued' }, META),
      ).rejects.toThrow(ConflictException);
      expect(productsRepository.updateVariant).not.toHaveBeenCalled();
    });

    it('allows discontinuing once physical stock is exactly 0', async () => {
      const { service, productsRepository, variantStock } = buildService();
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.findVariantById.mockResolvedValue(EXISTING_VARIANT);
      productsRepository.updateVariant.mockResolvedValue({ ...EXISTING_VARIANT, status: 'discontinued' });
      variantStock.totalPhysicalStock.mockResolvedValue(0);

      const result = await service.updateVariant(TENANT_ID, ACTOR_ID, [], PRODUCT_ID, 'variant-1', { status: 'discontinued' }, META);
      expect(result.status).toBe('discontinued');
    });

    it('never checks stock for a status transition other than into discontinued', async () => {
      const { service, productsRepository, variantStock } = buildService();
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.findVariantById.mockResolvedValue(EXISTING_VARIANT);
      productsRepository.updateVariant.mockResolvedValue({ ...EXISTING_VARIANT, unit: 'box' });

      await service.updateVariant(TENANT_ID, ACTOR_ID, [], PRODUCT_ID, 'variant-1', { unit: 'box' }, META);
      expect(variantStock.totalPhysicalStock).not.toHaveBeenCalled();
    });

    it('never re-checks stock when the variant is already discontinued and stays that way', async () => {
      const { service, productsRepository, variantStock } = buildService();
      const alreadyDiscontinued = { ...EXISTING_VARIANT, status: 'discontinued' };
      productsRepository.findById.mockResolvedValue(EXISTING_PRODUCT);
      productsRepository.findVariantById.mockResolvedValue(alreadyDiscontinued);
      productsRepository.updateVariant.mockResolvedValue(alreadyDiscontinued);

      await service.updateVariant(TENANT_ID, ACTOR_ID, [], PRODUCT_ID, 'variant-1', { status: 'discontinued' }, META);
      expect(variantStock.totalPhysicalStock).not.toHaveBeenCalled();
    });
  });
});
