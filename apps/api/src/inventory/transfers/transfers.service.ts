import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
import { LocationAuthorizationService } from '../location-authorization.service';
import { IdempotencyKeysRepository } from '../repositories/idempotency-keys.repository';
import type { InventoryTransferItemRow } from '../repositories/inventory-transfer-items.repository';
import { InventoryTransferItemsRepository } from '../repositories/inventory-transfer-items.repository';
import { InventoryTransferReceiptsRepository } from '../repositories/inventory-transfer-receipts.repository';
import type { InventoryTransferRow } from '../repositories/inventory-transfers.repository';
import { InventoryTransfersRepository } from '../repositories/inventory-transfers.repository';
import { LocationsRepository } from '../repositories/locations.repository';
import { ProductVariantsLookupRepository } from '../repositories/product-variants-lookup.repository';
import { InsufficientStockError, StockLedgerService } from '../stock-ledger.service';
import type { CreateTransferDto } from './dto/create-transfer.dto';
import type { DispatchTransferDto } from './dto/dispatch-transfer.dto';
import type { ListTransfersQueryDto } from './dto/list-transfers-query.dto';
import type { ReceiveTransferDto } from './dto/receive-transfer.dto';
import type { TransferResponseDto } from './dto/transfer-response.dto';

const OPEN_STATUSES = ['draft', 'approved', 'preparing'] as const;
const RECEIVABLE_STATUSES = ['dispatched', 'partially_received'] as const;
const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;

function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Full transfer lifecycle — database.md#inventory-transfers-and-in-transit-stock, ADR-0020:
 * draft -> approved -> preparing -> dispatched -> partially_received/received, with cancel valid
 * only up to `preparing`. Every state transition locks the transfer header row first
 * (InventoryTransfersRepository.lockById) before locking any balance row, serializing concurrent
 * attempts on the *same* transfer — the second concurrent call blocks until the first commits, then
 * re-reads `status` and correctly rejects an already-applied transition. StockLedgerService's own
 * per-balance-row locking (nested inside) additionally serializes different transfers competing for
 * the same product+location.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly transfersRepository: InventoryTransfersRepository,
    private readonly itemsRepository: InventoryTransferItemsRepository,
    private readonly receiptsRepository: InventoryTransferReceiptsRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly productVariantsLookup: ProductVariantsLookupRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly stockLedgerService: StockLedgerService,
    private readonly idempotencyKeysRepository: IdempotencyKeysRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, query: ListTransfersQueryDto): Promise<PaginatedResult<TransferResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.transfersRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        sourceLocationId: query.sourceLocationId,
        destinationLocationId: query.destinationLocationId,
      });
      const data = await Promise.all(rows.map((row) => this.toResponse(tx, tenantId, row)));
      return {
        data,
        meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      };
    });
  }

  async getById(tenantId: string, id: string): Promise<TransferResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const transfer = await this.transfersRepository.findById(tx, tenantId, id);
      if (!transfer) {
        throw new NotFoundException('Transfer not found.');
      }
      return this.toResponse(tx, tenantId, transfer);
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateTransferDto, meta: AuditMeta): Promise<TransferResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      if (dto.sourceLocationId === dto.destinationLocationId) {
        throw new BadRequestException('Source and destination locations must be different.');
      }
      const uniqueVariantIds = new Set(dto.items.map((item) => item.productVariantId));
      if (uniqueVariantIds.size !== dto.items.length) {
        throw new BadRequestException('Duplicate productVariantId in items.');
      }

      const source = await this.locationsRepository.findById(tx, tenantId, dto.sourceLocationId);
      if (!source) {
        throw new NotFoundException('Source location not found.');
      }
      const destination = await this.locationsRepository.findById(tx, tenantId, dto.destinationLocationId);
      if (!destination) {
        throw new NotFoundException('Destination location not found.');
      }

      // ADR-0024: requesting a transfer is itself an operation against the source location's
      // inventory (it is what `prepare` later reserves stock against) — a user restricted to a
      // subset of the tenant's locations must not be able to *originate* a transfer from a
      // location outside their scope, even though only prepare/dispatch/receive checked this
      // before (ROLES/PERMISSIONS block, WAREHOUSE OPERATION SCOPE gap-closure).
      await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, dto.sourceLocationId);
      for (const item of dto.items) {
        const exists = await this.productVariantsLookup.exists(tx, tenantId, item.productVariantId);
        if (!exists) {
          throw new NotFoundException(`Product variant ${item.productVariantId} not found.`);
        }
      }

      const transferId = generateId();
      const created = await this.transfersRepository.create(tx, {
        id: transferId,
        tenantId,
        sourceLocationId: dto.sourceLocationId,
        destinationLocationId: dto.destinationLocationId,
        requestedBy: actorId,
        notes: dto.notes,
      });
      await this.itemsRepository.createMany(
        tx,
        dto.items.map((item) => ({
          id: generateId(),
          tenantId,
          transferId,
          productVariantId: item.productVariantId,
          quantityRequested: item.quantityRequested,
        })),
      );

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'inventory_transfer.created',
        entityId: transferId,
        afterState: { sourceLocationId: dto.sourceLocationId, destinationLocationId: dto.destinationLocationId, itemCount: dto.items.length },
        meta,
      });

      return this.toResponse(tx, tenantId, created);
    });
  }

  async approve(tenantId: string, actorId: string, id: string, meta: AuditMeta): Promise<TransferResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const transfer = await this.transfersRepository.lockById(tx, tenantId, id);
      if (!transfer) {
        throw new NotFoundException('Transfer not found.');
      }
      if (transfer.status !== 'draft') {
        throw new ConflictException(`Transfer must be in "draft" status to approve (currently "${transfer.status}").`);
      }

      const updated = await this.transfersRepository.update(tx, tenantId, id, { status: 'approved', approvedBy: actorId, approvedAt: new Date() });
      if (!updated) {
        throw new NotFoundException('Transfer not found.');
      }

      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'inventory_transfer.approved', entityId: id, meta });
      return this.toResponse(tx, tenantId, updated);
    });
  }

  /** approved -> preparing: reserves stock at source for every item's full quantityRequested. */
  async prepare(tenantId: string, actorId: string, id: string, meta: AuditMeta): Promise<TransferResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const transfer = await this.transfersRepository.lockById(tx, tenantId, id);
      if (!transfer) {
        throw new NotFoundException('Transfer not found.');
      }
      if (transfer.status !== 'approved') {
        throw new ConflictException(`Transfer must be in "approved" status to prepare (currently "${transfer.status}").`);
      }

      await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, transfer.sourceLocationId);

      const items = await this.itemsRepository.listByTransfer(tx, tenantId, id);
      for (const item of items) {
        await this.reserveItem(tx, tenantId, transfer, item);
      }

      const updated = await this.transfersRepository.update(tx, tenantId, id, { status: 'preparing' });
      if (!updated) {
        throw new NotFoundException('Transfer not found.');
      }

      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'inventory_transfer.prepared', entityId: id, meta });
      return this.toResponse(tx, tenantId, updated);
    });
  }

  /** preparing -> dispatched: releases the preparing-time reservation and decrements physical stock
   * at source by whatever was actually dispatched (which may be less than requested). */
  async dispatch(tenantId: string, actorId: string, id: string, dto: DispatchTransferDto, meta: AuditMeta): Promise<TransferResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const transfer = await this.transfersRepository.lockById(tx, tenantId, id);
      if (!transfer) {
        throw new NotFoundException('Transfer not found.');
      }
      if (transfer.status !== 'preparing') {
        throw new ConflictException(`Transfer must be in "preparing" status to dispatch (currently "${transfer.status}").`);
      }

      await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, transfer.sourceLocationId);

      const items = await this.itemsRepository.listByTransfer(tx, tenantId, id);
      const overrides = new Map((dto.items ?? []).map((item) => [item.transferItemId, item.quantityDispatched]));
      for (const override of dto.items ?? []) {
        if (!items.some((item) => item.id === override.transferItemId)) {
          throw new NotFoundException(`Transfer item ${override.transferItemId} not found on this transfer.`);
        }
      }

      for (const item of items) {
        const requested = Number(item.quantityRequested);
        const quantityDispatched = overrides.get(item.id) ?? requested;
        if (quantityDispatched > requested) {
          throw new BadRequestException(`quantityDispatched for item ${item.id} cannot exceed its quantityRequested (${requested}).`);
        }

        // Undo the preparing-time hold for this item's full requested quantity, regardless of how
        // much actually ships — database.md's documented movement mapping.
        await this.stockLedgerService.applyMovement(tx, {
          tenantId,
          productVariantId: item.productVariantId,
          locationId: transfer.sourceLocationId,
          movementType: 'RESERVATION_RELEASE',
          quantity: requested,
          referenceType: 'transfer',
          referenceId: id,
          actorType: 'user',
          actorId,
          correlationId: meta.correlationId,
        });

        if (quantityDispatched > 0) {
          try {
            await this.stockLedgerService.applyMovement(tx, {
              tenantId,
              productVariantId: item.productVariantId,
              locationId: transfer.sourceLocationId,
              movementType: 'TRANSFER_OUT',
              quantity: quantityDispatched,
              referenceType: 'transfer',
              referenceId: id,
              actorType: 'user',
              actorId,
              // Deterministic, per-item key — database.md#inventory-transfers-and-in-transit-stock's
              // 'transfer-dispatch:' || transfer_id key, extended with the item id since a
              // multi-item transfer writes one TRANSFER_OUT per item and idempotency_key is unique
              // per row: each item's dispatch is still a legitimate one-time event with a derivable
              // key, just not globally shared across items.
              idempotencyKey: `transfer-dispatch:${id}:${item.id}`,
              correlationId: meta.correlationId,
            });
          } catch (error) {
            if (error instanceof InsufficientStockError) {
              throw new ConflictException(error.message);
            }
            throw error;
          }
        }

        await this.itemsRepository.setDispatched(tx, tenantId, item.id, quantityDispatched);
      }

      const updated = await this.transfersRepository.update(tx, tenantId, id, {
        status: 'dispatched',
        dispatchedBy: actorId,
        dispatchedAt: new Date(),
      });
      if (!updated) {
        throw new NotFoundException('Transfer not found.');
      }

      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'inventory_transfer.dispatched', entityId: id, meta });
      return this.toResponse(tx, tenantId, updated);
    });
  }

  /** dispatched/partially_received -> partially_received/received: one receiving EVENT, which may
   * cover some or all outstanding items. Requires a client-supplied Idempotency-Key header
   * (database.md#idempotency's general idempotency_keys table, scope = 'transfer.receive') — receiving
   * is a genuinely repeatable user action a client could retry after a timeout, and unlike dispatch
   * (a one-time transition the transfer's own status blocks from repeating) two legitimate receiving
   * events can have identical shape (the same items/quantities received twice, on purpose), so the
   * status check alone cannot distinguish a deliberate second event from an accidental retry. */
  async receive(
    tenantId: string,
    actorId: string,
    id: string,
    dto: ReceiveTransferDto,
    meta: AuditMeta,
    idempotencyKey: string | undefined,
  ): Promise<TransferResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      if (!idempotencyKey) {
        throw new BadRequestException('Idempotency-Key header is required to receive a transfer.');
      }
      const requestHash = hashRequest(dto);
      const existingKey = await this.idempotencyKeysRepository.find(tx, tenantId, 'transfer.receive', idempotencyKey);
      if (existingKey) {
        if (existingKey.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key was already used for a different request body.');
        }
        return existingKey.responseBody as TransferResponseDto;
      }

      const transfer = await this.transfersRepository.lockById(tx, tenantId, id);
      if (!transfer) {
        throw new NotFoundException('Transfer not found.');
      }
      if (!RECEIVABLE_STATUSES.includes(transfer.status as (typeof RECEIVABLE_STATUSES)[number])) {
        throw new ConflictException(`Transfer must be "dispatched" or "partially_received" to receive (currently "${transfer.status}").`);
      }

      await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, transfer.destinationLocationId);

      const items = await this.itemsRepository.listByTransfer(tx, tenantId, id);
      const itemsById = new Map(items.map((item) => [item.id, item]));
      for (const line of dto.items) {
        const item = itemsById.get(line.transferItemId);
        if (!item) {
          throw new NotFoundException(`Transfer item ${line.transferItemId} not found on this transfer.`);
        }
        const remaining = Number(item.quantityDispatched) - Number(item.quantityReceived);
        if (line.quantityReceived > remaining) {
          throw new BadRequestException(`Cannot receive ${line.quantityReceived} for item ${item.id} — only ${remaining} remain undelivered.`);
        }
      }

      const receipt = await this.receiptsRepository.createReceipt(tx, { id: generateId(), tenantId, transferId: id, receivedBy: actorId, notes: dto.notes });
      await this.receiptsRepository.createReceiptItems(
        tx,
        dto.items.map((line) => ({
          id: generateId(),
          tenantId,
          receiptId: receipt.id,
          transferItemId: line.transferItemId,
          quantityReceived: line.quantityReceived,
          incidentType: line.incidentType,
          incidentNotes: line.incidentNotes,
        })),
      );

      const updatedReceivedByItem = new Map<string, number>();
      for (const line of dto.items) {
        await this.itemsRepository.incrementReceived(tx, tenantId, line.transferItemId, line.quantityReceived);
        const item = itemsById.get(line.transferItemId)!;
        updatedReceivedByItem.set(line.transferItemId, Number(item.quantityReceived) + line.quantityReceived);

        await this.stockLedgerService.applyMovement(tx, {
          tenantId,
          productVariantId: item.productVariantId,
          locationId: transfer.destinationLocationId,
          movementType: 'TRANSFER_IN',
          quantity: line.quantityReceived,
          referenceType: 'transfer_receipt',
          referenceId: receipt.id,
          actorType: 'user',
          actorId,
          correlationId: meta.correlationId,
        });
      }

      const fullyReceived = items.every((item) => {
        const total = updatedReceivedByItem.get(item.id) ?? Number(item.quantityReceived);
        return total >= Number(item.quantityDispatched);
      });

      const updated = await this.transfersRepository.update(tx, tenantId, id, {
        status: fullyReceived ? 'received' : 'partially_received',
        ...(fullyReceived ? { receivedAt: new Date() } : {}),
      });
      if (!updated) {
        throw new NotFoundException('Transfer not found.');
      }

      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'inventory_transfer.received', entityId: id, meta });
      const response = await this.toResponse(tx, tenantId, updated);

      await this.idempotencyKeysRepository.create(tx, {
        id: generateId(),
        tenantId,
        scope: 'transfer.receive',
        idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody: response,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });

      return response;
    });
  }

  /** Only valid from draft/approved/preparing. Releases the preparing-time reservation if any —
   * nothing was ever dispatched at this point in the state machine, so there is nothing physical to
   * reverse. A transfer already dispatched cannot be cancelled at all (schema-level, per ADR-0020) —
   * the goods are already in motion; reversing that is a new, opposite-direction transfer. */
  async cancel(tenantId: string, actorId: string, id: string, meta: AuditMeta): Promise<TransferResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const transfer = await this.transfersRepository.lockById(tx, tenantId, id);
      if (!transfer) {
        throw new NotFoundException('Transfer not found.');
      }
      if (!OPEN_STATUSES.includes(transfer.status as (typeof OPEN_STATUSES)[number])) {
        throw new ConflictException(`Transfer cannot be cancelled from status "${transfer.status}".`);
      }

      if (transfer.status === 'preparing') {
        const items = await this.itemsRepository.listByTransfer(tx, tenantId, id);
        for (const item of items) {
          const requested = Number(item.quantityRequested);
          if (requested > 0) {
            await this.stockLedgerService.applyMovement(tx, {
              tenantId,
              productVariantId: item.productVariantId,
              locationId: transfer.sourceLocationId,
              movementType: 'RESERVATION_RELEASE',
              quantity: requested,
              referenceType: 'transfer',
              referenceId: id,
              actorType: 'user',
              actorId,
              correlationId: meta.correlationId,
            });
          }
        }
      }

      const updated = await this.transfersRepository.update(tx, tenantId, id, { status: 'cancelled', cancelledAt: new Date() });
      if (!updated) {
        throw new NotFoundException('Transfer not found.');
      }

      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'inventory_transfer.cancelled', entityId: id, meta });
      return this.toResponse(tx, tenantId, updated);
    });
  }

  private async reserveItem(tx: TenantTransaction, tenantId: string, transfer: InventoryTransferRow, item: InventoryTransferItemRow): Promise<void> {
    try {
      await this.stockLedgerService.applyMovement(tx, {
        tenantId,
        productVariantId: item.productVariantId,
        locationId: transfer.sourceLocationId,
        movementType: 'RESERVATION',
        quantity: Number(item.quantityRequested),
        referenceType: 'transfer',
        referenceId: transfer.id,
        actorType: 'user',
      });
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        throw new ConflictException(`Insufficient available stock at source location for product variant ${item.productVariantId}.`);
      }
      throw error;
    }
  }

  private async toResponse(tx: TenantTransaction, tenantId: string, transfer: InventoryTransferRow): Promise<TransferResponseDto> {
    const items = await this.itemsRepository.listByTransfer(tx, tenantId, transfer.id);
    return {
      id: transfer.id,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transfer.destinationLocationId,
      status: transfer.status,
      requestedBy: transfer.requestedBy,
      ...(transfer.approvedBy ? { approvedBy: transfer.approvedBy } : {}),
      ...(transfer.dispatchedBy ? { dispatchedBy: transfer.dispatchedBy } : {}),
      ...(transfer.notes ? { notes: transfer.notes } : {}),
      createdAt: transfer.createdAt.toISOString(),
      updatedAt: transfer.updatedAt.toISOString(),
      ...(transfer.approvedAt ? { approvedAt: transfer.approvedAt.toISOString() } : {}),
      ...(transfer.dispatchedAt ? { dispatchedAt: transfer.dispatchedAt.toISOString() } : {}),
      ...(transfer.receivedAt ? { receivedAt: transfer.receivedAt.toISOString() } : {}),
      ...(transfer.cancelledAt ? { cancelledAt: transfer.cancelledAt.toISOString() } : {}),
      items: items.map((item) => ({
        id: item.id,
        productVariantId: item.productVariantId,
        quantityRequested: Number(item.quantityRequested),
        quantityDispatched: Number(item.quantityDispatched),
        quantityReceived: Number(item.quantityReceived),
        quantityInTransit: Number(item.quantityDispatched) - Number(item.quantityReceived),
      })),
    };
  }

  private async writeAudit(
    tx: TenantTransaction,
    input: { tenantId: string; actorId: string; actionCode: string; entityId: string; afterState?: Record<string, unknown>; meta: AuditMeta },
  ): Promise<void> {
    try {
      await this.auditLogService.record(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actionCode: input.actionCode,
        entityType: 'inventory_transfer',
        entityId: input.entityId,
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
