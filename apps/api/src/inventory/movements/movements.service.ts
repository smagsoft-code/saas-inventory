import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
import { importLabel } from '../import-job-numbers';
import { ledgerOrderReferenceScope, ledgerReturnReferenceScope } from '../../sales/orders/order-seller-scope';
import { LocationAuthorizationService } from '../location-authorization.service';
import { ProductVariantsLookupRepository } from '../repositories/product-variants-lookup.repository';
import { LocationsRepository } from '../repositories/locations.repository';
import type { InventoryMovementRow } from '../repositories/inventory-movements.repository';
import { InventoryMovementsRepository } from '../repositories/inventory-movements.repository';
import { InsufficientStockError, StockLedgerService } from '../stock-ledger.service';
import { MovingAverageCostService } from '../kardex/moving-average-cost.service';
import type { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import type { ListMovementsQueryDto } from './dto/list-movements-query.dto';
import type { MovementResponseDto } from './dto/movement-response.dto';

/** The names the "Motivo / referencia" column shows instead of a raw id, keyed by the id each
 * movement's `referenceId` holds. */
interface ReferenceNames {
  orderNumbers: Map<string, string>;
  returnNumbers: Map<string, string>;
  transferIdsByReceipt: Map<string, string>;
  transferCodesByTransferId: Map<string, string>;
  importJobNumbers: Map<string, number>;
}

/**
 * A readable name for every movement that points at a document, whatever its type:
 *  - an order — "Venta #ORD-000123" for the SALE, "Pedido #ORD-000123" for its reservation /
 *    release / commitment movements (those used to fall back to `order 01a16b4d…`);
 *  - a transfer or its receipt — "Transferencia #<code>" (F17-TRANSFERS-AUDIT, `GAP-TRANSFER-CODE`);
 *  - a sales return — "Devolución #DEV-001";
 *  - an Excel import — "Importación #N".
 * Movements with no document (manual adjustments, receipts) keep their plain `reason`.
 */
function referenceLabelFor(movement: InventoryMovementRow, names: ReferenceNames): string | undefined {
  const { orderNumbers, returnNumbers, transferIdsByReceipt, transferCodesByTransferId, importJobNumbers } = names;
  const referenceId = movement.referenceId ?? undefined;
  // Excel import → "Importación #N" (the raw reason embeds the job's uuid and is not returned).
  if (movement.referenceType === 'import_job') {
    return importLabel(movement.referenceId, importJobNumbers);
  }
  if (!referenceId) {
    return undefined;
  }
  switch (movement.referenceType) {
    case 'order': {
      const orderNumber = orderNumbers.get(referenceId);
      if (!orderNumber) return undefined;
      return movement.movementType === 'SALE' ? `Venta #${orderNumber}` : `Pedido #${orderNumber}`;
    }
    case 'transfer': {
      const code = transferCodesByTransferId.get(referenceId);
      return code ? `Transferencia #${code}` : undefined;
    }
    case 'transfer_receipt': {
      const transferId = transferIdsByReceipt.get(referenceId);
      const code = transferId ? transferCodesByTransferId.get(transferId) : undefined;
      return code ? `Transferencia #${code}` : undefined;
    }
    case 'sales_return_item': {
      const returnNumber = returnNumbers.get(referenceId);
      return returnNumber ? `Devolución #${returnNumber}` : undefined;
    }
    default:
      return undefined;
  }
}

/** The movement types whose `referenceId` is a commercial document (an order or a return line) and so falls under the seller scope. */
const ORDER_REFERENCE_TYPES = new Set(['order', 'sales_return_item']);

const GENERIC_ORDER_LABEL = (movement: InventoryMovementRow): string => (movement.referenceType === 'sales_return_item' ? 'Devolución' : movement.movementType === 'SALE' ? 'Venta' : 'Pedido');

function toResponse(movement: InventoryMovementRow, canViewCost: boolean, referenceLabel?: string, masked = false): MovementResponseDto {
  if (masked) {
    // Another seller's order / return (ADR-0040): the row and its stock arithmetic stay, the commercial reference does not — no number,
    // no uuid, no free-text reason (may embed either) and no actor (who rang the sale up).
    return {
      id: movement.id,
      productVariantId: movement.productVariantId,
      locationId: movement.locationId,
      movementType: movement.movementType,
      quantity: Number(movement.quantity),
      balanceAfter: Number(movement.balanceAfter),
      ...(canViewCost && movement.unitCost !== null ? { unitCost: Number(movement.unitCost) } : {}),
      ...(movement.referenceType ? { referenceType: movement.referenceType } : {}),
      referenceLabel: GENERIC_ORDER_LABEL(movement),
      actorType: movement.actorType,
      occurredAt: movement.occurredAt.toISOString(),
      createdAt: movement.createdAt.toISOString(),
    };
  }
  return {
    id: movement.id,
    productVariantId: movement.productVariantId,
    locationId: movement.locationId,
    movementType: movement.movementType,
    quantity: Number(movement.quantity),
    balanceAfter: Number(movement.balanceAfter),
    ...(canViewCost && movement.unitCost !== null ? { unitCost: Number(movement.unitCost) } : {}),
    ...(movement.referenceType ? { referenceType: movement.referenceType } : {}),
    ...(movement.referenceId ? { referenceId: movement.referenceId } : {}),
    ...(movement.reason && movement.referenceType !== 'import_job' ? { reason: movement.reason } : {}),
    ...(referenceLabel ? { referenceLabel } : {}),
    actorType: movement.actorType,
    ...(movement.actorId ? { actorId: movement.actorId } : {}),
    occurredAt: movement.occurredAt.toISOString(),
    createdAt: movement.createdAt.toISOString(),
  };
}

/**
 * The inventory_movements ledger (read) plus manual stock adjustments (the only direct write path
 * onto inventory_balances outside the transfer lifecycle — inventory/transfers/). Every write goes
 * through StockLedgerService's locking convoy and is preceded by both an RBAC check
 * (inventory.adjust, on the route) and a location-authorization check (ADR-0024, here).
 */
@Injectable()
export class MovementsService {
  constructor(
    private readonly movementsRepository: InventoryMovementsRepository,
    private readonly productVariantsLookup: ProductVariantsLookupRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly stockLedgerService: StockLedgerService,
    private readonly auditLogService: AuditLogService,
    private readonly movingAverageCostService: MovingAverageCostService,
  ) {}

  async list(tenantId: string, actorId: string, permissions: string[], query: ListMovementsQueryDto, canViewCost: boolean): Promise<PaginatedResult<MovementResponseDto>> {
    // [occurredFrom, occurredTo) — half-open, same convention as every FASE 18 reporting endpoint
    // (F18-03, GAP-MOVEMENTS-DATE-FILTER). `occurredFrom >= occurredTo` is a caller mistake no date
    // format check catches on its own, so it is rejected here rather than silently returning empty.
    if (query.occurredFrom && query.occurredTo && new Date(query.occurredFrom).getTime() >= new Date(query.occurredTo).getTime()) {
      throw new BadRequestException('`occurredFrom` must be strictly before `occurredTo`.');
    }

    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.movementsRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        productVariantId: query.productVariantId,
        locationId: query.locationId,
        movementType: query.movementType,
        ...(query.occurredFrom ? { occurredGte: new Date(query.occurredFrom) } : {}),
        ...(query.occurredTo ? { occurredLt: new Date(query.occurredTo) } : {}),
      });

      // Batched, page-sized (never per-row) — the same N+1-avoidance `reports/kardex` uses for its
      // own label resolution.
      const idsOf = (referenceType: string): string[] => rows.filter((row) => row.referenceType === referenceType && row.referenceId).map((row) => row.referenceId!);
      const transferOutIds = idsOf('transfer');
      const [orderNumbers, returnNumbers, transferIdsByReceipt, importJobNumbers] = await Promise.all([
        this.movementsRepository.resolveOrderNumbers(tx, tenantId, idsOf('order'), ledgerOrderReferenceScope(actorId, permissions)),
        this.movementsRepository.resolveReturnNumbers(tx, tenantId, idsOf('sales_return_item'), ledgerReturnReferenceScope(actorId, permissions)),
        this.movementsRepository.resolveReceiptTransferIds(tx, tenantId, idsOf('transfer_receipt')),
        this.movementsRepository.resolveImportJobNumbers(tx, tenantId, idsOf('import_job')),
      ]);
      // TRANSFER_OUT's own referenceId already IS the transfer id; TRANSFER_IN's only resolves to
      // one via the receipt lookup above — union both before the single, batched code lookup.
      const transferCodesByTransferId = await this.movementsRepository.resolveTransferCodes(tx, tenantId, [
        ...transferOutIds,
        ...transferIdsByReceipt.values(),
      ]);

      return {
        data: rows.map((row) => {
          const names = { orderNumbers, returnNumbers, transferIdsByReceipt, transferCodesByTransferId, importJobNumbers };
          // A commercial reference that did not resolve under the caller's seller scope is masked, never shown half-way.
          const hidden =
            !!row.referenceId &&
            ORDER_REFERENCE_TYPES.has(row.referenceType ?? '') &&
            !(row.referenceType === 'order' ? orderNumbers : returnNumbers).has(row.referenceId);
          return toResponse(row, canViewCost, referenceLabelFor(row, names), hidden);
        }),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async createAdjustment(
    tenantId: string,
    actorId: string,
    dto: CreateAdjustmentDto,
    meta: AuditMeta,
    canViewCost: boolean,
  ): Promise<MovementResponseDto> {
    return withTenantTransaction(tenantId, (tx) => this.createAdjustmentInTx(tx, tenantId, actorId, dto, meta, canViewCost));
  }

  /** `createAdjustment`'s body inside a transaction the CALLER owns — so several adjustments can be
   * written atomically (the bulk stock load: all rows or none). Identical rules, audit and ledger
   * convoy as the single call. */
  async createAdjustmentInTx(
    tx: TenantTransaction,
    tenantId: string,
    actorId: string,
    dto: CreateAdjustmentDto,
    meta: AuditMeta,
    canViewCost: boolean,
  ): Promise<MovementResponseDto> {
    {
      const variantExists = await this.productVariantsLookup.exists(tx, tenantId, dto.productVariantId);
      if (!variantExists) {
        throw new NotFoundException('Product variant not found.');
      }
      const location = await this.locationsRepository.findById(tx, tenantId, dto.locationId);
      if (!location) {
        throw new NotFoundException('Location not found.');
      }

      await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, dto.locationId);

      // RECEIPT ("Agregar stock") always carries an explicit, mandatory unit cost (DTO validation).
      // ADJUSTMENT_IN defaults to the current moving average when the caller doesn't supply one —
      // a found-inventory correction is assumed not to move the average. ADJUSTMENT_OUT never
      // carries a cost: an outflow's Costo U is always the average vigente before it, derived at
      // read time by the Kardex, never stored (kardex-costing.ts).
      let unitCost: number | undefined;
      if (dto.movementType === 'RECEIPT') {
        unitCost = dto.unitCost;
      } else if (dto.movementType === 'ADJUSTMENT_IN') {
        if (dto.unitCost !== undefined) {
          unitCost = dto.unitCost;
        } else {
          const current = await this.movingAverageCostService.getCurrentAverageCost(tx, tenantId, dto.productVariantId, dto.locationId);
          unitCost = current.averageCost;
        }
      }

      let result;
      try {
        result = await this.stockLedgerService.applyMovement(tx, {
          tenantId,
          productVariantId: dto.productVariantId,
          locationId: dto.locationId,
          movementType: dto.movementType,
          quantity: dto.quantity,
          reason: dto.reason,
          referenceType: 'manual_adjustment',
          actorType: 'user',
          actorId,
          correlationId: meta.correlationId,
          ...(unitCost !== undefined ? { unitCost } : {}),
          ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
        });
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'inventory.adjustment.created',
        entityId: result.movement.id,
        afterState: {
          productVariantId: dto.productVariantId,
          locationId: dto.locationId,
          movementType: dto.movementType,
          quantity: dto.quantity,
          reason: dto.reason,
          balanceAfter: result.movement.balanceAfter,
          ...(unitCost !== undefined ? { unitCost } : {}),
        },
        meta,
      });

      return toResponse(result.movement, canViewCost);
    }
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
        entityType: 'inventory_movement',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation, same
      // convention as catalog/categories/categories.service.ts's writeAudit().
    }
  }
}
