import { Module } from '@nestjs/common';
import { AuditLogService } from '../common/audit/audit-log.service';
import { InventoryModule } from '../inventory/inventory.module';
import { CartsController } from './carts/carts.controller';
import { CartsService } from './carts/carts.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { SalesPricingService } from './pricing/sales-pricing.service';
import { CartItemsRepository } from './repositories/cart-items.repository';
import { CartsRepository } from './repositories/carts.repository';
import { CustomersRepository } from './repositories/customers.repository';
import { OrderItemsRepository } from './repositories/order-items.repository';
import { OrdersRepository } from './repositories/orders.repository';
import { SalesCatalogLookupRepository } from './repositories/sales-catalog-lookup.repository';
import { SalesIdempotencyRepository } from './repositories/sales-idempotency.repository';

/**
 * modules.md#sales — the SALES bounded context: customers, carts/cart_items, orders/order_items,
 * negotiated+frozen pricing, the Factura/Nota de venta document type, and inventory
 * reservation/commit through INVENTORY's public services. Depends on CORE (tenant scoping via
 * CurrentTenant/withTenantTransaction, audit via AuditLogService) and INVENTORY
 * (StockLedgerService — the one stock-locking convoy; LocationAuthorizationService — ADR-0024;
 * LocationsRepository/InventoryBalancesRepository — location + available-stock reads), per
 * modules.md's `Sales --> Core`/`Sales --> Inventory` edges. SALES reads the shared
 * `product_variants`/`products` tables directly (SalesCatalogLookupRepository) rather than through
 * CatalogModule's permission-gated ProductsRepository — it must be able to *validate* a negotiated
 * price against `min_price` server-side even for a caller who cannot *see* it (§23, ADR-0028).
 *
 * Deliberately NOT built here (later phases): `price_approvals` / exceptional-discount workflow
 * (FASE 13), `sales_returns` (FASE 13), event-outbox writes/processing (FASE 14),
 * Telegram/n8n (FASE 15), any frontend (FASE 16/17).
 */
@Module({
  imports: [InventoryModule],
  controllers: [CustomersController, CartsController, OrdersController],
  providers: [
    CustomersService,
    CartsService,
    OrdersService,
    SalesPricingService,
    AuditLogService,
    CustomersRepository,
    CartsRepository,
    CartItemsRepository,
    OrdersRepository,
    OrderItemsRepository,
    SalesCatalogLookupRepository,
    SalesIdempotencyRepository,
  ],
})
export class SalesModule {}
