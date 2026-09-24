/**
 * Mirrors `apps/api/src/reports/kardex/dto/*` — `GET /api/v1/reports/kardex` (`inventory.view`).
 * Cost fields (`unitCost`, `averageCost`, `stockValue`, `estimated`, `unitCostEstimated`,
 * `averageCostAfter`, `stockValueAfter`) are **omitted entirely** (not null) when the caller lacks
 * `pricing.cost.view` — ADR-0028's field-level-authorization precedent, same as every other cost
 * field in this app.
 */

export interface KardexBalance {
  stockUnits: number;
  averageCost?: number;
  stockValue?: number;
  /** True when at least one contributing inbound movement had no recorded unit cost and fell back
   * to the variant's current cost instead (legacy pre-costing-feature movements). */
  estimated?: boolean;
}

export interface KardexRow {
  movementId: string;
  occurredAt: string;
  movementType: string;
  label: string;
  entrada: number;
  salida: number;
  unitCost?: number;
  unitCostEstimated?: boolean;
  averageCostAfter?: number;
  stockAfter: number;
  stockValueAfter?: number;
}

export interface KardexLocationBalance {
  locationId: string;
  locationName: string;
  warehouseName: string;
  stockPhysical: number;
  stockAvailable?: number;
}

export interface KardexResponse {
  productVariantId: string;
  locationId: string;
  /** The parent product id — lets a caller that fetched several variants' Kardex (the "Ver todos"
   * tenant-wide feed) jump straight to this product's own variant picker without a second lookup. */
  productId: string;
  productName: string;
  sku: string;
  opening: KardexBalance;
  rows: KardexRow[];
  closing: KardexBalance;
  /** True when the [from, to) range held more than the server's row cap — narrow the date range to
   * see the rest (UI-UX-SPEC-001 §22: a limit, not an unbounded query). */
  truncated: boolean;
  /** This variant's current balance at every location it has one, tenant-wide (not limited to the
   * queried location) — "Stock por sucursal". */
  stockByLocation: KardexLocationBalance[];
}

export const KARDEX_EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type KardexExportFormat = (typeof KARDEX_EXPORT_FORMATS)[number];
