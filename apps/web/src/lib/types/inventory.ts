/**
 * Mirrors `apps/api/src/inventory/warehouses/dto/*` and `.../locations/dto/*` — the real
 * warehouse + location contract. Kept local to the frontend, the same convention as
 * `lib/types/catalog.ts` / `lib/types/core.ts`. Response / request shapes are kept separate.
 *
 * Endpoints (all tenant-scoped — `tenantId` is resolved server-side, never sent):
 *  - `GET/POST /api/v1/warehouses` · `GET/PATCH /api/v1/warehouses/:id`
 *  - `GET/POST /api/v1/locations` · `GET/PATCH /api/v1/locations/:id`
 *
 * There is **no DELETE** on either resource — deactivation is `status: 'inactive'` (same posture
 * as categories). There is no search and no sort in the backend contract; neither is invented here.
 */

/** The `active`/`inactive` toggle both resources share (`UpdateWarehouseDto` / `UpdateLocationDto`). */
export const INVENTORY_STATUSES = ['active', 'inactive'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

/** `code` format the backend enforces on both warehouses and locations
 * (`create-warehouse.dto.ts` / `create-location.dto.ts` — `@Matches`). */
export const INVENTORY_CODE_PATTERN = /^[A-Z0-9](-?[A-Z0-9]+)*$/;

/** `warehouses.address` / `locations` carry no structured address contract — `address` is a
 * free-form `@IsObject()` on the backend. These are the project's canonical address keys
 * (`AddressDto`, database.md#customers-and-suppliers); only non-empty fields are sent. */
export const ADDRESS_FIELDS = [
  'line1',
  'line2',
  'city',
  'state',
  'postalCode',
  'country',
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type WarehouseAddress = Partial<Record<AddressField, string>>;

export const ADDRESS_FIELD_LABELS: Record<AddressField, string> = {
  line1: 'Address line 1',
  line2: 'Address line 2',
  city: 'City',
  state: 'State / province',
  postalCode: 'Postal code',
  country: 'Country',
};

// --- warehouses --------------------------------------------------------------------------------

/** `GET /warehouses` list item / `GET /warehouses/:id` — `WarehouseResponseDto`. */
export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address?: Record<string, unknown>;
  /** `active` | `inactive`. */
  status: string;
  createdAt: string;
}

/** `POST /warehouses` body — `CreateWarehouseDto`. Creating a warehouse also creates its default
 * "General" location server-side. */
export interface CreateWarehouseInput {
  name: string;
  code: string;
  address?: WarehouseAddress;
}

/** `PATCH /warehouses/:id` body — `UpdateWarehouseDto`. Every field optional; omit to leave
 * unchanged. `status` toggles `active`/`inactive`. */
export interface UpdateWarehouseInput {
  name?: string;
  code?: string;
  address?: WarehouseAddress;
  status?: InventoryStatus;
}

// --- locations --------------------------------------------------------------------------------

/** `GET /locations` list item / `GET /locations/:id` — `LocationResponseDto`. */
export interface Location {
  id: string;
  warehouseId: string;
  parentLocationId?: string;
  name: string;
  code: string;
  /** `false` for quarantine/damaged/scrap locations (ADR-0021). */
  isSellable: boolean;
  /** `active` | `inactive`. */
  status: string;
  createdAt: string;
}

/** `POST /locations` body — `CreateLocationDto`. `warehouseId` is required and set once (no
 * endpoint moves a location to a different warehouse). */
export interface CreateLocationInput {
  warehouseId: string;
  parentLocationId?: string;
  name: string;
  code: string;
  isSellable?: boolean;
}

/** `PATCH /locations/:id` body — `UpdateLocationDto`. No `warehouseId` — only reparenting within
 * the same warehouse is supported. */
export interface UpdateLocationInput {
  name?: string;
  code?: string;
  parentLocationId?: string;
  isSellable?: boolean;
  status?: InventoryStatus;
}

// --- stock: balances, movements, adjustments (F17-06) -----------------------------------------
//
// Mirrors `apps/api/src/inventory/balances/dto/*` and `.../movements/dto/*`. Endpoints:
//  - `GET /api/v1/inventory/balances` · `GET /api/v1/inventory/balances/:id`  (`inventory.view`)
//  - `GET /api/v1/inventory/movements`                                        (`inventory.view`)
//  - `POST /api/v1/inventory/adjustments`                                     (`inventory.adjust`)
//
// The read endpoints return **FK ids only** — no product/variant/location/warehouse names, no
// SKU, no serial/lot, no in-transit column, no date-range or sort params (`GAP-NAME-ENRICHMENT`,
// `GAP-MOVEMENTS-DATE-FILTER`, `GAP-INV-AGGREGATE`). None of that is invented here. There is no
// tenant-wide product-name/status filter and no warehouse filter on either list.

/** `GET /inventory/balances` item / `GET /inventory/balances/:id` — `BalanceResponseDto`.
 * `quantityAvailable` is a DB GENERATED column (`physical - reserved - committed`). */
export interface InventoryBalance {
  id: string;
  productVariantId: string;
  locationId: string;
  quantityPhysical: number;
  quantityReserved: number;
  quantityCommitted: number;
  quantityAvailable: number;
  version: number;
  updatedAt: string;
}

/** Every `inventory_movements.movement_type` the ledger can hold (`ListMovementsQueryDto`). */
export const MOVEMENT_TYPES = [
  'RECEIPT',
  'SALE',
  'RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'COMMITMENT',
  'COMMITMENT_RELEASE',
  'INITIAL_STOCK',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  RECEIPT: 'Receipt',
  SALE: 'Sale',
  RETURN: 'Return',
  ADJUSTMENT_IN: 'Adjustment in',
  ADJUSTMENT_OUT: 'Adjustment out',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  RESERVATION: 'Reservation',
  RESERVATION_RELEASE: 'Reservation release',
  COMMITMENT: 'Commitment',
  COMMITMENT_RELEASE: 'Commitment release',
  INITIAL_STOCK: 'Initial stock',
};

/** The only movement types a manual adjustment may create (`CreateAdjustmentDto`). */
export const ADJUSTMENT_MOVEMENT_TYPES = ['RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] as const;
export type AdjustmentMovementType = (typeof ADJUSTMENT_MOVEMENT_TYPES)[number];

/** `GET /inventory/movements` item — `MovementResponseDto`. `quantity` is signed relative to the
 * bucket it affects; `balanceAfter` is the `quantity_physical` snapshot after the movement. */
export interface InventoryMovement {
  id: string;
  productVariantId: string;
  locationId: string;
  movementType: string;
  quantity: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  actorType: string;
  actorId?: string;
  occurredAt: string;
  createdAt: string;
}

/** `POST /inventory/adjustments` body — `CreateAdjustmentDto`. `quantity` is a positive magnitude;
 * direction comes from `movementType`. `reason` is required (1–500). Never sends `tenantId`. */
export interface CreateAdjustmentInput {
  productVariantId: string;
  locationId: string;
  movementType: AdjustmentMovementType;
  quantity: number;
  reason: string;
  occurredAt?: string;
}
