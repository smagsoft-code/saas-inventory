import { Injectable, Logger } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ProductsRepository } from '../../catalog/repositories/products.repository';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { InsufficientStockError, StockLedgerService } from '../../inventory/stock-ledger.service';
import { applyColumnMapping } from '../import-fields';
import type { ImportJobRowRow } from '../repositories/import-job-rows.repository';
import { ImportJobRowsRepository } from '../repositories/import-job-rows.repository';
import type { ImportJobRow } from '../repositories/import-jobs.repository';
import { ImportJobsRepository } from '../repositories/import-jobs.repository';
import { ImportCatalogLookupRepository } from '../repositories/import-catalog-lookup.repository';
import { ImportAttributePartitionService } from './import-attribute-partition.service';

function batchSize(): number {
  return Number(getOptionalEnvVar('IMPORT_BATCH_SIZE', '500'));
}

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(num) ? num : undefined;
}

/** A late-arriving, expected conflict (e.g. a concurrent write created the same SKU/serial between
 * validation and commit) — caught per-row (§7: "nunca permitir que un duplicado termine
 * convertido en una excepcion SQL cruda durante el commit") rather than aborting the whole batch. */
class RowCommitConflictError extends Error {}

/**
 * §17/§26 — batched commit (database.md#committing). Every catalog write reuses CATALOG's own
 * ProductsRepository/CategoriesRepository (the exact methods ProductsService itself calls); every
 * quantity write goes through StockLedgerService.applyMovement, the one locking convoy — "no
 * separate, parallel write path" (§17: "no bypass"). Each row's writes run in its own nested
 * transaction (a Postgres SAVEPOINT under drizzle-orm's `tx.transaction()`), so one row's
 * unexpected failure only rolls back that row, never the rest of the batch.
 */
@Injectable()
export class ImportExecutionService {
  private readonly logger = new Logger(ImportExecutionService.name);

  constructor(
    private readonly importJobsRepository: ImportJobsRepository,
    private readonly importJobRowsRepository: ImportJobRowsRepository,
    private readonly productsRepository: ProductsRepository,
    private readonly stockLedgerService: StockLedgerService,
    private readonly catalogLookup: ImportCatalogLookupRepository,
    private readonly attributePartitionService: ImportAttributePartitionService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Processes every `valid`/`warning` row not yet `imported`, batch by batch — §26's "validate ->
   * lock -> verify -> movement -> balance" convoy, reused unchanged via StockLedgerService. Resumable:
   * `nextCommittableBatch` never re-selects an already-`imported` row (§21, no separate idempotency
   * mechanism needed). Stops (leaving the job `importing`, to be picked back up on retry) if an
   * unexpected error escapes a whole batch — the caller (ImportJobService/ImportWorkerService)
   * decides the resulting job status. */
  async commitJob(tenantId: string, jobId: string, actorId: string): Promise<void> {
    const size = batchSize();

    for (;;) {
      const batchRows = await withTenantTransaction(tenantId, (tx) => this.importJobRowsRepository.nextCommittableBatch(tx, tenantId, jobId, size));
      if (batchRows.length === 0) break;

      await withTenantTransaction(tenantId, async (tx) => {
        const job = await this.importJobsRepository.findById(tx, tenantId, jobId);
        if (!job) return;
        for (const row of batchRows) {
          await this.commitOneRow(tx, tenantId, actorId, job, row);
        }
      });
    }

    await withTenantTransaction(tenantId, async (tx) => {
      const counts = await this.importJobRowsRepository.countsByStatus(tx, tenantId, jobId);
      await this.importJobsRepository.update(tx, tenantId, jobId, {
        importedRows: counts['imported'] ?? 0,
        invalidRows: counts['invalid'] ?? 0,
      });
    });
  }

  private async commitOneRow(tx: TenantTransaction, tenantId: string, actorId: string, job: ImportJobRow, row: ImportJobRowRow): Promise<void> {
    if (row.matchAction === 'skip') {
      await this.importJobRowsRepository.markSkipped(tx, tenantId, row.id);
      return;
    }

    try {
      await tx.transaction(async (rowTx) => {
        const mapped = applyColumnMapping(row.rawData as Record<string, unknown>, job.columnMapping as Record<string, string>);
        const variantId =
          row.matchAction === 'create'
            ? await this.commitCreate(rowTx, tenantId, actorId, job, mapped)
            : await this.commitUpdate(rowTx, tenantId, actorId, job, mapped, row.matchedProductVariantId!);
        await this.importJobRowsRepository.markImported(rowTx, tenantId, row.id, variantId);
      });
    } catch (error) {
      if (error instanceof RowCommitConflictError || error instanceof InsufficientStockError) {
        await this.importJobRowsRepository.markFailed(tx, tenantId, row.id, [{ field: 'sku', code: 'COMMIT_CONFLICT', message: error.message }]);
        return;
      }
      this.logger.error(`Unexpected error committing import row ${row.id} (job ${job.id}): ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  private async resolveReferences(
    tx: TenantTransaction,
    tenantId: string,
    mapped: Record<string, unknown>,
  ): Promise<{ categoryId: string | null; brandId: string | null; supplierId: string | null; locationId: string | null }> {
    const categoryText = asText(mapped['category']);
    const brandText = asText(mapped['brand']);
    const supplierText = asText(mapped['supplier']);
    const locationText = asText(mapped['location']);

    const [category, brand, supplier, location] = await Promise.all([
      categoryText ? this.catalogLookup.findCategoryByName(tx, tenantId, categoryText) : undefined,
      brandText ? this.catalogLookup.findBrandByName(tx, tenantId, brandText) : undefined,
      supplierText ? this.catalogLookup.findSupplierByName(tx, tenantId, supplierText) : undefined,
      locationText ? this.catalogLookup.findLocationByNameOrCode(tx, tenantId, locationText) : undefined,
    ]);
    if (categoryText && !category) throw new RowCommitConflictError(`Category "${categoryText}" no longer exists.`);
    if (brandText && !brand) throw new RowCommitConflictError(`Brand "${brandText}" no longer exists.`);
    if (supplierText && !supplier) throw new RowCommitConflictError(`Supplier "${supplierText}" no longer exists.`);
    if (locationText && !location) throw new RowCommitConflictError(`Location "${locationText}" no longer exists.`);

    return {
      categoryId: category?.id ?? null,
      brandId: brand?.id ?? null,
      supplierId: supplier?.id ?? null,
      locationId: location?.id ?? null,
    };
  }

  private async commitCreate(tx: TenantTransaction, tenantId: string, actorId: string, job: ImportJobRow, mapped: Record<string, unknown>): Promise<string> {
    const sku = asText(mapped['sku'])!;
    const { categoryId, brandId, supplierId, locationId } = await this.resolveReferences(tx, tenantId, mapped);
    const { productAttrs, variantAttrs } = await this.attributePartitionService.partition(tx, tenantId, categoryId, mapped);

    const serialNumber = asText(mapped['serialNumber']);
    const lotNumber = asText(mapped['lotNumber']);
    const isSerialized = Boolean(serialNumber);
    const isLotTracked = Boolean(lotNumber);

    const productId = generateId();
    const product = await this.productsRepository.create(tx, {
      id: productId,
      tenantId,
      categoryId,
      brandId,
      supplierId,
      name: asText(mapped['name'])!,
      description: asText(mapped['description']),
      attributes: productAttrs,
    });

    let variant;
    try {
      variant = await this.productsRepository.createVariant(tx, {
        id: generateId(),
        tenantId,
        productId: product.id,
        sku,
        barcode: asText(mapped['barcode']),
        unit: asText(mapped['unit']) ?? 'unit',
        maxPrice: String(asNumber(mapped['maxPrice'])),
        basePrice: String(asNumber(mapped['basePrice'])),
        minPrice: String(asNumber(mapped['minPrice'])),
        cost: asNumber(mapped['cost']) !== undefined ? String(asNumber(mapped['cost'])) : undefined,
        isSerialized,
        isLotTracked,
        attributes: variantAttrs,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new RowCommitConflictError(`SKU "${sku}" was created concurrently by another process.`);
      throw error;
    }

    await this.productsRepository.recordPriceChange(tx, {
      id: generateId(),
      tenantId,
      productVariantId: variant.id,
      maxPrice: variant.maxPrice,
      basePrice: variant.basePrice,
      // createVariant's `.returning()` always includes every column (unlike a
      // visibility-gated SELECT) — minPrice is only typed optional on VariantRow because that
      // interface is shared with the visibility-gated read path.
      minPrice: variant.minPrice!,
      changedBy: actorId,
    });

    if (isSerialized && serialNumber) {
      await this.catalogLookup.createSerial(tx, { id: generateId(), tenantId, productVariantId: variant.id, serialNumber });
    }
    if (isLotTracked && lotNumber) {
      await this.catalogLookup.createLot(tx, {
        id: generateId(),
        tenantId,
        productVariantId: variant.id,
        lotNumber,
        manufacturedDate: asText(mapped['manufacturedDate']),
        expiryDate: asText(mapped['expiryDate']),
      });
    }

    const quantity = asNumber(mapped['quantity']);
    if (quantity !== undefined && quantity > 0 && locationId) {
      await this.stockLedgerService.applyMovement(tx, {
        tenantId,
        productVariantId: variant.id,
        locationId,
        movementType: 'INITIAL_STOCK',
        quantity,
        reason: `Excel import job ${job.id}`,
        referenceType: 'import_job',
        referenceId: job.id,
        actorType: 'user',
        actorId,
      });
    }

    await this.writeAudit(tx, tenantId, actorId, 'product.created', 'product', productId, { name: product.name, sku, importJobId: job.id });
    return variant.id;
  }

  private async commitUpdate(
    tx: TenantTransaction,
    tenantId: string,
    actorId: string,
    job: ImportJobRow,
    mapped: Record<string, unknown>,
    variantId: string,
  ): Promise<string> {
    const existing = await this.catalogLookup.findVariantBySku(tx, tenantId, asText(mapped['sku'])!);
    if (!existing || existing.variantId !== variantId) {
      throw new RowCommitConflictError('The matched product variant no longer exists.');
    }
    const { categoryId, brandId, supplierId, locationId } = await this.resolveReferences(tx, tenantId, mapped);
    const { productAttrs, variantAttrs } = await this.attributePartitionService.partition(tx, tenantId, categoryId ?? existing.categoryId, mapped);

    const name = asText(mapped['name']);
    const description = asText(mapped['description']);
    if (name !== undefined || description !== undefined || categoryId !== null || brandId !== null || supplierId !== null || Object.keys(productAttrs).length > 0) {
      await this.productsRepository.update(tx, tenantId, existing.productId, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(categoryId !== null ? { categoryId } : {}),
        ...(brandId !== null ? { brandId } : {}),
        ...(supplierId !== null ? { supplierId } : {}),
        ...(Object.keys(productAttrs).length > 0 ? { attributes: productAttrs } : {}),
      });
    }

    const maxPrice = asNumber(mapped['maxPrice']);
    const basePrice = asNumber(mapped['basePrice']);
    const minPrice = asNumber(mapped['minPrice']);
    const priceProvided = maxPrice !== undefined || basePrice !== undefined || minPrice !== undefined;
    const barcode = asText(mapped['barcode']);
    const unit = asText(mapped['unit']);
    const cost = asNumber(mapped['cost']);

    if (priceProvided || barcode !== undefined || unit !== undefined || cost !== undefined || Object.keys(variantAttrs).length > 0) {
      await this.productsRepository.updateVariant(tx, tenantId, variantId, {
        ...(barcode !== undefined ? { barcode } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(maxPrice !== undefined ? { maxPrice: String(maxPrice) } : {}),
        ...(basePrice !== undefined ? { basePrice: String(basePrice) } : {}),
        ...(minPrice !== undefined ? { minPrice: String(minPrice) } : {}),
        ...(cost !== undefined ? { cost: String(cost) } : {}),
        ...(Object.keys(variantAttrs).length > 0 ? { attributes: variantAttrs } : {}),
      });
    }
    if (priceProvided) {
      await this.productsRepository.recordPriceChange(tx, {
        id: generateId(),
        tenantId,
        productVariantId: variantId,
        maxPrice: String(maxPrice ?? 0),
        basePrice: String(basePrice ?? 0),
        minPrice: String(minPrice ?? 0),
        changedBy: actorId,
      });
    }

    const serialNumber = asText(mapped['serialNumber']);
    if (existing.isSerialized && serialNumber) {
      await this.catalogLookup.createSerial(tx, { id: generateId(), tenantId, productVariantId: variantId, serialNumber });
    }
    const lotNumber = asText(mapped['lotNumber']);
    if (existing.isLotTracked && lotNumber) {
      const alreadyExists = await this.catalogLookup.lotExists(tx, tenantId, variantId, lotNumber);
      if (!alreadyExists) {
        await this.catalogLookup.createLot(tx, {
          id: generateId(),
          tenantId,
          productVariantId: variantId,
          lotNumber,
          manufacturedDate: asText(mapped['manufacturedDate']),
          expiryDate: asText(mapped['expiryDate']),
        });
      }
    }

    // §16 — UPDATE_CATALOG_ONLY (the default) never touches inventory; only
    // update_catalog_and_inventory does, and only then does an existing SKU's quantity move —
    // §16's core safety rule, enforced here, not just documented.
    const quantity = asNumber(mapped['quantity']);
    if (job.duplicateHandlingMode === 'update_catalog_and_inventory' && quantity !== undefined && quantity > 0 && locationId) {
      await this.stockLedgerService.applyMovement(tx, {
        tenantId,
        productVariantId: variantId,
        locationId,
        movementType: 'ADJUSTMENT_IN',
        quantity,
        reason: `Excel import job ${job.id} (update_catalog_and_inventory)`,
        referenceType: 'import_job',
        referenceId: job.id,
        actorType: 'user',
        actorId,
      });
    }

    await this.writeAudit(tx, tenantId, actorId, 'product.variant_updated', 'product', existing.productId, { variantId, importJobId: job.id });
    return variantId;
  }

  private async writeAudit(
    tx: TenantTransaction,
    tenantId: string,
    actorId: string,
    actionCode: string,
    entityType: string,
    entityId: string,
    afterState: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditLogService.record(tx, { tenantId, actorId, actionCode, entityType, entityId, afterState, correlationId: undefined, ipAddress: undefined });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation, same
      // convention as every other writeAudit() in this codebase.
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    const hasCode = (value: unknown): value is { code: string } => typeof value === 'object' && value !== null && 'code' in value;
    if (hasCode(error) && error.code === '23505') return true;
    return error instanceof Error && hasCode(error.cause) && error.cause.code === '23505';
  }
}
