import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBootstrapDatabaseUrl,
  getOptionalEnvVar,
  getRequiredEnvVar,
  MigratorUrlConflictError,
  MissingEnvVarError,
  resetBootstrapAliasWarning,
  resolveBootstrapDatabaseUrl,
} from './index';

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

describe('bootstrap database URL (one contract for every migrator consumer)', () => {
  const NEW = 'postgresql://boot:pw-new@h:5432/db';
  const OLD = 'postgresql://boot:pw-old@h:5432/db';

  afterEach(() => {
    vi.restoreAllMocks();
    resetBootstrapAliasWarning();
  });

  it('uses MIGRATOR_BOOTSTRAP_DATABASE_URL', () => {
    expect(resolveBootstrapDatabaseUrl({ MIGRATOR_BOOTSTRAP_DATABASE_URL: NEW })).toEqual({ url: NEW, viaDeprecatedAlias: false });
  });

  it('accepts the deprecated alias only when the new name is absent, and says so', () => {
    expect(resolveBootstrapDatabaseUrl({ MIGRATOR_DATABASE_URL: OLD })).toEqual({ url: OLD, viaDeprecatedAlias: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getBootstrapDatabaseUrl({ MIGRATOR_DATABASE_URL: OLD })).toBe(OLD);
    getBootstrapDatabaseUrl({ MIGRATOR_DATABASE_URL: OLD });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('pw-old');
  });

  it('refuses both variables at once instead of choosing one', () => {
    expect(() => resolveBootstrapDatabaseUrl({ MIGRATOR_BOOTSTRAP_DATABASE_URL: NEW, MIGRATOR_DATABASE_URL: OLD })).toThrow(MigratorUrlConflictError);
    try {
      resolveBootstrapDatabaseUrl({ MIGRATOR_BOOTSTRAP_DATABASE_URL: NEW, MIGRATOR_DATABASE_URL: OLD });
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/pw-new|pw-old|postgresql:\/\//);
    }
  });

  it('names the NEW variable when neither is set, and treats an empty value as unset', () => {
    expect(() => getBootstrapDatabaseUrl({})).toThrow(/MIGRATOR_BOOTSTRAP_DATABASE_URL/);
    expect(() => getBootstrapDatabaseUrl({ MIGRATOR_BOOTSTRAP_DATABASE_URL: '', MIGRATOR_DATABASE_URL: '' })).toThrow(MissingEnvVarError);
  });
});
