import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
import { MovingAverageCostService } from '../kardex/moving-average-cost.service';
import { LocationAuthorizationService } from '../location-authorization.service';
import { IdempotencyKeysRepository } from '../repositories/idempotency-keys.repository';
import { InventoryBalancesRepository } from '../repositories/inventory-balances.repository';
import { InventoryMovementsRepository } from '../repositories/inventory-movements.repository';
import type { InventoryTransferItemRow } from '../repositories/inventory-transfer-items.repository';
import { InventoryTransferItemsRepository } from '../repositories/inventory-transfer-items.repository';
import { InventoryTransferReceiptsRepository } from '../repositories/inventory-transfer-receipts.repository';
import type { InventoryTransferRow } from '../repositories/inventory-transfers.repository';
import { InventoryTransfersRepository } from '../repositories/inventory-transfers.repository';
import { LocationsRepository } from '../repositories/locations.repository';
import { ProductVariantsLookupRepository } from '../repositories/product-variants-lookup.repository';
import { TransferWorkflowConfigRepository } from '../repositories/transfer-workflow-config.repository';
import { WarehousesRepository } from '../repositories/warehouses.repository';
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
 *
 * F17-TRANSFERS-AUDIT §1: not every tenant has staff for every gate. `approved`/`preparing` are
 * *gates* in front of what is otherwise the exact same mechanics — `doApprove`/`doPrepare` hold the
 * one real implementation of each, called either by the manual `approve()`/`prepare()` endpoint OR
 * by `advanceThroughDisabledStages()` right after create()/approve() when the tenant's
 * `TransferWorkflowConfig` says that gate isn't required. Either way the row lock, the
 * RESERVATION movement, the audit entry are identical — a disabled gate is skipped, never
 * bypassed by a second, parallel code path. `dispatched`/`received` are never configurable: they
 * are the physical events themselves (stock actually leaving/arriving), not gates in front of one,
 * so `dispatch()`/`receive()`/`cancel()` below are completely unchanged by this.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly transfersRepository: InventoryTransfersRepository,
    private readonly itemsRepository: InventoryTransferItemsRepository,
    private readonly receiptsRepository: InventoryTransferReceiptsRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly warehousesRepository: WarehousesRepository,
    private readonly balancesRepository: InventoryBalancesRepository,
    private readonly productVariantsLookup: ProductVariantsLookupRepository,
    private readonly workflowConfigRepository: TransferWorkflowConfigRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly stockLedgerService: StockLedgerService,
    private readonly idempotencyKeysRepository: IdempotencyKeysRepository,
    private readonly auditLogService: AuditLogService,
    private readonly movingAverageCostService: MovingAverageCostService,
    private readonly movementsRepository: InventoryMovementsRepository,
  ) {}

  async list(tenantId: string, query: ListTransfersQueryDto): Promise<PaginatedResult<TransferResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.transfersRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        sourceLocationId: query.sourceLocationId,
        destinationLocationId: query.destinationLocationId,
        createdFrom: query.createdFrom,
        createdTo: query.createdTo,
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

      // Advisory, read-only guard (spec §4): reject up front against the available stock visible
      // right now, so a request for more than is on the shelf never gets this far. This does NOT
      // reserve anything and does NOT change WHEN stock is actually held — `prepare()` below is
      // still the sole place that reserves (RESERVATION movement) and is still the authoritative,
      // re-validated-under-lock check (§5: a concurrent sale between create() and prepare() can
      // still make prepare() fail with InsufficientStockError — that race is inherent and expected,
      // not a bug this check is meant to close).
      for (const item of dto.items) {
        const balance = await this.balancesRepository.findByVariantAndLocation(tx, tenantId, item.productVariantId, dto.sourceLocationId);
        const available = balance ? Number(balance.quantityAvailable ?? 0) : 0;
        if (item.quantityRequested > available) {
          throw new ConflictException(
            `Stock insuficiente para la variante ${item.productVariantId} en el almacén de origen. Disponible: ${available}.`,
          );
        }
      }

      const sourceWarehouse = await this.warehousesRepository.findById(tx, tenantId, source.warehouseId);
      if (!sourceWarehouse) {
        throw new NotFoundException('Source warehouse not found.');
      }

      const transferId = generateId();
      const code = await this.transfersRepository.nextTransferCode(tx, tenantId, dto.sourceLocationId, sourceWarehouse.code, source.code);
      const created = await this.transfersRepository.create(tx, {
        id: transferId,
        tenantId,
        code,
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

      const workflow = await this.workflowConfigRepository.get(tx, tenantId);
      const advanced = await this.advanceThroughDisabledStages(tx, tenantId, actorId, created, meta, workflow);

      return this.toResponse(tx, tenantId, advanced);
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

      const approved = await this.doApprove(tx, tenantId, actorId, transfer, meta);

      // A manual "Aprobar" click can still land on a tenant that also has "Preparar" disabled
      // (§1 — only "Aprobar" itself is required here) — advance through that gate too, same as
      // create() does, rather than leaving the transfer sitting in "approved" with no visible next
      // action for anyone but a Bodega-permission holder to manually "Preparar" a stage the tenant
      // said doesn't apply to them.
      const workflow = await this.workflowConfigRepository.get(tx, tenantId);
      const advanced = await this.advanceThroughDisabledStages(tx, tenantId, actorId, approved, meta, workflow);

      return this.toResponse(tx, tenantId, advanced);
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

      const updated = await this.doPrepare(tx, tenantId, actorId, transfer, meta);
      return this.toResponse(tx, tenantId, updated);
    });
  }

  /** The one real implementation of draft -> approved — called by the manual `approve()` endpoint
   * and by `advanceThroughDisabledStages` when the tenant's workflow config skips this gate. Caller
   * must already hold the row lock and have verified `transfer.status === 'draft'`. */
  private async doApprove(tx: TenantTransaction, tenantId: string, actorId: string, transfer: InventoryTransferRow, meta: AuditMeta): Promise<InventoryTransferRow> {
    const updated = await this.transfersRepository.update(tx, tenantId, transfer.id, { status: 'approved', approvedBy: actorId, approvedAt: new Date() });
    if (!updated) {
      throw new NotFoundException('Transfer not found.');
    }
    await this.writeAudit(tx, { tenantId, actorId, actionCode: 'inventory_transfer.approved', entityId: transfer.id, meta });
    return updated;
  }

  /** The one real implementation of approved -> preparing (reserves stock at source for every
   * item's full quantityRequested) — called by the manual `prepare()` endpoint and by
   * `advanceThroughDisabledStages` when the tenant's workflow config skips this gate. Caller must
   * already hold the row lock and have verified `transfer.status === 'approved'`. */
  private async doPrepare(tx: TenantTransaction, tenantId: string, actorId: string, transfer: InventoryTransferRow, meta: AuditMeta): Promise<InventoryTransferRow> {
    await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, transfer.sourceLocationId);

    const items = await this.itemsRepository.listByTransfer(tx, tenantId, transfer.id);
    for (const item of items) {
      await this.reserveItem(tx, tenantId, transfer, item);
    }

    const updated = await this.transfersRepository.update(tx, tenantId, transfer.id, { status: 'preparing' });
    if (!updated) {
      throw new NotFoundException('Transfer not found.');
    }
    await this.writeAudit(tx, { tenantId, actorId, actionCode: 'inventory_transfer.prepared', entityId: transfer.id, meta });
    return updated;
  }

  /** F17-TRANSFERS-AUDIT §1 — fast-forwards a freshly-created or freshly-approved transfer through
   * any gate the tenant's `TransferWorkflowConfig` has turned off, reusing `doApprove`/`doPrepare`
   * verbatim (never a parallel/shortcut implementation). Stops at the first gate that IS required,
   * or at `preparing` — `dispatch()`/`receive()` are always manual, physical-event actions, never
   * auto-advanced. A no-op (returns `transfer` unchanged) when both gates are required, which is
   * every tenant's default. */
  private async advanceThroughDisabledStages(
    tx: TenantTransaction,
    tenantId: string,
    actorId: string,
    transfer: InventoryTransferRow,
    meta: AuditMeta,
    workflow: { requireApproval: boolean; requirePreparation: boolean },
  ): Promise<InventoryTransferRow> {
    let current = transfer;
    if (current.status === 'draft' && !workflow.requireApproval) {
      current = await this.doApprove(tx, tenantId, actorId, current, meta);
    }
    if (current.status === 'approved' && !workflow.requirePreparation) {
      current = await this.doPrepare(tx, tenantId, actorId, current, meta);
    }
    return current;
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
            // TRANSFER_OUT stores the moving average cost at source right before dispatch — not to
            // change this location's own Kardex maths (an outflow never does, see
            // kardex-costing.ts) but purely as the carrier value the paired TRANSFER_IN copies at
            // receive(), since the destination has no way to derive "what this batch cost" from its
            // own ledger history.
            const { averageCost } = await this.movingAverageCostService.getCurrentAverageCost(
              tx,
              tenantId,
              item.productVariantId,
              transfer.sourceLocationId,
            );
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
              unitCost: averageCost,
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

        // TRANSFER_IN carries forward the exact unit cost its paired TRANSFER_OUT recorded at
        // dispatch — the cost of these specific units is a fact fixed when they left the source,
        // not something the destination's own (unrelated) ledger history could derive.
        const dispatchMovement = await this.movementsRepository.findOneByReference(tx, tenantId, {
          referenceType: 'transfer',
          referenceId: id,
          productVariantId: item.productVariantId,
          movementType: 'TRANSFER_OUT',
        });
        const unitCost = dispatchMovement?.unitCost !== null && dispatchMovement?.unitCost !== undefined ? Number(dispatchMovement.unitCost) : undefined;

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
          ...(unitCost !== undefined ? { unitCost } : {}),
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
    const variantIds = [...new Set(items.map((item) => item.productVariantId))];
    const names = await this.productVariantsLookup.findByIds(tx, tenantId, variantIds);
    const nameById = new Map(names.map((row) => [row.id, row]));
    return {
      id: transfer.id,
      code: transfer.code,
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
        ...(nameById.get(item.productVariantId) ? { productName: nameById.get(item.productVariantId)!.productName, sku: nameById.get(item.productVariantId)!.sku } : {}),
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
