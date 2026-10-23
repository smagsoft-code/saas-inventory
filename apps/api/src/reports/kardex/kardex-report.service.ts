import { BadRequestException, Injectable } from '@nestjs/common';
import { withTenantTransaction } from '../../database/tenant-context';
import { importLabel } from '../../inventory/import-job-numbers';
import { foldKardexLedger, isPhysicalMovementType, ZERO_BALANCE, type KardexBalanceState, type KardexSourceMovement } from '../../inventory/kardex/kardex-costing';
import type { KardexQueryDto } from './dto/kardex-query.dto';
import type { KardexBalanceDto, KardexResponseDto, KardexRowDto } from './dto/kardex-response.dto';
import { KardexReportRepository, type KardexMovementRow } from './kardex-report.repository';

/** Hard cap on rows returned within the visible [from, to) range — the opening balance still folds
 * every prior movement regardless (correctness there is non-negotiable, see kardex-costing.ts), but
 * the rows a human actually scrolls through are capped, per UI-UX-SPEC-001 §22's explicit request
 * for a limit rather than "a solution that only works with little data". A caller that hits this
 * should narrow the date range, exactly as `truncated: true` on the response tells them to. */
const MAX_ROWS = 2000;

function toSourceMovement(row: KardexMovementRow): KardexSourceMovement {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    movementType: row.movementType,
    quantity: Number(row.quantity),
    unitCost: row.unitCost !== null ? Number(row.unitCost) : null,
  };
}

function toBalanceDto(state: KardexBalanceState, canViewCost: boolean): KardexBalanceDto {
  return {
    stockUnits: state.stock,
    ...(canViewCost
      ? {
          averageCost: state.averageCost,
          stockValue: state.stock * state.averageCost,
          estimated: state.estimated,
        }
      : {}),
  };
}

function labelFor(
  row: KardexMovementRow,
  orderNumbersBySaleReference: Map<string, string>,
  orderNumbersByReturnItem: Map<string, string>,
  transferIdsByReceipt: Map<string, string>,
  transferCodesByTransferId: Map<string, string>,
  importJobNumbers: Map<string, number>,
): string {
  // An import's reason text embeds the job's uuid: show "Importación #N" instead, never the id.
  const reason = row.referenceType === 'import_job' ? importLabel(row.referenceId, importJobNumbers) : row.reason;
  switch (row.movementType) {
    case 'SALE': {
      const orderNumber = row.referenceId ? orderNumbersBySaleReference.get(row.referenceId) : undefined;
      return orderNumber ? `Venta #${orderNumber}` : 'Venta';
    }
    case 'RETURN': {
      const orderNumber = row.referenceId ? orderNumbersByReturnItem.get(row.referenceId) : undefined;
      return orderNumber ? `Devolución de venta #${orderNumber}` : 'Devolución de venta';
    }
    case 'TRANSFER_OUT': {
      const code = row.referenceId ? transferCodesByTransferId.get(row.referenceId) : undefined;
      return code ? `Transferencia #${code} (salida)` : 'Transferencia (salida)';
    }
    case 'TRANSFER_IN': {
      const transferId = row.referenceId ? transferIdsByReceipt.get(row.referenceId) : undefined;
      const code = transferId ? transferCodesByTransferId.get(transferId) : undefined;
      return code ? `Transferencia #${code} (entrada)` : 'Transferencia (entrada)';
    }
    case 'RECEIPT':
      return reason ? `Ingreso de stock: ${reason}` : 'Ingreso de stock';
    case 'ADJUSTMENT_IN':
      return reason ? `Ajuste (entrada): ${reason}` : 'Ajuste (entrada)';
    case 'ADJUSTMENT_OUT':
      return reason ? `Ajuste (salida): ${reason}` : 'Ajuste (salida)';
    case 'INITIAL_STOCK':
      return reason ? `Stock inicial: ${reason}` : 'Stock inicial';
    default:
      return row.movementType;
  }
}

/**
 * `GET /reports/kardex` (UI-UX-SPEC-001) — a chronological ledger for one (variant, location) with
 * running Costo K / Stock U / Stock S, seeded with an opening balance folded from everything before
 * `from` so a mid-history date filter never starts a variant's stock at a false zero (§5).
 */
@Injectable()
export class KardexReportService {
  constructor(private readonly repository: KardexReportRepository) {}

  /** Product/SKU/location display strings for the export's header — a separate small lookup so the
   * main JSON response (the frontend already has this context from its own product search and
   * location picker) doesn't carry redundant display fields. */
  async getExportContext(tenantId: string, productVariantId: string, locationId: string): Promise<{ productName: string; sku: string; locationLabel: string }> {
    return withTenantTransaction(tenantId, async (tx) => {
      const [variantInfo, locationBalances] = await Promise.all([
        this.repository.getVariantDisplayInfo(tx, tenantId, productVariantId),
        this.repository.listLocationBalances(tx, tenantId, productVariantId),
      ]);
      const location = locationBalances.find((row) => row.locationId === locationId);
      return {
        productName: variantInfo?.productName ?? 'Producto',
        sku: variantInfo?.sku ?? '',
        locationLabel: location ? `${location.warehouseName} — ${location.locationName}` : locationId,
      };
    });
  }

  async getKardex(tenantId: string, query: KardexQueryDto, canViewCost: boolean): Promise<KardexResponseDto> {
    if (query.from && query.to && new Date(query.from).getTime() >= new Date(query.to).getTime()) {
      throw new BadRequestException('`from` must be strictly before `to`.');
    }

    return withTenantTransaction(tenantId, async (tx) => {
      const from = query.from ? new Date(query.from) : undefined;
      const to = query.to ? new Date(query.to) : undefined;

      const [priorMovements, rangeMovementsPlusOne, fallbackCost, stockByLocation, variantInfo] = await Promise.all([
        from
          ? this.repository.listMovements(tx, tenantId, { productVariantId: query.productVariantId, locationId: query.locationId, occurredLt: from })
          : Promise.resolve([]),
        this.repository.listMovements(tx, tenantId, {
          productVariantId: query.productVariantId,
          locationId: query.locationId,
          ...(from ? { occurredGte: from } : {}),
          ...(to ? { occurredLt: to } : {}),
          limit: MAX_ROWS + 1,
        }),
        this.repository.getVariantCost(tx, tenantId, query.productVariantId),
        this.repository.listLocationBalances(tx, tenantId, query.productVariantId),
        this.repository.getVariantDisplayInfo(tx, tenantId, query.productVariantId),
      ]);

      const truncated = rangeMovementsPlusOne.length > MAX_ROWS;
      const rangeMovements = truncated ? rangeMovementsPlusOne.slice(0, MAX_ROWS) : rangeMovementsPlusOne;

      const opening = from ? foldKardexLedger(priorMovements.map(toSourceMovement), ZERO_BALANCE, fallbackCost).closing : ZERO_BALANCE;

      const { rows: foldedRows, closing } = foldKardexLedger(rangeMovements.map(toSourceMovement), opening, fallbackCost);

      const physicalRows = rangeMovements.filter((row) => isPhysicalMovementType(row.movementType));
      const saleReferenceIds = physicalRows.filter((row) => row.movementType === 'SALE' && row.referenceId).map((row) => row.referenceId!);
      const returnItemIds = physicalRows.filter((row) => row.movementType === 'RETURN' && row.referenceId).map((row) => row.referenceId!);
      const transferOutIds = physicalRows.filter((row) => row.movementType === 'TRANSFER_OUT' && row.referenceId).map((row) => row.referenceId!);
      const receiptIds = physicalRows.filter((row) => row.movementType === 'TRANSFER_IN' && row.referenceId).map((row) => row.referenceId!);

      const importJobIds = physicalRows.filter((row) => row.referenceType === 'import_job' && row.referenceId).map((row) => row.referenceId!);
      const [orderNumbersBySaleReference, orderNumbersByReturnItem, transferIdsByReceipt, importJobNumbers] = await Promise.all([
        this.repository.resolveOrderNumbers(tx, tenantId, saleReferenceIds),
        this.repository.resolveReturnOrderNumbers(tx, tenantId, returnItemIds),
        this.repository.resolveReceiptTransferIds(tx, tenantId, receiptIds),
        this.repository.resolveImportJobNumbers(tx, tenantId, importJobIds),
      ]);
      // TRANSFER_OUT's own referenceId already IS the transfer id; TRANSFER_IN's only resolves to
      // one via the receipt lookup above — union both before the single, batched code lookup.
      const transferCodesByTransferId = await this.repository.resolveTransferCodes(tx, tenantId, [
        ...transferOutIds,
        ...transferIdsByReceipt.values(),
      ]);

      const movementsById = new Map(physicalRows.map((row) => [row.id, row]));
      const rows: KardexRowDto[] = foldedRows.map((row) => {
        const source = movementsById.get(row.movementId)!;
        return {
          movementId: row.movementId,
          occurredAt: row.occurredAt.toISOString(),
          movementType: row.movementType,
          label: labelFor(source, orderNumbersBySaleReference, orderNumbersByReturnItem, transferIdsByReceipt, transferCodesByTransferId, importJobNumbers),
          entrada: row.entrada,
          salida: row.salida,
          ...(canViewCost
            ? { unitCost: row.unitCost, unitCostEstimated: row.unitCostEstimated, averageCostAfter: row.averageCostAfter, stockValueAfter: row.stockValueAfter }
            : {}),
          stockAfter: row.stockAfter,
        };
      });

      return {
        productVariantId: query.productVariantId,
        locationId: query.locationId,
        productId: variantInfo?.productId ?? '',
        productName: variantInfo?.productName ?? 'Producto',
        sku: variantInfo?.sku ?? '',
        opening: toBalanceDto(opening, canViewCost),
        rows,
        closing: toBalanceDto(closing, canViewCost),
        truncated,
        stockByLocation: stockByLocation.map((location) => ({
          locationId: location.locationId,
          locationName: location.locationName,
          warehouseName: location.warehouseName,
          stockPhysical: Number(location.quantityPhysical),
          ...(location.quantityAvailable !== null ? { stockAvailable: Number(location.quantityAvailable) } : {}),
        })),
      };
    });
  }
}
