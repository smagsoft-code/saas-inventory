import { describe, expect, it } from 'vitest';
import type { AttributeDefinition, CategoryAttribute } from '../types/catalog';
import {
  loadCategoryAttributeFieldSets,
  pruneAttributeValues,
  resolveAttributeFields,
  validateAttributeValues,
} from './product-attributes';

const DEFS: AttributeDefinition[] = [
  { id: 'd1', code: 'color', name: 'Color', dataType: 'select', appliesTo: 'product', isRequiredDefault: false, status: 'active' },
  { id: 'd2', code: 'voltage', name: 'Voltage', dataType: 'number', appliesTo: 'variant', isRequiredDefault: false, status: 'active', minValue: 110, maxValue: 240 },
  { id: 'd3', code: 'legacy', name: 'Legacy', dataType: 'text', appliesTo: 'product', isRequiredDefault: false, status: 'inactive' },
];

const ASSIGNMENTS: CategoryAttribute[] = [
  { attributeDefinitionId: 'd2', code: 'voltage', name: 'Voltage', dataType: 'number', isRequired: true, displayOrder: 1 },
  { attributeDefinitionId: 'd1', code: 'color', name: 'Color', dataType: 'select', isRequired: false, displayOrder: 0 },
  { attributeDefinitionId: 'd3', code: 'legacy', name: 'Legacy', dataType: 'text', isRequired: false, displayOrder: 2 },
];

describe('resolveAttributeFields', () => {
  it('keeps only active definitions of the requested scope, ordered by displayOrder', () => {
    const product = resolveAttributeFields(ASSIGNMENTS, DEFS, 'product');
    expect(product.map((f) => f.code)).toEqual(['color']); // d3 is inactive, d2 is variant scope
    const variant = resolveAttributeFields(ASSIGNMENTS, DEFS, 'variant');
    expect(variant.map((f) => f.code)).toEqual(['voltage']);
    expect(variant[0]).toMatchObject({ isRequired: true, minValue: 110, maxValue: 240 });
  });

  it('carries the per-category isRequired override', () => {
    const withOverride = resolveAttributeFields(
      [{ ...ASSIGNMENTS[1]!, isRequired: true }],
      DEFS,
      'product',
    );
    expect(withOverride[0]?.isRequired).toBe(true);
  });
});

describe('pruneAttributeValues', () => {
  it('drops keys that are not current fields', () => {
    const fields = resolveAttributeFields(ASSIGNMENTS, DEFS, 'product');
    expect(pruneAttributeValues({ color: 'red', voltage: 220, ghost: 1 }, fields)).toEqual({ color: 'red' });
  });
});

describe('validateAttributeValues', () => {
  const variantFields = resolveAttributeFields(ASSIGNMENTS, DEFS, 'variant');

  it('flags a missing required value', () => {
    expect(validateAttributeValues({}, variantFields)).toEqual({ voltage: 'Voltage es obligatorio.' });
  });

  it('enforces min/max for numbers', () => {
    expect(validateAttributeValues({ voltage: 12 }, variantFields)).toEqual({ voltage: 'Voltage debe ser ≥ 110.' });
    expect(validateAttributeValues({ voltage: 999 }, variantFields)).toEqual({ voltage: 'Voltage debe ser ≤ 240.' });
    expect(validateAttributeValues({ voltage: 220 }, variantFields)).toEqual({});
  });
});

describe('loadCategoryAttributeFieldSets', () => {
  it('returns empty sets and makes no request when there is no category', async () => {
    let called = 0;
    const sets = await loadCategoryAttributeFieldSets(
      async () => {
        called += 1;
        return [] as never;
      },
      undefined,
      DEFS,
    );
    expect(called).toBe(0);
    expect(sets).toEqual({ product: [], variant: [], options: {} });
  });

  it('splits by scope and loads active options for select fields', async () => {
    const fetchJson = async <T>(path: string): Promise<T> => {
      if (path === '/api/v1/categories/c1/attributes') return ASSIGNMENTS as T;
      if (path === '/api/v1/attribute-definitions/d1/options') {
        return [
          { id: 'o1', attributeDefinitionId: 'd1', code: 'red', label: 'Red', displayOrder: 0, status: 'active' },
          { id: 'o2', attributeDefinitionId: 'd1', code: 'old', label: 'Old', displayOrder: 1, status: 'inactive' },
        ] as T;
      }
      throw new Error(`unexpected ${path}`);
    };
    const sets = await loadCategoryAttributeFieldSets(fetchJson, 'c1', DEFS);
    expect(sets.product.map((f) => f.code)).toEqual(['color']);
    expect(sets.variant.map((f) => f.code)).toEqual(['voltage']);
    expect(sets.options['d1']?.map((o) => o.code)).toEqual(['red']); // inactive option dropped
  });
});
