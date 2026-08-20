import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttributeValidationService } from './attribute-validation.service';

/**
 * database.md#validation-jsonb, ADR-0026, §33's algorithm — every unit test here exercises pure
 * validation logic with a mocked AttributesRepository (no DB, no transaction), same convention as
 * core/users/users.service.spec.ts. Real-Postgres coverage (governed-key rejection actually backed
 * by category_attributes/attribute_definitions/attribute_options rows) lives in
 * test/catalog/catalog.integration.test.ts.
 */
const TENANT_ID = 'tenant-1';
const CATEGORY_ID = 'category-1';

function def(overrides: Partial<{ definitionId: string; code: string; name: string; dataType: string; isRequired: boolean; minValue: string | null; maxValue: string | null }> = {}) {
  return {
    definitionId: 'def-1',
    code: 'color',
    name: 'Color',
    dataType: 'text',
    isRequired: false,
    minValue: null,
    maxValue: null,
    ...overrides,
  };
}

function buildService(applicable: ReturnType<typeof def>[], optionCodes = new Map<string, Set<string>>()) {
  const attributesRepository = {
    listApplicableForCategory: vi.fn().mockResolvedValue(applicable),
    listActiveOptionCodes: vi.fn().mockResolvedValue(optionCodes),
  };
  const service = new AttributeValidationService(attributesRepository as never);
  return { service, attributesRepository };
}

describe('AttributeValidationService', () => {
  let tx: unknown;
  beforeEach(() => {
    tx = {};
  });

  it('allows an empty attributes object when nothing is governed', async () => {
    const { service } = buildService([]);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', {})).resolves.toBeUndefined();
  });

  it('rejects any attribute when categoryId is null (no governed set at all)', async () => {
    const { service, attributesRepository } = buildService([]);
    await expect(service.validate(tx as never, TENANT_ID, null, 'product', { color: 'red' })).rejects.toThrow(BadRequestException);
    expect(attributesRepository.listApplicableForCategory).not.toHaveBeenCalled();
  });

  it('rejects a key not in the governed set', async () => {
    const { service } = buildService([def({ code: 'color' })]);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { size: 'M' })).rejects.toThrow(BadRequestException);
  });

  it('rejects when a required attribute is missing', async () => {
    const { service } = buildService([def({ code: 'color', isRequired: true })]);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', {})).rejects.toThrow(BadRequestException);
  });

  it('accepts when an optional attribute is simply omitted', async () => {
    const { service } = buildService([def({ code: 'color', isRequired: false })]);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', {})).resolves.toBeUndefined();
  });

  it.each([
    ['text', 'red', true],
    ['text', 123, false],
    ['boolean', true, true],
    ['boolean', 'true', false],
    ['number', 10, true],
    ['number', '10', false],
    ['decimal', 1.5, true],
    ['date', '2026-01-15', true],
    ['date', 'not-a-date', false],
    ['date', '2026-13-99', false],
    ['datetime', '2026-01-15T10:00:00Z', true],
    ['datetime', 'garbage', false],
  ] as const)('data type %s with value %p is valid=%s', async (dataType, value, valid) => {
    const { service } = buildService([def({ code: 'field', dataType })]);
    const promise = service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { field: value });
    if (valid) {
      await expect(promise).resolves.toBeUndefined();
    } else {
      await expect(promise).rejects.toThrow(BadRequestException);
    }
  });

  it('enforces min_value/max_value range for number/decimal', async () => {
    const { service } = buildService([def({ code: 'cilindraje', dataType: 'number', minValue: '100', maxValue: '300' })]);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { cilindraje: 250 })).resolves.toBeUndefined();
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { cilindraje: 50 })).rejects.toThrow(BadRequestException);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { cilindraje: 500 })).rejects.toThrow(BadRequestException);
  });

  it('select: accepts an active option code, rejects an unknown one', async () => {
    const options = new Map([['def-1', new Set(['black', 'white'])]]);
    const { service } = buildService([def({ code: 'color', dataType: 'select' })], options);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { color: 'black' })).resolves.toBeUndefined();
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { color: 'purple' })).rejects.toThrow(BadRequestException);
  });

  it('select: rejects a retired (inactive) option code — not in the active set', async () => {
    const options = new Map([['def-1', new Set(['black'])]]); // 'white' exists but is inactive, so absent here
    const { service } = buildService([def({ code: 'color', dataType: 'select' })], options);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { color: 'white' })).rejects.toThrow(BadRequestException);
  });

  it('multi_select: accepts an array of active option codes, rejects a non-array or an invalid entry', async () => {
    const options = new Map([['def-1', new Set(['black', 'white', 'red'])]]);
    const { service } = buildService([def({ code: 'colors', dataType: 'multi_select' })], options);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { colors: ['black', 'red'] })).resolves.toBeUndefined();
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { colors: 'black' })).rejects.toThrow(BadRequestException);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { colors: ['black', 'purple'] })).rejects.toThrow(BadRequestException);
  });

  it('scopes to PRODUCT vs VARIANT independently — a variant-scope call never sees product-scope definitions', async () => {
    const { service, attributesRepository } = buildService([def({ code: 'color' })]);
    await service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'variant', { color: 'red' });
    expect(attributesRepository.listApplicableForCategory).toHaveBeenCalledWith(tx, TENANT_ID, CATEGORY_ID, 'variant');
  });

  it('reports every field-level error together, not just the first one', async () => {
    const { service } = buildService([def({ code: 'color', isRequired: true }), def({ definitionId: 'def-2', code: 'size', isRequired: true })]);
    await expect(service.validate(tx as never, TENANT_ID, CATEGORY_ID, 'product', { bogus: 'x' })).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          expect.objectContaining({ code: 'bogus' }),
          expect.objectContaining({ code: 'color' }),
          expect.objectContaining({ code: 'size' }),
        ]),
      },
    });
  });
});
