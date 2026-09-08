import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '../../database/tenant-context';

/** Plain type aliases (not `interface`) — `Database['execute']`'s generic bound requires
 * `Record<string, unknown>`, which only a type literal is structurally assignable to (same reason
 * `InventoryReportRepository` inlines its row shapes). */
export type TransfersStatusBucketRow = {
  key: string;
  transferCount: string;
};

export type TransfersDestinationBucketRow = {
  key: string;
  destinationName: string;
  inTransitQuantity: string;
  openTransferCount: string;
};

export type TransfersVariantBucketRow = {
  key: string;
  sku: string;
  productName: string;
  inTransitQuantity: string;
};

export type TransfersTotalsRow = {
  inTransitQuantity: string;
  openTransferCount: string;
};

/**
 * `reports/transfers` read-side (F18-08, mirrors `reports/inventory`'s F18-03 precedent — a live
 * snapshot, no `from`/`to`). Never the transactional `InventoryTransfersRepository` /
 * `InventoryTransferItemsRepository` — modules.md's "reporting is a separate read-side" rule, the
 * same as every other `reports/<domain>/` module.
 *
 * Two grains, never mixed in one query:
 * - **`inventory_transfers` alone** — `COUNT(*) GROUP BY status`. One row is one transfer, so the
 *   count is exact; no item join, no fan-out.
 * - **`inventory_transfer_items` joined to its parent `inventory_transfers`** — a strict
 *   parent→child read (`t.id = ti.transfer_id`, 1:1 from the item's side), used only to filter items
 *   to open transfers and to reach `destination_location_id`. `SUM(dispatched − received)` is at the
 *   natural item grain; `COUNT(DISTINCT t.id)` dedupes the header so a 3-line transfer counts once.
 *
 * "Open" / "in transit" = `status IN ('dispatched', 'partially_received')` — the fixed set that
 * carries derived in-transit stock (ADR-0020; `metrics.md` `TRF-INTRANSIT-QTY` / `KPI-INV-INTRANSIT`).
 * Bounded by `inventory_transfers_tenant_status_created_idx (tenant_id, status, created_at)` on the
 * header side and `inventory_transfer_items_tenant_transfer_idx` on the join — no new index.
 *
 * Tenant scope: **tenant-wide** — matching `GET /inventory/transfers` / `GET /inventory/balances` /
 * `GET /inventory/movements`, none of which is restricted by `user_location_assignments` (ADR-0024's
 * guard only ever gates a write-path action). Raw parameterized `sql` (never string-interpolated),
 * the same precedent as `InventoryReportRepository` / `EventClaimRepository`.
 */
@Injectable()
export class TransfersReportRepository {
  async statusBuckets(tx: TenantTransaction, tenantId: string): Promise<TransfersStatusBucketRow[]> {
    return tx.execute<TransfersStatusBucketRow>(sql`
      SELECT it.status AS key, COUNT(*) AS "transferCount"
      FROM inventory_transfers it
      WHERE it.tenant_id = ${tenantId}
      GROUP BY it.status
      ORDER BY it.status
    `);
  }

  async destinationBuckets(tx: TenantTransaction, tenantId: string): Promise<TransfersDestinationBucketRow[]> {
    return tx.execute<TransfersDestinationBucketRow>(sql`
      SELECT
        t.destination_location_id AS key,
        l.name AS "destinationName",
        COALESCE(SUM(ti.quantity_dispatched - ti.quantity_received), 0) AS "inTransitQuantity",
        COUNT(DISTINCT t.id) AS "openTransferCount"
      FROM inventory_transfer_items ti
      JOIN inventory_transfers t ON t.tenant_id = ti.tenant_id AND t.id = ti.transfer_id
      JOIN locations l ON l.tenant_id = t.tenant_id AND l.id = t.destination_location_id
      WHERE ti.tenant_id = ${tenantId}
        AND t.status IN ('dispatched', 'partially_received')
      GROUP BY t.destination_location_id, l.name
      ORDER BY l.name
    `);
  }

  async variantBuckets(tx: TenantTransaction, tenantId: string): Promise<TransfersVariantBucketRow[]> {
    return tx.execute<TransfersVariantBucketRow>(sql`
      SELECT
        ti.product_variant_id AS key,
        pv.sku AS sku,
        p.name AS "productName",
        COALESCE(SUM(ti.quantity_dispatched - ti.quantity_received), 0) AS "inTransitQuantity"
      FROM inventory_transfer_items ti
      JOIN inventory_transfers t ON t.tenant_id = ti.tenant_id AND t.id = ti.transfer_id
      JOIN product_variants pv ON pv.tenant_id = ti.tenant_id AND pv.id = ti.product_variant_id
      JOIN products p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
      WHERE ti.tenant_id = ${tenantId}
        AND t.status IN ('dispatched', 'partially_received')
      GROUP BY ti.product_variant_id, pv.sku, p.name
      ORDER BY pv.sku
    `);
  }

  /** `groupBy`-independent, always run. `inTransitQuantity` is the tenant-wide Σ; `openTransferCount`
   * counts the header rows (never the item rows). */
  async totals(tx: TenantTransaction, tenantId: string): Promise<TransfersTotalsRow> {
    const rows = await tx.execute<TransfersTotalsRow>(sql`
      WITH open_transfers AS (
        SELECT id
        FROM inventory_transfers
        WHERE tenant_id = ${tenantId}
          AND status IN ('dispatched', 'partially_received')
      )
      SELECT
        COALESCE((
          SELECT SUM(ti.quantity_dispatched - ti.quantity_received)
          FROM inventory_transfer_items ti
          WHERE ti.tenant_id = ${tenantId}
            AND ti.transfer_id IN (SELECT id FROM open_transfers)
        ), 0) AS "inTransitQuantity",
        (SELECT COUNT(*) FROM open_transfers) AS "openTransferCount"
    `);
    return rows[0] ?? { inTransitQuantity: '0', openTransferCount: '0' };
  }
}
