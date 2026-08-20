import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { CategoriesRepository } from '../repositories/categories.repository';
import type { ProductRow, VariantRow, VariantVisibility } from '../repositories/products.repository';
import { ProductsRepository } from '../repositories/products.repository';
import type { AuditMeta } from '../catalog-audit-meta';
import { AttributeValidationService } from './attribute-validation.service';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListProductsQueryDto } from './dto/list-products-query.dto';
import type { ProductResponseDto } from './dto/product-response.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type { UpdateVariantDto } from './dto/update-variant.dto';
import type { VariantFieldsDto } from './dto/variant-fields.dto';
import type { VariantResponseDto } from './dto/variant-response.dto';

interface UniqueViolation {
  code: string;
}

function hasUniqueViolationCode(error: unknown): error is UniqueViolation {
  return typeof error === 'object' && error !== null && 'code' in error && (error as UniqueViolation).code === '23505';
}

/** Same fix as core/users/users.service.ts (Prompt 05-B): drizzle-orm's postgres-js driver wraps
 * the real Postgres error (carrying `.code`) as `DrizzleQueryError.cause`, never on the thrown
 * error directly. */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  return error instanceof Error && hasUniqueViolationCode(error.cause);
}

function toProductResponse(row: ProductRow): ProductResponseDto {
  return {
    id: row.id,
    categoryId: row.categoryId ?? undefined,
    brandId: row.brandId ?? undefined,
    supplierId: row.supplierId ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    warrantyMonths: row.warrantyMonths ?? undefined,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Products + variants (§10-§21, §33-§34) within the caller's own tenant. Every method runs inside
 * `withTenantTransaction`, so RLS backstops every query on top of the explicit tenantId filter.
 * `AttributeValidationService` is the single, shared enforcement point for the governed
 * `attributes` JSONB (ADR-0026) — never bypassed here for a "just this once" write path.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly categoriesRepository: CategoriesRepository,
    private readonly attributeValidationService: AttributeValidationService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(
    tenantId: string,
    query: ListProductsQueryDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.productsRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        categoryId: query.categoryId,
      });
      return {
        data: rows.map(toProductResponse),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async getById(tenantId: string, productId: string): Promise<ProductResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const product = await this.productsRepository.findById(tx, tenantId, productId);
      if (!product) {
        throw new NotFoundException('Product not found.');
      }
      return toProductResponse(product);
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateProductDto, meta: AuditMeta): Promise<ProductResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      await this.assertReferencesExist(tx, tenantId, dto.categoryId, dto.brandId, dto.supplierId);

      const productAttributes = dto.attributes ?? {};
      const variantAttributes = dto.defaultVariant.attributes ?? {};
      const categoryId = dto.categoryId ?? null;
      await this.attributeValidationService.validate(tx, tenantId, categoryId, 'product', productAttributes);
      await this.attributeValidationService.validate(tx, tenantId, categoryId, 'variant', variantAttributes);
      this.assertPriceTierValues(dto.defaultVariant.minPrice, dto.defaultVariant.basePrice, dto.defaultVariant.maxPrice);

      const productId = generateId();
      const product = await this.productsRepository.create(tx, {
        id: productId,
        tenantId,
        categoryId,
        brandId: dto.brandId ?? null,
        supplierId: dto.supplierId ?? null,
        name: dto.name,
        description: dto.description,
        warrantyMonths: dto.warrantyMonths,
        attributes: productAttributes,
      });

      // ADR-0017: every product creates exactly one default variant alongside it, in the same
      // transaction — INVENTORY/SALES always have exactly one kind of thing to reference.
      let variant: VariantRow;
      try {
        variant = await this.productsRepository.createVariant(tx, {
          id: generateId(),
          tenantId,
          productId,
          sku: dto.defaultVariant.sku,
          barcode: dto.defaultVariant.barcode,
          unit: dto.defaultVariant.unit,
          maxPrice: String(dto.defaultVariant.maxPrice),
          basePrice: String(dto.defaultVariant.basePrice),
          minPrice: String(dto.defaultVariant.minPrice),
          cost: dto.defaultVariant.cost !== undefined ? String(dto.defaultVariant.cost) : undefined,
          isSerialized: dto.defaultVariant.isSerialized,
          isLotTracked: dto.defaultVariant.isLotTracked,
          attributes: variantAttributes,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A variant with this SKU or barcode already exists.');
        }
        throw error;
      }

      await this.productsRepository.recordPriceChange(tx, {
        id: generateId(),
        tenantId,
        productVariantId: variant.id,
        maxPrice: String(dto.defaultVariant.maxPrice),
        basePrice: String(dto.defaultVariant.basePrice),
        minPrice: String(dto.defaultVariant.minPrice),
        changedBy: actorId,
      });

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'product.created',
        entityId: productId,
        afterState: { name: product.name, categoryId: product.categoryId, defaultVariantSku: variant.sku },
        meta,
      });

      return toProductResponse(product);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    productId: string,
    dto: UpdateProductDto,
    meta: AuditMeta,
  ): Promise<ProductResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.productsRepository.findById(tx, tenantId, productId);
      if (!before) {
        throw new NotFoundException('Product not found.');
      }

      await this.assertReferencesExist(tx, tenantId, dto.categoryId, dto.brandId, dto.supplierId);

      // §34: a category change (or an explicit attributes replacement) is re-validated against the
      // effective (possibly new) category — never a silent carry-over of now-incompatible keys. If
      // the existing attributes don't validate under a new category, the category change itself is
      // rejected until the client also submits compatible attributes in the same request.
      if (dto.categoryId !== undefined || dto.attributes !== undefined) {
        const effectiveCategoryId = dto.categoryId !== undefined ? dto.categoryId : before.categoryId;
        const effectiveAttributes = dto.attributes !== undefined ? dto.attributes : ((before.attributes ?? {}) as Record<string, unknown>);
        await this.attributeValidationService.validate(tx, tenantId, effectiveCategoryId, 'product', effectiveAttributes);
      }

      let updated: ProductRow | undefined;
      try {
        updated = await this.productsRepository.update(tx, tenantId, productId, {
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.brandId !== undefined ? { brandId: dto.brandId } : {}),
          ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.warrantyMonths !== undefined ? { warrantyMonths: dto.warrantyMonths } : {}),
          ...(dto.attributes !== undefined ? { attributes: dto.attributes } : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('Conflict updating product.');
        }
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('Product not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: before.status !== updated.status ? 'product.status_changed' : 'product.updated',
        entityId: productId,
        beforeState: { name: before.name, status: before.status, categoryId: before.categoryId },
        afterState: { name: updated.name, status: updated.status, categoryId: updated.categoryId },
        meta,
      });

      return toProductResponse(updated);
    });
  }

  async listVariants(tenantId: string, productId: string, actorPermissions: string[]): Promise<VariantResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const product = await this.productsRepository.findById(tx, tenantId, productId);
      if (!product) {
        throw new NotFoundException('Product not found.');
      }
      const visibility = this.visibilityFor(actorPermissions);
      const rows = await this.productsRepository.listVariantsByProduct(tx, tenantId, productId, visibility);
      return rows.map((row) => this.toVariantResponse(row, visibility));
    });
  }

  async getVariant(tenantId: string, productId: string, variantId: string, actorPermissions: string[]): Promise<VariantResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const visibility = this.visibilityFor(actorPermissions);
      const variant = await this.productsRepository.findVariantById(tx, tenantId, variantId, visibility);
      if (!variant || variant.productId !== productId) {
        throw new NotFoundException('Variant not found.');
      }
      return this.toVariantResponse(variant, visibility);
    });
  }

  async createVariant(
    tenantId: string,
    actorId: string,
    actorPermissions: string[],
    productId: string,
    dto: VariantFieldsDto,
    meta: AuditMeta,
  ): Promise<VariantResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const product = await this.productsRepository.findById(tx, tenantId, productId);
      if (!product) {
        throw new NotFoundException('Product not found.');
      }

      const attributes = dto.attributes ?? {};
      await this.attributeValidationService.validate(tx, tenantId, product.categoryId, 'variant', attributes);
      this.assertPriceTierValues(dto.minPrice, dto.basePrice, dto.maxPrice);

      let variant: VariantRow;
      try {
        variant = await this.productsRepository.createVariant(tx, {
          id: generateId(),
          tenantId,
          productId,
          sku: dto.sku,
          barcode: dto.barcode,
          unit: dto.unit,
          maxPrice: String(dto.maxPrice),
          basePrice: String(dto.basePrice),
          minPrice: String(dto.minPrice),
          cost: dto.cost !== undefined ? String(dto.cost) : undefined,
          isSerialized: dto.isSerialized,
          isLotTracked: dto.isLotTracked,
          attributes,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A variant with this SKU or barcode already exists.');
        }
        throw error;
      }

      await this.productsRepository.recordPriceChange(tx, {
        id: generateId(),
        tenantId,
        productVariantId: variant.id,
        maxPrice: String(dto.maxPrice),
        basePrice: String(dto.basePrice),
        minPrice: String(dto.minPrice),
        changedBy: actorId,
      });

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'product.variant_created',
        entityId: productId,
        afterState: { variantId: variant.id, sku: variant.sku },
        meta,
      });

      return this.toVariantResponse(variant, this.visibilityFor(actorPermissions));
    });
  }

  async updateVariant(
    tenantId: string,
    actorId: string,
    actorPermissions: string[],
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
    meta: AuditMeta,
  ): Promise<VariantResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const product = await this.productsRepository.findById(tx, tenantId, productId);
      if (!product) {
        throw new NotFoundException('Product not found.');
      }
      const before = await this.productsRepository.findVariantById(tx, tenantId, variantId, {
        canViewFloor: true,
        canViewCost: true,
      });
      if (!before || before.productId !== productId) {
        throw new NotFoundException('Variant not found.');
      }

      if (dto.attributes !== undefined) {
        await this.attributeValidationService.validate(tx, tenantId, product.categoryId, 'variant', dto.attributes);
      }

      const priceChanged = dto.maxPrice !== undefined || dto.basePrice !== undefined || dto.minPrice !== undefined;
      const maxPrice = dto.maxPrice ?? Number(before.maxPrice);
      const basePrice = dto.basePrice ?? Number(before.basePrice);
      const minPrice = dto.minPrice ?? Number(before.minPrice ?? 0);
      if (priceChanged) {
        this.assertPriceTierValues(minPrice, basePrice, maxPrice);
      }

      let updated: VariantRow | undefined;
      try {
        updated = await this.productsRepository.updateVariant(tx, tenantId, variantId, {
          ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
          ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
          ...(dto.maxPrice !== undefined ? { maxPrice: String(dto.maxPrice) } : {}),
          ...(dto.basePrice !== undefined ? { basePrice: String(dto.basePrice) } : {}),
          ...(dto.minPrice !== undefined ? { minPrice: String(dto.minPrice) } : {}),
          ...(dto.cost !== undefined ? { cost: String(dto.cost) } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.attributes !== undefined ? { attributes: dto.attributes } : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A variant with this barcode already exists.');
        }
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('Variant not found.');
      }

      if (priceChanged) {
        await this.productsRepository.recordPriceChange(tx, {
          id: generateId(),
          tenantId,
          productVariantId: variantId,
          maxPrice: String(maxPrice),
          basePrice: String(basePrice),
          minPrice: String(minPrice),
          changedBy: actorId,
        });
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: priceChanged ? 'product.variant_price_changed' : 'product.variant_updated',
        entityId: productId,
        beforeState: { variantId, status: before.status },
        afterState: { variantId, status: updated.status },
        meta,
      });

      return this.toVariantResponse(updated, this.visibilityFor(actorPermissions));
    });
  }

  private async assertReferencesExist(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string | undefined,
    brandId: string | undefined,
    supplierId: string | undefined,
  ): Promise<void> {
    if (categoryId !== undefined) {
      const category = await this.categoriesRepository.findById(tx, tenantId, categoryId);
      if (!category) {
        throw new NotFoundException('Category not found.');
      }
    }
    if (brandId !== undefined) {
      const exists = await this.productsRepository.brandExists(tx, tenantId, brandId);
      if (!exists) {
        throw new NotFoundException('Brand not found.');
      }
    }
    if (supplierId !== undefined) {
      const exists = await this.productsRepository.supplierExists(tx, tenantId, supplierId);
      if (!exists) {
        throw new NotFoundException('Supplier not found.');
      }
    }
  }

  /** database.md#catalog: `CHECK (min_price <= base_price AND base_price <= max_price)` — checked
   * here too for a clean 400 before ever reaching Postgres's constraint error; the DB stays the
   * ultimate backstop. */
  private assertPriceTierValues(minPrice: number, basePrice: number, maxPrice: number): void {
    if (!(minPrice <= basePrice && basePrice <= maxPrice)) {
      throw new BadRequestException('Prices must satisfy minPrice <= basePrice <= maxPrice.');
    }
  }

  private visibilityFor(permissions: string[]): VariantVisibility {
    return {
      canViewFloor: permissions.includes('pricing.floor.view'),
      canViewCost: permissions.includes('pricing.cost.view'),
    };
  }

  /** ADR-0028: built by inclusion, never a `{...row}` spread — a field the row happens to carry
   * (write paths always return the full row via `.returning()`) is only included when the caller's
   * actual permission set allows it, independent of whether the DB row itself has the value. */
  private toVariantResponse(row: VariantRow, visibility: VariantVisibility): VariantResponseDto {
    return {
      id: row.id,
      productId: row.productId,
      sku: row.sku,
      barcode: row.barcode ?? undefined,
      unit: row.unit,
      maxPrice: Number(row.maxPrice),
      basePrice: Number(row.basePrice),
      ...(visibility.canViewFloor && row.minPrice !== undefined ? { minPrice: Number(row.minPrice) } : {}),
      ...(visibility.canViewCost && row.cost !== undefined && row.cost !== null ? { cost: Number(row.cost) } : {}),
      status: row.status,
      isSerialized: row.isSerialized,
      isLotTracked: row.isLotTracked,
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async writeAudit(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      actorId: string;
      actionCode: string;
      entityId: string;
      beforeState?: Record<string, unknown>;
      afterState?: Record<string, unknown>;
      meta: AuditMeta;
    },
  ): Promise<void> {
    try {
      await this.auditLogService.record(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actionCode: input.actionCode,
        entityType: 'product',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation.
    }
  }
}
