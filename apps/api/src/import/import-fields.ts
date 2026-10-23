import { BadRequestException } from '@nestjs/common';

/**
 * The canonical target-field vocabulary a column_mapping value (§9, database.md's
 * `column_mapping jsonb` — `{ "CODIGO": "sku", "CC": "attr:cilindraje", ... }`) may point at.
 * Standard fields are fixed, known columns; an `attr:<code>` target routes to the governed
 * dynamic-attribute system (ADR-0026) instead — validated by AttributeValidationService, never a
 * second, IMPORT-only attribute system.
 */
export const STANDARD_IMPORT_FIELDS = [
  'sku',
  'name',
  'category',
  'brand',
  'supplier',
  'description',
  'unit',
  'barcode',
  'cost',
  'maxPrice',
  'basePrice',
  'minPrice',
  'quantity',
  'warehouse',
  'location',
  'productRef',
  'serialNumber',
  'lotNumber',
  'manufacturedDate',
  'expiryDate',
] as const;
export type StandardImportField = (typeof STANDARD_IMPORT_FIELDS)[number];

/** PROMPT 010-A §9/§10 — fields that define the *logical* product/variant entity a row belongs
 * to, as opposed to fields scoped to one *physical unit* (serialNumber, lotNumber, location,
 * quantity, manufacturedDate, expiryDate) or the row itself. When several rows in one file share a
 * brand-new SKU (a serialized/lot-tracked onboarding group — §4/§5), every row must agree on these
 * fields; a mismatch means the rows are contradicting each other about what "TV-001" actually is,
 * not describing several legitimate physical units of the same thing. `attr:*` fields are handled
 * separately (any attr: field is entity-scoped by construction, checked by iterating the mapped
 * row's own keys rather than a fixed list here). */
export const PRODUCT_IDENTITY_FIELDS = ['name', 'category', 'brand', 'supplier', 'description', 'unit', 'maxPrice', 'basePrice', 'minPrice', 'cost'] as const;

/** Normalizes a mapped field value for cross-row equality comparison — string/number/blank
 * distinctions that shouldn't cause a false-positive mismatch (e.g. `100` vs `"100"` vs `" 100 "`)
 * collapse to the same comparable form; `undefined`/`null`/`''` all collapse to `''` (a row that
 * simply omitted the column never conflicts with one that supplied it). */
export function normalizeForGroupComparison(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

export const ATTRIBUTE_FIELD_PREFIX = 'attr:';

export function isAttributeField(field: string): boolean {
  return field.startsWith(ATTRIBUTE_FIELD_PREFIX);
}

export function attributeCodeOf(field: string): string {
  return field.slice(ATTRIBUTE_FIELD_PREFIX.length);
}

export function isKnownTargetField(field: string): boolean {
  return isAttributeField(field) || (STANDARD_IMPORT_FIELDS as readonly string[]).includes(field);
}

/**
 * Applies a job's frozen `column_mapping` (Excel header -> target field) to one raw, header-keyed
 * row, producing a target-field-keyed record — §9's "columna Excel -> campo del sistema". Unmapped
 * Excel columns are dropped; a mapped target that never appears in `rawData` becomes `undefined`
 * (missing), which downstream required-field validation catches explicitly rather than silently.
 * Cell values are read as-is (string/number/boolean/Date/null) — no coercion here, each validator
 * coerces/parses the specific type it expects.
 */
export function applyColumnMapping(rawData: Record<string, unknown>, columnMapping: Record<string, string>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [header, target] of Object.entries(columnMapping)) {
    if (!isKnownTargetField(target)) continue;
    mapped[target] = rawData[header];
  }
  return mapped;
}

/** §9 — shared by ImportMappingService (template CRUD, setMapping) and ImportJobService (an
 * inline columnMapping supplied at upload time), so "what makes a mapping valid" has exactly one
 * implementation. */
export function assertValidColumnMapping(columnMapping: Record<string, string>): void {
  const entries = Object.entries(columnMapping);
  if (entries.length === 0) {
    throw new BadRequestException('columnMapping must map at least one Excel header.');
  }
  const unknown = entries.filter(([, target]) => !isKnownTargetField(target));
  if (unknown.length > 0) {
    throw new BadRequestException(`Unknown target field(s): ${unknown.map(([, target]) => target).join(', ')}.`);
  }
  const targets = entries.map(([, target]) => target);
  const duplicateTargets = targets.filter((target, index) => targets.indexOf(target) !== index && !target.startsWith(ATTRIBUTE_FIELD_PREFIX));
  if (duplicateTargets.length > 0) {
    throw new BadRequestException(`Target field(s) mapped more than once: ${[...new Set(duplicateTargets)].join(', ')}.`);
  }
  if (!targets.includes('sku')) {
    throw new BadRequestException('columnMapping must map a column to "sku".');
  }
}

/** PROMPT 010-A §4/§5/§9 — resolved once per SKU that repeats in the file and does not already
 * exist in the database: is this repeat a legitimate "several physical units of one new,
 * serialized/lot-tracked product" group, or does it carry a contradiction that must be rejected? A
 * SKU that already exists in the database is untouched by this — repeated rows against an existing
 * SKU keep the pre-existing per-row `update` behavior (already correct: nothing is (re-)created
 * there, so there is no "create it twice" risk to guard against). */
export interface NewSkuGroupInfo {
  /** Every row in the group uniformly declares a serial (and only a serial), or uniformly declares
   * a lot (and only a lot) — the one shape that makes "same SKU, several rows" a legitimate
   * multi-unit onboarding group rather than an ambiguous duplicate. */
  isLegitimateUnitGroup: boolean;
  /** At least one row in the group declared a serial or lot number, but not uniformly — mixing
   * serial-tracked and lot-tracked rows (or bare rows) under one new SKU is always a contradiction,
   * never merely "not a group" (§9's tracking-mode consistency). */
  trackingModeConflict: boolean;
  /** Product/variant-identity field names (PRODUCT_IDENTITY_FIELDS plus any `attr:*` key present
   * on any row) whose value differs across the group's rows. */
  mismatchedFields: string[];
}

/** Pure, no I/O — the caller (ImportValidationService) has already fetched every raw row's mapped
 * data and only needs to run this once per repeated-and-not-yet-existing SKU, not per row. */
export function analyzeNewSkuGroup(rows: Array<Record<string, unknown>>): NewSkuGroupInfo {
  const asGroupText = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text === '' ? undefined : text;
  };

  const hasSerial = rows.map((row) => Boolean(asGroupText(row['serialNumber'])));
  const hasLot = rows.map((row) => Boolean(asGroupText(row['lotNumber'])));
  const allSerialOnly = hasSerial.every(Boolean) && !hasLot.some(Boolean);
  const allLotOnly = hasLot.every(Boolean) && !hasSerial.some(Boolean);
  const isLegitimateUnitGroup = allSerialOnly || allLotOnly;
  const anyPhysicalMarker = hasSerial.some(Boolean) || hasLot.some(Boolean);
  const trackingModeConflict = !isLegitimateUnitGroup && anyPhysicalMarker;

  const mismatchedFields: string[] = [];
  const canonical = rows[0] ?? {};
  const attrFields = new Set(rows.flatMap((row) => Object.keys(row).filter(isAttributeField)));
  for (const field of [...PRODUCT_IDENTITY_FIELDS, ...attrFields]) {
    const canonicalValue = normalizeForGroupComparison(canonical[field]);
    if (rows.some((row) => normalizeForGroupComparison(row[field]) !== canonicalValue)) {
      mismatchedFields.push(field);
    }
  }

  return { isLegitimateUnitGroup, trackingModeConflict, mismatchedFields };
}

/** Splits a row's mapped `attr:*` values into a plain `{code: value}` map — the shape
 * AttributeValidationService.validate() expects. */
export function extractAttributeValues(mapped: Record<string, unknown>): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(mapped)) {
    if (isAttributeField(field) && value !== undefined && value !== null && value !== '') {
      attributes[attributeCodeOf(field)] = value;
    }
  }
  return attributes;
}

/** User-facing (Spanish) names of the target fields — the same labels the product form and the
 * downloadable template use (`sku` is always "Código"). Used by validation messages and the error
 * report so a finding names the column the user actually knows, never the internal field id. */
export const IMPORT_FIELD_LABELS: Record<StandardImportField, string> = {
  sku: 'Código',
  name: 'Nombre',
  category: 'Categoría',
  brand: 'Marca',
  supplier: 'Proveedor',
  description: 'Descripción',
  unit: 'Unidad',
  barcode: 'Código de barras',
  cost: 'Costo',
  maxPrice: 'Precio máximo',
  basePrice: 'Precio base',
  minPrice: 'Precio mínimo',
  quantity: 'Cantidad',
  warehouse: 'Sucursal',
  location: 'Almacén',
  productRef: 'Referencia de producto',
  serialNumber: 'Número de serie',
  lotNumber: 'Número de lote',
  manufacturedDate: 'Fecha de fabricación',
  expiryDate: 'Fecha de vencimiento',
};

export function importFieldLabel(field: string): string {
  if (isAttributeField(field)) return `Atributo «${attributeCodeOf(field)}»`;
  return (IMPORT_FIELD_LABELS as Record<string, string>)[field] ?? field;
}

function normalizeHeaderForMatch(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\((obligatorio|atributo)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The downloadable template names each attribute column after the attribute itself (`Color`,
 * `Cilindraje (obligatorio)`), but the upload only knows header→field pairs. So that the "I filled
 * in the downloaded template" path also carries the attribute columns, any header the mapping does
 * not already cover that matches an active attribute's name (case/accent-insensitive, ignoring the
 * `(obligatorio)`/`(atributo)` markers the template appends) is mapped to `attr:<code>`. Existing
 * mapping entries always win; an attribute is never mapped twice; ambiguous names (two attributes
 * normalizing to the same text) are left unmapped rather than guessed.
 */
export function autoMapAttributeHeaders(
  columnMapping: Record<string, string>,
  headers: string[],
  definitions: Array<{ code: string; name: string }>,
): Record<string, string> {
  const byName = new Map<string, string | null>();
  for (const def of definitions) {
    const key = normalizeHeaderForMatch(def.name);
    byName.set(key, byName.has(key) ? null : def.code);
  }
  const usedTargets = new Set(Object.values(columnMapping));
  const result = { ...columnMapping };
  for (const header of headers) {
    if (header in result) continue;
    const code = byName.get(normalizeHeaderForMatch(header));
    if (!code) continue;
    const target = `${ATTRIBUTE_FIELD_PREFIX}${code}`;
    if (usedTargets.has(target)) continue;
    result[header] = target;
    usedTargets.add(target);
  }
  return result;
}
