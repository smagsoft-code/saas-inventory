import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { applyColumnMapping, assertValidColumnMapping, attributeCodeOf, extractAttributeValues, isAttributeField, isKnownTargetField } from './import-fields';

describe('import-fields', () => {
  describe('isKnownTargetField / isAttributeField / attributeCodeOf', () => {
    it('accepts standard fields and rejects unknown ones', () => {
      expect(isKnownTargetField('sku')).toBe(true);
      expect(isKnownTargetField('name')).toBe(true);
      expect(isKnownTargetField('bogus')).toBe(false);
    });

    it('treats any attr:* field as known, regardless of code', () => {
      expect(isKnownTargetField('attr:color')).toBe(true);
      expect(isAttributeField('attr:color')).toBe(true);
      expect(isAttributeField('sku')).toBe(false);
      expect(attributeCodeOf('attr:color')).toBe('color');
    });
  });

  describe('applyColumnMapping', () => {
    it('maps raw Excel headers to target fields, dropping unmapped columns', () => {
      const raw = { CODIGO: 'SKU-1', DESCRIPCION: 'Widget', UNUSED: 'ignored me' };
      const mapping = { CODIGO: 'sku', DESCRIPCION: 'name' };
      expect(applyColumnMapping(raw, mapping)).toEqual({ sku: 'SKU-1', name: 'Widget' });
    });

    it('routes attr: targets through unchanged', () => {
      const raw = { CC: '250' };
      const mapping = { CC: 'attr:cilindraje' };
      expect(applyColumnMapping(raw, mapping)).toEqual({ 'attr:cilindraje': '250' });
    });

    it('silently drops a mapping entry pointing at an unknown target field (defense in depth beyond assertValidColumnMapping)', () => {
      const raw = { X: 'value' };
      const mapping = { X: 'not-a-real-field' };
      expect(applyColumnMapping(raw, mapping)).toEqual({});
    });

    it('produces undefined for a mapped target whose header never appears in this row', () => {
      const raw = {};
      const mapping = { CODIGO: 'sku' };
      expect(applyColumnMapping(raw, mapping).sku).toBeUndefined();
    });
  });

  describe('extractAttributeValues', () => {
    it('collects only attr:* entries with a real value, keyed by bare code', () => {
      const mapped = { sku: 'SKU-1', 'attr:color': 'red', 'attr:empty': '', 'attr:missing': undefined };
      expect(extractAttributeValues(mapped)).toEqual({ color: 'red' });
    });
  });

  describe('assertValidColumnMapping', () => {
    it('accepts a mapping with sku and other known fields', () => {
      expect(() => assertValidColumnMapping({ CODIGO: 'sku', NOMBRE: 'name' })).not.toThrow();
    });

    it('rejects an empty mapping', () => {
      expect(() => assertValidColumnMapping({})).toThrow(BadRequestException);
    });

    it('rejects a mapping with no sku target', () => {
      expect(() => assertValidColumnMapping({ NOMBRE: 'name' })).toThrow(BadRequestException);
    });

    it('rejects an unknown target field', () => {
      expect(() => assertValidColumnMapping({ CODIGO: 'sku', X: 'not-a-field' })).toThrow(BadRequestException);
    });

    it('rejects the same standard target field mapped from two different headers', () => {
      expect(() => assertValidColumnMapping({ CODIGO: 'sku', SKU2: 'sku' })).toThrow(BadRequestException);
    });

    it('allows two different attr: targets even if it looks like a collision (they never do — different codes)', () => {
      expect(() => assertValidColumnMapping({ CODIGO: 'sku', CC: 'attr:cilindraje', COLOR: 'attr:color' })).not.toThrow();
    });
  });
});
