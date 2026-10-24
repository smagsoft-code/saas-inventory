import { describe, expect, it } from 'vitest';
import { standardizeName } from './customers.service';

describe('standardizeName', () => {
  it('upper-cases the first letter of every word and lower-cases the rest', () => {
    expect(standardizeName('juan PÉREZ  gómez')).toBe('Juan Pérez Gómez');
  });
  it('keeps undefined and trims', () => {
    expect(standardizeName(undefined)).toBeUndefined();
    expect(standardizeName('  ana ')).toBe('Ana');
  });
});
