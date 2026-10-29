import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBootstrapDatabaseUrl } from '@saas-inventory/config';
import { resolveMigratorConfig, type MigratorEnv } from './config';

/**
 * The environment contract of the migrator (ADR-0041, D-8A), checked against the files that carry it:
 * `.env.example` (a template — it has no real values) and the consumers that read the variables. Reads
 * source files only; no `.env`, no database.
 */

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/** `KEY=value` lines of the template. `commented` = lines written as `# KEY=value` (optional blocks). */
function parseTemplate(text: string, commented: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = commented ? /^#\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw) : /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw);
    if (line?.[1] !== undefined) out[line[1]] = (line[2] ?? '').trim();
  }
  return out;
}

const template = read('.env.example');
const active = parseTemplate(template, false);
const optional = parseTemplate(template, true);
const PASSWORD = 'synthetic-password-0123456789';

describe('.env.example as a starting point', () => {
  it('copied as it is, it configures bootstrap mode and nothing is left unset for the wrapper', () => {
    const r = resolveMigratorConfig(active);
    expect(r.diagnostics).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.config).toMatchObject({ mode: 'bootstrap', usesLegacyUrl: false, provisionIncrementalLogin: false });
  });

  it('every other migrator consumer accepts it too (the new name, no alias)', () => {
    expect(active['MIGRATOR_BOOTSTRAP_DATABASE_URL']).toBeDefined();
    expect(active['MIGRATOR_EXPECTED_DATABASE']).toBeDefined();
    expect(active['MIGRATOR_DATABASE_URL']).toBeUndefined();
    expect(resolveBootstrapDatabaseUrl(active)).toMatchObject({ viaDeprecatedAlias: false });
  });

  it('the deprecated alias is offered only as a comment, so copying cannot set both', () => {
    expect(optional['MIGRATOR_DATABASE_URL']).toBeDefined();
    const both = { ...active, MIGRATOR_DATABASE_URL: optional['MIGRATOR_DATABASE_URL'] };
    expect(resolveMigratorConfig(both).diagnostics.map((d) => d.code)).toContain('CONFIG_VARIABLE_CONFLICT');
    expect(() => resolveBootstrapDatabaseUrl(both)).toThrow();
  });

  it('uncommenting the incremental block yields a valid incremental configuration', () => {
    const env: MigratorEnv = {
      MIGRATOR_EXPECTED_DATABASE: active['MIGRATOR_EXPECTED_DATABASE'],
      MIGRATOR_INCREMENTAL_LOGIN: optional['MIGRATOR_INCREMENTAL_LOGIN'],
      MIGRATOR_INCREMENTAL_DATABASE_URL: optional['MIGRATOR_INCREMENTAL_DATABASE_URL'],
    };
    const r = resolveMigratorConfig(env);
    expect(r.diagnostics).toEqual([]);
    expect(r.config).toMatchObject({ mode: 'incremental' });
  });

  it('with the bootstrap URL and the incremental login/password it provisions; with both URLs it asks for --mode', () => {
    const provisioning = { ...active, MIGRATOR_INCREMENTAL_LOGIN: optional['MIGRATOR_INCREMENTAL_LOGIN'], MIGRATOR_INCREMENTAL_PASSWORD: PASSWORD };
    expect(resolveMigratorConfig(provisioning).config).toMatchObject({ mode: 'bootstrap', provisionIncrementalLogin: true });
    const both = { ...provisioning, MIGRATOR_INCREMENTAL_DATABASE_URL: optional['MIGRATOR_INCREMENTAL_DATABASE_URL'] };
    expect(resolveMigratorConfig(both).diagnostics.map((d) => d.code)).toEqual(['CONFIG_MODE_AMBIGUOUS']);
    expect(resolveMigratorConfig(both, 'bootstrap').diagnostics).toEqual([]);
  });

  it('the example documents no placeholder that the wrapper would reject (no real secret either)', () => {
    expect(template).not.toMatch(/postgres(ql)?:\/\/[^:\s]+:(?!password@|\$\{)[^@\s]{6,}@/);
  });
});

describe('the deprecated MIGRATOR_DATABASE_URL (exact scope)', () => {
  const alias: MigratorEnv = { MIGRATOR_DATABASE_URL: active['MIGRATOR_BOOTSTRAP_DATABASE_URL'], MIGRATOR_EXPECTED_DATABASE: active['MIGRATOR_EXPECTED_DATABASE'] };

  it('is accepted as bootstrap only, with a warning that says what it cannot do', () => {
    const r = resolveMigratorConfig(alias);
    expect(r.config).toMatchObject({ mode: 'bootstrap', usesLegacyUrl: true });
    expect(r.warnings.join(' ')).toMatch(/bootstrap mode only/);
    expect(r.warnings.join(' ')).toMatch(/already adopted with --provision-only/);
    expect(r.warnings.join(' ')).toMatch(/ordinary migrations on an existing database need incremental mode/);
  });

  it('cannot stand in for the incremental URL', () => {
    expect(resolveMigratorConfig(alias, 'incremental').diagnostics.map((d) => d.code)).toContain('CONFIG_VARIABLE_MISSING');
  });
});

describe('consumers of the privileged migrator URL read the one contract', () => {
  it.each([
    'apps/api/src/database/bootstrap-dev-roles.ts',
    'database/seeds/demo-tenant.ts',
    'database/scripts/reset-demo-tenant.ts',
    'apps/api/drizzle.config.ts',
    'tools/pg-verify/dev-server.ts',
    'tools/pg-verify/_dev-start-postgres-only.mjs',
    'tools/pg-verify/verify-real-postgres.ts',
  ])('%s does not require the deprecated name on its own', (file) => {
    const source = read(file);
    expect(source).toMatch(/getBootstrapDatabaseUrl|MIGRATOR_BOOTSTRAP_DATABASE_URL/);
    expect(source).not.toMatch(/getRequiredEnvVar\('MIGRATOR_DATABASE_URL'\)/);
    expect(source).not.toMatch(/new URL\(env\.MIGRATOR_DATABASE_URL\)/);
  });

  it('docker-compose.dev.yml sets the new name and the expected database, and not the alias', () => {
    const compose = read('docker-compose.dev.yml');
    expect(compose).toMatch(/^\s+MIGRATOR_BOOTSTRAP_DATABASE_URL:/m);
    expect(compose).toMatch(/^\s+MIGRATOR_EXPECTED_DATABASE:/m);
    expect(compose).not.toMatch(/^\s+MIGRATOR_DATABASE_URL:/m);
  });
});
