/**
 * Mirrors `apps/api/src/catalog/categories/dto/*` — the real category + attribute contract
 * (ADR-0017 / ADR-0026). Kept local to the frontend, the same convention as `lib/types/core.ts`.
 * Response / request / UI-state shapes are kept separate (F17-03 §22).
 *
 * Endpoints (all tenant-scoped — `tenantId` is resolved server-side, never sent):
 *  - `GET/POST /api/v1/categories` · `GET/PATCH /api/v1/categories/:id`
 *  - `GET/PUT /api/v1/categories/:id/attributes`
 *  - `GET/POST /api/v1/attribute-definitions` · `PATCH /api/v1/attribute-definitions/:id`
 *  - `GET/POST /api/v1/attribute-definitions/:id/options` · `PATCH .../options/:optionId`
 *  - `GET /api/v1/measurement-units`
 */

// --- categories --------------------------------------------------------------------------------

export interface Category {
  id: string;
  parentCategoryId?: string;
  name: string;
  slug: string;
  /** `active` | `inactive` — categories are deactivated, never hard-deleted (no DELETE endpoint). */
  status: string;
  createdAt: string;
}

/** `POST /categories` body — `CreateCategoryDto`. */
export interface CreateCategoryInput {
  name: string;
  slug: string;
  parentCategoryId?: string;
}

/** `PATCH /categories/:id` body — `UpdateCategoryDto`. Every field optional; omit to leave
 * unchanged. `status` toggles `active`/`inactive`. */
export interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  parentCategoryId?: string;
  status?: 'active' | 'inactive';
}

// --- category ↔ attribute assignment ----------------------------------------------------------

/** `GET /categories/:id/attributes` response — `CategoryAttributeResponseDto`. */
export interface CategoryAttribute {
  attributeDefinitionId: string;
  code: string;
  name: string;
  dataType: string;
  isRequired: boolean;
  displayOrder: number;
}

/** One entry in the `PUT /categories/:id/attributes` body — `CategoryAttributeEntryDto`. The PUT
 * replaces the category's complete assignment set. */
export interface CategoryAttributeEntry {
  attributeDefinitionId: string;
  /** Omit to inherit `attribute_definitions.isRequiredDefault`. */
  isRequired?: boolean;
  displayOrder?: number;
}

// --- attribute definitions --------------------------------------------------------------------

export const ATTRIBUTE_DATA_TYPES = [
  'text',
  'number',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'select',
  'multi_select',
] as const;
export type AttributeDataType = (typeof ATTRIBUTE_DATA_TYPES)[number];

export const ATTRIBUTE_SCOPES = ['product', 'variant'] as const;
export type AttributeScope = (typeof ATTRIBUTE_SCOPES)[number];

/** `select` / `multi_select` are the only types that carry an options list. */
export function isSelectType(dataType: string): boolean {
  return dataType === 'select' || dataType === 'multi_select';
}

/** `number` / `decimal` are the only types that carry a unit and min/max. */
export function isNumericType(dataType: string): boolean {
  return dataType === 'number' || dataType === 'decimal';
}

/** `GET /attribute-definitions` response item — `AttributeDefinitionResponseDto`. */
export interface AttributeDefinition {
  id: string;
  code: string;
  name: string;
  description?: string;
  dataType: string;
  appliesTo: string;
  unitId?: string;
  isRequiredDefault: boolean;
  minValue?: number;
  maxValue?: number;
  status: string;
}

/** `POST /attribute-definitions` body — `CreateAttributeDefinitionDto`. `code`, `dataType`,
 * `appliesTo`, `unitId` are intrinsic and set once (never on update). */
export interface CreateAttributeDefinitionInput {
  code: string;
  name: string;
  description?: string;
  dataType: AttributeDataType;
  appliesTo: AttributeScope;
  unitId?: string;
  isRequiredDefault?: boolean;
  minValue?: number;
  maxValue?: number;
}

/** `PATCH /attribute-definitions/:id` body — `UpdateAttributeDefinitionDto`. */
export interface UpdateAttributeDefinitionInput {
  name?: string;
  description?: string;
  isRequiredDefault?: boolean;
  minValue?: number;
  maxValue?: number;
  status?: 'active' | 'inactive';
}

// --- attribute options ----------------------------------------------------------------------

/** `GET /attribute-definitions/:id/options` response item — `AttributeOptionResponseDto`. */
export interface AttributeOption {
  id: string;
  attributeDefinitionId: string;
  code: string;
  label: string;
  displayOrder: number;
  status: string;
}

/** `POST /attribute-definitions/:id/options` body — `CreateAttributeOptionDto`. */
export interface CreateAttributeOptionInput {
  code: string;
  label: string;
  displayOrder?: number;
}

/** `PATCH .../options/:optionId` body — `UpdateAttributeOptionDto`. `code` is not editable. */
export interface UpdateAttributeOptionInput {
  label?: string;
  displayOrder?: number;
  status?: 'active' | 'inactive';
}

// --- measurement units --------------------------------------------------------------------------

/** `GET /measurement-units` response item — `MeasurementUnitResponseDto` (platform reference data). */
export interface MeasurementUnit {
  id: string;
  code: string;
  label: string;
  dimension: string;
}

/** Human label for a data type, for tables/selects. */
export const ATTRIBUTE_DATA_TYPE_LABELS: Record<string, string> = {
  text: 'Texto',
  number: 'Número',
  decimal: 'Decimal',
  boolean: 'Sí / No',
  date: 'Fecha',
  datetime: 'Fecha y hora',
  select: 'Selección única',
  multi_select: 'Selección múltiple',
};

/** The slug format the backend enforces (`create-category.dto.ts`). */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
