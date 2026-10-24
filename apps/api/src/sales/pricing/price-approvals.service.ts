import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { localDayRangeToUtc } from '../../common/reporting/local-day-range';
import { DomainEventPublisher } from '../../common/events/domain-event-publisher.service';
import type { PriceApprovalRequestedData, PriceApprovalResolvedData } from '../../common/events/domain-event.contracts';
import { EVENT_TYPES } from '../../common/events/event-types';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { OrderItemRow } from '../repositories/order-items.repository';
import { OrderItemsRepository } from '../repositories/order-items.repository';
import { OrdersRepository } from '../repositories/orders.repository';
import type { PriceApprovalRow } from '../repositories/price-approvals.repository';
import { PriceApprovalsRepository } from '../repositories/price-approvals.repository';
import type { EffectivePricePolicy } from '../repositories/tenant-price-policies.repository';
import { TenantPricePoliciesRepository } from '../repositories/tenant-price-policies.repository';
import type { AuditMeta } from '../sales-audit-meta';
import { moneyString, roundMoney } from '../sales-money';
import { SalesPricingService } from './sales-pricing.service';
import type { CreatePriceApprovalDto } from './dto/create-price-approval.dto';
import type { ListPriceApprovalsQueryDto } from './dto/list-price-approvals-query.dto';
import type { PriceApprovalResponseDto } from './dto/price-approval-response.dto';

/** The arithmetic result of editing a line's price — computed up front (no I/O), so a caller can
 * validate and compute everything before deciding whether/when to actually write it. */
interface PriceEditPlan {
  unitPrice: number;
  lineTotal: number;
  discountAmount: number;
  isExceptional: boolean;
}

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
 * approval is **order-first**: the below-`base_price` line already exists on a `pending` order with
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
    private readonly usersRepository: UsersRepository,
    private readonly pricePoliciesRepository: TenantPricePoliciesRepository,
    private readonly pricingService: SalesPricingService,
    private readonly auditLogService: AuditLogService,
    private readonly domainEventPublisher: DomainEventPublisher,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
  ) {}

  async list(
    tenantId: string,
    actorId: string,
    permissions: string[],
    query: ListPriceApprovalsQueryDto,
  ): Promise<PaginatedResult<PriceApprovalResponseDto>> {
    this.assertCanView(permissions);
    return withTenantTransaction(tenantId, async (tx) => {
      if (query.dateTo && !query.dateFrom) {
        throw new BadRequestException('`dateTo` requires `dateFrom`.');
      }
      // Business-day filter on requested_at (tenant timezone, whole final day, half-open upper bound).
      let dayRange: { gte: Date; lt: Date } | undefined;
      if (query.dateFrom) {
        const settings = await this.tenantSettingsRepository.find(tx, tenantId);
        dayRange = localDayRangeToUtc(query.dateFrom, query.dateTo, settings?.timezone ?? DEFAULT_TIMEZONE);
      }
      // Same location scope as the writes (ADR-0024/0035), through the parent order's location.
      const readScope = await this.locationAuthorizationService.resolveReadScope(tx, tenantId, actorId, query.locationId);
      const { rows, total } = await this.priceApprovalsRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        orderId: query.orderId,
        locationId: readScope.locationId,
        locationIds: readScope.locationIds,
        dayRange,
      });
      // One batched lookup for the product labels of the whole page.
      const labels = await this.orderItemsRepository.findLabelsByIds(tx, tenantId, [...new Set(rows.map((row) => row.orderItemId))]);
      const data = await Promise.all(rows.map((row) => this.toResponse(tx, tenantId, row, permissions, labels)));
      return {
        data,
        meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      };
    });
  }

  async getById(tenantId: string, actorId: string, permissions: string[], id: string): Promise<PriceApprovalResponseDto> {
    this.assertCanView(permissions);
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.priceApprovalsRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException('Price approval not found.');
      }
      // 404, not 403, for a request whose order sits outside the caller's locations.
      const order = await this.ordersRepository.findById(tx, tenantId, row.orderId);
      if (order && !(await this.locationAuthorizationService.canAccess(tx, tenantId, actorId, order.locationId))) {
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
      let orderItem = await this.orderItemsRepository.findById(tx, tenantId, dto.orderItemId);
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

      // Owner redesign: resubmitting after a rejection may propose a different price for the line
      // before filing this new request. Applied before the exceptional-discount check below so a
      // vendor raising the price to (or above) base_price correctly lands on "no approval needed"
      // rather than filing a request against a price that's no longer exceptional.
      if (dto.newPrice !== undefined && roundMoney(dto.newPrice) !== Number(orderItem.unitPriceSnapshot)) {
        const pricePolicy = await this.pricePoliciesRepository.getEffective(tx, tenantId);
        const plan = this.computePriceEdit(orderItem, dto.newPrice, pricePolicy);
        orderItem = await this.applyPriceEdit(tx, tenantId, orderItem, plan);
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
      const basePrice = Number(orderItem.basePriceSnapshot);
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
          basePriceAtRequest: moneyString(basePrice),
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
    price?: number,
  ): Promise<PriceApprovalResponseDto> {
    return this.resolve(tenantId, actorId, permissions, id, 'approved', meta, price);
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
    price?: number,
  ): Promise<PriceApprovalResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const existing = await this.priceApprovalsRepository.lockById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException('Price approval not found.');
      }
      // Separation of duties (§49, §74 / test P7) — the requester cannot resolve their own request
      // just by holding pricing.discount.approve (a Supervisor). The tenant administrator (the
      // pricing-policy owner, `pricing.policy.manage`) is the one exception: owner decision, they
      // may both raise and approve a below-minimum price. Still audited like any resolution.
      if (existing.requestedBy === actorId && !permissions.includes('pricing.policy.manage')) {
        throw new ForbiddenException('You cannot resolve your own exceptional-discount request.');
      }
      if (existing.status === status) {
        return this.toResponse(tx, tenantId, existing, permissions);
      }
      if (existing.status !== 'pending') {
        throw new ConflictException(`This request is already resolved (status "${existing.status}").`);
      }

      // Owner redesign: an administrator approving this request may edit the price instead of
      // just accepting the amount the seller asked for — validated and COMPUTED here, before the
      // CAS below, but only actually WRITTEN to `order_items`/`orders` once that CAS has won (so a
      // lost race never leaves the line's price changed for an approval that didn't actually go
      // through).
      let plan: PriceEditPlan | undefined;
      let orderItem: OrderItemRow | undefined;
      if (status === 'approved' && price !== undefined) {
        orderItem = await this.orderItemsRepository.findById(tx, tenantId, existing.orderItemId);
        if (!orderItem) {
          throw new NotFoundException('Order line not found.');
        }
        if (roundMoney(price) !== Number(orderItem.unitPriceSnapshot)) {
          const pricePolicy = await this.pricePoliciesRepository.getEffective(tx, tenantId);
          plan = this.computePriceEdit(orderItem, price, pricePolicy);
        }
      }

      const updated = await this.priceApprovalsRepository.resolveIfPending(tx, tenantId, id, {
        status,
        approvedBy: actorId,
        ...(plan ? { requestedPrice: moneyString(plan.unitPrice), discountAmount: moneyString(plan.discountAmount) } : {}),
      });
      if (!updated) {
        // Lost the race — re-read and reflect the terminal state. The computed `plan` above is
        // simply discarded: nothing was ever written from it.
        const current = await this.priceApprovalsRepository.findById(tx, tenantId, id);
        if (current && current.status === status) {
          return this.toResponse(tx, tenantId, current, permissions);
        }
        throw new ConflictException('This request was concurrently resolved.');
      }

      if (plan && orderItem) {
        await this.applyPriceEdit(tx, tenantId, orderItem, plan);
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: status === 'approved' ? 'price_approval.approved' : 'price_approval.rejected',
        entityId: id,
        beforeState: { status: 'pending', requestedPrice: existing.requestedPrice },
        afterState: {
          status,
          approvedBy: actorId,
          ...(plan ? { editedPrice: moneyString(plan.unitPrice) } : {}),
        },
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

  /** Pure computation, no I/O — validated the same way `OrdersService.resolveLines` validates a
   * negotiated price at checkout (max price ceiling via `resolveUnitPrice`, tenant hard floor via
   * `assertWithinHardFloor`). Callers decide separately whether/when to actually persist the
   * result (see `applyPriceEdit` and the lost-race handling in `resolve`). */
  private computePriceEdit(orderItem: OrderItemRow, newPrice: number, pricePolicy: EffectivePricePolicy): PriceEditPlan {
    const maxPrice = Number(orderItem.maxPriceSnapshot);
    const basePrice = Number(orderItem.basePriceSnapshot);
    const minPrice = Number(orderItem.minPriceSnapshot);
    const { unitPrice, classification } = this.pricingService.resolveUnitPrice(
      newPrice,
      { maxPrice, basePrice, minPrice },
      orderItem.skuSnapshot,
    );
    const isExceptional = classification === 'below_base';
    if (isExceptional) {
      this.pricingService.assertWithinHardFloor(unitPrice, minPrice, pricePolicy.maxDiscountBelowMinPercent, orderItem.skuSnapshot);
    }
    const quantity = Number(orderItem.quantity);
    return {
      unitPrice,
      lineTotal: roundMoney(unitPrice * quantity),
      discountAmount: roundMoney(Math.max(0, (maxPrice - unitPrice) * quantity)),
      isExceptional,
    };
  }

  /** Writes a previously-computed price edit onto `order_items` and recomputes the parent order's
   * totals from every one of its lines — never just the edited one, since a multi-line order's
   * other lines are untouched but still need to be summed. Only ever called while the order is
   * `pending` (both call sites hold a lock that guarantees this — `request`'s own `orders` lock,
   * `resolve`'s `price_approvals` CAS which cannot win against anything but a `pending` order). */
  private async applyPriceEdit(
    tx: TenantTransaction,
    tenantId: string,
    orderItem: OrderItemRow,
    plan: PriceEditPlan,
  ): Promise<OrderItemRow> {
    const updated = await this.orderItemsRepository.updatePriceWhilePending(tx, tenantId, orderItem.id, {
      unitPriceSnapshot: moneyString(plan.unitPrice),
      lineTotal: moneyString(plan.lineTotal),
      discountAmount: moneyString(plan.discountAmount),
      isExceptionalDiscount: plan.isExceptional,
    });
    const allItems = await this.orderItemsRepository.listByOrder(tx, tenantId, orderItem.orderId);
    const subtotal = roundMoney(allItems.reduce((sum, item) => sum + Number(item.lineTotal), 0));
    const discountTotal = roundMoney(allItems.reduce((sum, item) => sum + Number(item.discountAmount), 0));
    await this.ordersRepository.updateTotals(tx, tenantId, orderItem.orderId, {
      subtotal: moneyString(subtotal),
      discountTotal: moneyString(discountTotal),
      // No tax engine in this phase (§31) — total is always exactly the subtotal.
      total: moneyString(subtotal),
    });
    return updated;
  }

  private assertCanView(permissions: string[]): void {
    if (!permissions.includes('pricing.discount.request') && !permissions.includes('pricing.discount.approve')) {
      throw new ForbiddenException('Missing required permission.');
    }
  }

  /** Resolves the parent order's number and the requester/approver's display names server-side —
   * a list/detail response never makes the caller show a raw id on screen. Best-effort: a missing
   * order/user (never expected — `ON DELETE RESTRICT` everywhere these point) falls back to a
   * placeholder rather than failing the whole response. */
  private async toResponse(
    tx: TenantTransaction,
    tenantId: string,
    row: PriceApprovalRow,
    permissions: string[],
    prefetchedLabels?: Map<string, { sku: string; productName: string }>,
  ): Promise<PriceApprovalResponseDto> {
    const canViewFloor = permissions.includes('pricing.floor.view');
    const labels = prefetchedLabels ?? (await this.orderItemsRepository.findLabelsByIds(tx, tenantId, [row.orderItemId]));
    const label = labels.get(row.orderItemId);
    const [order, requester, approver] = await Promise.all([
      this.ordersRepository.findById(tx, tenantId, row.orderId),
      this.usersRepository.findById(tx, tenantId, row.requestedBy),
      row.approvedBy ? this.usersRepository.findById(tx, tenantId, row.approvedBy) : Promise.resolve(undefined),
    ]);
    return {
      id: row.id,
      orderId: row.orderId,
      orderNumber: order?.orderNumber ?? row.orderId,
      orderItemId: row.orderItemId,
      locationId: order?.locationId ?? '',
      ...(label ? { productName: label.productName, sku: label.sku } : {}),
      requestedPrice: Number(row.requestedPrice),
      maxPriceAtRequest: Number(row.maxPriceAtRequest),
      basePriceAtRequest: Number(row.basePriceAtRequest),
      ...(canViewFloor ? { minPriceAtRequest: Number(row.minPriceAtRequest) } : {}),
      discountAmount: Number(row.discountAmount),
      reason: row.reason,
      requestedBy: row.requestedBy,
      requestedByName: requester?.fullName ?? row.requestedBy,
      ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
      ...(row.approvedBy ? { approvedByName: approver?.fullName ?? row.approvedBy } : {}),
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
