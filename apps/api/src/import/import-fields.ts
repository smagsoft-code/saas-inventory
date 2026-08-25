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
  'location',
  'productRef',
  'serialNumber',
  'lotNumber',
  'manufacturedDate',
  'expiryDate',
] as const;
export type StandardImportField = (typeof STANDARD_IMPORT_FIELDS)[number];

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
