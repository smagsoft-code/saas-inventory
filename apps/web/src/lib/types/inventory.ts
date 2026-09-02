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
