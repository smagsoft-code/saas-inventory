import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { TenantsPlatformRepository } from '../../auth/repositories/tenants-platform.repository';
import { AttributeValidationService } from '../../catalog/products/attribute-validation.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { analyzeNewSkuGroup, applyColumnMapping, importFieldLabel, type NewSkuGroupInfo } from '../import-fields';
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
  private readonly logger = new Logger(ImportValidationService.name);

  constructor(
    private readonly importJobsRepository: ImportJobsRepository,
    private readonly importJobRowsRepository: ImportJobRowsRepository,
    private readonly attributeValidationService: AttributeValidationService,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly catalogLookup: ImportCatalogLookupRepository,
    private readonly attributePartitionService: ImportAttributePartitionService,
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
  ) {}

  /** Processes every `pending` row for a job, batch by batch (own transaction per batch, per
   * database.md#committing's identical batching rationale applied to validation), then finalizes
   * the job's counters and transitions `validating -> ready`. Safe to call again on a job that
   * already has some `valid`/`warning`/`invalid` rows (resumed after a crash) — those rows are
   * simply not `pending` any more and are skipped.
   *
   * PROMPT 011-B: `tenants.status` is re-checked live before every batch (never only at the
   * initial HTTP-level TenantGuard check, which the Import Worker's own poll loop never passes
   * through at all — §32/§33 of that prompt: a worker execution policy, not a reused HTTP guard).
   * If the tenant is no longer `active`, this returns early *without* running the finalize block
   * below — the job is left exactly as it was (`validating`, whatever rows already got a result),
   * never marked `failed` for a suspension that isn't an import error, and never falsely finalized
   * to `ready` before every row actually has a result. `nextPendingBatch` never re-selects an
   * already-validated row, so resuming after reactivation picks up exactly where this left off. */
  async validateJob(tenantId: string, jobId: string, actorUserId: string): Promise<void> {
    const size = batchSize();
    const fileWideMaps = await this.buildFileWideMaps(tenantId, jobId);

    for (;;) {
      const tenant = await this.tenantsPlatformRepository.findById(tenantId);
      if (!tenant || tenant.status !== 'active') {
        this.logger.warn(`Import job ${jobId} (tenant ${tenantId}) paused mid-validation — tenant is not active.`);
        return;
      }

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
      errors.push({ field: 'sku', code: 'SKU_REQUIRED', message: 'El código es obligatorio: la fila no tiene valor en esa columna.' });
      return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
    }
    // PROMPT 010-A §4/§5/§9 — a SKU repeated in the file is only ever a plain duplicate when it
    // isn't a recognized new-SKU onboarding group (analyzeNewSkuGroup, computed once file-wide).
    // A repeat against a SKU that already exists in the database was never routed into
    // `newSkuGroups` at all — it keeps the pre-existing per-row `update` handling below unchanged.
    if ((fileWideMaps.skuRowCounts.get(sku) ?? 0) > 1) {
      const group = fileWideMaps.newSkuGroups.get(sku);
      if (!group) {
        errors.push({ field: 'sku', code: 'DUPLICATE_SKU_IN_FILE', message: `El código "${sku}" aparece más de una vez en este archivo. Deja solo una fila por código.` });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      if (group.trackingModeConflict) {
        errors.push({
          field: 'sku',
          code: 'SKU_GROUP_TRACKING_MODE_INCONSISTENT',
          message: `El código "${sku}" se repite con seguimiento inconsistente: todas sus filas deben traer número de serie, o todas número de lote, sin mezclar.`,
        });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      if (!group.isLegitimateUnitGroup) {
        errors.push({ field: 'sku', code: 'DUPLICATE_SKU_IN_FILE', message: `El código "${sku}" aparece más de una vez en este archivo. Deja solo una fila por código.` });
        return { status: 'invalid', matchAction: null, matchedProductVariantId: null, errors, warnings };
      }
      if (group.mismatchedFields.length > 0) {
        errors.push({
          field: 'sku',
          code: 'SKU_GROUP_INCONSISTENT_METADATA',
          message: `El código "${sku}" se repite en varias unidades pero estas columnas no coinciden entre filas: ${group.mismatchedFields.map((f) => importFieldLabel(f)).join(', ')}.`,
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
        errors.push({ field: 'sku', code: 'DUPLICATE_SKU_REJECTED', message: `El código "${sku}" ya existe en el catálogo. Cambia el código para poder importar esta fila; el catálogo existente no se modifica.` });
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
        errors.push({ field: 'category', code: 'CATEGORY_NOT_FOUND', message: `La categoría "${categoryText}" no existe. Escríbela exactamente como está en el sistema (revisa mayúsculas y tildes).` });
      } else {
        categoryId = category.id;
      }
    }
    const brandText = asText(mapped['brand']);
    if (brandText) {
      const brand = await this.catalogLookup.findBrandByName(tx, tenantId, brandText);
      if (!brand) errors.push({ field: 'brand', code: 'BRAND_NOT_FOUND', message: `La marca "${brandText}" no existe en el sistema.` });
    }
    const supplierText = asText(mapped['supplier']);
    if (supplierText) {
      const supplier = await this.catalogLookup.findSupplierByName(tx, tenantId, supplierText);
      if (!supplier) errors.push({ field: 'supplier', code: 'SUPPLIER_NOT_FOUND', message: `El proveedor "${supplierText}" no existe en el sistema.` });
    }

    // Name — required on create.
    const name = asText(mapped['name']);
    if (matchAction === 'create' && !name) {
      errors.push({ field: 'name', code: 'NAME_REQUIRED', message: 'El nombre es obligatorio para un producto nuevo.' });
    }

    // Prices.
    this.validatePrices(mapped, matchAction, errors);

    // Attributes — reuses AttributeValidationService verbatim, never a second implementation.
    await this.validateAttributes(tx, tenantId, categoryId, mapped, errors);

    // Quantity / location / initial stock.
    const quantity = asNumber(mapped['quantity']);
    if (quantity === 'invalid') {
      errors.push({ field: 'quantity', code: 'QUANTITY_INVALID', message: 'La cantidad debe ser un número.' });
    } else if (quantity !== undefined && quantity < 0) {
      errors.push({ field: 'quantity', code: 'QUANTITY_NEGATIVE', message: 'La cantidad no puede ser negativa.' });
    }

    // Sucursal + Almacén (or, failing both, the job's defaults) — one shared resolver, same one commit uses.
    const warehouseText = asText(mapped['warehouse']);
    const locationText = asText(mapped['location']);
    const resolution = await this.catalogLookup.resolveLocation(tx, tenantId, { warehouseText, locationText, defaultLocationId });
    let locationId: string | null = null;
    let locationFailed = false;
    switch (resolution.kind) {
      case 'resolved':
        locationId = resolution.locationId;
        break;
      case 'warehouse_not_found':
        locationFailed = true;
        errors.push({ field: 'warehouse', code: 'WAREHOUSE_NOT_FOUND', message: `La sucursal "${warehouseText}" no existe. Usa el nombre exacto (hoja «Referencia» de la plantilla).` });
        break;
      case 'location_not_found':
        locationFailed = true;
        errors.push({ field: 'location', code: 'LOCATION_NOT_FOUND', message: `El almacén "${locationText}" no existe${warehouseText ? ` en la sucursal "${warehouseText}"` : ''}. Usa el nombre o código exacto (hoja «Referencia» de la plantilla).` });
        break;
      case 'location_ambiguous':
        locationFailed = true;
        errors.push({ field: 'location', code: 'LOCATION_AMBIGUOUS', message: `Hay varios almacenes llamados "${locationText}". Indica la Sucursal en su columna para elegir el correcto.` });
        break;
      case 'location_required_in_warehouse':
        locationFailed = true;
        errors.push({ field: 'location', code: 'LOCATION_REQUIRED', message: `Indicaste la sucursal "${warehouseText}" pero no el almacén: llena la columna Almacén.` });
        break;
    }
    const wantsInventory = matchAction === 'create' ? typeof quantity === 'number' && quantity > 0 : duplicateHandlingMode === 'update_catalog_and_inventory' && typeof quantity === 'number' && quantity > 0;
    if (wantsInventory && !locationFailed) {
      if (!locationId) {
        errors.push({ field: 'location', code: 'LOCATION_REQUIRED', message: 'Para importar una cantidad se necesita un almacén: llena las columnas Sucursal y Almacén, o elige uno predeterminado al subir el archivo.' });
      } else {
        try {
          await this.locationAuthorizationService.assertAccess(tx, tenantId, actorUserId, locationId);
        } catch (error) {
          if (error instanceof ForbiddenException) {
            errors.push({ field: 'location', code: 'LOCATION_NOT_AUTHORIZED', message: 'No tienes autorización para cargar inventario en este almacén.' });
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
      errors.push({ field: 'serialNumber', code: 'SERIAL_AND_LOT_MUTUALLY_EXCLUSIVE', message: 'Una variante no puede tener número de serie y número de lote a la vez. Llena solo uno.' });
    }

    if (isSerialized) {
      if (!serialNumber) {
        errors.push({ field: 'serialNumber', code: 'SERIAL_NUMBER_REQUIRED', message: 'Esta variante se controla por número de serie: el número de serie es obligatorio.' });
      } else {
        if ((fileWideMaps.serialRowCounts.get(serialNumber) ?? 0) > 1) {
          errors.push({ field: 'serialNumber', code: 'DUPLICATE_SERIAL_IN_FILE', message: `El número de serie "${serialNumber}" aparece más de una vez en este archivo.` });
        }
        if (await this.catalogLookup.serialNumberExists(tx, tenantId, serialNumber)) {
          errors.push({ field: 'serialNumber', code: 'SERIAL_NUMBER_EXISTS', message: `El número de serie "${serialNumber}" ya existe en el sistema.` });
        }
      }
      if (typeof quantity === 'number' && quantity !== 1) {
        errors.push({ field: 'quantity', code: 'SERIAL_QUANTITY_MUST_BE_ONE', message: 'Una fila con número de serie es exactamente una unidad: la cantidad debe ser 1 (o dejarse vacía).' });
      }
      if (!locationId && !locationFailed) {
        errors.push({ field: 'location', code: 'LOCATION_REQUIRED', message: 'Una unidad con número de serie necesita un almacén (columna Almacén o almacén predeterminado).' });
      }
    } else if (matchAction !== 'create' && serialNumber) {
      warnings.push({ field: 'serialNumber', code: 'SERIAL_IGNORED', message: 'Esta variante no se controla por número de serie: el número de serie se ignoró.' });
    }

    if (isLotTracked) {
      if (!lotNumber) {
        errors.push({ field: 'lotNumber', code: 'LOT_NUMBER_REQUIRED', message: 'Esta variante se controla por lote: el número de lote es obligatorio.' });
      } else {
        const key = `${sku}::${lotNumber}`;
        if ((fileWideMaps.skuLotRowCounts.get(key) ?? 0) > 1) {
          errors.push({ field: 'lotNumber', code: 'DUPLICATE_LOT_IN_FILE', message: `El lote "${lotNumber}" del código "${sku}" aparece más de una vez en este archivo.` });
        }
        if (existingVariant && (await this.catalogLookup.lotExists(tx, tenantId, existingVariant.variantId, lotNumber))) {
          errors.push({ field: 'lotNumber', code: 'LOT_NUMBER_EXISTS', message: `El lote "${lotNumber}" ya existe para esta variante.` });
        }
      }
      for (const [field, target] of [
        ['manufacturedDate', 'manufacturedDate'],
        ['expiryDate', 'expiryDate'],
      ] as const) {
        const value = asText(mapped[target]);
        if (value && !DATE_PATTERN.test(value)) {
          errors.push({ field, code: 'DATE_FORMAT_INVALID', message: `${importFieldLabel(field)} debe tener el formato AAAA-MM-DD (por ejemplo 2026-12-31).` });
        }
      }
    } else if (matchAction !== 'create' && lotNumber) {
      warnings.push({ field: 'lotNumber', code: 'LOT_IGNORED', message: 'Esta variante no se controla por lote: el número de lote se ignoró.' });
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
        errors.push({ field, code: 'PRICE_INVALID', message: `${importFieldLabel(field)} debe ser un número.` });
      } else if (parsed !== undefined) {
        if (parsed < 0) {
          errors.push({ field, code: 'PRICE_NEGATIVE', message: `${importFieldLabel(field)} no puede ser negativo.` });
        } else {
          values[field] = parsed;
        }
      } else if (matchAction === 'create') {
        errors.push({ field, code: 'PRICE_REQUIRED', message: `${importFieldLabel(field)} es obligatorio para un producto nuevo.` });
      }
    }
    if (values.minPrice !== undefined && values.basePrice !== undefined && values.maxPrice !== undefined) {
      if (!(values.minPrice <= values.basePrice && values.basePrice <= values.maxPrice)) {
        errors.push({ field: 'basePrice', code: 'PRICE_TIER_INVALID', message: 'Los precios deben cumplir: Precio mínimo ≤ Precio base ≤ Precio máximo.' });
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
      errors.push({ field: `attr:${code}`, code: 'ATTRIBUTE_NOT_GOVERNED', message: `El atributo "${code}" no pertenece a la categoría de este producto.` });
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
