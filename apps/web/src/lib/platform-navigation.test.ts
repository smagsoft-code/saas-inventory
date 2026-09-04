import { describe, expect, it } from 'vitest';
import { PLATFORM_NAVIGATION, isPlatformNavItemActive } from './platform-navigation';

describe('PLATFORM_NAVIGATION', () => {
  it('lists exactly Home and Companies — nothing that lacks a real route/contract', () => {
    expect(PLATFORM_NAVIGATION.map((item) => item.href)).toEqual(['/platform', '/platform/tenants']);
  });

  it('has no tenant-area routes (structural separation)', () => {
    for (const item of PLATFORM_NAVIGATION) {
      expect(item.href.startsWith('/platform')).toBe(true);
    }
  });
});

describe('isPlatformNavItemActive', () => {
  const home = PLATFORM_NAVIGATION[0]!;
  const companies = PLATFORM_NAVIGATION[1]!;

  it('Home matches only exactly /platform', () => {
    expect(isPlatformNavItemActive(home, '/platform')).toBe(true);
    expect(isPlatformNavItemActive(home, '/platform/tenants')).toBe(false);
  });

  it('Companies matches its own subtree', () => {
    expect(isPlatformNavItemActive(companies, '/platform/tenants')).toBe(true);
    expect(isPlatformNavItemActive(companies, '/platform/tenants/01a0-t1')).toBe(true);
    expect(isPlatformNavItemActive(companies, '/platform')).toBe(false);
  });
});
