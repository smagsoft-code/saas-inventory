import { describe, expect, it } from 'vitest';
import { buildAttributeSummary, buildAttributeSummaryFromDefinitions, formatAttributeSummaryLine } from './attribute-summary';
import type { AttributeField } from './product-attributes';
import type { AttributeDefinition, MeasurementUnit } from '../types/catalog';

function field(over: Partial<AttributeField> & Pick<AttributeField, 'code' | 'name' | 'dataType'>): AttributeField {
  return {
    attributeDefinitionId: `def-${over.code}`,
    isRequired: false,
    displayOrder: 0,
    appliesTo: 'product',
    ...over,
  };
}

const definitions: AttributeDefinition[] = [
  { id: 'def-ATR001', code: 'ATR001', name: 'Color', dataType: 'select', appliesTo: 'product', isRequiredDefault: false, status: 'active' },
  { id: 'def-ATR002', code: 'ATR002', name: 'Medidas', dataType: 'number', appliesTo: 'product', unitId: 'u-cm', isRequiredDefault: false, status: 'active' },
  { id: 'def-ATR003', code: 'ATR003', name: 'Peso', dataType: 'decimal', appliesTo: 'variant', isRequiredDefault: false, status: 'active' },
];
const units: MeasurementUnit[] = [{ id: 'u-cm', code: 'cm', label: 'Centímetros', dimension: 'length' }];
const options = { 'def-ATR001': [{ id: 'o1', attributeDefinitionId: 'def-ATR001', code: 'crema', label: 'Crema', displayOrder: 0, status: 'active' }] };

describe('buildAttributeSummary', () => {
  const fields = [
    field({ code: 'ATR001', name: 'Color', dataType: 'select' }),
    field({ code: 'ATR002', name: 'Medidas', dataType: 'number' }),
    field({ code: 'ATR003', name: 'Peso', dataType: 'decimal', appliesTo: 'variant' }),
  ];

  it('resolves option labels and appends the unit of measure to numbers', () => {
    const items = buildAttributeSummary({ fields, options, definitions, units, values: { ATR001: 'crema', ATR002: 80 } });
    expect(items).toEqual([
      { code: 'ATR001', label: 'Color', value: 'Crema' },
      { code: 'ATR002', label: 'Medidas', value: '80 cm' },
    ]);
    expect(formatAttributeSummaryLine(items)).toBe('Color: Crema; Medidas: 80 cm');
  });

  it('skips attributes without a stored value and keeps a number without a unit plain', () => {
    const items = buildAttributeSummary({ fields, options, definitions, units, values: { ATR003: 2.5 } });
    expect(items).toEqual([{ code: 'ATR003', label: 'Peso', value: '2.5' }]);
  });

  it('formats booleans and multi-selects', () => {
    const items = buildAttributeSummary({
      fields: [
        field({ code: 'B', name: 'Garantía extendida', dataType: 'boolean' }),
        field({ code: 'M', name: 'Acabados', dataType: 'multi_select', attributeDefinitionId: 'def-M' }),
      ],
      options: { 'def-M': [{ id: 'a', attributeDefinitionId: 'def-M', code: 'mate', label: 'Mate', displayOrder: 0, status: 'active' }] },
      definitions: [],
      units: [],
      values: { B: false, M: ['mate', 'otro'] },
    });
    expect(items.map((i) => i.value)).toEqual(['No', 'Mate, otro']);
  });

  it('builds the same summary straight from the definitions (list rows of mixed categories)', () => {
    const items = buildAttributeSummaryFromDefinitions({ definitions, options, units, values: { ATR001: 'crema', ATR002: 80, UNKNOWN: 'x' } });
    expect(formatAttributeSummaryLine(items)).toBe('Color: Crema; Medidas: 80 cm');
  });

  it('an empty list yields an empty line', () => {
    expect(formatAttributeSummaryLine([])).toBe('');
  });
});
