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
import type { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import type { ListMovementsQueryDto } from './dto/list-movements-query.dto';
import type { MovementResponseDto } from './dto/movement-response.dto';

function toResponse(movement: InventoryMovementRow): MovementResponseDto {
  return {
    id: movement.id,
    productVariantId: movement.productVariantId,
    locationId: movement.locationId,
    movementType: movement.movementType,
    quantity: Number(movement.quantity),
    balanceAfter: Number(movement.balanceAfter),
    ...(movement.referenceType ? { referenceType: movement.referenceType } : {}),
    ...(movement.referenceId ? { referenceId: movement.referenceId } : {}),
    ...(movement.reason ? { reason: movement.reason } : {}),
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
  ) {}

  async list(tenantId: string, query: ListMovementsQueryDto): Promise<PaginatedResult<MovementResponseDto>> {
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
      return {
        data: rows.map(toResponse),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async createAdjustment(tenantId: string, actorId: string, dto: CreateAdjustmentDto, meta: AuditMeta): Promise<MovementResponseDto> {
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
        },
        meta,
      });

      return toResponse(result.movement);
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
