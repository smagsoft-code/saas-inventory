import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOptionalEnvVar, getRequiredEnvVar, MissingEnvVarError } from './index';

describe('config package', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a required env var when present', () => {
    vi.stubEnv('SOME_VAR', 'value');
    expect(getRequiredEnvVar('SOME_VAR')).toBe('value');
  });

  it('throws MissingEnvVarError when a required env var is absent', () => {
    vi.stubEnv('MISSING_VAR', '');
    expect(() => getRequiredEnvVar('MISSING_VAR')).toThrow(MissingEnvVarError);
  });

  it('falls back for optional env vars', () => {
    expect(getOptionalEnvVar('UNSET_VAR', 'fallback')).toBe('fallback');
  });
});
