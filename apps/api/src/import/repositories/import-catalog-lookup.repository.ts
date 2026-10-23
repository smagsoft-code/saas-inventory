import { Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, isNull } from 'drizzle-orm';
import { brands, categories, locations, productLots, products, productSerials, productVariants, suppliers, warehouses } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

/** Outcome of turning a row's Sucursal / Almacén cells (plus the job's default location) into one
 * concrete location — the single implementation both validation and commit call. */
export type LocationResolution =
  | { kind: 'resolved'; locationId: string | null }
  | { kind: 'warehouse_not_found' }
  | { kind: 'location_not_found' }
  | { kind: 'location_ambiguous' }
  | { kind: 'location_required_in_warehouse' };

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

  async findWarehouseByName(tx: TenantTransaction, tenantId: string, name: string): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt), ilike(warehouses.name, name)));
    return row;
  }

  async findLocationById(tx: TenantTransaction, tenantId: string, id: string): Promise<{ id: string; warehouseId: string } | undefined> {
    const [row] = await tx
      .select({ id: locations.id, warehouseId: locations.warehouseId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id), isNull(locations.deletedAt)));
    return row;
  }

  /** Every location matching by name, else by code, optionally inside one warehouse. */
  async findLocationsByNameOrCode(
    tx: TenantTransaction,
    tenantId: string,
    value: string,
    warehouseId?: string,
  ): Promise<Array<{ id: string; warehouseId: string }>> {
    const scope = warehouseId ? [eq(locations.warehouseId, warehouseId)] : [];
    const byName = await tx
      .select({ id: locations.id, warehouseId: locations.warehouseId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt), ilike(locations.name, value), ...scope));
    if (byName.length > 0) return byName;
    return tx
      .select({ id: locations.id, warehouseId: locations.warehouseId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt), ilike(locations.code, value), ...scope));
  }

  /**
   * Sucursal (warehouse) + Almacén (location) resolution, shared by validation and commit:
   *  - Sucursal given → that sucursal is authoritative; Almacén is looked up inside it. Without an
   *    Almacén, only the job's default location can stand in, and only if it belongs to that sucursal.
   *  - Sucursal empty → the job's default sucursal (the one of its default location) scopes the
   *    Almacén lookup, falling back to the whole tenant; an Almacén that is still ambiguous there is an
   *    error, never a silent pick. No Almacén either → the job's default location (or none).
   */
  async resolveLocation(
    tx: TenantTransaction,
    tenantId: string,
    input: { warehouseText?: string | undefined; locationText?: string | undefined; defaultLocationId?: string | null | undefined },
  ): Promise<LocationResolution> {
    const defaultLocation = input.defaultLocationId ? await this.findLocationById(tx, tenantId, input.defaultLocationId) : undefined;

    let warehouseId: string | undefined;
    if (input.warehouseText) {
      const warehouse = await this.findWarehouseByName(tx, tenantId, input.warehouseText);
      if (!warehouse) return { kind: 'warehouse_not_found' };
      warehouseId = warehouse.id;
    } else {
      warehouseId = defaultLocation?.warehouseId;
    }

    if (!input.locationText) {
      if (input.warehouseText) {
        return defaultLocation && defaultLocation.warehouseId === warehouseId
          ? { kind: 'resolved', locationId: defaultLocation.id }
          : { kind: 'location_required_in_warehouse' };
      }
      return { kind: 'resolved', locationId: defaultLocation?.id ?? null };
    }

    let matches = await this.findLocationsByNameOrCode(tx, tenantId, input.locationText, warehouseId);
    if (matches.length === 0 && !input.warehouseText && warehouseId) {
      matches = await this.findLocationsByNameOrCode(tx, tenantId, input.locationText);
    }
    if (matches.length === 0) return { kind: 'location_not_found' };
    if (matches.length > 1) return { kind: 'location_ambiguous' };
    return { kind: 'resolved', locationId: matches[0]!.id };
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

  /** PROMPT 010-A §4/§9 — one round trip for every SKU that repeats within a file, so
   * ImportValidationService can decide "is this a legitimate new-SKU serialized/lot group" without
   * a query per row. Only SKUs that already exist come back; a SKU absent from the result map is a
   * genuinely new one as far as the database is concerned right now. */
  async findVariantsBySkus(tx: TenantTransaction, tenantId: string, skus: string[]): Promise<Map<string, VariantMatchRow>> {
    if (skus.length === 0) return new Map();
    const rows = await tx
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
      .where(and(eq(productVariants.tenantId, tenantId), inArray(productVariants.sku, skus), isNull(productVariants.deletedAt)));
    return new Map(rows.map((row) => [row.sku, row]));
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
