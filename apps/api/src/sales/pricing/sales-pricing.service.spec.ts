import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SalesPricingService } from './sales-pricing.service';

const CTX = { maxPrice: 120, basePrice: 100, minPrice: 80 };

describe('SalesPricingService', () => {
  const service = new SalesPricingService();

  describe('classify', () => {
    it('within range for min, base, max and anything between', () => {
      expect(service.classify(80, CTX)).toBe('within_range');
      expect(service.classify(100, CTX)).toBe('within_range');
      expect(service.classify(120, CTX)).toBe('within_range');
      expect(service.classify(95, CTX)).toBe('within_range');
    });

    it('below_min strictly under the floor', () => {
      expect(service.classify(79.99, CTX)).toBe('below_min');
      expect(service.classify(0, CTX)).toBe('below_min');
    });

    it('above_max strictly over the ceiling', () => {
      expect(service.classify(120.01, CTX)).toBe('above_max');
    });
  });

  describe('assertAllowed', () => {
    it('falls back to base price when no negotiation is proposed', () => {
      expect(service.assertAllowed(undefined, CTX, 'SKU-1')).toBe(100);
      expect(service.assertAllowed(null, CTX, 'SKU-1')).toBe(100);
    });

    it('returns a valid negotiated price unchanged', () => {
      expect(service.assertAllowed(90, CTX, 'SKU-1')).toBe(90);
      expect(service.assertAllowed(80, CTX, 'SKU-1')).toBe(80);
    });

    it('rejects a price above the maximum (400)', () => {
      expect(() => service.assertAllowed(130, CTX, 'SKU-1')).toThrow(BadRequestException);
    });

    it('rejects a price below the minimum as a controlled conflict — never bypassed (§25)', () => {
      expect(() => service.assertAllowed(50, CTX, 'SKU-1')).toThrow(ConflictException);
      try {
        service.assertAllowed(50, CTX, 'SKU-1');
      } catch (error) {
        expect((error as Error).message).toMatch(/exceptional discount approval is required/i);
      }
    });

    it('rejects a negative or non-finite proposed price (400)', () => {
      expect(() => service.assertAllowed(-1, CTX, 'SKU-1')).toThrow(BadRequestException);
      expect(() => service.assertAllowed(Number.NaN, CTX, 'SKU-1')).toThrow(BadRequestException);
    });
  });
});
