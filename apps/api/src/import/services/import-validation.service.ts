import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { AttributeValidationService } from '../../catalog/products/attribute-validation.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { analyzeNewSkuGroup, applyColumnMapping, type NewSkuGroupInfo } from '../import-fields';
import type { ImportRowError } from '../repositories/import-job-rows.repository';
import { ImportJobRowsRepository } from '../repositories/import-job-rows.repository';
import { ImportJobsRepository } from '../repositories/import-jobs.repository';
import { ImportCatalogLookupRepository } from '../repositories/import-catalog-lookup.repository';
import { ImportAttributePartitionService } from './import-attribute-partition.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function batchSize(): number {
  return Number(getOptionalEnvVar('IMPORT_BATCH_SIZE', '500'));
}

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

function asNumber(value: unknown): number | undefined | 'invalid' {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(num) ? num : 'invalid';
}

interface FileWideMaps {
  skuRowCounts: Map<string, number>;
  serialRowCounts: Map<string, number>;
  skuLotRowCounts: Map<string, number>;
  newSkuGroups: Map<string, NewSkuGroupInfo>;
}

/**
 * §12/§13 — per-row validation, batched (database.md#large-imports). Never writes to
 * CATALOG/INVENTORY tables directly (§2, §8) — only stages a validation *result* onto the row.
 * Reuses AttributeValidationService/LocationAuthorizationService verbatim (§12: "reutilizar el
 * mismo servicio de validacion usado por CATALOG" — no second implementation).
 */
@Injectable()
export class ImportValidationService {
  constructor(
    private readonly importJobsRepository: ImportJobsRepository,
    private readonly importJobRowsRepository: ImportJobRowsRepository,
    private readonly attributeValidationService: AttributeValidationService,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly catalogLookup: ImportCatalogLookupRepository,
    private readonly attributePartitionService: ImportAttributePartitionService,
  ) {}

  /** Processes every `pending` row for a job, batch by batch (own transaction per batch, per
   * database.md#committing's identical batching rationale applied to validation), then finalizes
   * the job's counters and transitions `validating -> ready`. Safe to call again on a job that
   * already has some `valid`/`warning`/`invalid` rows (resumed after a crash) — those rows are
   * simply not `pending` any more and are skipped. */
  async validateJob(tenantId: string, jobId: string, actorUserId: string): Promise<void> {
    const size = batchSize();
    const fileWideMaps = await this.buildFileWideMaps(tenantId, jobId);

    for (;;) {
      const batchRows = await withTenantTransaction(tenantId, (tx) => this.importJobRowsRepository.nextPendingBatch(tx, tenantId, jobId, size));
      if (batchRows.length === 0) break;

      await withTenantTransaction(tenantId, async (tx) => {
        const job = await this.importJobsRepository.findById(tx, tenantId, jobId);
        if (!job) return;
        const columnMapping = job.columnMapping as Record<string, string>;
        for (const row of batchRows) {
          const mapped = applyColumnMapping(row.rawData as Record<string, unknown>, columnMapping);
          const result = await this.validateRow(tx, tenantId, actorUserId, job.duplicateHandlingMode, job.defaultLocationId, mapped, fileWideMaps);
          await this.importJobRowsRepository.setValidationResult(tx, tenantId, row.id, {
            mappedData: mapped,
            status: result.status,
            matchAction: result.matchAction,
            matchedProductVariantId: result.matchedProductVariantId,
            errors: result.errors,
            warnings: result.warnings,
          });
        }
      });
    }

    await withTenantTransaction(tenantId, async (tx) => {
      const counts = await this.importJobRowsRepository.countsByStatus(tx, tenantId, jobId);
      const total = await this.importJobRowsRepository.countByJob(tx, tenantId, jobId);
      await this.importJobsRepository.update(tx, tenantId, jobId, {
        status: 'ready',
        totalRows: total,
        validRows: counts['valid'] ?? 0,
        invalidRows: counts['invalid'] ?? 0,
        warningRows: counts['warning'] ?? 0,
      });
    });
  }

  private async buildFileWideMaps(tenantId: string, jobId: string): Promise<FileWideMaps> {
    return withTenantTransaction(tenantId, async (tx) => {
      const job = await this.importJobsRepository.findById(tx, tenantId, jobId);
      const columnMapping = (job?.columnMapping as Record<string, string> | undefined) ?? {};
      const all = await this.importJobRowsRepository.listAllRaw(tx, tenantId, jobId);

      const skuRowCounts = new Map<string, number>();
      const serialRowCounts = new Map<string, number>();
      const skuLotRowCounts = new Map<string, number>();
      const mappedRowsBySku = new Map<string, Record<string, unknown>[]>();

      for (const { rawData } of all) {
        const mapped = applyColumnMapping(rawData, columnMapping);
        const sku = asText(mapped['sku']);
        const serial = asText(mapped['serialNumber']);
        const lot = asText(mapped['lotNumber']);
        if (sku) {
          skuRowCounts.set(sku, (skuRowCounts.get(sku) ?? 0) + 1);
          const bucket = mappedRowsBySku.get(sku) ?? [];
          bucket.push(mapped);
          mappedRowsBySku.set(sku, bucket);
        }
        if (serial) serialRowCounts.set(serial, (serialRowCounts.get(serial) ?? 0) + 1);
        if (sku && lot) {
          const key = `${sku}::${lot}`;
          skuLotRowCounts.set(key, (skuLotRowCounts.get(key) ?? 0) + 1);
        }
      }

      // Only SKUs that repeat AND do not already exist in the database are candidate onboarding
      // groups — a repeat against an existing SKU keeps the pre-existing per-row `update` handling
      // (§4/§9: this correction is scoped to the brand-new-SKU case).
      const repeatedSkus = [...skuRowCounts.entries()].filter(([, count]) => count > 1).map(([sku]) => sku);
      const existingBySku = await this.catalogLookup.findVariantsBySkus(tx, tenantId, repeatedSkus);
      const newSkuGroups = new Map<string, NewSkuGroupInfo>();
      for (const sku of repeatedSkus) {
        if (existingBySku.has(sku)) continue;
        newSkuGroups.set(sku, analyzeNewSkuGroup(mappedRowsBySku.get(sku) ?? []));
      }

      return { skuRowCounts, serialRowCounts, skuLotRowCounts, newSkuGroups };
    });
  }

  private async validateRow(
    tx: TenantTransaction,
    tenantId: string,
    actorUserId: string,
    duplicateHandlingMode: string,
    defaultLocationId: string | null,
    mapped: Record<string, unknown>,
    fileWideMaps: FileWideMaps,
  ): Promise<{ status: 'valid' | 'warning' | 'invalid'; matchAction: 'create' | 'update' | 'skip' | null; matchedProductVariantId: string | null; errors: ImportRowError[]; warnings: ImportRowError[] }> {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowError[] = [];

    const sku = asText(mapped['sku']);
    if (!sku) {
      errors.push({ field: 'sku', code: 'SKU_REQUIRED', message: 'SKU is required.' });
      return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
    }
    // PROMPT 010-A §4/§5/§9 — a SKU repeated in the file is only ever a plain duplicate when it
    // isn't a recognized new-SKU onboarding group (analyzeNewSkuGroup, computed once file-wide).
    // A repeat against a SKU that already exists in the database was never routed into
    // `newSkuGroups` at all — it keeps the pre-existing per-row `update` handling below unchanged.
    if ((fileWideMaps.skuRowCounts.get(sku) ?? 0) > 1) {
      const group = fileWideMaps.newSkuGroups.get(sku);
      if (!group) {
        errors.push({ field: 'sku', code: 'DUPLICATE_SKU_IN_FILE', message: `SKU "${sku}" appears more than once in this file.` });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      if (group.trackingModeConflict) {
        errors.push({
          field: 'sku',
          code: 'SKU_GROUP_TRACKING_MODE_INCONSISTENT',
          message: `SKU "${sku}" is repeated with inconsistent serial/lot tracking across rows — every row for a new serialized SKU must declare a serial number, or every row must declare a lot number, never a mix.`,
        });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      if (!group.isLegitimateUnitGroup) {
        errors.push({ field: 'sku', code: 'DUPLICATE_SKU_IN_FILE', message: `SKU "${sku}" appears more than once in this file.` });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      if (group.mismatchedFields.length > 0) {
        errors.push({
          field: 'sku',
          code: 'SKU_GROUP_INCONSISTENT_METADATA',
          message: `SKU "${sku}" is repeated across multiple physical units, but these fields disagree between rows: ${group.mismatchedFields.join(', ')}.`,
        });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      // A legitimate, internally-consistent new-SKU group — fall through and validate this row as
      // one physical unit of it (matchAction resolves to 'create' below, same as any other new SKU).
    }

    const existingVariant = await this.catalogLookup.findVariantBySku(tx, tenantId, sku);
    let matchAction: 'create' | 'update' | 'skip';
    if (existingVariant) {
      if (duplicateHandlingMode === 'reject_on_duplicate') {
        errors.push({ field: 'sku', code: 'DUPLICATE_SKU_REJECTED', message: `SKU "${sku}" already exists.` });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      matchAction = duplicateHandlingMode === 'skip_existing' ? 'skip' : 'update';
    } else {
      matchAction = 'create';
    }

    // Category / brand / supplier — text lookups, only when the column was actually mapped.
    let categoryId: string | null = existingVariant?.categoryId ?? null;
    const categoryText = asText(mapped['category']);
    if (categoryText) {
      const category = await this.catalogLookup.findCategoryByName(tx, tenantId, categoryText);
      if (!category) {
        errors.push({ field: 'category', code: 'CATEGORY_NOT_FOUND', message: `Category "${categoryText}" not found.` });
      } else {
        categoryId = category.id;
      }
    }
    const brandText = asText(mapped['brand']);
    if (brandText) {
      const brand = await this.catalogLookup.findBrandByName(tx, tenantId, brandText);
      if (!brand) errors.push({ field: 'brand', code: 'BRAND_NOT_FOUND', message: `Brand "${brandText}" not found.` });
    }
    const supplierText = asText(mapped['supplier']);
    if (supplierText) {
      const supplier = await this.catalogLookup.findSupplierByName(tx, tenantId, supplierText);
      if (!supplier) errors.push({ field: 'supplier', code: 'SUPPLIER_NOT_FOUND', message: `Supplier "${supplierText}" not found.` });
    }

    // Name — required on create.
    const name = asText(mapped['name']);
    if (matchAction === 'create' && !name) {
      errors.push({ field: 'name', code: 'NAME_REQUIRED', message: 'Name is required for a new product.' });
    }

    // Prices.
    this.validatePrices(mapped, matchAction, errors);

    // Attributes — reuses AttributeValidationService verbatim, never a second implementation.
    await this.validateAttributes(tx, tenantId, categoryId, mapped, errors);

    // Quantity / location / initial stock.
    const quantity = asNumber(mapped['quantity']);
    if (quantity === 'invalid') {
      errors.push({ field: 'quantity', code: 'QUANTITY_INVALID', message: 'Quantity must be a number.' });
    } else if (quantity !== undefined && quantity < 0) {
      errors.push({ field: 'quantity', code: 'QUANTITY_NEGATIVE', message: 'Quantity cannot be negative.' });
    }

    let locationId: string | null = defaultLocationId;
    const locationText = asText(mapped['location']);
    if (locationText) {
      const location = await this.catalogLookup.findLocationByNameOrCode(tx, tenantId, locationText);
      if (!location) {
        errors.push({ field: 'location', code: 'LOCATION_NOT_FOUND', message: `Location "${locationText}" not found.` });
      } else {
        locationId = location.id;
      }
    }
    const wantsInventory = matchAction === 'create' ? typeof quantity === 'number' && quantity > 0 : duplicateHandlingMode === 'update_catalog_and_inventory' && typeof quantity === 'number' && quantity > 0;
    if (wantsInventory) {
      if (!locationId) {
        errors.push({ field: 'location', code: 'LOCATION_REQUIRED', message: 'A location (row column or job default) is required when importing a quantity.' });
      } else {
        try {
          await this.locationAuthorizationService.assertAccess(tx, tenantId, actorUserId, locationId);
        } catch (error) {
          if (error instanceof ForbiddenException) {
            errors.push({ field: 'location', code: 'LOCATION_NOT_AUTHORIZED', message: 'You are not authorized to import stock into this location.' });
          } else {
            throw error;
          }
        }
      }
    }

    // Serialized / lot-tracked.
    const serialNumber = asText(mapped['serialNumber']);
    const lotNumber = asText(mapped['lotNumber']);
    const isSerialized = matchAction === 'create' ? Boolean(serialNumber) : (existingVariant?.isSerialized ?? false);
    const isLotTracked = matchAction === 'create' ? Boolean(lotNumber) : (existingVariant?.isLotTracked ?? false);

    if (isSerialized && isLotTracked) {
      errors.push({ field: 'serialNumber', code: 'SERIAL_AND_LOT_MUTUALLY_EXCLUSIVE', message: 'A variant cannot be both serialized and lot-tracked.' });
    }

    if (isSerialized) {
      if (!serialNumber) {
        errors.push({ field: 'serialNumber', code: 'SERIAL_NUMBER_REQUIRED', message: 'This variant is serialized — a serial number is required.' });
      } else {
        if ((fileWideMaps.serialRowCounts.get(serialNumber) ?? 0) > 1) {
          errors.push({ field: 'serialNumber', code: 'DUPLICATE_SERIAL_IN_FILE', message: `Serial "${serialNumber}" appears more than once in this file.` });
        }
        if (await this.catalogLookup.serialNumberExists(tx, tenantId, serialNumber)) {
          errors.push({ field: 'serialNumber', code: 'SERIAL_NUMBER_EXISTS', message: `Serial "${serialNumber}" already exists.` });
        }
      }
      if (typeof quantity === 'number' && quantity !== 1) {
        errors.push({ field: 'quantity', code: 'SERIAL_QUANTITY_MUST_BE_ONE', message: 'A serialized row represents exactly one physical unit — quantity must be 1 (or omitted).' });
      }
      if (!locationId) {
        errors.push({ field: 'location', code: 'LOCATION_REQUIRED', message: 'A location is required for a serialized unit.' });
      }
    } else if (matchAction !== 'create' && serialNumber) {
      warnings.push({ field: 'serialNumber', code: 'SERIAL_IGNORED', message: 'This variant is not serialized — the serial number was ignored.' });
    }

    if (isLotTracked) {
      if (!lotNumber) {
        errors.push({ field: 'lotNumber', code: 'LOT_NUMBER_REQUIRED', message: 'This variant is lot-tracked — a lot number is required.' });
      } else {
        const key = `${sku}::${lotNumber}`;
        if ((fileWideMaps.skuLotRowCounts.get(key) ?? 0) > 1) {
          errors.push({ field: 'lotNumber', code: 'DUPLICATE_LOT_IN_FILE', message: `Lot "${lotNumber}" for SKU "${sku}" appears more than once in this file.` });
        }
        if (existingVariant && (await this.catalogLookup.lotExists(tx, tenantId, existingVariant.variantId, lotNumber))) {
          errors.push({ field: 'lotNumber', code: 'LOT_NUMBER_EXISTS', message: `Lot "${lotNumber}" already exists for this variant.` });
        }
      }
      for (const [field, target] of [
        ['manufacturedDate', 'manufacturedDate'],
        ['expiryDate', 'expiryDate'],
      ] as const) {
        const value = asText(mapped[target]);
        if (value && !DATE_PATTERN.test(value)) {
          errors.push({ field, code: 'DATE_FORMAT_INVALID', message: `${field} must be in YYYY-MM-DD format.` });
        }
      }
    } else if (matchAction !== 'create' && lotNumber) {
      warnings.push({ field: 'lotNumber', code: 'LOT_IGNORED', message: 'This variant is not lot-tracked — the lot number was ignored.' });
    }

    const status: 'valid' | 'warning' | 'invalid' = errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warning' : 'valid';
    return {
      status,
      matchAction: status === 'invalid' ? null : matchAction,
      matchedProductVariantId: status === 'invalid' ? null : (existingVariant?.variantId ?? null),
      errors,
      warnings,
    };
  }

  private validatePrices(mapped: Record<string, unknown>, matchAction: 'create' | 'update' | 'skip', errors: ImportRowError[]): void {
    const fields = ['maxPrice', 'basePrice', 'minPrice'] as const;
    const values: Partial<Record<(typeof fields)[number], number>> = {};
    for (const field of fields) {
      const parsed = asNumber(mapped[field]);
      if (parsed === 'invalid') {
        errors.push({ field, code: 'PRICE_INVALID', message: `${field} must be a number.` });
      } else if (parsed !== undefined) {
        if (parsed < 0) {
          errors.push({ field, code: 'PRICE_NEGATIVE', message: `${field} cannot be negative.` });
        } else {
          values[field] = parsed;
        }
      } else if (matchAction === 'create') {
        errors.push({ field, code: 'PRICE_REQUIRED', message: `${field} is required for a new product.` });
      }
    }
    if (values.minPrice !== undefined && values.basePrice !== undefined && values.maxPrice !== undefined) {
      if (!(values.minPrice <= values.basePrice && values.basePrice <= values.maxPrice)) {
        errors.push({ field: 'basePrice', code: 'PRICE_TIER_INVALID', message: 'Prices must satisfy minPrice <= basePrice <= maxPrice.' });
      }
    }
  }

  private async validateAttributes(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string | null,
    mapped: Record<string, unknown>,
    errors: ImportRowError[],
  ): Promise<void> {
    const { productAttrs, variantAttrs, unrouted } = await this.attributePartitionService.partition(tx, tenantId, categoryId, mapped);
    if (Object.keys(productAttrs).length === 0 && Object.keys(variantAttrs).length === 0 && unrouted.length === 0) return;

    for (const code of unrouted) {
      errors.push({ field: `attr:${code}`, code: 'ATTRIBUTE_NOT_GOVERNED', message: `"${code}" is not a governed attribute for this category.` });
    }

    // Required attributes this row omitted entirely never reach `submitted` — validate() itself
    // catches that (its own "required" check iterates the applicable set, not the submitted one),
    // so both scopes are always called even when this row supplied zero attr:* values for one of
    // them, as long as the category has applicable attributes for it.
    await this.runAttributeScope(tx, tenantId, categoryId, 'product', productAttrs, errors);
    await this.runAttributeScope(tx, tenantId, categoryId, 'variant', variantAttrs, errors);
  }

  private async runAttributeScope(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string | null,
    scope: 'product' | 'variant',
    attrs: Record<string, unknown>,
    errors: ImportRowError[],
  ): Promise<void> {
    try {
      await this.attributeValidationService.validate(tx, tenantId, categoryId, scope, attrs);
    } catch (error) {
      if (error instanceof BadRequestException) {
        const response = error.getResponse();
        const fieldErrors = (typeof response === 'object' && response !== null && 'errors' in response ? (response as { errors: Array<{ code: string; message: string }> }).errors : []) ?? [];
        for (const fieldError of fieldErrors) {
          errors.push({ field: `attr:${fieldError.code}`, code: 'ATTRIBUTE_INVALID', message: fieldError.message });
        }
      } else {
        throw error;
      }
    }
  }
}
