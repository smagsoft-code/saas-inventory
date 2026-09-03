import { Module } from '@nestjs/common';
import { AuditLogService } from '../common/audit/audit-log.service';
import { DomainEventPublisher } from '../common/events/domain-event-publisher.service';
import { OutboxRepository } from '../common/events/outbox.repository';
import { InventoryModule } from '../inventory/inventory.module';
import { CartsController } from './carts/carts.controller';
import { CartsService } from './carts/carts.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { PriceApprovalsController } from './pricing/price-approvals.controller';
import { PriceApprovalsService } from './pricing/price-approvals.service';
import { SalesPricingService } from './pricing/sales-pricing.service';
import { CartItemsRepository } from './repositories/cart-items.repository';
import { CartsRepository } from './repositories/carts.repository';
import { CustomersRepository } from './repositories/customers.repository';
import { OrderItemsRepository } from './repositories/order-items.repository';
import { OrderNotificationsRepository } from './repositories/order-notifications.repository';
import { OrdersRepository } from './repositories/orders.repository';
import { PriceApprovalsRepository } from './repositories/price-approvals.repository';
import { SalesCatalogLookupRepository } from './repositories/sales-catalog-lookup.repository';
import { SalesIdempotencyRepository } from './repositories/sales-idempotency.repository';
import { SalesReturnItemsRepository } from './repositories/sales-return-items.repository';
import { SalesReturnsRepository } from './repositories/sales-returns.repository';
import { TenantPricePoliciesRepository } from './repositories/tenant-price-policies.repository';
import { ReturnsController } from './returns/returns.controller';
import { ReturnsService } from './returns/returns.service';

/**
 * modules.md#sales — the SALES bounded context: customers, carts/cart_items, orders/order_items,
 * negotiated+frozen pricing, the Factura/Nota de venta document type, and inventory
 * reservation/commit through INVENTORY's public services. Depends on CORE (tenant scoping via
 * CurrentTenant/withTenantTransaction, audit via AuditLogService) and INVENTORY
 * (StockLedgerService — the one stock-locking convoy; LocationAuthorizationService — ADR-0024;
 * LocationsRepository/InventoryBalancesRepository).
 *
 * FASE 13 adds the two SALES-dependent workflows the schema has carried since Prompt 03:
 *  - exceptional-discount approvals (`price_approvals`, `pricing/price-approvals.*`) — order-first,
 *    gated at `OrdersService.confirm`; reads `tenant_price_policies` (read-only, defaults) for the
 *    hard discount floor.
 *  - sales returns / disposition (`sales_returns`/`sales_return_items`, `returns/*`) — a reversal
 *    traced to the original sale, with inventory re-entry through `StockLedgerService` only.
 *
 * FASE 14 adds transactional domain-event publishing: `OrdersService`/`PriceApprovalsService`/
 * `ReturnsService` call `DomainEventPublisher.append(tx, ...)` inside their existing
 * `withTenantTransaction` on every real state transition, so the `event_outbox` row and the
 * business mutation commit atomically. The Event Processor delivers them later — SALES has no
 * knowledge of n8n/Telegram (still FASE 15), no frontend (FASE 16/17); selling serialized/
 * lot-tracked variants stays deferred (no approved `order_items` ↔ `product_serials`/`product_lots`
 * model — gap kept explicit).
 */
@Module({
  imports: [InventoryModule],
  controllers: [CustomersController, CartsController, OrdersController, PriceApprovalsController, ReturnsController],
  providers: [
    CustomersService,
    CartsService,
    OrdersService,
    PriceApprovalsService,
    ReturnsService,
    SalesPricingService,
    AuditLogService,
    // NOTIFICATIONS owns event_outbox (§154); SALES gets the shared write API the same way it gets
    // AuditLogService — a provider, not a module import, so there is no SALES -> NOTIFICATIONS
    // dependency (§24). The Event Processor (apps/api/src/event-processor/) reads these rows back.
    DomainEventPublisher,
    OutboxRepository,
    CustomersRepository,
    CartsRepository,
    CartItemsRepository,
    OrdersRepository,
    OrderItemsRepository,
    OrderNotificationsRepository,
    PriceApprovalsRepository,
    SalesReturnsRepository,
    SalesReturnItemsRepository,
    TenantPricePoliciesRepository,
    SalesCatalogLookupRepository,
    SalesIdempotencyRepository,
  ],
})
export class SalesModule {}
