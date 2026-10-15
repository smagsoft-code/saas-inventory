import type { AttributeDefinition, AttributeOption, MeasurementUnit } from '../types/catalog';
import type { AttributeField } from './product-attributes';

/**
 * Human-readable view of a product/variant's stored attribute values (ADR-0026 stores them in JSONB
 * keyed by the attribute **code**): the attribute's name, the value formatted by its type, and its
 * unit of measure when it has one. Shared by the product photo preview modal and any list that
 * shows "Color: Crema; Medidas: 80 cm". Pure — the caller supplies the already-fetched metadata.
 */
export interface AttributeSummaryItem {
  code: string;
  label: string;
  /** Already formatted, unit included (e.g. `80 cm`). */
  value: string;
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function formatDate(raw: string, withTime: boolean): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return withTime ? date.toLocaleString('es') : date.toLocaleDateString('es', { timeZone: 'UTC' });
}

function formatValue(
  field: AttributeField,
  raw: unknown,
  options: AttributeOption[],
  unitCode: string | undefined,
): string {
  switch (field.dataType) {
    case 'boolean':
      return raw === true ? 'Sí' : 'No';
    case 'select': {
      const option = options.find((o) => o.code === raw);
      return option?.label ?? String(raw);
    }
    case 'multi_select': {
      const codes = Array.isArray(raw) ? raw : [raw];
      return codes.map((code) => options.find((o) => o.code === code)?.label ?? String(code)).join(', ');
    }
    case 'date':
      return formatDate(String(raw), false);
    case 'datetime':
      return formatDate(String(raw), true);
    case 'number':
    case 'decimal':
      return unitCode ? `${String(raw)} ${unitCode}` : String(raw);
    default:
      return String(raw);
  }
}

export function buildAttributeSummary(input: {
  /** The attribute fields to show, in display order (product-scope first, then variant-scope). */
  fields: AttributeField[];
  /** Active options keyed by attribute definition id (`CategoryAttributeFieldSets.options`). */
  options: Record<string, AttributeOption[]>;
  definitions: AttributeDefinition[];
  units: MeasurementUnit[];
  /** Stored values by attribute code — product and variant attributes already merged. */
  values: Record<string, unknown>;
}): AttributeSummaryItem[] {
  const definitionById = new Map(input.definitions.map((d) => [d.id, d]));
  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const items: AttributeSummaryItem[] = [];
  for (const field of input.fields) {
    const raw = input.values[field.code];
    if (isEmpty(raw)) continue;
    const unitId = definitionById.get(field.attributeDefinitionId)?.unitId;
    const unitCode = unitId ? unitById.get(unitId)?.code : undefined;
    items.push({
      code: field.code,
      label: field.name,
      value: formatValue(field, raw, input.options[field.attributeDefinitionId] ?? [], unitCode),
    });
  }
  return items;
}

/**
 * Same summary, built straight from the attribute *definitions* (no category assignments needed):
 * every definition whose code has a stored value, in definition order. For lists that mix products
 * of many categories (the products table), where resolving each category's assignments is too heavy.
 */
export function buildAttributeSummaryFromDefinitions(input: {
  definitions: AttributeDefinition[];
  options: Record<string, AttributeOption[]>;
  units: MeasurementUnit[];
  values: Record<string, unknown>;
}): AttributeSummaryItem[] {
  const fields: AttributeField[] = input.definitions
    .filter((def) => def.code in input.values)
    .map((def) => ({
      attributeDefinitionId: def.id,
      code: def.code,
      name: def.name,
      dataType: def.dataType,
      isRequired: def.isRequiredDefault,
      displayOrder: 0,
      appliesTo: def.appliesTo === 'variant' ? 'variant' : 'product',
    }));
  return buildAttributeSummary({ ...input, fields });
}

/** `Color: Crema; Medidas: 80 cm` — the compact one-line form for list rows. */
export function formatAttributeSummaryLine(items: AttributeSummaryItem[]): string {
  return items.map((item) => `${item.label}: ${item.value}`).join('; ');
}
