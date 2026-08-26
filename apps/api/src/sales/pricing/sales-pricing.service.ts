import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { roundMoney } from '../sales-money';

export interface VariantPriceContext {
  maxPrice: number;
  basePrice: number;
  minPrice: number;
}

export type PriceClassification = 'within_range' | 'below_min' | 'above_max';

export interface ResolvedUnitPrice {
  unitPrice: number;
  /** `below_min` is an exceptional discount — the caller sets `is_exceptional_discount` and drives
   * the `price_approvals` workflow / confirm gate. */
  classification: PriceClassification;
}

/**
 * The three-tier pricing rules (ADR-0022, database.md#pricing) applied to a sale line, server-side.
 * CATALOG stays the source of truth for `max_price`/`base_price`/`min_price` (§44) — this service
 * only *consumes* them and never stores its own copy.
 *
 * FASE 13 boundary (§41, §58): a price within `[min_price, max_price]` is a normal negotiation. A
 * price **below `min_price`** is now PERMITTED to enter an order as an exceptional discount
 * (`is_exceptional_discount = true`) — `resolveUnitPrice` classifies it as `below_min` rather than
 * rejecting it; the caller (OrdersService) then enforces the tenant hard floor
 * (`assertWithinHardFloor`, ADR-0022 point 2) and, at confirm, the `price_approvals` gate. A price
 * **above `max_price`** is always invalid (400). This service still never reads
 * `tenant_price_policies` itself — it takes the effective policy value as a parameter.
 */
@Injectable()
export class SalesPricingService {
  classify(unitPrice: number, ctx: VariantPriceContext): PriceClassification {
    if (unitPrice > ctx.maxPrice) {
      return 'above_max';
    }
    if (unitPrice < ctx.minPrice) {
      return 'below_min';
    }
    return 'within_range';
  }

  /**
   * Resolves the effective unit price for a line (the proposed price, or the live base price when
   * the vendor did not negotiate) and validates it. Throws `400` for a non-finite/negative price
   * or one above `max_price`. A below-`min_price` price is returned with `classification =
   * 'below_min'`, never thrown — it is an exceptional discount the caller handles.
   */
  resolveUnitPrice(
    proposedUnitPrice: number | null | undefined,
    ctx: VariantPriceContext,
    variantLabel: string,
  ): ResolvedUnitPrice {
    const unitPrice =
      proposedUnitPrice === null || proposedUnitPrice === undefined ? ctx.basePrice : proposedUnitPrice;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new BadRequestException(`Invalid unit price for ${variantLabel}.`);
    }
    const classification = this.classify(unitPrice, ctx);
    if (classification === 'above_max') {
      throw new BadRequestException(
        `Unit price ${unitPrice} for ${variantLabel} exceeds the maximum authorized price (${ctx.maxPrice}).`,
      );
    }
    return { unitPrice, classification };
  }

  /**
   * The tenant's hard discount floor (ADR-0022 point 2 / database.md#pricing): a below-`min_price`
   * price more than `maxDiscountBelowMinPercent`% under the floor is rejected outright — it can
   * never become a `price_approvals` request, because no approval could authorize it. A `null`
   * policy value means no floor beyond `min_price >= 0` itself. Only meaningful for a `below_min`
   * line; a no-op otherwise.
   */
  assertWithinHardFloor(
    unitPrice: number,
    minPrice: number,
    maxDiscountBelowMinPercent: number | null,
    variantLabel: string,
  ): void {
    if (maxDiscountBelowMinPercent === null || unitPrice >= minPrice) {
      return;
    }
    const hardFloor = roundMoney(minPrice * (1 - maxDiscountBelowMinPercent / 100));
    if (unitPrice < hardFloor) {
      throw new UnprocessableEntityException(
        `Unit price ${unitPrice} for ${variantLabel} is more than ${maxDiscountBelowMinPercent}% below the authorized minimum (${minPrice}); it exceeds the tenant's hard discount floor and cannot be requested for approval.`,
      );
    }
  }

  /**
   * Soft, guidance-level validation for the cart (carts.service.ts). A cart may now stage a
   * below-`min_price` line — checkout turns it into an exceptional order + approval flow — so this
   * only rejects an above-`max_price` or otherwise invalid price. The authoritative rules (hard
   * floor, approval gate) re-run under lock at checkout / confirm.
   */
  assertNotAboveMax(
    proposedUnitPrice: number | null | undefined,
    ctx: VariantPriceContext,
    variantLabel: string,
  ): void {
    this.resolveUnitPrice(proposedUnitPrice, ctx, variantLabel);
  }
}
