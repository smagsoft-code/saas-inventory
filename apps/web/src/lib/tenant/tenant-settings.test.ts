import { describe, expect, it } from 'vitest';
import { resolveTenantTimezone, TENANT_SETTINGS_DEFAULTS } from '../types/tenant-settings';

describe('resolveTenantTimezone', () => {
  it('falls back to the backend default (UTC) when settings are unreadable', () => {
    expect(resolveTenantTimezone(null)).toBe('UTC');
    expect(resolveTenantTimezone(null)).toBe(TENANT_SETTINGS_DEFAULTS.timezone);
  });

  it('returns the configured timezone when present', () => {
    expect(
      resolveTenantTimezone({
        timezone: 'America/Bogota',
        businessHours: [],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('America/Bogota');
  });
});
