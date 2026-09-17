import { Injectable } from '@nestjs/common';
import type { VariantStockPort } from '../catalog/products/variant-stock.port';
import type { TenantTransaction } from '../database/tenant-context';
import { InventoryBalancesRepository } from './repositories/inventory-balances.repository';

/** INVENTORY-side implementation of CATALOG's `VariantStockPort` — see that file for why this
 * exists as a port rather than a direct import. Bound to the port token in
 * `variant-stock-bridge.module.ts`. */
@Injectable()
export class VariantStockAdapter implements VariantStockPort {
  constructor(private readonly balancesRepository: InventoryBalancesRepository) {}

  totalPhysicalStock(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<number> {
    return this.balancesRepository.sumPhysicalStockByVariant(tx, tenantId, productVariantId);
  }
}
