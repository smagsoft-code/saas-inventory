import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The real `db:migrate` process, through pnpm exactly as a developer runs it (ADR-0041, D-8A, finding H8).
 * It needs NO PostgreSQL: an invalid invocation must be refused before the configuration is read, and the
 * evidence that nothing connected is that the refusal is the CLI's own, never the connection's
 * (`FACTS_UNAVAILABLE`). The URL points at a closed local port so that, if anything did try to connect, the
 * test would see it. The password in it is synthetic and must never appear in the output.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const API = join(__dirname, '..', '..');
const SECRET = 'synthetic-secret-0123456789';
const BASE_ENV = {
  MIGRATOR_BOOTSTRAP_DATABASE_URL: `postgresql://boot:${SECRET}@127.0.0.1:1/probe_db`,
  MIGRATOR_EXPECTED_DATABASE: 'probe_db',
};

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('PG') && !k.startsWith('MIGRATOR_')) env[k] = v;
  return { ...env, ...extra };
}

/** `form`: how the developer types it. */
function migrate(form: 'filter' | 'run', args: string[], extra: Record<string, string> = BASE_ENV) {
  const argv = form === 'filter' ? ['--filter', '@saas-inventory/api', 'db:migrate', ...args] : ['run', 'db:migrate', ...args];
  const r = spawnSync('pnpm', argv, { cwd: form === 'filter' ? REPO : API, env: cleanEnv(extra), encoding: 'utf8', shell: true });
  const text = `${r.stdout}${r.stderr}`;
  return { status: r.status, text };
}

const NOT_CONNECTED = (text: string) => {
  expect(text).not.toContain('FACTS_UNAVAILABLE');
  expect(text).not.toContain('Migration run:');
  expect(text).not.toContain(SECRET);
  expect(text).not.toMatch(/postgres(ql)?:\/\//);
};

describe('db:migrate refuses an invalid invocation before reading the configuration or connecting', () => {
  it.each([
    ['filter', ['--provision-onyl']],
    ['filter', ['--force']],
    ['filter', ['bootstrap']],
    ['filter', ['--mode']],
    ['filter', ['--mode', 'superuser']],
    ['filter', ['--mode', 'incremental', '--provision-only']],
    ['run', ['--provision-onyl']],
    ['run', ['--', '--provision-onyl']],
    ['run', ['--', '--', '--mode', 'bootstrap']],
  ] as const)('pnpm (%s) db:migrate %j → exit 1, the CLI\'s own refusal, nothing connected', (form, args) => {
    const r = migrate(form, [...args]);
    expect(r.status).toBe(1);
    expect(r.text).toContain('CLI_ARGUMENT_INVALID');
    expect(r.text).toContain('Usage: db:migrate');
    NOT_CONNECTED(r.text);
  });
});

describe('db:migrate delivers valid arguments (how pnpm 9 forwards them)', () => {
  it.each([
    ['filter', ['--mode', 'incremental']],
    ['filter', ['--mode=incremental']],
    ['filter', ['--', '--mode', 'incremental']],
    ['run', ['--mode', 'incremental']],
    ['run', ['--', '--mode', 'incremental']],
  ] as const)('pnpm (%s) db:migrate %j reaches incremental mode (and stops at the missing incremental URL, without connecting)', (form, args) => {
    const r = migrate(form, [...args]);
    expect(r.status).toBe(1);
    expect(r.text).not.toContain('CLI_ARGUMENT_INVALID');
    expect(r.text).toContain('CONFIG_VARIABLE_MISSING');
    expect(r.text).toContain('MIGRATOR_INCREMENTAL_DATABASE_URL is required in incremental mode');
    NOT_CONNECTED(r.text);
  });

  it('--provision-only is delivered too: without the incremental login variables it stops at the configuration', () => {
    const r = migrate('filter', ['--mode', 'bootstrap', '--provision-only']);
    expect(r.status).toBe(1);
    expect(r.text).not.toContain('CLI_ARGUMENT_INVALID');
    expect(r.text).toContain('--provision-only needs bootstrap mode with MIGRATOR_INCREMENTAL_LOGIN');
    NOT_CONNECTED(r.text);
  });

  it('a valid invocation DOES reach the connection (the contrast that gives the tests above their meaning)', () => {
    const r = migrate('filter', ['--mode', 'bootstrap']);
    expect(r.status).toBe(1);
    expect(r.text).toContain('FACTS_UNAVAILABLE');
    expect(r.text).not.toContain(SECRET);
  });
});
