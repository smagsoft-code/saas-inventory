import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SalesPricingService } from './sales-pricing.service';

const CTX = { maxPrice: 120, basePrice: 100, minPrice: 80 };

describe('SalesPricingService', () => {
  const service = new SalesPricingService();

  describe('classify', () => {
    it('within range only at base and above (owner policy change: trigger moved from min to base)', () => {
      expect(service.classify(100, CTX)).toBe('within_range');
      expect(service.classify(120, CTX)).toBe('within_range');
    });

    it('below_base for anything under base, including the old [min, base) "normal" band', () => {
      expect(service.classify(95, CTX)).toBe('below_base');
      expect(service.classify(80, CTX)).toBe('below_base');
      expect(service.classify(79.99, CTX)).toBe('below_base');
      expect(service.classify(0, CTX)).toBe('below_base');
    });

    it('above_max strictly over the ceiling', () => {
      expect(service.classify(120.01, CTX)).toBe('above_max');
    });
  });

  describe('resolveUnitPrice', () => {
    it('falls back to base price when no negotiation is proposed', () => {
      expect(service.resolveUnitPrice(undefined, CTX, 'SKU-1')).toEqual({ unitPrice: 100, classification: 'within_range' });
      expect(service.resolveUnitPrice(null, CTX, 'SKU-1')).toEqual({ unitPrice: 100, classification: 'within_range' });
    });

    it('classifies a price between min and base as exceptional too (owner policy change)', () => {
      expect(service.resolveUnitPrice(90, CTX, 'SKU-1')).toEqual({ unitPrice: 90, classification: 'below_base' });
    });

    it('permits a below-minimum price, classified as exceptional (FASE 13 — no longer a 409 here)', () => {
      expect(service.resolveUnitPrice(50, CTX, 'SKU-1')).toEqual({ unitPrice: 50, classification: 'below_base' });
    });

    it('rejects a price above the maximum (400)', () => {
      expect(() => service.resolveUnitPrice(130, CTX, 'SKU-1')).toThrow(BadRequestException);
    });

    it('rejects a negative or non-finite proposed price (400)', () => {
      expect(() => service.resolveUnitPrice(-1, CTX, 'SKU-1')).toThrow(BadRequestException);
      expect(() => service.resolveUnitPrice(Number.NaN, CTX, 'SKU-1')).toThrow(BadRequestException);
    });
  });

  describe('assertWithinHardFloor', () => {
    it('no-op when the tenant sets no hard floor (null)', () => {
      expect(() => service.assertWithinHardFloor(1, 80, null, 'SKU-1')).not.toThrow();
    });

    it('no-op for a within-range price regardless of the floor', () => {
      expect(() => service.assertWithinHardFloor(90, 80, 10, 'SKU-1')).not.toThrow();
    });

    it('permits a below-min price still within the configured percentage', () => {
      // 20% below min (80) => hard floor 64; 70 is allowed.
      expect(() => service.assertWithinHardFloor(70, 80, 20, 'SKU-1')).not.toThrow();
    });

    it('rejects a below-min price beyond the configured percentage (422)', () => {
      // 20% below min (80) => hard floor 64; 60 is rejected outright.
      expect(() => service.assertWithinHardFloor(60, 80, 20, 'SKU-1')).toThrow(UnprocessableEntityException);
    });
  });

  describe('assertNotAboveMax (cart soft validation)', () => {
    it('permits a below-base price (cart may stage an exceptional line)', () => {
      expect(() => service.assertNotAboveMax(50, CTX, 'SKU-1')).not.toThrow();
    });

    it('still rejects an above-max price', () => {
      expect(() => service.assertNotAboveMax(130, CTX, 'SKU-1')).toThrow(BadRequestException);
    });
  });
});
