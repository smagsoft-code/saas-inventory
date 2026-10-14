import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { sql } from 'drizzle-orm';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { DomainEventPublisher } from '../../common/events/domain-event-publisher.service';
import type { OrderCancelledData, OrderConfirmedData } from '../../common/events/domain-event.contracts';
import { EVENT_TYPES } from '../../common/events/event-types';
import { localDayRangeToUtc } from '../../common/reporting/local-day-range';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { LocationsRepository } from '../../inventory/repositories/locations.repository';
import { InsufficientStockError, StockLedgerService } from '../../inventory/stock-ledger.service';
import { CartItemsRepository } from '../repositories/cart-items.repository';
import { CartsRepository } from '../repositories/carts.repository';
import type { CustomerRow } from '../repositories/customers.repository';
import { CustomersRepository } from '../repositories/customers.repository';
import type { CreateOrderItemValues, OrderItemRow } from '../repositories/order-items.repository';
import { OrderItemsRepository } from '../repositories/order-items.repository';
import type { OrderRow } from '../repositories/orders.repository';
import { OrderNotificationsRepository } from '../repositories/order-notifications.repository';
import type { CreateOrderPaymentValues } from '../repositories/order-payments.repository';
import { OrderPaymentsRepository } from '../repositories/order-payments.repository';
import { OrdersRepository } from '../repositories/orders.repository';
import { PriceApprovalsRepository } from '../repositories/price-approvals.repository';
import { SalesCatalogLookupRepository } from '../repositories/sales-catalog-lookup.repository';
import { SalesIdempotencyRepository } from '../repositories/sales-idempotency.repository';
import type { EffectivePricePolicy } from '../repositories/tenant-price-policies.repository';
import { TenantPricePoliciesRepository } from '../repositories/tenant-price-policies.repository';
import type { AuditMeta } from '../sales-audit-meta';
import { moneyString, roundMoney } from '../sales-money';
import { SalesPricingService } from '../pricing/sales-pricing.service';
import type { ConfirmOrderDto } from './dto/confirm-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import type { OrderNotificationsResponseDto } from './dto/order-notifications-response.dto';
import type { OrderItemResponseDto, OrderResponseDto } from './dto/order-response.dto';

const IDEMPOTENCY_SCOPE = 'orders.create';
const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;
/** Single-currency-per-tenant is assumed by the schema (`orders.currency`, database.md#orders);
 * no tenant currency setting exists yet. USD is the FASE 12 default — a documented assumption,
 * revisited if/when multi-currency or a tenant currency config is introduced. Exported so
 * `SalesReportService` (F18-02) echoes the same constant on `GET /reports/sales-summary` rather
 * than a second, potentially-drifting 'USD' literal. */
export const DEFAULT_CURRENCY = 'USD';

function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

interface ResolvedLine {
  variantId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  maxPrice: number;
  basePrice: number;
  minPrice: number;
  unitCost: string | null;
  discountAmount: number;
  lineTotal: number;
  /** `unit_price` is below the variant's `base_price` (owner policy change — previously
   * `min_price`) — an exceptional discount. The order line is created with
   * `is_exceptional_discount = true` and its order cannot be confirmed until a `price_approvals`
   * row for it is `approved` (when the tenant policy requires approval). */
  isExceptional: boolean;
}

/**
 * Orders / checkout (§36-§41, §144). The two-phase lifecycle for FASE 12:
 *
 *   POST /orders           cart -> order `pending`, writes a RESERVATION inventory movement per line
 *                          (reserved stock held, physical untouched). Idempotent via
 *                          `idempotency_keys` (`scope = 'orders.create'`), the mechanism
 *                          modules.md#order-flow and api.md#idempotency both name.
 *   POST /orders/:id/confirm   `pending` -> `confirmed`, RESERVATION_RELEASE + SALE per line — this
 *                          is the inventory COMMIT boundary (physical stock leaves).
 *   POST /orders/:id/cancel    `draft`/`pending` -> `cancelled`, RESERVATION_RELEASE per line. A
 *                          `confirmed` order cannot be cancelled — reversing a committed sale is a
 *                          sales return (FASE 13), never a cancellation (§54).
 *
 * SALES never writes `inventory_balances` directly (§42) — every stock effect goes through
 * `StockLedgerService.applyMovement`, INVENTORY's one locking convoy, which is what makes two
 * simultaneous sales of the last unit safe (§44).
 *
 * FASE 13 — exceptional pricing (order-first, per ADR-0022 / database.md#orders), trigger moved
 * by owner policy change from "below `min_price`" to **"below `base_price`"**: a line priced
 * anywhere under `base_price` (still subject to the tenant hard floor specifically at
 * `min_price` — `tenant_price_policies.max_discount_below_min_percent`, read via
 * `TenantPricePoliciesRepository` — when it actually goes that low) is no longer rejected at
 * checkout. It creates the order `pending` with `order_items.is_exceptional_discount = true`;
 * `POST /price-approvals` then files the `price_approvals` request against that line, and
 * `confirm` is gated (`assertExceptionalDiscountsApproved`) on every exceptional line having an
 * `approved` request — never a permission-based bypass (§59). Above `max_price` is still a 400.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
    private readonly cartsRepository: CartsRepository,
    private readonly cartItemsRepository: CartItemsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly catalogLookup: SalesCatalogLookupRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly stockLedgerService: StockLedgerService,
    private readonly pricingService: SalesPricingService,
    private readonly idempotencyRepository: SalesIdempotencyRepository,
    private readonly pricePoliciesRepository: TenantPricePoliciesRepository,
    private readonly priceApprovalsRepository: PriceApprovalsRepository,
    private readonly orderNotificationsRepository: OrderNotificationsRepository,
    private readonly orderPaymentsRepository: OrderPaymentsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly auditLogService: AuditLogService,
    private readonly domainEventPublisher: DomainEventPublisher,
  ) {}

  async list(tenantId: string, actorId: string, permissions: string[], query: ListOrdersQueryDto): Promise<PaginatedResult<OrderResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      if (query.dateTo && !query.dateFrom) {
        throw new BadRequestException('`dateTo` requires `dateFrom`.');
      }
      // Business-day filter (tenant timezone, whole final day included, half-open upper bound).
      let dayRange: { gte: Date; lt: Date } | undefined;
      if (query.dateFrom) {
        const settings = await this.tenantSettingsRepository.find(tx, tenantId);
        dayRange = localDayRangeToUtc(query.dateFrom, query.dateTo, settings?.timezone ?? DEFAULT_TIMEZONE);
      }
      // Same location scope as the writes (ADR-0024/0035): a restricted caller only sees orders of
      // their assigned locations, and asking for another one is a 403.
      const readScope = await this.locationAuthorizationService.resolveReadScope(tx, tenantId, actorId, query.locationId);
      const { rows, total } = await this.ordersRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        customerId: query.customerId,
        documentType: query.documentType,
        locationId: readScope.locationId,
        locationIds: readScope.locationIds,
        createdFrom: query.createdFrom,
        createdTo: query.createdTo,
        dayRange,
      });
      // Two batched lookups for the whole page — never one per row.
      const sellerIds = [...new Set(rows.map((row) => row.placedByUserId).filter((id): id is string => Boolean(id)))];
      const [sellerNames, notificationByOrder] = await Promise.all([
        this.usersRepository.findNamesByIds(tx, tenantId, sellerIds),
        this.orderNotificationsRepository.rollUpByOrders(tx, tenantId, rows.map((row) => row.id)),
      ]);
      const data = await Promise.all(
        rows.map(async (row) => {
          const response = await this.toResponse(tx, tenantId, row, permissions);
          const placedByName = row.placedByUserId ? sellerNames.get(row.placedByUserId) : undefined;
          return {
            ...response,
            ...(placedByName ? { placedByName } : {}),
            notificationStatus: notificationByOrder.get(row.id) ?? ('none' as const),
          };
        }),
      );
      return {
        data,
        meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      };
    });
  }

  async getById(tenantId: string, actorId: string, permissions: string[], id: string): Promise<OrderResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const order = await this.ordersRepository.findById(tx, tenantId, id);
      // 404, not 403, for an order outside the caller's locations - its existence is not revealed.
      if (!order || !(await this.locationAuthorizationService.canAccess(tx, tenantId, actorId, order.locationId))) {
        throw new NotFoundException('Order not found.');
      }
      return this.toResponse(tx, tenantId, order, permissions);
    });
  }

  /**
   * Delivery status of the order's domain-event notifications (`event_outbox`), F17-10 —
   * `GAP-NOTIF-STATUS`. Read-only: metadata only, never `payload`/`last_error`. 404 if the order is
   * not in the caller's tenant (same shape as `getById`). A deployment with outbound notifications
   * disabled legitimately reports every event `pending` — nothing claims the rows.
   */
  async getNotifications(tenantId: string, actorId: string, id: string): Promise<OrderNotificationsResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const order = await this.ordersRepository.findById(tx, tenantId, id);
      if (!order || !(await this.locationAuthorizationService.canAccess(tx, tenantId, actorId, order.locationId))) {
        throw new NotFoundException('Order not found.');
      }
      const rows = await this.orderNotificationsRepository.listByOrder(tx, tenantId, id);
      const events = rows.map((row) => ({
        eventId: row.id,
        eventType: row.eventType,
        status: row.status,
        attempts: row.attempts,
        occurredAt: row.createdAt.toISOString(),
        ...(row.processedAt ? { processedAt: row.processedAt.toISOString() } : {}),
      }));
      let overallStatus: 'none' | 'pending' | 'delivered' | 'failed';
      if (events.length === 0) {
        overallStatus = 'none';
      } else if (events.some((event) => event.status === 'dead_letter')) {
        overallStatus = 'failed';
      } else if (events.every((event) => event.status === 'delivered')) {
        overallStatus = 'delivered';
      } else {
        overallStatus = 'pending';
      }
      return { orderId: id, overallStatus, events };
    });
  }

  async checkout(
    tenantId: string,
    actorId: string,
    permissions: string[],
    dto: CreateOrderDto,
    meta: AuditMeta,
    idempotencyKey: string | undefined,
  ): Promise<OrderResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required to create an order.');
    }
    const requestHash = hashRequest({ cartId: dto.cartId, documentType: dto.documentType });

    return withTenantTransaction(tenantId, async (tx) => {
      // Serialize same-key requests before any work (§61) — the second concurrent request blocks
      // here until the first commits, then finds the cached result below. The
      // UNIQUE (tenant_id, scope, idempotency_key) constraint (migration 0011) is the backstop.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${IDEMPOTENCY_SCOPE}:${tenantId}:${idempotencyKey}`}))`);
      const existing = await this.idempotencyRepository.find(tx, tenantId, IDEMPOTENCY_SCOPE, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key was already used for a different request.');
        }
        return existing.responseBody as OrderResponseDto;
      }

      const cart = await this.cartsRepository.lockById(tx, tenantId, dto.cartId);
      if (!cart || cart.userId !== actorId) {
        throw new NotFoundException('Cart not found.');
      }
      if (cart.status !== 'open') {
        throw new ConflictException('This cart has already been checked out.');
      }

      const cartItems = await this.cartItemsRepository.listByCart(tx, tenantId, cart.id);
      if (cartItems.length === 0) {
        throw new BadRequestException('The cart is empty.');
      }
      if (!cart.customerId) {
        throw new BadRequestException('Set a customer on the cart before checkout (PATCH /cart).');
      }
      const customer = await this.customersRepository.findById(tx, tenantId, cart.customerId);
      if (!customer) {
        throw new NotFoundException('The cart customer no longer exists.');
      }
      this.assertCustomerCommercialData(customer);

      const location = await this.locationsRepository.findById(tx, tenantId, cart.locationId);
      if (!location) {
        throw new NotFoundException('The cart location no longer exists.');
      }
      if (location.status !== 'active' || !location.isSellable) {
        throw new ConflictException('The cart location can no longer be used for sales.');
      }
      await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, cart.locationId);

      const pricePolicy = await this.pricePoliciesRepository.getEffective(tx, tenantId);
      const lines = await this.resolveLines(tx, tenantId, cartItems, pricePolicy);

      const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
      const discountTotal = roundMoney(lines.reduce((sum, line) => sum + line.discountAmount, 0));
      const taxTotal = 0;
      const total = roundMoney(subtotal + taxTotal);

      const orderId = generateId();
      const orderNumber = await this.ordersRepository.nextOrderNumber(tx, tenantId);
      const invoiceStatus = dto.documentType === 'invoice' ? 'pending' : null;
      // customers.address is now a single free-form text line (migration 0037); the order's own
      // snapshot column keeps its original structured jsonb shape, so wrap it as line1.
      const address = customer.address ? { line1: customer.address } : null;

      const order = await this.ordersRepository.create(tx, {
        id: orderId,
        tenantId,
        locationId: cart.locationId,
        customerId: customer.id,
        customerNameSnapshot: customer.displayName,
        customerTaxIdSnapshot: customer.taxId,
        customerEmailSnapshot: customer.email,
        customerPhoneSnapshot: customer.phone,
        customerAddressSnapshot: address,
        orderNumber,
        documentType: dto.documentType,
        invoiceStatus,
        status: 'pending',
        subtotal: moneyString(subtotal),
        discountTotal: moneyString(discountTotal),
        taxTotal: moneyString(taxTotal),
        total: moneyString(total),
        currency: DEFAULT_CURRENCY,
        placedByUserId: actorId,
        correlationId: meta.correlationId ?? null,
      });

      const itemValues: CreateOrderItemValues[] = lines.map((line) => ({
        id: generateId(),
        tenantId,
        orderId,
        productVariantId: line.variantId,
        skuSnapshot: line.sku,
        productNameSnapshot: line.productName,
        maxPriceSnapshot: moneyString(line.maxPrice),
        basePriceSnapshot: moneyString(line.basePrice),
        minPriceSnapshot: moneyString(line.minPrice),
        unitPriceSnapshot: moneyString(line.unitPrice),
        unitCostSnapshot: line.unitCost,
        quantity: String(line.quantity),
        discountAmount: moneyString(line.discountAmount),
        isExceptionalDiscount: line.isExceptional,
        lineTotal: moneyString(line.lineTotal),
      }));
      await this.orderItemsRepository.createMany(tx, itemValues);

      // Reservation boundary — hold stock, physical untouched until confirm (§16, §53).
      for (const line of lines) {
        try {
          await this.stockLedgerService.applyMovement(tx, {
            tenantId,
            productVariantId: line.variantId,
            locationId: cart.locationId,
            movementType: 'RESERVATION',
            quantity: line.quantity,
            referenceType: 'order',
            referenceId: orderId,
            actorType: 'user',
            actorId,
            correlationId: meta.correlationId,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new ConflictException(`Insufficient stock for ${line.sku} at the selected location.`);
          }
          throw error;
        }
      }

      await this.cartsRepository.update(tx, tenantId, cart.id, { status: 'checked_out', orderId });

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'order.created',
        entityId: orderId,
        afterState: {
          orderNumber,
          documentType: dto.documentType,
          total: moneyString(total),
          lineCount: lines.length,
          exceptionalLineCount: lines.filter((line) => line.isExceptional).length,
        },
        meta,
      });

      const response = await this.toResponse(tx, tenantId, order, permissions);
      await this.idempotencyRepository.create(tx, {
        id: generateId(),
        tenantId,
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody: response,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
      return response;
    });
  }

  async confirm(
    tenantId: string,
    actorId: string,
    permissions: string[],
    id: string,
    dto: ConfirmOrderDto,
    meta: AuditMeta,
  ): Promise<OrderResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const order = await this.ordersRepository.lockById(tx, tenantId, id);
      if (!order) {
        throw new NotFoundException('Order not found.');
      }
      if (order.status === 'confirmed') {
        return this.toResponse(tx, tenantId, order, permissions);
      }
      if (order.status !== 'pending') {
        throw new ConflictException(`An order must be "pending" to confirm (currently "${order.status}").`);
      }

      await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, order.locationId);
      const items = await this.orderItemsRepository.listByOrder(tx, tenantId, id);

      await this.assertExceptionalDiscountsApproved(tx, tenantId, order.id, items);

      // Owner redesign: the payment method is picked here, at the actual commit boundary — not at
      // `POST /orders` — so the sum must match the order's own frozen total exactly (§39-style
      // invariant; no CHECK constraint can reach across `order_payments` rows).
      const paymentsTotal = roundMoney(dto.payments.reduce((sum, payment) => sum + payment.amount, 0));
      const orderTotal = Number(order.total);
      if (paymentsTotal !== orderTotal) {
        throw new BadRequestException(
          `The sum of payments (${paymentsTotal.toFixed(2)}) must equal the order total (${orderTotal.toFixed(2)}).`,
        );
      }
      const paymentValues: CreateOrderPaymentValues[] = dto.payments.map((payment) => ({
        id: generateId(),
        tenantId,
        orderId: id,
        paymentMethod: payment.paymentMethod,
        amount: moneyString(payment.amount),
      }));
      await this.orderPaymentsRepository.createMany(tx, paymentValues);

      for (const item of items) {
        const quantity = Number(item.quantity);
        await this.stockLedgerService.applyMovement(tx, {
          tenantId,
          productVariantId: item.productVariantId,
          locationId: order.locationId,
          movementType: 'RESERVATION_RELEASE',
          quantity,
          referenceType: 'order',
          referenceId: id,
          actorType: 'user',
          actorId,
          correlationId: meta.correlationId,
        });
        try {
          await this.stockLedgerService.applyMovement(tx, {
            tenantId,
            productVariantId: item.productVariantId,
            locationId: order.locationId,
            movementType: 'SALE',
            quantity,
            referenceType: 'order',
            referenceId: id,
            actorType: 'user',
            actorId,
            correlationId: meta.correlationId,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new ConflictException(`Insufficient stock to fulfil ${item.skuSnapshot}.`);
          }
          throw error;
        }
      }

      const updated = await this.ordersRepository.updateStatus(tx, tenantId, id, { status: 'confirmed' });
      if (!updated) {
        throw new NotFoundException('Order not found.');
      }

      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'order.confirmed', entityId: id, meta });
      // Domain event — the physical sale is committed (§16). Written in THIS transaction, so it
      // exists iff the confirmation does (§26/§97/§98). Only the real pending -> confirmed path
      // reaches here; an idempotent retry returned early above and emits nothing (§16/§35/§99).
      await this.domainEventPublisher.append<OrderConfirmedData>(tx, {
        eventType: EVENT_TYPES.ORDER_CONFIRMED,
        tenantId,
        aggregateType: 'order',
        aggregateId: id,
        correlationId: meta.correlationId,
        actor: { type: 'user', id: actorId },
        data: this.buildOrderConfirmedData(updated, items),
      });
      return this.toResponse(tx, tenantId, updated, permissions);
    });
  }

  async cancel(tenantId: string, actorId: string, permissions: string[], id: string, meta: AuditMeta): Promise<OrderResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const order = await this.ordersRepository.lockById(tx, tenantId, id);
      if (!order) {
        throw new NotFoundException('Order not found.');
      }
      if (order.status === 'cancelled') {
        return this.toResponse(tx, tenantId, order, permissions);
      }
      if (order.status === 'confirmed' || order.status === 'fulfilled') {
        throw new ConflictException('A confirmed order cannot be cancelled — reversing a committed sale is a sales return (FASE 13).');
      }
      if (order.status !== 'draft' && order.status !== 'pending') {
        throw new ConflictException(`An order cannot be cancelled from status "${order.status}".`);
      }

      if (order.status === 'pending') {
        const items = await this.orderItemsRepository.listByOrder(tx, tenantId, id);
        for (const item of items) {
          await this.stockLedgerService.applyMovement(tx, {
            tenantId,
            productVariantId: item.productVariantId,
            locationId: order.locationId,
            movementType: 'RESERVATION_RELEASE',
            quantity: Number(item.quantity),
            referenceType: 'order',
            referenceId: id,
            actorType: 'user',
            actorId,
            correlationId: meta.correlationId,
          });
        }
      }

      // A pending exceptional-discount request has nothing left to authorize once the order is
      // cancelled — mark it `cancelled` in the same transaction (uses the `price_approvals`
      // `cancelled` status, database.md#soft-delete-policy "Status, not delete").
      await this.priceApprovalsRepository.cancelPendingByOrder(tx, tenantId, id);

      const updated = await this.ordersRepository.updateStatus(tx, tenantId, id, { status: 'cancelled' });
      if (!updated) {
        throw new NotFoundException('Order not found.');
      }

      await this.writeAudit(tx, { tenantId, actorId, actionCode: 'order.cancelled', entityId: id, meta });
      // Domain event — a still-pending reservation was released (§15). Only the real transition
      // reaches here; an already-cancelled order returned early above and emits nothing (§35/§100).
      await this.domainEventPublisher.append<OrderCancelledData>(tx, {
        eventType: EVENT_TYPES.ORDER_CANCELLED,
        tenantId,
        aggregateType: 'order',
        aggregateId: id,
        correlationId: meta.correlationId,
        actor: { type: 'user', id: actorId },
        data: { orderId: id, orderNumber: order.orderNumber, documentType: order.documentType },
      });
      return this.toResponse(tx, tenantId, updated, permissions);
    });
  }

  private buildOrderConfirmedData(order: OrderRow, items: OrderItemRow[]): OrderConfirmedData {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      documentType: order.documentType,
      invoiceStatus: order.invoiceStatus,
      currency: order.currency,
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      total: Number(order.total),
      locationId: order.locationId,
      placedByUserId: order.placedByUserId,
      hasExceptionalDiscount: items.some((item) => item.isExceptionalDiscount),
      customer: {
        name: order.customerNameSnapshot,
        taxId: order.customerTaxIdSnapshot,
        email: order.customerEmailSnapshot,
        phone: order.customerPhoneSnapshot,
        address: (order.customerAddressSnapshot ?? null) as Record<string, unknown> | null,
      },
      // Data minimisation (ADR-0028, §32): no min/base/cost/max snapshots, only what a notification
      // consumer needs.
      lines: items.map((item) => ({
        productVariantId: item.productVariantId,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPriceSnapshot),
        discountAmount: Number(item.discountAmount),
        lineTotal: Number(item.lineTotal),
      })),
    };
  }

  /**
   * PROMPT 012-A: the commercial customer data a sale must freeze (§6, and FASE 12's own §34:
   * "nombre, identificación, correo, teléfono, dirección") is required for **both** document types,
   * not just `invoice`. `invoice` vs `sales_note` differ only by `document_type` / `invoice_status`
   * (§9), never by how complete the buyer's record must be. `display_name` is always present
   * (NOT NULL + DTO min length), so it is not re-checked here. No inventory / order / order_items /
   * idempotency-success side effect happens before this — it runs before `resolveLines` and every
   * write (§10).
   */
  private assertCustomerCommercialData(customer: CustomerRow): void {
    const missing: string[] = [];
    if (!customer.taxId) missing.push('taxId');
    if (!customer.email) missing.push('email');
    if (!customer.phone) missing.push('phone');
    if (!customer.address) missing.push('address');
    if (missing.length > 0) {
      throw new UnprocessableEntityException(`Customer is missing data required to create a sales order: ${missing.join(', ')}.`);
    }
  }

  /**
   * FASE 13 confirmation gate (database.md#orders "Prompt 02-A: confirmation is gated on price
   * approvals" + ADR-0022): an order with a below-`base_price` line
   * (`order_items.is_exceptional_discount = true`) cannot move `pending` → `confirmed` unless every
   * such line has an `approved` `price_approvals` row and none is still `pending` — when the tenant
   * policy requires approval (the default). Runs inside the transaction that already holds the
   * `orders` row lock (`lockById` at the top of `confirm`); `lockByOrder` additionally row-locks the
   * `price_approvals` rows so a concurrent approve/reject serializes against this check (§102 lock
   * order: orders → price_approvals → inventory_balances). No bypass for a Supervisor caller — the
   * `pricing.discount.approve` permission authorizes *resolving* a request, never skipping the
   * record (§59).
   */
  private async assertExceptionalDiscountsApproved(
    tx: TenantTransaction,
    tenantId: string,
    orderId: string,
    items: OrderItemRow[],
  ): Promise<void> {
    const exceptionalItemIds = items.filter((item) => item.isExceptionalDiscount).map((item) => item.id);
    if (exceptionalItemIds.length === 0) {
      return;
    }
    const policy = await this.pricePoliciesRepository.getEffective(tx, tenantId);
    if (!policy.exceptionalDiscountRequiresApproval) {
      return;
    }
    const approvals = await this.priceApprovalsRepository.lockByOrder(tx, tenantId, orderId);
    for (const itemId of exceptionalItemIds) {
      const forItem = approvals.filter((approval) => approval.orderItemId === itemId);
      if (forItem.some((approval) => approval.status === 'pending')) {
        throw new ConflictException(
          'This order has an exceptional-discount request still awaiting approval — it cannot be confirmed yet.',
        );
      }
      const item = items.find((candidate) => candidate.id === itemId);
      const approved = forItem.find(
        (approval) =>
          approval.status === 'approved' &&
          item !== undefined &&
          Number(approval.requestedPrice) === Number(item.unitPriceSnapshot),
      );
      if (!approved) {
        throw new ConflictException(
          'This order has a below-base-price line with no approved exceptional-discount request — request approval (POST /price-approvals) or cancel the order.',
        );
      }
    }
  }

  private async resolveLines(
    tx: TenantTransaction,
    tenantId: string,
    cartItems: { productVariantId: string; quantity: string; negotiatedUnitPrice: string | null }[],
    pricePolicy: EffectivePricePolicy,
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const cartItem of cartItems) {
      const variant = await this.catalogLookup.findVariantById(tx, tenantId, cartItem.productVariantId);
      if (!variant) {
        throw new NotFoundException(`Product variant ${cartItem.productVariantId} no longer exists.`);
      }
      if (variant.status !== 'active') {
        throw new ConflictException(`Product variant ${variant.sku} is no longer sellable.`);
      }
      if (variant.isSerialized || variant.isLotTracked) {
        throw new UnprocessableEntityException(
          `Product variant ${variant.sku} is serialized or lot-tracked; selling those is not supported yet (deferred to a later phase).`,
        );
      }
      const maxPrice = Number(variant.maxPrice);
      const basePrice = Number(variant.basePrice);
      const minPrice = Number(variant.minPrice);
      const negotiated = cartItem.negotiatedUnitPrice === null ? undefined : Number(cartItem.negotiatedUnitPrice);
      // Owner policy change: a below-`base_price` line (not just below-`min_price`) is no longer
      // rejected here — it is classified as an exceptional discount. The tenant's hard floor still
      // rejects a price too far below `min_price` specifically outright (it could never be
      // authorized by an approval). Above `max_price` is still a 400.
      const { unitPrice, classification } = this.pricingService.resolveUnitPrice(
        negotiated,
        { maxPrice, basePrice, minPrice },
        variant.sku,
      );
      const isExceptional = classification === 'below_base';
      if (isExceptional) {
        this.pricingService.assertWithinHardFloor(unitPrice, minPrice, pricePolicy.maxDiscountBelowMinPercent, variant.sku);
      }
      const quantity = Number(cartItem.quantity);
      const lineTotal = roundMoney(unitPrice * quantity);
      const discountAmount = roundMoney(Math.max(0, (maxPrice - unitPrice) * quantity));
      lines.push({
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.productName,
        quantity,
        unitPrice,
        maxPrice,
        basePrice,
        minPrice,
        unitCost: variant.cost,
        discountAmount,
        lineTotal,
        isExceptional,
      });
    }
    return lines;
  }

  private async toResponse(tx: TenantTransaction, tenantId: string, order: OrderRow, permissions: string[]): Promise<OrderResponseDto> {
    const canViewFloor = permissions.includes('pricing.floor.view');
    const items = await this.orderItemsRepository.listByOrder(tx, tenantId, order.id);
    const payments = await this.orderPaymentsRepository.listByOrder(tx, tenantId, order.id);
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      documentType: order.documentType,
      ...(order.invoiceStatus ? { invoiceStatus: order.invoiceStatus } : {}),
      locationId: order.locationId,
      ...(order.customerId ? { customerId: order.customerId } : {}),
      customer: {
        name: order.customerNameSnapshot,
        ...(order.customerTaxIdSnapshot ? { taxId: order.customerTaxIdSnapshot } : {}),
        ...(order.customerEmailSnapshot ? { email: order.customerEmailSnapshot } : {}),
        ...(order.customerPhoneSnapshot ? { phone: order.customerPhoneSnapshot } : {}),
        ...(order.customerAddressSnapshot ? { address: order.customerAddressSnapshot as Record<string, unknown> } : {}),
      },
      items: items.map((item) => this.toItemResponse(item, canViewFloor)),
      payments: payments.map((payment) => ({ paymentMethod: payment.paymentMethod, amount: Number(payment.amount) })),
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      total: Number(order.total),
      currency: order.currency,
      ...(order.placedByUserId ? { placedByUserId: order.placedByUserId } : {}),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private toItemResponse(item: OrderItemRow, canViewFloor: boolean): OrderItemResponseDto {
    return {
      id: item.id,
      productVariantId: item.productVariantId,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPriceSnapshot),
      maxPrice: Number(item.maxPriceSnapshot),
      basePrice: Number(item.basePriceSnapshot),
      ...(canViewFloor ? { minPrice: Number(item.minPriceSnapshot) } : {}),
      discountAmount: Number(item.discountAmount),
      isExceptionalDiscount: item.isExceptionalDiscount,
      lineTotal: Number(item.lineTotal),
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
        entityType: 'order',
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
