import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { sql } from 'drizzle-orm';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { DomainEventPublisher } from '../../common/events/domain-event-publisher.service';
import type {
  SalesReturnCancelledData,
  SalesReturnRequestedData,
  SalesReturnResolvedData,
} from '../../common/events/domain-event.contracts';
import { EVENT_TYPES } from '../../common/events/event-types';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { LocationsRepository } from '../../inventory/repositories/locations.repository';
import { InsufficientStockError, StockLedgerService } from '../../inventory/stock-ledger.service';
import { OrderItemsRepository } from '../repositories/order-items.repository';
import { OrdersRepository } from '../repositories/orders.repository';
import type { Disposition, SalesReturnItemRow } from '../repositories/sales-return-items.repository';
import { SalesReturnItemsRepository } from '../repositories/sales-return-items.repository';
import type { SalesReturnRow } from '../repositories/sales-returns.repository';
import { SalesReturnsRepository } from '../repositories/sales-returns.repository';
import { SalesIdempotencyRepository } from '../repositories/sales-idempotency.repository';
import type { AuditMeta } from '../sales-audit-meta';
import type { CreateReturnDto } from './dto/create-return.dto';
import type { InspectReturnDto } from './dto/inspect-return.dto';
import type { ListReturnsQueryDto } from './dto/list-returns-query.dto';
import type { ReturnItemResponseDto, ReturnResponseDto } from './dto/return-response.dto';

const CREATE_SCOPE = 'sales_return.create';
const RESOLVE_SCOPE = 'sales_return.disposition';
const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;

/** Only a `confirmed` order committed physical stock, so only a `confirmed` order can produce a
 * physical return (§8; `fulfilled` has no FASE 12 transition into it but is accepted for
 * forward-compatibility). */
const RETURNABLE_ORDER_STATUSES = new Set(['confirmed', 'fulfilled']);

function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Sales returns lifecycle (FASE 13 Part A, ADR-0021 / database.md#sales-returns-and-disposition).
 * A return is a reversal traced back to the original sale — never a second negative order, never a
 * cancellation of a `confirmed` order (§6).
 *
 *   create  (`POST /sales-returns`)              — `sales.returns.create`. Idempotency-Key
 *                                                  (scope `sales_return.create`). Locks the `orders`
 *                                                  row, then validates every line against
 *                                                  `returnable = sold - already-returned` under that
 *                                                  lock (§11, §13 — concurrent over-return is
 *                                                  serialized). No inventory effect. -> `requested`.
 *   inspect (`POST /sales-returns/:id/inspect`)  — `inventory.returns.manage`. Records each line's
 *                                                  disposition + re-entry location (restock ->
 *                                                  sellable location, others -> non-sellable, ADR-0021)
 *                                                  and location authorization. -> `inspecting`.
 *   resolve (`POST /sales-returns/:id/resolve`)  — `inventory.returns.manage`. Idempotency-Key
 *                                                  (scope `sales_return.disposition`). Writes ONE
 *                                                  `RETURN` movement per line through
 *                                                  `StockLedgerService` (SALES never writes
 *                                                  `inventory_balances` directly — §18) at the
 *                                                  disposition location, deterministic ledger key
 *                                                  `sales-return:<itemId>`. Locks the return row so
 *                                                  concurrent processing is exactly-once (§25).
 *                                                  -> `resolved`.
 *   cancel  (`POST /sales-returns/:id/cancel`)   — `sales.returns.create`. -> `cancelled`, no
 *                                                  inventory effect.
 *
 * Returns never mutate the original order / order_items (§26 / test R12) — they only read the
 * frozen snapshot.
 *
 * FASE 14: `create` / `resolve` / `cancel` each publish one domain event to `event_outbox` in the
 * same transaction (`DomainEventPublisher`). `inspect` does not — an internal re-inspection is not
 * an externally-meaningful fact (§18). Still no Telegram / n8n (FASE 15).
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly returnsRepository: SalesReturnsRepository,
    private readonly returnItemsRepository: SalesReturnItemsRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly stockLedgerService: StockLedgerService,
    private readonly idempotencyRepository: SalesIdempotencyRepository,
    private readonly auditLogService: AuditLogService,
    private readonly domainEventPublisher: DomainEventPublisher,
  ) {}

  async list(tenantId: string, query: ListReturnsQueryDto): Promise<PaginatedResult<ReturnResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.returnsRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        orderId: query.orderId,
      });
      const data = await Promise.all(rows.map((row) => this.toResponse(tx, tenantId, row)));
      return {
        data,
        meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      };
    });
  }

  async getById(tenantId: string, id: string): Promise<ReturnResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.returnsRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException('Sales return not found.');
      }
      return this.toResponse(tx, tenantId, row);
    });
  }

  async create(
    tenantId: string,
    actorId: string,
    dto: CreateReturnDto,
    meta: AuditMeta,
    idempotencyKey: string | undefined,
  ): Promise<ReturnResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required to create a sales return.');
    }
    const requestHash = hashRequest({
      orderId: dto.orderId,
      locationId: dto.locationId,
      items: dto.items.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })),
    });

    return withTenantTransaction(tenantId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${CREATE_SCOPE}:${tenantId}:${idempotencyKey}`}))`);
      const existing = await this.idempotencyRepository.find(tx, tenantId, CREATE_SCOPE, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key was already used for a different request.');
        }
        return existing.responseBody as ReturnResponseDto;
      }

      // Lock the order — serializes concurrent return creation for the same order, so the
      // returnable-quantity check below cannot be raced (§13 / test R4).
      const order = await this.ordersRepository.lockById(tx, tenantId, dto.orderId);
      if (!order) {
        throw new NotFoundException('Order not found.');
      }
      if (!RETURNABLE_ORDER_STATUSES.has(order.status)) {
        throw new ConflictException(
          `Only a confirmed order can be returned (order is "${order.status}"). A still-pending order is cancelled, not returned.`,
        );
      }

      const location = await this.locationsRepository.findById(tx, tenantId, dto.locationId);
      if (!location) {
        throw new NotFoundException('Receiving location not found.');
      }
      if (location.status !== 'active') {
        throw new ConflictException('The receiving location is not active.');
      }

      const orderItems = await this.orderItemsRepository.listByOrder(tx, tenantId, order.id);
      const orderItemsById = new Map(orderItems.map((item) => [item.id, item]));
      const alreadyReturned = await this.returnItemsRepository.sumReturnedByOrder(tx, tenantId, order.id);

      const requestedByItem = new Map<string, number>();
      for (const line of dto.items) {
        const orderItem = orderItemsById.get(line.orderItemId);
        if (!orderItem) {
          throw new UnprocessableEntityException(`Order line ${line.orderItemId} is not part of order ${order.id}.`);
        }
        requestedByItem.set(line.orderItemId, (requestedByItem.get(line.orderItemId) ?? 0) + line.quantity);
      }
      for (const [orderItemId, requested] of requestedByItem) {
        const orderItem = orderItemsById.get(orderItemId)!;
        const returnable = Number(orderItem.quantity) - (alreadyReturned.get(orderItemId) ?? 0);
        if (requested > returnable) {
          throw new ConflictException(
            `Cannot return ${requested} of ${orderItem.skuSnapshot}; only ${returnable} remain returnable.`,
          );
        }
      }

      const returnId = generateId();
      const created = await this.returnsRepository.create(tx, {
        id: returnId,
        tenantId,
        orderId: order.id,
        locationId: dto.locationId,
        status: 'requested',
        requestedBy: actorId,
        reason: dto.reason,
      });
      await this.returnItemsRepository.createMany(
        tx,
        dto.items.map((line) => ({
          id: generateId(),
          tenantId,
          returnId,
          orderItemId: line.orderItemId,
          productVariantId: orderItemsById.get(line.orderItemId)!.productVariantId,
          quantityReturned: String(line.quantity),
        })),
      );

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'sales_return.created',
        entityId: returnId,
        afterState: { orderId: order.id, locationId: dto.locationId, lineCount: dto.items.length },
        meta,
      });
      // Domain event — one per logical return: the Idempotency-Key short-circuit above returns the
      // cached response and never reaches here, so a retry emits nothing (§18/§104).
      await this.domainEventPublisher.append<SalesReturnRequestedData>(tx, {
        eventType: EVENT_TYPES.SALES_RETURN_REQUESTED,
        tenantId,
        aggregateType: 'sales_return',
        aggregateId: returnId,
        correlationId: meta.correlationId,
        actor: { type: 'user', id: actorId },
        data: {
          returnId,
          orderId: order.id,
          orderNumber: order.orderNumber,
          locationId: dto.locationId,
          reason: dto.reason,
          requestedByUserId: actorId,
          lines: dto.items.map((line) => {
            const orderItem = orderItemsById.get(line.orderItemId)!;
            return {
              orderItemId: line.orderItemId,
              productVariantId: orderItem.productVariantId,
              sku: orderItem.skuSnapshot,
              quantityReturned: line.quantity,
            };
          }),
        },
      });

      const response = await this.toResponse(tx, tenantId, created);
      await this.idempotencyRepository.create(tx, {
        id: generateId(),
        tenantId,
        scope: CREATE_SCOPE,
        idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody: response,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
      return response;
    });
  }

  async inspect(
    tenantId: string,
    actorId: string,
    id: string,
    dto: InspectReturnDto,
    meta: AuditMeta,
  ): Promise<ReturnResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const ret = await this.returnsRepository.lockById(tx, tenantId, id);
      if (!ret) {
        throw new NotFoundException('Sales return not found.');
      }
      if (ret.status !== 'requested' && ret.status !== 'inspecting') {
        throw new ConflictException(`A "${ret.status}" return cannot be inspected.`);
      }

      const items = await this.returnItemsRepository.listByReturn(tx, tenantId, id);
      const itemsById = new Map(items.map((item) => [item.id, item]));
      const seen = new Set<string>();

      for (const line of dto.items) {
        if (seen.has(line.returnItemId)) {
          throw new BadRequestException(`Duplicate return item ${line.returnItemId} in the request.`);
        }
        seen.add(line.returnItemId);
        const item = itemsById.get(line.returnItemId);
        if (!item) {
          throw new NotFoundException(`Return item ${line.returnItemId} is not part of this return.`);
        }

        const dispositionLocation = await this.locationsRepository.findById(tx, tenantId, line.dispositionLocationId);
        if (!dispositionLocation) {
          throw new NotFoundException(`Disposition location ${line.dispositionLocationId} not found.`);
        }
        if (dispositionLocation.status !== 'active') {
          throw new ConflictException('The disposition location is not active.');
        }
        // ADR-0021: restock re-enters SELLABLE stock; every other disposition re-enters a
        // NON-sellable location (tracked, never counted as available anywhere).
        if (line.disposition === 'restock' && !dispositionLocation.isSellable) {
          throw new UnprocessableEntityException('A "restock" disposition requires a sellable location.');
        }
        if (line.disposition !== 'restock' && dispositionLocation.isSellable) {
          throw new UnprocessableEntityException(
            `A "${line.disposition}" disposition requires a non-sellable location (is_sellable = false).`,
          );
        }
        // The inspector must be authorized at the location they are routing stock to (§21).
        await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, line.dispositionLocationId);

        await this.returnItemsRepository.recordInspection(tx, tenantId, line.returnItemId, {
          disposition: line.disposition as Disposition,
          dispositionLocationId: line.dispositionLocationId,
          inspectedBy: actorId,
          notes: line.notes ?? null,
        });
      }

      const updated = await this.returnsRepository.updateStatus(tx, tenantId, id, {
        status: 'inspecting',
        ...(ret.receivedBy === null ? { receivedBy: actorId } : {}),
      });
      if (!updated) {
        throw new NotFoundException('Sales return not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'sales_return.inspected',
        entityId: id,
        afterState: {
          dispositions: dto.items.map((line) => ({ returnItemId: line.returnItemId, disposition: line.disposition })),
        },
        meta,
      });
      return this.toResponse(tx, tenantId, updated);
    });
  }

  async resolve(
    tenantId: string,
    actorId: string,
    id: string,
    meta: AuditMeta,
    idempotencyKey: string | undefined,
  ): Promise<ReturnResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required to resolve a sales return.');
    }
    const requestHash = hashRequest({ returnId: id });

    return withTenantTransaction(tenantId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${RESOLVE_SCOPE}:${tenantId}:${idempotencyKey}`}))`);
      const existingKey = await this.idempotencyRepository.find(tx, tenantId, RESOLVE_SCOPE, idempotencyKey);
      if (existingKey) {
        if (existingKey.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key was already used for a different request.');
        }
        return existingKey.responseBody as ReturnResponseDto;
      }

      // Lock the return row — concurrent resolve/processing on one return is serialized here
      // (§25 / test R11); a second attempt re-reads the terminal status below.
      const ret = await this.returnsRepository.lockById(tx, tenantId, id);
      if (!ret) {
        throw new NotFoundException('Sales return not found.');
      }
      if (ret.status === 'resolved') {
        return this.toResponse(tx, tenantId, ret);
      }
      if (ret.status !== 'inspecting') {
        throw new ConflictException(`A return must be "inspecting" to resolve (currently "${ret.status}").`);
      }

      const items = await this.returnItemsRepository.listByReturn(tx, tenantId, id);
      const uninspected = items.filter((item) => item.disposition === null || item.dispositionLocationId === null);
      if (uninspected.length > 0) {
        throw new UnprocessableEntityException('Every return line must be inspected before the return can be resolved.');
      }

      for (const item of items) {
        // Re-check location authorization at the moment the physical effect happens (§21, §37).
        await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, item.dispositionLocationId!);
        // A RETURN's unit cost is the cost the original SALE actually removed at (order_items'
        // frozen unit_cost_snapshot), for symmetry with the outflow it reverses — not a freshly
        // computed average, which may have drifted since the sale. Falls back to leaving unitCost
        // unset (the Kardex then estimates from the variant's current cost, flagged as such) only
        // for a legacy order line that predates unit_cost_snapshot being populated.
        const orderItem = await this.orderItemsRepository.findById(tx, tenantId, item.orderItemId);
        const unitCost = orderItem?.unitCostSnapshot !== null && orderItem?.unitCostSnapshot !== undefined ? Number(orderItem.unitCostSnapshot) : undefined;
        try {
          await this.stockLedgerService.applyMovement(tx, {
            tenantId,
            productVariantId: item.productVariantId,
            locationId: item.dispositionLocationId!,
            movementType: 'RETURN',
            quantity: Number(item.quantityReturned),
            reason: `Sales return ${id} (${item.disposition ?? ''})`,
            referenceType: 'sales_return_item',
            referenceId: item.id,
            actorType: 'user',
            actorId,
            ...(unitCost !== undefined ? { unitCost } : {}),
            // Deterministic ledger key — a RETURN movement for a given return line can only ever
            // happen once (§23 / test R10). The idempotency_keys short-circuit above and the
            // `inspecting` -> `resolved` transition already guarantee this; the key is the DB-level
            // backstop, matching the `transfer-dispatch:<id>` precedent.
            idempotencyKey: `sales-return:${item.id}`,
            correlationId: meta.correlationId,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new ConflictException(`Cannot re-enter stock for return line ${item.id}: ${error.message}`);
          }
          throw error;
        }
      }

      const updated = await this.returnsRepository.updateStatus(tx, tenantId, id, {
        status: 'resolved',
        ...(ret.receivedBy === null ? { receivedBy: actorId } : {}),
      });
      if (!updated) {
        throw new NotFoundException('Sales return not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'sales_return.resolved',
        entityId: id,
        afterState: {
          movements: items.map((item) => ({
            returnItemId: item.id,
            disposition: item.disposition,
            dispositionLocationId: item.dispositionLocationId,
            quantity: Number(item.quantityReturned),
          })),
        },
        meta,
      });
      // Domain event — one RETURN movement per line was committed in this transaction (§18/§105).
      // Only the real inspecting -> resolved path reaches here; the idempotency short-circuit and
      // the already-`resolved` early return emit nothing (§35/§107). If any line's ledger write
      // throws, the whole transaction (movements + status + this event) rolls back (§106).
      await this.domainEventPublisher.append<SalesReturnResolvedData>(tx, {
        eventType: EVENT_TYPES.SALES_RETURN_RESOLVED,
        tenantId,
        aggregateType: 'sales_return',
        aggregateId: id,
        correlationId: meta.correlationId,
        actor: { type: 'user', id: actorId },
        data: {
          returnId: id,
          orderId: ret.orderId,
          locationId: ret.locationId,
          lines: items.map((item) => ({
            orderItemId: item.orderItemId,
            productVariantId: item.productVariantId,
            quantityReturned: Number(item.quantityReturned),
            disposition: item.disposition,
            dispositionLocationId: item.dispositionLocationId,
          })),
        },
      });

      const response = await this.toResponse(tx, tenantId, updated);
      await this.idempotencyRepository.create(tx, {
        id: generateId(),
        tenantId,
        scope: RESOLVE_SCOPE,
        idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody: response,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
      return response;
    });
  }

  async cancel(tenantId: string, actorId: string, id: string, meta: AuditMeta): Promise<ReturnResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const ret = await this.returnsRepository.lockById(tx, tenantId, id);
      if (!ret) {
        throw new NotFoundException('Sales return not found.');
      }
      if (ret.status === 'cancelled') {
        return this.toResponse(tx, tenantId, ret);
      }
      if (ret.status === 'resolved') {
        throw new ConflictException('A resolved return cannot be cancelled — its inventory effect is already applied.');
      }

      const updated = await this.returnsRepository.updateStatus(tx, tenantId, id, { status: 'cancelled' });
      if (!updated) {
        throw new NotFoundException('Sales return not found.');
      }
      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'sales_return.cancelled', entityId: id, meta });
      // Domain event — only the real requested/inspecting -> cancelled transition reaches here; an
      // already-`cancelled` return returned early above (§35/§108).
      await this.domainEventPublisher.append<SalesReturnCancelledData>(tx, {
        eventType: EVENT_TYPES.SALES_RETURN_CANCELLED,
        tenantId,
        aggregateType: 'sales_return',
        aggregateId: id,
        correlationId: meta.correlationId,
        actor: { type: 'user', id: actorId },
        data: { returnId: id, orderId: ret.orderId, status: 'cancelled' },
      });
      return this.toResponse(tx, tenantId, updated);
    });
  }

  private async toResponse(tx: TenantTransaction, tenantId: string, row: SalesReturnRow): Promise<ReturnResponseDto> {
    const items = await this.returnItemsRepository.listByReturn(tx, tenantId, row.id);
    return {
      id: row.id,
      orderId: row.orderId,
      locationId: row.locationId,
      status: row.status,
      requestedBy: row.requestedBy,
      ...(row.receivedBy ? { receivedBy: row.receivedBy } : {}),
      reason: row.reason,
      items: items.map((item) => this.toItemResponse(item)),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItemResponse(item: SalesReturnItemRow): ReturnItemResponseDto {
    return {
      id: item.id,
      orderItemId: item.orderItemId,
      productVariantId: item.productVariantId,
      quantityReturned: Number(item.quantityReturned),
      ...(item.disposition ? { disposition: item.disposition } : {}),
      ...(item.dispositionLocationId ? { dispositionLocationId: item.dispositionLocationId } : {}),
      ...(item.inspectedBy ? { inspectedBy: item.inspectedBy } : {}),
      ...(item.inspectedAt ? { inspectedAt: item.inspectedAt.toISOString() } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    };
  }

  private async writeAudit(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      actorId: string;
      actionCode: string;
      entityId: string;
      afterState?: Record<string, unknown>;
      meta: AuditMeta;
    },
  ): Promise<void> {
    try {
      await this.auditLogService.record(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actionCode: input.actionCode,
        entityType: 'sales_return',
        entityId: input.entityId,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation.
    }
  }
}
