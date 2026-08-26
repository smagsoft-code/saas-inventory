import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { InventoryBalancesRepository } from '../../inventory/repositories/inventory-balances.repository';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { LocationsRepository } from '../../inventory/repositories/locations.repository';
import type { CartItemRow } from '../repositories/cart-items.repository';
import { CartItemsRepository } from '../repositories/cart-items.repository';
import type { CartRow } from '../repositories/carts.repository';
import { CartsRepository } from '../repositories/carts.repository';
import { CustomersRepository } from '../repositories/customers.repository';
import type { SalesVariantRow } from '../repositories/sales-catalog-lookup.repository';
import { SalesCatalogLookupRepository } from '../repositories/sales-catalog-lookup.repository';
import type { AuditMeta } from '../sales-audit-meta';
import { roundMoney } from '../sales-money';
import { SalesPricingService } from '../pricing/sales-pricing.service';
import type { AddCartItemDto } from './dto/add-cart-item.dto';
import type { CartResponseDto } from './dto/cart-response.dto';
import type { CreateCartDto } from './dto/create-cart.dto';
import type { UpdateCartDto } from './dto/update-cart.dto';
import type { UpdateCartItemDto } from './dto/update-cart-item.dto';

/**
 * The sales cart — a mutable pre-checkout working area (database.md#cart, §15). Owned by the vendor
 * operating it (`carts.user_id`): every operation is scoped to `(tenant, actorId)`, and the
 * caller only ever sees / mutates their own open cart. No inventory is reserved by cart edits (§16,
 * database.md#cart's explicit design) — availability is a live read shown for guidance; the
 * authoritative check happens under lock at checkout (OrdersService). The cart is not idempotency-
 * key protected (§62) — its mutations are reversible and carry no irreversible side effect.
 */
@Injectable()
export class CartsService {
  constructor(
    private readonly cartsRepository: CartsRepository,
    private readonly cartItemsRepository: CartItemsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly catalogLookup: SalesCatalogLookupRepository,
    private readonly balancesRepository: InventoryBalancesRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly pricingService: SalesPricingService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getActive(tenantId: string, userId: string, permissions: string[]): Promise<CartResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const cart = await this.cartsRepository.findOpenByUser(tx, tenantId, userId);
      if (!cart) {
        throw new NotFoundException('No active cart. Create one with POST /cart.');
      }
      return this.toResponse(tx, tenantId, cart, permissions);
    });
  }

  async createOrGetActive(
    tenantId: string,
    userId: string,
    permissions: string[],
    dto: CreateCartDto,
    meta: AuditMeta,
  ): Promise<CartResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      await this.cartsRepository.acquireUserCartLock(tx, tenantId, userId);
      const existing = await this.cartsRepository.findOpenByUser(tx, tenantId, userId);
      if (existing) {
        return this.toResponse(tx, tenantId, existing, permissions);
      }

      await this.assertLocationSellable(tx, tenantId, userId, dto.locationId);
      if (dto.customerId !== undefined) {
        await this.assertCustomerExists(tx, tenantId, dto.customerId);
      }

      const cart = await this.cartsRepository.create(tx, {
        id: generateId(),
        tenantId,
        locationId: dto.locationId,
        userId,
        customerId: dto.customerId ?? null,
      });

      await this.writeAudit(tx, {
        tenantId,
        actorId: userId,
        actionCode: 'cart.created',
        entityId: cart.id,
        afterState: { locationId: cart.locationId, customerId: cart.customerId },
        meta,
      });

      return this.toResponse(tx, tenantId, cart, permissions);
    });
  }

  async updateHeader(
    tenantId: string,
    userId: string,
    permissions: string[],
    dto: UpdateCartDto,
    meta: AuditMeta,
  ): Promise<CartResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const cart = await this.lockOpenCart(tx, tenantId, userId);

      if (dto.locationId !== undefined && dto.locationId !== cart.locationId) {
        await this.assertLocationSellable(tx, tenantId, userId, dto.locationId);
      }
      if (dto.customerId !== undefined) {
        await this.assertCustomerExists(tx, tenantId, dto.customerId);
      }

      const updated = await this.cartsRepository.update(tx, tenantId, cart.id, {
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
        ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
      });
      if (!updated) {
        throw new NotFoundException('Cart not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId: userId,
        actionCode: 'cart.updated',
        entityId: cart.id,
        afterState: { locationId: updated.locationId, customerId: updated.customerId },
        meta,
      });

      return this.toResponse(tx, tenantId, updated, permissions);
    });
  }

  async addItem(
    tenantId: string,
    userId: string,
    permissions: string[],
    dto: AddCartItemDto,
    meta: AuditMeta,
  ): Promise<CartResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const cart = await this.lockOpenCart(tx, tenantId, userId);
      const variant = await this.loadSellableVariant(tx, tenantId, dto.productVariantId);

      // Soft, early guidance-level price validation (§101) — the authoritative check re-runs under
      // lock at checkout (§20). A below-`min_price` line is now allowed to stage in the cart
      // (FASE 13: checkout turns it into an exceptional order + approval flow); only an
      // above-`max_price` price is rejected this early.
      if (dto.negotiatedUnitPrice !== undefined) {
        this.pricingService.assertNotAboveMax(
          dto.negotiatedUnitPrice,
          { maxPrice: Number(variant.maxPrice), basePrice: Number(variant.basePrice), minPrice: Number(variant.minPrice) },
          variant.sku,
        );
      }

      await this.cartItemsRepository.upsert(tx, {
        id: generateId(),
        tenantId,
        cartId: cart.id,
        productVariantId: dto.productVariantId,
        quantityDelta: dto.quantity,
        negotiatedUnitPrice: dto.negotiatedUnitPrice,
      });
      await this.cartsRepository.update(tx, tenantId, cart.id, {});

      await this.writeAudit(tx, {
        tenantId,
        actorId: userId,
        actionCode: 'cart.item_added',
        entityId: cart.id,
        afterState: { productVariantId: dto.productVariantId, quantity: dto.quantity },
        meta,
      });

      const refreshed = await this.cartsRepository.findById(tx, tenantId, cart.id);
      return this.toResponse(tx, tenantId, refreshed ?? cart, permissions);
    });
  }

  async updateItem(
    tenantId: string,
    userId: string,
    permissions: string[],
    itemId: string,
    dto: UpdateCartItemDto,
    meta: AuditMeta,
  ): Promise<CartResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const cart = await this.lockOpenCart(tx, tenantId, userId);
      const item = await this.cartItemsRepository.findById(tx, tenantId, itemId);
      if (!item || item.cartId !== cart.id) {
        throw new NotFoundException('Cart item not found.');
      }
      if (dto.quantity === undefined && dto.negotiatedUnitPrice === undefined) {
        throw new BadRequestException('Provide at least one of quantity or negotiatedUnitPrice.');
      }

      if (dto.negotiatedUnitPrice !== undefined && dto.negotiatedUnitPrice !== null) {
        const variant = await this.loadSellableVariant(tx, tenantId, item.productVariantId);
        this.pricingService.assertNotAboveMax(
          dto.negotiatedUnitPrice,
          { maxPrice: Number(variant.maxPrice), basePrice: Number(variant.basePrice), minPrice: Number(variant.minPrice) },
          variant.sku,
        );
      }

      const updated = await this.cartItemsRepository.update(tx, tenantId, itemId, {
        ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
        ...(dto.negotiatedUnitPrice !== undefined ? { negotiatedUnitPrice: dto.negotiatedUnitPrice } : {}),
      });
      if (!updated) {
        throw new NotFoundException('Cart item not found.');
      }
      await this.cartsRepository.update(tx, tenantId, cart.id, {});

      await this.writeAudit(tx, {
        tenantId,
        actorId: userId,
        actionCode: 'cart.item_updated',
        entityId: cart.id,
        afterState: { itemId, quantity: dto.quantity, negotiatedUnitPrice: dto.negotiatedUnitPrice },
        meta,
      });

      return this.toResponse(tx, tenantId, cart, permissions);
    });
  }

  async removeItem(tenantId: string, userId: string, permissions: string[], itemId: string, meta: AuditMeta): Promise<CartResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const cart = await this.lockOpenCart(tx, tenantId, userId);
      const item = await this.cartItemsRepository.findById(tx, tenantId, itemId);
      if (!item || item.cartId !== cart.id) {
        throw new NotFoundException('Cart item not found.');
      }
      await this.cartItemsRepository.delete(tx, tenantId, itemId);
      await this.cartsRepository.update(tx, tenantId, cart.id, {});

      await this.writeAudit(tx, {
        tenantId,
        actorId: userId,
        actionCode: 'cart.item_removed',
        entityId: cart.id,
        afterState: { itemId, productVariantId: item.productVariantId },
        meta,
      });

      return this.toResponse(tx, tenantId, cart, permissions);
    });
  }

  private async lockOpenCart(tx: TenantTransaction, tenantId: string, userId: string): Promise<CartRow> {
    const open = await this.cartsRepository.findOpenByUser(tx, tenantId, userId);
    if (!open) {
      throw new NotFoundException('No active cart. Create one with POST /cart.');
    }
    const locked = await this.cartsRepository.lockById(tx, tenantId, open.id);
    if (!locked || locked.status !== 'open') {
      throw new ConflictException('The cart is no longer open.');
    }
    return locked;
  }

  private async assertLocationSellable(tx: TenantTransaction, tenantId: string, userId: string, locationId: string): Promise<void> {
    const location = await this.locationsRepository.findById(tx, tenantId, locationId);
    if (!location) {
      throw new NotFoundException('Location not found.');
    }
    if (location.status !== 'active' || !location.isSellable) {
      throw new ConflictException('That location cannot be used for sales.');
    }
    await this.locationAuthorizationService.assertAccess(tx, tenantId, userId, locationId);
  }

  private async assertCustomerExists(tx: TenantTransaction, tenantId: string, customerId: string): Promise<void> {
    const customer = await this.customersRepository.findById(tx, tenantId, customerId);
    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }
  }

  private async loadSellableVariant(tx: TenantTransaction, tenantId: string, variantId: string): Promise<SalesVariantRow> {
    const variant = await this.catalogLookup.findVariantById(tx, tenantId, variantId);
    if (!variant) {
      throw new NotFoundException('Product variant not found.');
    }
    if (variant.status !== 'active') {
      throw new ConflictException(`Product variant ${variant.sku} is not currently sellable.`);
    }
    if (variant.isSerialized || variant.isLotTracked) {
      throw new ConflictException(
        `Product variant ${variant.sku} is serialized or lot-tracked; selling those is not supported yet (deferred to a later phase).`,
      );
    }
    return variant;
  }

  private async toResponse(tx: TenantTransaction, tenantId: string, cart: CartRow, permissions: string[]): Promise<CartResponseDto> {
    const canViewFloor = permissions.includes('pricing.floor.view');
    const items = await this.cartItemsRepository.listByCart(tx, tenantId, cart.id);
    const lines = await Promise.all(items.map((item) => this.toItemResponse(tx, tenantId, cart, item, canViewFloor)));
    const subtotal = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
    return {
      id: cart.id,
      status: cart.status,
      locationId: cart.locationId,
      ...(cart.customerId ? { customerId: cart.customerId } : {}),
      ...(cart.orderId ? { orderId: cart.orderId } : {}),
      items: lines,
      subtotal: roundMoney(subtotal),
      createdAt: cart.createdAt.toISOString(),
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  private async toItemResponse(
    tx: TenantTransaction,
    tenantId: string,
    cart: CartRow,
    item: CartItemRow,
    canViewFloor: boolean,
  ): Promise<CartResponseDto['items'][number]> {
    const variant = await this.catalogLookup.findVariantById(tx, tenantId, item.productVariantId);
    const quantity = Number(item.quantity);
    const negotiated = item.negotiatedUnitPrice === null ? undefined : Number(item.negotiatedUnitPrice);
    const basePrice = variant ? Number(variant.basePrice) : 0;
    const unitPrice = negotiated ?? basePrice;
    const balance = await this.balancesRepository.findByVariantAndLocation(tx, tenantId, item.productVariantId, cart.locationId);
    const available = balance?.quantityAvailable != null ? Number(balance.quantityAvailable) : 0;
    return {
      id: item.id,
      productVariantId: item.productVariantId,
      sku: variant?.sku ?? '(unknown)',
      productName: variant?.productName ?? '(unknown)',
      quantity,
      ...(negotiated !== undefined ? { negotiatedUnitPrice: negotiated } : {}),
      unitPrice: roundMoney(unitPrice),
      lineSubtotal: roundMoney(unitPrice * quantity),
      maxPrice: variant ? Number(variant.maxPrice) : 0,
      basePrice,
      ...(canViewFloor && variant ? { minPrice: Number(variant.minPrice) } : {}),
      sellable: variant != null && variant.status === 'active' && !variant.isSerialized && !variant.isLotTracked,
      availableAtLocation: available,
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
        entityType: 'cart',
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
