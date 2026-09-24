import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
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

const shortId = (id: string) => id.slice(0, 8);

/** SALE → the order's number; TRANSFER_OUT/TRANSFER_IN → the transfer's own id (there is no human
 * transfer number in the schema yet — `GAP-TRANSFER-CODE` — so this uses the same short-id
 * convention `reports/kardex` already established for the exact same gap). Every other movement
 * type already has a plain `reason` and needs no resolved label. */
function referenceLabelFor(movement: InventoryMovementRow, orderNumbersBySaleReference: Map<string, string>, transferIdsByReceipt: Map<string, string>): string | undefined {
  switch (movement.movementType) {
    case 'SALE': {
      const orderNumber = movement.referenceId ? orderNumbersBySaleReference.get(movement.referenceId) : undefined;
      return orderNumber ? `Venta #${orderNumber}` : undefined;
    }
    case 'TRANSFER_OUT':
      return movement.referenceId ? `Transferencia #${shortId(movement.referenceId)}` : undefined;
    case 'TRANSFER_IN': {
      const transferId = movement.referenceId ? transferIdsByReceipt.get(movement.referenceId) : undefined;
      return transferId ? `Transferencia #${shortId(transferId)}` : undefined;
    }
    default:
      return undefined;
  }
}

function toResponse(movement: InventoryMovementRow, canViewCost: boolean, referenceLabel?: string): MovementResponseDto {
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
    ...(movement.reason ? { reason: movement.reason } : {}),
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

  async list(tenantId: string, query: ListMovementsQueryDto, canViewCost: boolean): Promise<PaginatedResult<MovementResponseDto>> {
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
      const saleReferenceIds = rows.filter((row) => row.movementType === 'SALE' && row.referenceId).map((row) => row.referenceId!);
      const receiptIds = rows.filter((row) => row.movementType === 'TRANSFER_IN' && row.referenceId).map((row) => row.referenceId!);
      const [orderNumbersBySaleReference, transferIdsByReceipt] = await Promise.all([
        this.movementsRepository.resolveOrderNumbers(tx, tenantId, saleReferenceIds),
        this.movementsRepository.resolveReceiptTransferIds(tx, tenantId, receiptIds),
      ]);

      return {
        data: rows.map((row) => toResponse(row, canViewCost, referenceLabelFor(row, orderNumbersBySaleReference, transferIdsByReceipt))),
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
    return withTenantTransaction(tenantId, async (tx) => {
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
    });
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
