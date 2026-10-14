import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { LocationAuthorizationService } from './location-authorization.service';

/** Read-side of ADR-0024/0035: what a caller may SEE in lists/reports/details. The scope itself is
 * stubbed (`getOperatingScope`) — its DB behaviour is covered by the integration suites. */
function build(scope: { unrestricted: boolean; locationIds: string[] }): LocationAuthorizationService {
  const service = new LocationAuthorizationService();
  service.getOperatingScope = async () => scope;
  return service;
}
const tx = {} as never;

describe('LocationAuthorizationService.resolveReadScope', () => {
  it('unrestricted caller: tenant-wide, narrowed only by the requested location', async () => {
    const s = build({ unrestricted: true, locationIds: [] });
    expect(await s.resolveReadScope(tx, 't', 'u')).toEqual({});
    expect(await s.resolveReadScope(tx, 't', 'u', 'loc-9')).toEqual({ locationId: 'loc-9' });
  });

  it('restricted caller with no request: narrowed to their assigned set, never tenant-wide', async () => {
    const s = build({ unrestricted: false, locationIds: ['a', 'b'] });
    expect(await s.resolveReadScope(tx, 't', 'u')).toEqual({ locationIds: ['a', 'b'] });
  });

  it('restricted caller with no assignment sees nothing (empty set, not "unrestricted")', async () => {
    const s = build({ unrestricted: false, locationIds: [] });
    expect(await s.resolveReadScope(tx, 't', 'u')).toEqual({ locationIds: [] });
  });

  it('restricted caller asking for an assigned location is narrowed to it; for another one gets 403', async () => {
    const s = build({ unrestricted: false, locationIds: ['a'] });
    expect(await s.resolveReadScope(tx, 't', 'u', 'a')).toEqual({ locationId: 'a' });
    await expect(s.resolveReadScope(tx, 't', 'u', 'zzz')).rejects.toThrow(ForbiddenException);
  });
});

describe('LocationAuthorizationService.canAccess', () => {
  it('true for unrestricted or an assigned location, false otherwise', async () => {
    expect(await build({ unrestricted: true, locationIds: [] }).canAccess(tx, 't', 'u', 'x')).toBe(true);
    const s = build({ unrestricted: false, locationIds: ['a'] });
    expect(await s.canAccess(tx, 't', 'u', 'a')).toBe(true);
    expect(await s.canAccess(tx, 't', 'u', 'b')).toBe(false);
  });
});
