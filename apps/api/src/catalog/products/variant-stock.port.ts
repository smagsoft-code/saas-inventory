import type { TenantTransaction } from '../../database/tenant-context';

/**
 * Cross-domain port (Dependency Inversion) — CATALOG defines and depends only on this interface,
 * never on INVENTORY directly, keeping modules.md's `Catalog -> Core`-only edge intact. A global
 * bridge (`inventory/variant-stock-bridge.module.ts`) binds it to an INVENTORY-backed adapter, the
 * same "@Global() so no module gains a new edge" motivation `common/storage/`'s
 * `ObjectStorageService` already established for cross-cutting infrastructure. This is the one
 * place a CATALOG write (rejecting "discontinued" while a variant still has physical stock) needs
 * to see INVENTORY data — the direction INVENTORY already legitimately depends on CATALOG, inverted
 * through this port rather than a raw import.
 */
export interface VariantStockPort {
  /** Sum of `quantity_physical` for this variant across every location, tenant-scoped — run inside
   * the caller's own transaction so the check and the status write are atomic. */
  totalPhysicalStock(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<number>;
}

export const VARIANT_STOCK_PORT = Symbol('VARIANT_STOCK_PORT');
