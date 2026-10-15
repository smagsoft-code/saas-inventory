import { describe, expect, it } from 'vitest';
import { DEFAULT_SKU_PREFIX, skuPrefixFromCategoryName } from './sku-prefix';

describe('skuPrefixFromCategoryName', () => {
  it('is the first three letters of the category, accents removed, uppercased', () => {
    expect(skuPrefixFromCategoryName('ARMARIO CON MALETERO')).toBe('ARM');
    expect(skuPrefixFromCategoryName('Armario sin maletero')).toBe('ARM'); // same prefix for both categories
    expect(skuPrefixFromCategoryName('FERRETERÍA')).toBe('FER');
    expect(skuPrefixFromCategoryName('Ñandú')).toBe('NAN');
    expect(skuPrefixFromCategoryName('Óptica')).toBe('OPT');
  });

  it('skips non-letters, uses the letters it has when there are fewer than three, and falls back to PRD', () => {
    expect(skuPrefixFromCategoryName('3M cintas')).toBe('MCI');
    expect(skuPrefixFromCategoryName('TV')).toBe('TV');
    expect(skuPrefixFromCategoryName('123')).toBe(DEFAULT_SKU_PREFIX);
    expect(skuPrefixFromCategoryName('')).toBe('PRD');
    expect(skuPrefixFromCategoryName(null)).toBe('PRD');
    expect(skuPrefixFromCategoryName(undefined)).toBe('PRD');
  });
});
