import { describe, expect, it } from 'vitest';
import { resolveMigratorConfig, type MigratorEnv } from './config';
import { formatDiagnostics } from './execution-guard';

// Synthetic values only: these are not credentials of anything.
const BOOT = 'postgresql://boot_super:s3cret-boot-pass@127.0.0.1:5432/appdb';
const INC = 'postgresql://migrator_inc:s3cret-inc-pass@127.0.0.1:5432/appdb';
const PASSWORD = 'synthetic-password-0123456789';

const bootstrapEnv: MigratorEnv = { MIGRATOR_BOOTSTRAP_DATABASE_URL: BOOT, MIGRATOR_EXPECTED_DATABASE: 'appdb' };
const incrementalEnv: MigratorEnv = {
  MIGRATOR_INCREMENTAL_DATABASE_URL: INC,
  MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc',
  MIGRATOR_EXPECTED_DATABASE: 'appdb',
};

describe('resolveMigratorConfig — accepted configurations', () => {
  it('bootstrap with only the bootstrap URL (no provisioning)', () => {
    const r = resolveMigratorConfig(bootstrapEnv);
    expect(r.diagnostics).toEqual([]);
    expect(r.config).toMatchObject({ mode: 'bootstrap', connectionLogin: 'boot_super', usesLegacyUrl: false, provisionIncrementalLogin: false });
  });

  it('bootstrap that also provisions the incremental login', () => {
    const r = resolveMigratorConfig({ ...bootstrapEnv, MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc', MIGRATOR_INCREMENTAL_PASSWORD: PASSWORD });
    expect(r.diagnostics).toEqual([]);
    expect(r.config).toMatchObject({ mode: 'bootstrap', provisionIncrementalLogin: true, incrementalLogin: 'migrator_inc', incrementalPassword: PASSWORD });
  });

  it('incremental with its own URL and login', () => {
    const r = resolveMigratorConfig(incrementalEnv);
    expect(r.diagnostics).toEqual([]);
    expect(r.config).toMatchObject({ mode: 'incremental', connectionLogin: 'migrator_inc', incrementalPassword: undefined });
  });

  it('the deprecated MIGRATOR_DATABASE_URL is a bootstrap alias and warns, without echoing the URL', () => {
    const r = resolveMigratorConfig({ MIGRATOR_DATABASE_URL: BOOT, MIGRATOR_EXPECTED_DATABASE: 'appdb' });
    expect(r.config).toMatchObject({ mode: 'bootstrap', usesLegacyUrl: true });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/deprecated/);
    expect(JSON.stringify(r.warnings)).not.toContain('s3cret');
  });

  it('with both URLs, an explicit mode picks one', () => {
    const env = { ...bootstrapEnv, ...incrementalEnv, MIGRATOR_INCREMENTAL_PASSWORD: PASSWORD };
    expect(resolveMigratorConfig(env, 'incremental').config?.mode).toBe('incremental');
    expect(resolveMigratorConfig(env, 'bootstrap').config?.mode).toBe('bootstrap');
  });

  it('warns that the password is ignored in incremental mode', () => {
    const r = resolveMigratorConfig({ ...incrementalEnv, MIGRATOR_INCREMENTAL_PASSWORD: PASSWORD });
    expect(r.config?.incrementalPassword).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/ignored/);
  });
});

describe('resolveMigratorConfig — refusals', () => {
  it.each<[string, MigratorEnv, string | undefined, string]>([
    ['no expected database', { MIGRATOR_BOOTSTRAP_DATABASE_URL: BOOT }, undefined, 'CONFIG_VARIABLE_MISSING'],
    ['expected database is not a plain name', { ...bootstrapEnv, MIGRATOR_EXPECTED_DATABASE: 'a b;drop' }, undefined, 'CONFIG_VARIABLE_MISSING'],
    ['no URL at all', { MIGRATOR_EXPECTED_DATABASE: 'appdb' }, undefined, 'CONFIG_VARIABLE_MISSING'],
    ['legacy and bootstrap URL together', { ...bootstrapEnv, MIGRATOR_DATABASE_URL: BOOT }, undefined, 'CONFIG_VARIABLE_CONFLICT'],
    ['two URLs without a mode', { ...bootstrapEnv, ...incrementalEnv }, undefined, 'CONFIG_MODE_AMBIGUOUS'],
    ['unknown mode', bootstrapEnv, 'sudo', 'CONFIG_MODE_INVALID'],
    ['incremental mode only has the bootstrap URL (no silent fallback)', bootstrapEnv, 'incremental', 'CONFIG_VARIABLE_MISSING'],
    ['bootstrap mode only has the incremental URL (no silent fallback)', incrementalEnv, 'bootstrap', 'CONFIG_VARIABLE_MISSING'],
    ['legacy URL cannot stand in for the incremental one', { MIGRATOR_DATABASE_URL: BOOT, MIGRATOR_EXPECTED_DATABASE: 'appdb' }, 'incremental', 'CONFIG_VARIABLE_MISSING'],
    ['URL that is not a URL', { ...bootstrapEnv, MIGRATOR_BOOTSTRAP_DATABASE_URL: 'not a url' }, undefined, 'CONFIG_URL_INVALID'],
    ['URL with the wrong protocol', { ...bootstrapEnv, MIGRATOR_BOOTSTRAP_DATABASE_URL: 'mysql://u:p@h/appdb' }, undefined, 'CONFIG_URL_INVALID'],
    ['URL without a database', { ...bootstrapEnv, MIGRATOR_BOOTSTRAP_DATABASE_URL: 'postgresql://u:p@h:5432' }, undefined, 'CONFIG_URL_INVALID'],
    ['URL of another database', { ...bootstrapEnv, MIGRATOR_EXPECTED_DATABASE: 'otherdb' }, undefined, 'CONFIG_DATABASE_URL_MISMATCH'],
    ['incremental login unset', { ...incrementalEnv, MIGRATOR_INCREMENTAL_LOGIN: '' }, undefined, 'CONFIG_VARIABLE_MISSING'],
    ['incremental login differs from the URL user', { ...incrementalEnv, MIGRATOR_INCREMENTAL_LOGIN: 'someone_else' }, undefined, 'CONFIG_LOGIN_URL_MISMATCH'],
    ['incremental login is an application role', { ...incrementalEnv, MIGRATOR_INCREMENTAL_LOGIN: 'app_migrator' }, undefined, 'CONFIG_LOGIN_INVALID'],
    ['incremental login is postgres', { ...incrementalEnv, MIGRATOR_INCREMENTAL_LOGIN: 'postgres' }, undefined, 'CONFIG_LOGIN_INVALID'],
    ['incremental login with quotes', { ...incrementalEnv, MIGRATOR_INCREMENTAL_LOGIN: 'x"; drop' }, undefined, 'CONFIG_LOGIN_INVALID'],
    ['bootstrap provisioning without a password', { ...bootstrapEnv, MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc' }, undefined, 'CONFIG_VARIABLE_MISSING'],
    ['password without a login', { ...bootstrapEnv, MIGRATOR_INCREMENTAL_PASSWORD: PASSWORD }, undefined, 'CONFIG_VARIABLE_CONFLICT'],
    ['password too short', { ...bootstrapEnv, MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc', MIGRATOR_INCREMENTAL_PASSWORD: 'short' }, undefined, 'CONFIG_PASSWORD_INVALID'],
    ['password with surrounding space', { ...bootstrapEnv, MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc', MIGRATOR_INCREMENTAL_PASSWORD: ` ${PASSWORD}` }, undefined, 'CONFIG_PASSWORD_INVALID'],
    ['password with a control character', { ...bootstrapEnv, MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc', MIGRATOR_INCREMENTAL_PASSWORD: `${PASSWORD}\n` }, undefined, 'CONFIG_PASSWORD_INVALID'],
    [
      'incremental login is the bootstrap login',
      { MIGRATOR_BOOTSTRAP_DATABASE_URL: 'postgresql://migrator_inc:x@h:5432/appdb', MIGRATOR_EXPECTED_DATABASE: 'appdb', MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc', MIGRATOR_INCREMENTAL_PASSWORD: PASSWORD },
      undefined,
      'CONFIG_LOGINS_NOT_SEPARATED',
    ],
    [
      'both URLs use the same account',
      { ...bootstrapEnv, ...incrementalEnv, MIGRATOR_BOOTSTRAP_DATABASE_URL: 'postgresql://migrator_inc:y@h:5432/appdb' },
      'incremental',
      'CONFIG_LOGINS_NOT_SEPARATED',
    ],
  ])('refuses: %s', (_name, env, mode, code) => {
    const r = resolveMigratorConfig(env, mode);
    expect(r.config).toBeNull();
    expect(r.diagnostics.map((d) => d.code)).toContain(code);
  });

  it('never puts a URL, a password or a login secret in a diagnostic or warning', () => {
    const bad: MigratorEnv[] = [
      { ...bootstrapEnv, MIGRATOR_EXPECTED_DATABASE: 'otherdb' },
      { ...bootstrapEnv, MIGRATOR_INCREMENTAL_LOGIN: 'migrator_inc', MIGRATOR_INCREMENTAL_PASSWORD: 'tooshort-secret' },
      { ...bootstrapEnv, MIGRATOR_DATABASE_URL: BOOT },
      { ...incrementalEnv, MIGRATOR_INCREMENTAL_LOGIN: 'someone_else' },
    ];
    for (const env of bad) {
      const r = resolveMigratorConfig(env);
      const text = `${formatDiagnostics(r.diagnostics)} ${JSON.stringify(r.diagnostics)} ${r.warnings.join(' ')}`;
      expect(text).not.toMatch(/s3cret|tooshort-secret|127\.0\.0\.1|postgres(ql)?:\/\//);
    }
  });

  it('returns no configuration (and therefore nothing to connect with) on any refusal', () => {
    expect(resolveMigratorConfig({}).config).toBeNull();
  });
});

describe('resolveMigratorConfig — lock timeout (D-8C)', () => {
  it('defaults to 60 seconds', () => {
    expect(resolveMigratorConfig(bootstrapEnv).config?.lockTimeoutSeconds).toBe(60);
  });

  it.each([['0', 0], ['5', 5], ['3600', 3600]])('accepts %s seconds', (text, seconds) => {
    expect(resolveMigratorConfig({ ...bootstrapEnv, MIGRATOR_LOCK_TIMEOUT_SECONDS: text }).config?.lockTimeoutSeconds).toBe(seconds);
  });

  it.each(['-1', '3601', '1.5', 'abc', '10s', '1e3', ' 5'])('refuses %j before connecting', (text) => {
    const r = resolveMigratorConfig({ ...bootstrapEnv, MIGRATOR_LOCK_TIMEOUT_SECONDS: text });
    expect(r.config).toBeNull();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['CONFIG_LOCK_TIMEOUT_INVALID']);
  });

  it('an empty value means the default', () => {
    expect(resolveMigratorConfig({ ...bootstrapEnv, MIGRATOR_LOCK_TIMEOUT_SECONDS: '' }).config?.lockTimeoutSeconds).toBe(60);
  });
});
