import type { AttributeDefinition, AttributeOption, CategoryAttribute } from '../types/catalog';
import { isSelectType } from '../types/catalog';

/**
 * ADR-0026 glue for the product/variant forms. The backend stores dynamic attribute values as a
 * governed JSONB object on the product/variant row, keyed by the attribute definition **`code`**,
 * validated by `AttributeValidationService`:
 *
 *  - `text`      → string
 *  - `number` / `decimal` → number (honours the definition's `minValue`/`maxValue`)
 *  - `boolean`   → boolean
 *  - `date`      → `"YYYY-MM-DD"` string
 *  - `datetime`  → an ISO-8601 string (`Date.parse`-able)
 *  - `select`    → one active option **code** (string)
 *  - `multi_select` → an array of active option **codes**
 *
 * `GET /categories/:id/attributes` returns every assigned definition mixed together with no
 * `appliesTo`. The product form needs only the PRODUCT-scope ones and the variant form only the
 * VARIANT-scope ones, so we join that list with `GET /attribute-definitions` (which carries
 * `appliesTo`, `minValue`, `maxValue`, `status`) and split by scope. Only `active` definitions are
 * applicable server-side, so inactive ones are dropped here too.
 *
 * This module is transport-agnostic (no `next/headers`, no `apiFetch` import) so both Server
 * Components and Client Components can use it — the caller injects a `fetchJson`.
 */

export type AttributeFieldScope = 'product' | 'variant';

export type FetchJson = <T>(path: string) => Promise<T>;

/** One resolved dynamic field the form renders. */
export interface AttributeField {
  attributeDefinitionId: string;
  code: string;
  name: string;
  dataType: string;
  isRequired: boolean;
  displayOrder: number;
  appliesTo: AttributeFieldScope;
  minValue?: number;
  maxValue?: number;
}

/** Pure — join category assignments with definitions, filter by scope + active, order. */
export function resolveAttributeFields(
  assignments: CategoryAttribute[],
  definitions: AttributeDefinition[],
  scope: AttributeFieldScope,
): AttributeField[] {
  const defById = new Map(definitions.map((def) => [def.id, def]));
  return assignments
    .flatMap((assignment) => {
      const def = defById.get(assignment.attributeDefinitionId);
      if (!def || def.status !== 'active' || def.appliesTo !== scope) {
        return [];
      }
      const field: AttributeField = {
        attributeDefinitionId: assignment.attributeDefinitionId,
        code: assignment.code,
        name: assignment.name,
        dataType: assignment.dataType,
        isRequired: assignment.isRequired,
        displayOrder: assignment.displayOrder,
        appliesTo: scope,
      };
      if (typeof def.minValue === 'number') field.minValue = def.minValue;
      if (typeof def.maxValue === 'number') field.maxValue = def.maxValue;
      return [field];
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}

export interface CategoryAttributeFieldSets {
  product: AttributeField[];
  variant: AttributeField[];
  /** Active options for every `select`/`multi_select` field, keyed by attribute definition id. */
  options: Record<string, AttributeOption[]>;
}

/**
 * Fetch + resolve both scopes and their `select` options for a category. Empty sets when the
 * product has no category. `fetchJson` is `serverApiFetch` on the server, `apiFetch` on the client.
 */
export async function loadCategoryAttributeFieldSets(
  fetchJson: FetchJson,
  categoryId: string | undefined,
  definitions: AttributeDefinition[],
): Promise<CategoryAttributeFieldSets> {
  if (!categoryId) {
    return { product: [], variant: [], options: {} };
  }
  const assignments = await fetchJson<CategoryAttribute[]>(
    `/api/v1/categories/${categoryId}/attributes`,
  );
  const product = resolveAttributeFields(assignments, definitions, 'product');
  const variant = resolveAttributeFields(assignments, definitions, 'variant');
  const selectDefIds = [
    ...new Set(
      [...product, ...variant]
        .filter((f) => isSelectType(f.dataType))
        .map((f) => f.attributeDefinitionId),
    ),
  ];
  const optionEntries = await Promise.all(
    selectDefIds.map(
      async (id) =>
        [
          id,
          (await fetchJson<AttributeOption[]>(`/api/v1/attribute-definitions/${id}/options`)).filter(
            (option) => option.status === 'active',
          ),
        ] as const,
    ),
  );
  return { product, variant, options: Object.fromEntries(optionEntries) };
}

/** Drop any value whose key is not a current field — used so a category change never sends an
 * attribute the new category does not govern (§34). */
export function pruneAttributeValues(
  values: Record<string, unknown>,
  fields: AttributeField[],
): Record<string, unknown> {
  const allowed = new Set(fields.map((f) => f.code));
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
}

/** Client-side per-field validation mirroring `AttributeValidationService` — the backend stays the
 * authority; this only surfaces errors before a submit. Returns `{ [code]: message }`. */
export function validateAttributeValues(
  values: Record<string, unknown>,
  fields: AttributeField[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.code];
    const present =
      field.code in values &&
      raw !== undefined &&
      raw !== '' &&
      !(Array.isArray(raw) && raw.length === 0);

    if (field.isRequired && !present && field.dataType !== 'boolean') {
      errors[field.code] = `${field.name} is required.`;
      continue;
    }
    if (!present) {
      continue;
    }
    if ((field.dataType === 'number' || field.dataType === 'decimal') && typeof raw === 'number') {
      if (field.minValue !== undefined && raw < field.minValue) {
        errors[field.code] = `${field.name} must be ≥ ${field.minValue}.`;
      } else if (field.maxValue !== undefined && raw > field.maxValue) {
        errors[field.code] = `${field.name} must be ≤ ${field.maxValue}.`;
      }
    }
  }
  return errors;
}
