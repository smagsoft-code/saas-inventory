import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { analyzeNewSkuGroup, applyColumnMapping, assertValidColumnMapping, attributeCodeOf, extractAttributeValues, isAttributeField, isKnownTargetField, normalizeForGroupComparison } from './import-fields';

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

  describe('normalizeForGroupComparison', () => {
    it('collapses number/string/blank differences that should never cause a false mismatch', () => {
      expect(normalizeForGroupComparison(100)).toBe(normalizeForGroupComparison('100'));
      expect(normalizeForGroupComparison(' Widget ')).toBe(normalizeForGroupComparison('Widget'));
      expect(normalizeForGroupComparison(undefined)).toBe(normalizeForGroupComparison(null));
      expect(normalizeForGroupComparison(undefined)).toBe(normalizeForGroupComparison(''));
    });

    it('still distinguishes genuinely different values', () => {
      expect(normalizeForGroupComparison('Televisores')).not.toBe(normalizeForGroupComparison('Refrigeracion'));
    });
  });

  // PROMPT 010-A §4/§5/§9/§10 — multi-serial onboarding for a brand-new SKU.
  describe('analyzeNewSkuGroup', () => {
    it('S1: several rows, same new SKU, each with a distinct serial and identical product/variant fields — a legitimate group', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', category: 'Televisores', maxPrice: 150, basePrice: 120, minPrice: 100, serialNumber: 'SN001' },
        { sku: 'TV-001', name: 'TV Samsung', category: 'Televisores', maxPrice: 150, basePrice: 120, minPrice: 100, serialNumber: 'SN002' },
        { sku: 'TV-001', name: 'TV Samsung', category: 'Televisores', maxPrice: 150, basePrice: 120, minPrice: 100, serialNumber: 'SN003' },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.isLegitimateUnitGroup).toBe(true);
      expect(result.trackingModeConflict).toBe(false);
      expect(result.mismatchedFields).toEqual([]);
    });

    it('treats rows with neither serial nor lot as not a legitimate unit group (plain ambiguous duplicate)', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', quantity: 5 },
        { sku: 'TV-001', name: 'TV Samsung', quantity: 5 },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.isLegitimateUnitGroup).toBe(false);
      expect(result.trackingModeConflict).toBe(false);
    });

    it('S4: flags product/variant-identity fields that disagree across rows of the same new SKU', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', category: 'Televisores', serialNumber: 'SN001' },
        { sku: 'TV-001', name: 'Refrigerador', category: 'Refrigeracion', serialNumber: 'SN002' },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.isLegitimateUnitGroup).toBe(true);
      expect(result.mismatchedFields).toEqual(expect.arrayContaining(['name', 'category']));
    });

    it('flags a mix of serial-tracked and lot-tracked rows under the same new SKU as a tracking-mode conflict', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', serialNumber: 'SN001' },
        { sku: 'TV-001', name: 'TV Samsung', lotNumber: 'LOT-1' },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.isLegitimateUnitGroup).toBe(false);
      expect(result.trackingModeConflict).toBe(true);
    });

    it('flags a mix of serialized and bare (neither serial nor lot) rows as a tracking-mode conflict, not silently a group', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', serialNumber: 'SN001' },
        { sku: 'TV-001', name: 'TV Samsung' },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.isLegitimateUnitGroup).toBe(false);
      expect(result.trackingModeConflict).toBe(true);
    });

    it('S5: allows distinct locations across group rows — location is unit-scoped, never compared', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', serialNumber: 'SN001', location: 'Zone A' },
        { sku: 'TV-001', name: 'TV Samsung', serialNumber: 'SN002', location: 'Zone B' },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.isLegitimateUnitGroup).toBe(true);
      expect(result.mismatchedFields).toEqual([]);
    });

    it('allows distinct manufacturedDate/expiryDate across a lot-tracked group — those are physical-batch attributes, never compared', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', lotNumber: 'LOT-1', manufacturedDate: '2026-01-01', expiryDate: '2027-01-01' },
        { sku: 'TV-001', name: 'TV Samsung', lotNumber: 'LOT-2', manufacturedDate: '2026-06-01', expiryDate: '2027-06-01' },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.isLegitimateUnitGroup).toBe(true);
      expect(result.mismatchedFields).toEqual([]);
    });

    it('flags attr:* attribute mismatches across group rows the same way as standard fields', () => {
      const rows = [
        { sku: 'TV-001', name: 'TV Samsung', 'attr:color': 'black', serialNumber: 'SN001' },
        { sku: 'TV-001', name: 'TV Samsung', 'attr:color': 'white', serialNumber: 'SN002' },
      ];
      const result = analyzeNewSkuGroup(rows);
      expect(result.mismatchedFields).toContain('attr:color');
    });

    it('a single row is trivially not evaluated by callers (documented via a 1-row input still resolving safely)', () => {
      const result = analyzeNewSkuGroup([{ sku: 'TV-001', name: 'TV Samsung', serialNumber: 'SN001' }]);
      expect(result.isLegitimateUnitGroup).toBe(true);
      expect(result.mismatchedFields).toEqual([]);
    });
  });
});
