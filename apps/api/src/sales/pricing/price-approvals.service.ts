import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { DomainEventPublisher } from '../../common/events/domain-event-publisher.service';
import type { PriceApprovalRequestedData, PriceApprovalResolvedData } from '../../common/events/domain-event.contracts';
import { EVENT_TYPES } from '../../common/events/event-types';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { OrderItemsRepository } from '../repositories/order-items.repository';
import { OrdersRepository } from '../repositories/orders.repository';
import type { PriceApprovalRow } from '../repositories/price-approvals.repository';
import { PriceApprovalsRepository } from '../repositories/price-approvals.repository';
import type { AuditMeta } from '../sales-audit-meta';
import { moneyString, roundMoney } from '../sales-money';
import type { CreatePriceApprovalDto } from './dto/create-price-approval.dto';
import type { ListPriceApprovalsQueryDto } from './dto/list-price-approvals-query.dto';
import type { PriceApprovalResponseDto } from './dto/price-approval-response.dto';

interface UniqueViolation {
  code: string;
}
function hasUniqueViolationCode(error: unknown): error is UniqueViolation {
  return typeof error === 'object' && error !== null && 'code' in error && (error as UniqueViolation).code === '23505';
}
/** drizzle-orm's postgres-js driver wraps the real Postgres error on `.cause`, not the thrown
 * error itself (Prompt 05-B finding — see core/users/users.service.ts). */
function isUniqueViolation(error: unknown): boolean {
  return hasUniqueViolationCode(error) || (error instanceof Error && hasUniqueViolationCode(error.cause));
}

/**
 * Exceptional-discount approval workflow (FASE 13 Part B, ADR-0022 / database.md#pricing). The
 * approval is **order-first**: the below-`min_price` line already exists on a `pending` order with
 * `is_exceptional_discount = true`; this service files, approves, and rejects the `price_approvals`
 * row bound to that line. `OrdersService.confirm` consumes it (`assertExceptionalDiscountsApproved`).
 *
 * - request  (`POST /price-approvals`)          — `pricing.discount.request`. Locks the `orders`
 *                                                  row so a concurrent confirm / second request
 *                                                  for the same line serializes; the partial unique
 *                                                  index `(tenant_id, order_item_id) WHERE status =
 *                                                  'pending'` is the DB backstop.
 * - approve  (`POST /price-approvals/:id/approve`) — `pricing.discount.approve`. Conditional
 *                                                  `UPDATE ... WHERE status = 'pending'`; the
 *                                                  requester can never approve their own request
 *                                                  (§49 / test P7).
 * - reject   (`POST /price-approvals/:id/reject`)  — `pricing.discount.approve`. Same conditional
 *                                                  update; a rejected request can never authorize a
 *                                                  confirm (§65 / test P12).
 *
 * `min_price` in the response is gated on `pricing.floor.view` (ADR-0028, §45 / test P15).
 *
 * FASE 14: `request` / `approve` / `reject` each publish one domain event to `event_outbox` in the
 * same transaction (`DomainEventPublisher`) — `approve`/`reject` only when the `resolveIfPending`
 * CAS actually won. Still no Telegram / n8n (FASE 15).
 */
@Injectable()
export class PriceApprovalsService {
  constructor(
    private readonly priceApprovalsRepository: PriceApprovalsRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
    private readonly auditLogService: AuditLogService,
    private readonly domainEventPublisher: DomainEventPublisher,
  ) {}

  async list(
    tenantId: string,
    permissions: string[],
    query: ListPriceApprovalsQueryDto,
  ): Promise<PaginatedResult<PriceApprovalResponseDto>> {
    this.assertCanView(permissions);
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.priceApprovalsRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        orderId: query.orderId,
      });
      const data = await Promise.all(rows.map((row) => this.toResponse(tx, tenantId, row, permissions)));
      return {
        data,
        meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      };
    });
  }

  async getById(tenantId: string, permissions: string[], id: string): Promise<PriceApprovalResponseDto> {
    this.assertCanView(permissions);
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.priceApprovalsRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException('Price approval not found.');
      }
      return this.toResponse(tx, tenantId, row, permissions);
    });
  }

  async request(
    tenantId: string,
    actorId: string,
    permissions: string[],
    dto: CreatePriceApprovalDto,
    meta: AuditMeta,
  ): Promise<PriceApprovalResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const orderItem = await this.orderItemsRepository.findById(tx, tenantId, dto.orderItemId);
      if (!orderItem) {
        throw new NotFoundException('Order line not found.');
      }
      // Lock the parent order — a concurrent confirm (which also locks it first, §102) or a second
      // request for the same order serializes here.
      const order = await this.ordersRepository.lockById(tx, tenantId, orderItem.orderId);
      if (!order) {
        throw new NotFoundException('Order line not found.');
      }
      if (order.status !== 'pending') {
        throw new ConflictException(
          `An exceptional-discount request can only be filed while the order is "pending" (currently "${order.status}").`,
        );
      }
      if (!orderItem.isExceptionalDiscount) {
        throw new UnprocessableEntityException(
          "This order line's price is within the authorized range — no exceptional-discount approval is needed.",
        );
      }
      const requestedPrice = Number(orderItem.unitPriceSnapshot);
      if (dto.requestedPrice !== undefined && roundMoney(dto.requestedPrice) !== roundMoney(requestedPrice)) {
        throw new UnprocessableEntityException(
          "requestedPrice does not match the order line's negotiated price; the price cannot be changed via an approval request.",
        );
      }

      const alreadyPending = await this.priceApprovalsRepository.findPendingByOrderItem(tx, tenantId, orderItem.id);
      if (alreadyPending) {
        throw new ConflictException('An exceptional-discount request for this order line is already pending.');
      }

      const minPrice = Number(orderItem.minPriceSnapshot);
      const maxPrice = Number(orderItem.maxPriceSnapshot);
      const quantity = Number(orderItem.quantity);
      const discountAmount = roundMoney(Math.max(0, (maxPrice - requestedPrice) * quantity));

      let row: PriceApprovalRow;
      try {
        row = await this.priceApprovalsRepository.create(tx, {
          id: generateId(),
          tenantId,
          orderId: order.id,
          orderItemId: orderItem.id,
          requestedPrice: moneyString(requestedPrice),
          minPriceAtRequest: moneyString(minPrice),
          maxPriceAtRequest: moneyString(maxPrice),
          discountAmount: moneyString(discountAmount),
          reason: dto.reason,
          requestedBy: actorId,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('An exceptional-discount request for this order line is already pending.');
        }
        throw error;
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'price_approval.requested',
        entityId: row.id,
        afterState: { orderId: order.id, orderItemId: orderItem.id, requestedPrice: moneyString(requestedPrice), reason: dto.reason },
        meta,
      });
      // Domain event — a supervisor/administrator now has a request to act on (§17). One event per
      // logical request: a retry hits the `alreadyPending` / 23505 guard above and never reaches
      // here. `minPriceAtRequest` is NOT in the payload — ADR-0028 / §32 (the approver sees the
      // floor in-app with their own `pricing.floor.view`).
      await this.domainEventPublisher.append<PriceApprovalRequestedData>(tx, {
        eventType: EVENT_TYPES.PRICE_APPROVAL_REQUESTED,
        tenantId,
        aggregateType: 'price_approval',
        aggregateId: row.id,
        correlationId: meta.correlationId,
        actor: { type: 'user', id: actorId },
        data: {
          approvalId: row.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderItemId: orderItem.id,
          productVariantId: orderItem.productVariantId,
          sku: orderItem.skuSnapshot,
          productName: orderItem.productNameSnapshot,
          quantity,
          requestedPrice,
          maxPriceAtRequest: maxPrice,
          discountAmount,
          reason: dto.reason,
          requestedByUserId: actorId,
        },
      });
      return this.toResponse(tx, tenantId, row, permissions);
    });
  }

  async approve(
    tenantId: string,
    actorId: string,
    permissions: string[],
    id: string,
    meta: AuditMeta,
  ): Promise<PriceApprovalResponseDto> {
    return this.resolve(tenantId, actorId, permissions, id, 'approved', meta);
  }

  async reject(
    tenantId: string,
    actorId: string,
    permissions: string[],
    id: string,
    meta: AuditMeta,
  ): Promise<PriceApprovalResponseDto> {
    return this.resolve(tenantId, actorId, permissions, id, 'rejected', meta);
  }

  private async resolve(
    tenantId: string,
    actorId: string,
    permissions: string[],
    id: string,
    status: 'approved' | 'rejected',
    meta: AuditMeta,
  ): Promise<PriceApprovalResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const existing = await this.priceApprovalsRepository.lockById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException('Price approval not found.');
      }
      // Separation of duties (§49, §74 / test P7) — the requester can never resolve their own
      // request, regardless of holding pricing.discount.approve.
      if (existing.requestedBy === actorId) {
        throw new ForbiddenException('You cannot resolve your own exceptional-discount request.');
      }
      if (existing.status === status) {
        return this.toResponse(tx, tenantId, existing, permissions);
      }
      if (existing.status !== 'pending') {
        throw new ConflictException(`This request is already resolved (status "${existing.status}").`);
      }

      const updated = await this.priceApprovalsRepository.resolveIfPending(tx, tenantId, id, { status, approvedBy: actorId });
      if (!updated) {
        // Lost the race — re-read and reflect the terminal state.
        const current = await this.priceApprovalsRepository.findById(tx, tenantId, id);
        if (current && current.status === status) {
          return this.toResponse(tx, tenantId, current, permissions);
        }
        throw new ConflictException('This request was concurrently resolved.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: status === 'approved' ? 'price_approval.approved' : 'price_approval.rejected',
        entityId: id,
        beforeState: { status: 'pending' },
        afterState: { status, approvedBy: actorId },
        meta,
      });
      // Domain event — only when the conditional `WHERE status = 'pending'` CAS actually won
      // (`updated` is set): an `approve || reject` race resolves to exactly one of the two, and it
      // is that one winner that emits its single event (§38/§103). Idempotent re-resolution
      // returned early above and emits nothing.
      await this.domainEventPublisher.append<PriceApprovalResolvedData>(tx, {
        eventType: status === 'approved' ? EVENT_TYPES.PRICE_APPROVAL_APPROVED : EVENT_TYPES.PRICE_APPROVAL_REJECTED,
        tenantId,
        aggregateType: 'price_approval',
        aggregateId: id,
        correlationId: meta.correlationId,
        actor: { type: 'user', id: actorId },
        data: {
          approvalId: id,
          orderId: existing.orderId,
          orderItemId: existing.orderItemId,
          status,
          resolvedByUserId: actorId,
          requestedByUserId: existing.requestedBy,
        },
      });
      return this.toResponse(tx, tenantId, updated, permissions);
    });
  }

  private assertCanView(permissions: string[]): void {
    if (!permissions.includes('pricing.discount.request') && !permissions.includes('pricing.discount.approve')) {
      throw new ForbiddenException('Missing required permission.');
    }
  }

  private async toResponse(
    _tx: TenantTransaction,
    _tenantId: string,
    row: PriceApprovalRow,
    permissions: string[],
  ): Promise<PriceApprovalResponseDto> {
    const canViewFloor = permissions.includes('pricing.floor.view');
    return {
      id: row.id,
      orderId: row.orderId,
      orderItemId: row.orderItemId,
      requestedPrice: Number(row.requestedPrice),
      maxPriceAtRequest: Number(row.maxPriceAtRequest),
      ...(canViewFloor ? { minPriceAtRequest: Number(row.minPriceAtRequest) } : {}),
      discountAmount: Number(row.discountAmount),
      reason: row.reason,
      requestedBy: row.requestedBy,
      ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    };
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
        entityType: 'price_approval',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation.
    }
  }
}
