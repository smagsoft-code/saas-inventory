import { Injectable } from '@nestjs/common';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { brands, categories, locations, productLots, products, productSerials, productVariants, suppliers, warehouses } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface VariantMatchRow {
  variantId: string;
  productId: string;
  categoryId: string | null;
  sku: string;
  status: string;
  isSerialized: boolean;
  isLotTracked: boolean;
}

/**
 * IMPORT's own read-only lookups against CATALOG/INVENTORY tables that neither module exposes a
 * repository method for — text-column matching (category/brand/supplier/location by the
 * human-readable name an Excel cell carries, product_variant by SKU) plus the product_serials/
 * product_lots writes database.md#serialized-and-lot-tracked-rows assigns directly to the import
 * pipeline ("no new tables — the import pipeline writes directly into product_serials/
 * product_lots... exactly like it writes into product_variants/inventory_movements"). Reads the
 * shared schema tables directly, the same convention
 * inventory/repositories/product-variants-lookup.repository.ts already established for a
 * cross-module read.
 */
@Injectable()
export class ImportCatalogLookupRepository {
  async findCategoryByName(tx: TenantTransaction, tenantId: string, name: string): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), ilike(categories.name, name), isNull(categories.deletedAt)));
    return row;
  }

  async findBrandByName(tx: TenantTransaction, tenantId: string, name: string): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.tenantId, tenantId), ilike(brands.name, name), isNull(brands.deletedAt)));
    return row;
  }

  async findSupplierByName(tx: TenantTransaction, tenantId: string, name: string): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), ilike(suppliers.displayName, name), isNull(suppliers.deletedAt)));
    return row;
  }

  /** Matches by location name OR code, tenant-wide — the Excel template asks for one "Ubicacion"
   * column, not a warehouse+location pair (§Ubicaciones import). */
  async findLocationByNameOrCode(tx: TenantTransaction, tenantId: string, value: string): Promise<{ id: string; warehouseId: string } | undefined> {
    const [row] = await tx
      .select({ id: locations.id, warehouseId: locations.warehouseId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt), ilike(locations.name, value)));
    if (row) return row;
    const [byCode] = await tx
      .select({ id: locations.id, warehouseId: locations.warehouseId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt), ilike(locations.code, value)));
    return byCode;
  }

  async listWarehouseNames(tx: TenantTransaction, tenantId: string): Promise<Array<{ id: string; name: string }>> {
    return tx
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
      .orderBy(warehouses.name);
  }

  async listLocationNames(tx: TenantTransaction, tenantId: string): Promise<Array<{ id: string; name: string; code: string; warehouseId: string }>> {
    return tx
      .select({ id: locations.id, name: locations.name, code: locations.code, warehouseId: locations.warehouseId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt)))
      .orderBy(locations.name);
  }

  async findVariantBySku(tx: TenantTransaction, tenantId: string, sku: string): Promise<VariantMatchRow | undefined> {
    const [row] = await tx
      .select({
        variantId: productVariants.id,
        productId: productVariants.productId,
        categoryId: products.categoryId,
        sku: productVariants.sku,
        status: productVariants.status,
        isSerialized: productVariants.isSerialized,
        isLotTracked: productVariants.isLotTracked,
      })
      .from(productVariants)
      .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.tenantId, productVariants.tenantId)))
      .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.sku, sku), isNull(productVariants.deletedAt)));
    return row;
  }

  async serialNumberExists(tx: TenantTransaction, tenantId: string, serialNumber: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: productSerials.id })
      .from(productSerials)
      .where(and(eq(productSerials.tenantId, tenantId), eq(productSerials.serialNumber, serialNumber)));
    return row !== undefined;
  }

  async createSerial(tx: TenantTransaction, values: { id: string; tenantId: string; productVariantId: string; serialNumber: string }): Promise<void> {
    await tx.insert(productSerials).values(values);
  }

  async lotExists(tx: TenantTransaction, tenantId: string, productVariantId: string, lotNumber: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: productLots.id })
      .from(productLots)
      .where(and(eq(productLots.tenantId, tenantId), eq(productLots.productVariantId, productVariantId), eq(productLots.lotNumber, lotNumber)));
    return row !== undefined;
  }

  async createLot(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      productVariantId: string;
      lotNumber: string;
      manufacturedDate?: string | undefined;
      expiryDate?: string | undefined;
    },
  ): Promise<void> {
    await tx.insert(productLots).values(values);
  }
}
