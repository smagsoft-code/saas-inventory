import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps a rooted internal path', () => {
    expect(safeReturnTo('/users')).toBe('/users');
    expect(safeReturnTo('/users/123?tab=roles')).toBe('/users/123?tab=roles');
  });

  it('rejects anything that could leave the origin', () => {
    for (const value of [
      'https://evil.example/x',
      '//evil.example',
      '/\\evil.example',
      'http:/evil.example',
      'javascript:alert(1)',
      '/foo\nSet-Cookie: x=y',
      '/foo bar',
      'users', // not rooted
      '',
      null,
      undefined,
    ]) {
      expect(safeReturnTo(value)).toBe('/');
    }
  });

  it('never returns to an auth route', () => {
    expect(safeReturnTo('/login')).toBe('/');
    expect(safeReturnTo('/register?x=1')).toBe('/');
    expect(safeReturnTo('/platform/login')).toBe('/');
    expect(safeReturnTo('/platform/login?returnTo=/platform', '/platform')).toBe('/platform');
  });

  it('never returns to an auth route regardless of case (a stale browser-autocompleted "/LOGIN" must not loop into a 404)', () => {
    expect(safeReturnTo('/LOGIN')).toBe('/');
    expect(safeReturnTo('/Login')).toBe('/');
    expect(safeReturnTo('/REGISTER')).toBe('/');
    expect(safeReturnTo('/Platform/Login')).toBe('/');
  });

  it('honours a custom fallback', () => {
    expect(safeReturnTo('//evil', '/dashboard')).toBe('/dashboard');
    expect(safeReturnTo('/platform', '/platform')).toBe('/platform');
  });
});
