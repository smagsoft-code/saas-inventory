import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

export interface VariantPriceContext {
  maxPrice: number;
  basePrice: number;
  minPrice: number;
}

export type PriceClassification = 'within_range' | 'below_min' | 'above_max';

/**
 * The three-tier pricing rules (ADR-0022, database.md#pricing) applied to a sale line, server-side.
 * CATALOG stays the source of truth for `max_price`/`base_price`/`min_price` (§21) — this service
 * only *consumes* them and never stores its own copy.
 *
 * FASE 12 boundary (§25-§26): a price within `[min_price, max_price]` is a normal negotiation and
 * completes now. A price **below `min_price`** is an exceptional discount whose approval workflow
 * (`price_approvals`) is FASE 13 — FASE 12 rejects it in a controlled way (409, no order created,
 * no inventory touched), it never silently bypasses the floor. A price **above `max_price`** is
 * always invalid (400). This service does not read `tenant_price_policies` or create
 * `price_approvals` rows — both are FASE 13.
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

  /** Resolves the effective unit price for a line (proposed price, or the live base price when the
   * vendor did not negotiate) and asserts it is allowed in FASE 12. Throws a controlled domain
   * error otherwise — never returns an out-of-range price. */
  assertAllowed(proposedUnitPrice: number | null | undefined, ctx: VariantPriceContext, variantLabel: string): number {
    const unitPrice = proposedUnitPrice === null || proposedUnitPrice === undefined ? ctx.basePrice : proposedUnitPrice;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new BadRequestException(`Invalid unit price for ${variantLabel}.`);
    }
    switch (this.classify(unitPrice, ctx)) {
      case 'above_max':
        throw new BadRequestException(
          `Unit price ${unitPrice} for ${variantLabel} exceeds the maximum authorized price (${ctx.maxPrice}).`,
        );
      case 'below_min':
        throw new ConflictException(
          `Unit price ${unitPrice} for ${variantLabel} is below the authorized minimum (${ctx.minPrice}); an exceptional discount approval is required and is not available until FASE 13.`,
        );
      case 'within_range':
        return unitPrice;
    }
  }
}
