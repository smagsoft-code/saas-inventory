import { describe, expect, it } from 'vitest';
import { companyInitials } from './company-initials';

describe('companyInitials', () => {
  it('two words: the first letter of each', () => {
    expect(companyInitials('Muebles Norte')).toBe('MN');
    expect(companyInitials('  smag   soft ')).toBe('SS');
  });

  it('more than two words: the first letters of the first two (always two letters)', () => {
    expect(companyInitials('Muebles del Norte S.A.')).toBe('MD');
  });

  it('a single word: its first two letters', () => {
    expect(companyInitials('Acme')).toBe('AC');
    expect(companyInitials('x')).toBe('X');
  });

  it('upper-cases, keeps accents and never splits a character', () => {
    expect(companyInitials('óptica ñandú')).toBe('ÓÑ');
    expect(companyInitials('éxito')).toBe('ÉX');
    expect(companyInitials('😀smile')).toBe('😀S');
  });

  it('an empty or blank name gives a placeholder, never an empty badge', () => {
    expect(companyInitials('')).toBe('?');
    expect(companyInitials('   ')).toBe('?');
  });
});
