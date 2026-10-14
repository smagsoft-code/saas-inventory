import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenantPricePolicies } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

/**
 * `tenant_price_policies` (one row per tenant, ADR-0022 point 2 / database.md#pricing) — the
 * discount-governance knobs FASE 13's exceptional-pricing workflow reads:
 *
 *   - `exceptional_discount_requires_approval` (default `true`) — whether a below-`base_price` line
 *     needs a resolved `price_approvals` row before its order can be confirmed.
 *   - `max_discount_below_min_percent` (default `NULL` = no extra floor) — the hard floor below
 *     which even an approval request is rejected outright (database.md#pricing: "a request below
 *     that hard floor is rejected outright ... never becomes a `pending` row at all").
 *
 * FASE 13 reads this table only — there is no endpoint to configure it this phase (a tenant with
 * no row gets the documented defaults). `pricing.policy.manage` stays in the catalog for a later
 * phase's configuration surface. RLS-scoped like every other tenant-owned read.
 */
export interface EffectivePricePolicy {
  exceptionalDiscountRequiresApproval: boolean;
  /** `null` = no hard floor beyond `min_price` itself. */
  maxDiscountBelowMinPercent: number | null;
}

export const DEFAULT_PRICE_POLICY: EffectivePricePolicy = {
  exceptionalDiscountRequiresApproval: true,
  maxDiscountBelowMinPercent: null,
};

@Injectable()
export class TenantPricePoliciesRepository {
  async getEffective(tx: TenantTransaction, tenantId: string): Promise<EffectivePricePolicy> {
    const [row] = await tx
      .select({
        exceptionalDiscountRequiresApproval: tenantPricePolicies.exceptionalDiscountRequiresApproval,
        maxDiscountBelowMinPercent: tenantPricePolicies.maxDiscountBelowMinPercent,
      })
      .from(tenantPricePolicies)
      .where(eq(tenantPricePolicies.tenantId, tenantId));
    if (!row) {
      return { ...DEFAULT_PRICE_POLICY };
    }
    return {
      exceptionalDiscountRequiresApproval: row.exceptionalDiscountRequiresApproval,
      maxDiscountBelowMinPercent:
        row.maxDiscountBelowMinPercent === null ? null : Number(row.maxDiscountBelowMinPercent),
    };
  }
}
