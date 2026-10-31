import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { allowedNames, buildChildEnv, CHILD_ENV_SPECS, CHILD_PROCESS_NAMES, ChildEnvError, OS_BASELINE, PARENT_ONLY_VARIABLES, scrubParentOnlyVariables, SYSTEM_BASELINE, withChildProcessEnv, type ChildProcessName } from './child-env';
import { loadQaAdmin, QaCredentialsError } from './qa-credentials';

/** Fictitious, random, in memory only. */
const fake = (): string => `Aa1!${randomBytes(9).toString('hex')}`;
const upper = (names: readonly string[]): string[] => names.map((n) => n.toUpperCase());
const sorted = (names: Iterable<string>): string[] => [...names].sort();

/** A world with EVERY name the lists mention (fake values), plus names that must never be passed. */
function world(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const child of CHILD_PROCESS_NAMES) {
    const spec = CHILD_ENV_SPECS[child];
    for (const n of [...spec.required, ...spec.requiredAnyOf.flat(), ...spec.optional]) env[n] = fake();
  }
  for (const n of SYSTEM_BASELINE) env[n] = `sys-${n}`;
  Object.assign(env, {
    QA_ADMIN_PASSWORD: fake(),
    QA_ADMIN_EMAIL: 'qa@example.test',
    PLATFORM_ADMIN_PASSWORD: fake(),
    REDIS_URL: `redis://:${fake()}@127.0.0.1:6379`,
    UNKNOWN_FUTURE_SETTING: fake(),
    PGPASSWORD: fake(),
    NPM_TOKEN: fake(),
    DEV_PGDATA_DIR: '/somewhere',
    IMPORT_WORKER_POLL_INTERVAL_MS: '1000',
    EVENT_PROCESSOR_ID: 'x',
  });
  return env;
}
/** The names that exist only for one deployable / tool and that no dev-server child reads. */
const NEVER = ['QA_ADMIN_PASSWORD', 'QA_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD', 'REDIS_URL', 'UNKNOWN_FUTURE_SETTING', 'PGPASSWORD', 'NPM_TOKEN', 'DEV_PGDATA_DIR', 'IMPORT_WORKER_POLL_INTERVAL_MS', 'EVENT_PROCESSOR_ID'];

describe('buildChildEnv — an explicit allow-list per child process', () => {
  it('1/10. each of the five processes receives exactly its own allowed variables that are present, and nothing else', () => {
    const w = world();
    for (const child of CHILD_PROCESS_NAMES) {
      const env = buildChildEnv(child, w);
      const expected = sorted(allowedNames(child).filter((n) => Object.keys(w).some((k) => k.toUpperCase() === n.toUpperCase())).map((n) => n.toUpperCase()));
      assert.deepEqual(sorted(upper(Object.keys(env))), expected, child);
      for (const [name, value] of Object.entries(env)) assert.equal(value, w[name], `${child}: ${name} value unchanged`);
    }
  });

  it('2. no child receives QA_ADMIN_PASSWORD, in any letter case, and none of the other never-passed names', () => {
    const w = { ...world(), qa_admin_password: fake(), Qa_Admin_Password: fake() };
    for (const child of CHILD_PROCESS_NAMES) {
      const names = upper(Object.keys(buildChildEnv(child, w)));
      for (const forbidden of NEVER) assert.ok(!names.includes(forbidden), `${child} got ${forbidden}`);
      assert.ok(!names.includes('QA_ADMIN_PASSWORD'));
    }
    for (const child of CHILD_PROCESS_NAMES) assert.ok(!upper(allowedNames(child)).includes('QA_ADMIN_PASSWORD'));
  });

  it('3. the parent keeps access to the variable where it needs it, and the input is not modified', () => {
    const w = world();
    const snapshot = JSON.stringify(w);
    assert.equal(loadQaAdmin(w).password, w['QA_ADMIN_PASSWORD']);
    for (const child of CHILD_PROCESS_NAMES) buildChildEnv(child, w);
    assert.equal(JSON.stringify(w), snapshot);
  });

  it('4/5. a variable that is not allowed does not arrive whether it comes from process.env or from the .env file (the merge is only looked up)', () => {
    const processEnv = { ...world(), ONLY_IN_PROCESS_ENV: fake() };
    const fileEnv = { ONLY_IN_ENV_FILE: fake(), JWT_SECRET: 'from-file' };
    const available = { ...processEnv, ...fileEnv }; // exactly what dev-server.ts does
    for (const child of CHILD_PROCESS_NAMES) {
      const names = Object.keys(buildChildEnv(child, available));
      assert.ok(!names.includes('ONLY_IN_PROCESS_ENV') && !names.includes('ONLY_IN_ENV_FILE'), child);
    }
    assert.equal(buildChildEnv('api', available)['JWT_SECRET'], 'from-file', 'the .env value still wins over process.env, as before');
  });

  it('6. optional variables that are absent do not fail: only the required ones are needed', () => {
    for (const child of CHILD_PROCESS_NAMES) {
      const spec = CHILD_ENV_SPECS[child];
      const minimal: Record<string, string> = { PATH: '/bin' };
      for (const n of spec.required) minimal[n] = 'x';
      for (const group of spec.requiredAnyOf) minimal[group[0] as string] = 'x';
      const env = buildChildEnv(child, minimal);
      assert.deepEqual(sorted(upper(Object.keys(env))), sorted(upper(Object.keys(minimal))), child);
    }
  });

  it('7/8. a missing required variable gives a safe error that names variables and never contains a value', () => {
    const secrets = world();
    for (const child of CHILD_PROCESS_NAMES) {
      const spec = CHILD_ENV_SPECS[child];
      if (spec.required.length === 0 && spec.requiredAnyOf.length === 0) continue;
      const without = { ...secrets };
      for (const n of spec.required) delete without[n];
      for (const g of spec.requiredAnyOf) for (const n of g) delete without[n];
      assert.throws(
        () => buildChildEnv(child, without),
        (error: unknown) => {
          assert.ok(error instanceof ChildEnvError);
          const message = (error as Error).message;
          for (const value of Object.values(without)) assert.ok(!message.includes(value), 'a value appeared in the message');
          for (const n of spec.required) assert.ok(message.includes(n));
          return true;
        },
        child,
      );
    }
    // an empty string counts as missing
    assert.throws(() => buildChildEnv('bootstrap-roles', { ...secrets, APP_TENANT_PASSWORD: '' }), (e: unknown) => e instanceof ChildEnvError && e.missing.join() === 'APP_TENANT_PASSWORD');
    // one of the two names of the bootstrap URL is enough; the deprecated alias counts
    const onlyAlias = { ...secrets };
    delete onlyAlias['MIGRATOR_BOOTSTRAP_DATABASE_URL'];
    assert.doesNotThrow(() => buildChildEnv('migrate', onlyAlias));
    const noUrl = { ...onlyAlias };
    delete noUrl['MIGRATOR_DATABASE_URL'];
    assert.throws(() => buildChildEnv('migrate', noUrl), (e: unknown) => e instanceof ChildEnvError && /one of MIGRATOR_BOOTSTRAP_DATABASE_URL \/ MIGRATOR_DATABASE_URL/.test(e.message));
  });

  it('9. shared variables go only to the processes that read them', () => {
    const w = world();
    const holders = (name: string): ChildProcessName[] => CHILD_PROCESS_NAMES.filter((c) => name.toUpperCase() in Object.fromEntries(Object.keys(buildChildEnv(c, w)).map((k) => [k.toUpperCase(), 1])));
    assert.deepEqual(holders('S3_ENDPOINT'), ['s3-shim', 'api']);
    assert.deepEqual(holders('NODE_ENV'), ['api', 'web']);
    assert.deepEqual(holders('DATABASE_URL'), ['api']);
    assert.deepEqual(holders('PORT'), ['api'], "PORT is the API's; the Web must keep its own default");
    assert.deepEqual(holders('API_URL'), ['web']);
    assert.deepEqual(holders('MIGRATOR_BOOTSTRAP_DATABASE_URL'), ['migrate', 'bootstrap-roles']);
    assert.deepEqual(holders('MIGRATOR_INCREMENTAL_PASSWORD'), ['migrate']);
    assert.deepEqual(holders('APP_TENANT_PASSWORD'), ['bootstrap-roles']);
    assert.deepEqual(holders('JWT_SECRET'), ['api']);
    assert.deepEqual(holders('PATH'), [...CHILD_PROCESS_NAMES], 'the system baseline reaches every process');
  });

  it('10/12. every process gets its own configuration and the lists are distinct (nothing of one leaks into another)', () => {
    const w = world();
    const appNames = (c: ChildProcessName): string[] => sorted(Object.keys(buildChildEnv(c, w)).filter((k) => !SYSTEM_BASELINE.includes(k.toUpperCase())));
    assert.deepEqual(appNames('s3-shim'), ['S3_ENDPOINT']);
    assert.deepEqual(appNames('web'), ['API_URL', 'NEXT_PUBLIC_API_URL', 'NEXT_TELEMETRY_DISABLED', 'NODE_ENV']);
    assert.deepEqual(appNames('migrate'), sorted(['MIGRATOR_EXPECTED_DATABASE', 'MIGRATOR_BOOTSTRAP_DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'MIGRATOR_INCREMENTAL_DATABASE_URL', 'MIGRATOR_INCREMENTAL_LOGIN', 'MIGRATOR_INCREMENTAL_PASSWORD', 'MIGRATOR_LOCK_TIMEOUT_SECONDS']));
    assert.deepEqual(appNames('bootstrap-roles'), sorted(['MIGRATOR_BOOTSTRAP_DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'APP_TENANT_PASSWORD', 'APP_PLATFORM_PASSWORD', 'APP_PUBLIC_RESOLVER_PASSWORD', 'APP_EVENT_PROCESSOR_PASSWORD', 'APP_IMPORT_WORKER_PASSWORD']));
    const api = appNames('api');
    for (const forbidden of ['MIGRATOR_BOOTSTRAP_DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'APP_TENANT_PASSWORD', 'APP_PLATFORM_PASSWORD', 'APP_IMPORT_WORKER_DATABASE_URL', 'APP_EVENT_PROCESSOR_DATABASE_URL', 'API_URL']) {
      assert.ok(!api.includes(forbidden), `the API must not receive ${forbidden}`);
    }
    for (const c of CHILD_PROCESS_NAMES) for (const d of CHILD_PROCESS_NAMES) if (c < d) assert.notDeepEqual(appNames(c), appNames(d));
  });

  it('11. a variable newly added to the environment is NOT transmitted until it is added to a list', () => {
    const w = { ...world(), [`NEW_${randomBytes(4).toString('hex').toUpperCase()}_SETTING`]: fake() };
    const added = Object.keys(w).find((k) => k.startsWith('NEW_')) as string;
    for (const child of CHILD_PROCESS_NAMES) assert.ok(!(added in buildChildEnv(child, w)));
  });

  it('overrides must be on the list of that child, and replace the looked-up value whatever its letter case', () => {
    const w = world();
    assert.equal(buildChildEnv('migrate', { ...w, migrator_expected_database: 'old' }, { MIGRATOR_EXPECTED_DATABASE: 'saas_inventory_dev' })['MIGRATOR_EXPECTED_DATABASE'], 'saas_inventory_dev');
    assert.equal(Object.keys(buildChildEnv('migrate', { ...w, migrator_expected_database: 'old' }, { MIGRATOR_EXPECTED_DATABASE: 'x' })).filter((k) => k.toUpperCase() === 'MIGRATOR_EXPECTED_DATABASE').length, 1);
    assert.throws(() => buildChildEnv('web', w, { QA_ADMIN_PASSWORD: 'nope' }), /not on the "web" list/);
    assert.throws(() => buildChildEnv('api', w, { MIGRATOR_EXPECTED_DATABASE: 'x' }), /not on the "api" list/);
  });

  it('names match whatever their letter case (Windows) and keep the casing found in the environment', () => {
    const env = buildChildEnv('web', { Path: 'p', SystemRoot: 'r', api_url: 'http://127.0.0.1:4000', Qa_Admin_Password: fake() });
    assert.deepEqual(sorted(Object.keys(env)), ['Path', 'SystemRoot', 'api_url']);
  });

  it('the lists themselves: no parent-only name, no secret-looking name in the system baseline, no wildcard, and QA_ADMIN_PASSWORD only in PARENT_ONLY_VARIABLES', () => {
    assert.deepEqual([...PARENT_ONLY_VARIABLES], ['QA_ADMIN_PASSWORD']);
    for (const n of SYSTEM_BASELINE) assert.ok(!/PASSWORD|SECRET|TOKEN|KEY$|CREDENTIAL/i.test(n), n);
    for (const child of CHILD_PROCESS_NAMES) for (const n of allowedNames(child)) assert.ok(!n.includes('*') && n !== '' && n.toUpperCase() !== 'QA_ADMIN_PASSWORD', `${child}: ${n}`);
  });

  it('a real child process started with the web environment sees API_URL but neither the database URL nor the QA password', () => {
    const password = fake();
    const env = buildChildEnv('web', { ...process.env, QA_ADMIN_PASSWORD: password, DATABASE_URL: `postgresql://u:${fake()}@127.0.0.1:5432/x`, API_URL: 'http://127.0.0.1:4000' });
    const probe = 'console.log(JSON.stringify({ api: process.env.API_URL, db: process.env.DATABASE_URL !== undefined, qa: process.env.QA_ADMIN_PASSWORD !== undefined }))';
    const r = spawnSync(process.execPath, ['-e', probe], { env, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), { api: 'http://127.0.0.1:4000', db: false, qa: false });
    assert.ok(!`${r.stdout}${r.stderr}`.includes(password));
  });

  it('the minimal environment is enough for the tooling: pnpm and node start through the shell with it (the same way dev-server.ts starts them)', () => {
    const env = buildChildEnv('web', process.env);
    const r = spawnSync('pnpm --version', { env, encoding: 'utf8', shell: true });
    assert.equal(r.status, 0, 'pnpm could not start with the baseline environment');
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });
});

describe('the PostgreSQL processes that embedded-postgres starts (initdb, postgres) — B4.11.5.10', () => {
  // The library launches both with `env: Object.assign({}, process.env, { LC_MESSAGES })` and has no option for an environment. This reproduces that exact expression with a real child
  // process (no PostgreSQL, no service): what it sees is what initdb / postgres would see.
  const NAMES = ['QA_ADMIN_PASSWORD', 'UNKNOWN_FUTURE_SETTING', 'PGPASSWORD', 'JWT_SECRET', 'DATABASE_URL', 'NODE_OPTIONS', 'PNPM_HOME'];
  const PROBE = `const keys = Object.keys(process.env).filter((k) => !k.startsWith('=')).map((k) => k.toUpperCase()).sort(); console.log(JSON.stringify(keys));`;
  const launchLikeTheLibrary = (): string[] => {
    const r = spawnSync(process.execPath, ['-e', PROBE], { env: Object.assign({}, process.env, { LC_MESSAGES: 'C' }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout) as string[];
  };
  const realisticWorld = (): Record<string, string | undefined> => ({
    ...process.env, // the real operating-system variables of whatever machine runs this test (Windows or POSIX)
    QA_ADMIN_PASSWORD: fake(),
    UNKNOWN_FUTURE_SETTING: fake(),
    PGPASSWORD: fake(),
    JWT_SECRET: fake(),
    DATABASE_URL: `postgresql://u:${fake()}@127.0.0.1:5432/x`,
    NODE_OPTIONS: '--no-warnings',
    PNPM_HOME: '/somewhere',
  });

  it('the profile is the operating-system essentials only: no QA password, no unknown variable, no PG*, no application secret, no toolchain setting', () => {
    const env = buildChildEnv('postgres', realisticWorld());
    const names = upper(Object.keys(env));
    for (const forbidden of NAMES) assert.ok(!names.includes(forbidden), forbidden);
    for (const name of names) assert.ok(OS_BASELINE.includes(name), `${name} is not an operating-system essential`);
    assert.deepEqual(upper(allowedNames('postgres')).sort(), upper(OS_BASELINE).sort());
  });

  it('initdb and postgres, launched while the swap is active, do not see QA_ADMIN_PASSWORD or any variable that is not an operating-system essential, and still see every essential that exists', async () => {
    const world = realisticWorld();
    const before = process.env;
    process.env['QA_ADMIN_PASSWORD'] = String(world['QA_ADMIN_PASSWORD']); // as if it were defined in the shell that started dev-server.ts
    try {
      const seen = await withChildProcessEnv('postgres', world, async () => ({ initdb: launchLikeTheLibrary(), postgres: launchLikeTheLibrary() }));
      // Windows itself adds default variables (USERPROFILE, TEMP, LOGONSERVER, …) to any process it creates with a custom environment: a control launch with almost nothing
      // tells which ones, so they are not mistaken for something inherited from us.
      const control = spawnSync(process.execPath, ['-e', PROBE], { env: { PATH: process.env['PATH'] ?? '', ...(process.env['SystemRoot'] !== undefined ? { SystemRoot: process.env['SystemRoot'] } : {}), LC_MESSAGES: 'C' }, encoding: 'utf8' });
      assert.equal(control.status, 0, control.stderr);
      const suppliedByTheSystem = JSON.parse(control.stdout) as string[];
      const expected = sorted(new Set([...upper(Object.keys(world)).filter((n) => OS_BASELINE.includes(n)), 'LC_MESSAGES', ...suppliedByTheSystem]));
      for (const [which, names] of Object.entries(seen)) {
        assert.deepEqual(names, expected, `${which}: exactly the essentials that exist, plus LC_MESSAGES (added by the library) and what the operating system supplies by itself`);
        for (const forbidden of NAMES) assert.ok(!names.includes(forbidden), `${which} got ${forbidden}`);
      }
      assert.ok(expected.includes('PATH'), 'PATH is an essential and reaches both');
      // and WITHOUT the swap the same launch would have leaked it — the reason this exists
      const leaked = launchLikeTheLibrary();
      assert.ok(leaked.includes('QA_ADMIN_PASSWORD'));
    } finally {
      delete process.env['QA_ADMIN_PASSWORD'];
    }
    assert.equal(process.env, before, 'the original process.env object is back');
  });

  it('works whatever the platform: nothing is Windows-specific (names of both families are listed, only those that exist are passed)', () => {
    for (const name of ['SYSTEMROOT', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'HOME', 'TMPDIR', 'LANG', 'USERPROFILE']) assert.ok(OS_BASELINE.includes(name), name);
    const env = buildChildEnv('postgres', { Path: '/usr/bin', systemroot: 'C:\\Windows', TMPDIR: '/tmp', HOME: '/home/x', Whatever: 'y' });
    assert.deepEqual(sorted(Object.keys(env)), ['HOME', 'Path', 'TMPDIR', 'systemroot']);
  });

  it('restores the original environment when the work fails, and the failure is the work\'s own (nothing is added, no value appears)', async () => {
    const secret = fake();
    const holder = { env: { KEEP: 'original', QA_ADMIN_PASSWORD: secret } as NodeJS.ProcessEnv };
    const original = holder.env;
    await assert.rejects(
      withChildProcessEnv('postgres', { PATH: '/bin', QA_ADMIN_PASSWORD: secret }, async () => {
        assert.deepEqual(holder.env, { PATH: '/bin' });
        throw new Error('boom');
      }, holder),
      (error: unknown) => error instanceof Error && error.message === 'boom' && !error.message.includes(secret),
    );
    assert.equal(holder.env, original);
    assert.equal(holder.env['QA_ADMIN_PASSWORD'], secret, 'the original object is untouched');
  });

  it('scrubParentOnlyVariables removes the variable (any letter case) from the holder and reports names only', () => {
    const secret = fake();
    const holder = { env: { PATH: '/bin', QA_ADMIN_PASSWORD: secret, qa_admin_password: secret, OTHER: 'x' } as NodeJS.ProcessEnv };
    const removed = scrubParentOnlyVariables(holder);
    assert.deepEqual(sorted(removed), ['QA_ADMIN_PASSWORD', 'qa_admin_password']);
    assert.deepEqual(Object.keys(holder.env).sort(), ['OTHER', 'PATH']);
    assert.ok(!JSON.stringify(removed).includes(secret));
    assert.deepEqual(scrubParentOnlyVariables(holder), [], 'idempotent');
  });

  it('the installed library still takes its environment from process.env at both launch sites (if this fails after an upgrade, review this mechanism)', () => {
    const library = readFileSync(new URL('./node_modules/embedded-postgres/dist/index.js', import.meta.url), 'utf8');
    assert.equal((library.match(/Object\.assign\(Object\.assign\(\{\}, process\.env\), \{ LC_MESSAGES: locale \}\)/g) ?? []).length, 2, 'initdb and postgres');
    assert.ok(!/this\.options\.env\b/.test(library), 'the library has no environment option, so the swap is the only control');
  });

  it('dev-server.ts wraps the whole cluster preparation in the swap and scrubs the parent-only variables right after reading them', () => {
    const source = readFileSync(new URL('./dev-server.ts', import.meta.url), 'utf8');
    const read = source.indexOf('const qaAdmin = action');
    const scrub = source.indexOf('scrubParentOnlyVariables();');
    const cluster = source.indexOf("withChildProcessEnv('postgres', available, () => prepareDevCluster(");
    assert.ok(read > 0 && scrub > read && cluster > scrub, 'order: read the QA admin, scrub, then prepare the cluster');
    assert.equal((source.match(/prepareDevCluster\(/g) ?? []).length, 1, 'the only call is the wrapped one');
  });
});

describe('regression (B4.11.5.7) — the QA login', () => {
  it('errors about the credential name the variable and never contain the value', () => {
    const tooShort = 'Aa1!x';
    assert.throws(() => loadQaAdmin({ QA_ADMIN_PASSWORD: tooShort }), (error: unknown) => error instanceof QaCredentialsError && error.message.includes('QA_ADMIN_PASSWORD') && !error.message.includes(tooShort));
  });
});

describe('dev-server.ts (static check of the source)', () => {
  const source = readFileSync(new URL('./dev-server.ts', import.meta.url), 'utf8');

  it('never hands a child the whole environment: the merge is only `available`, and every process start passes childEnv(<its own name>)', () => {
    assert.match(source, /const available: Record<string, string \| undefined> = \{ \.\.\.process\.env, \.\.\.fileEnv \};/);
    assert.doesNotMatch(source, /env:\s*process\.env/);
    const calls = source.match(/^\s+(?:runOrThrow|spawnChild)\(.*\);$/gm) ?? [];
    assert.equal(calls.length, 5, 'the five process starts');
    const names = calls.map((c) => /childEnv\('([a-z0-9-]+)'\)\);$/.exec(c)?.[1]);
    assert.deepEqual(names.sort(), ['api', 'bootstrap-roles', 'migrate', 's3-shim', 'web']);
    // `available` is read only inside buildChildEnv; the raw merges that remain feed loadQaAdmin (the parent's own use)
    assert.equal((source.match(/buildChildEnv\(child, available/g) ?? []).length, 1);
    const rawMerges = source.match(/\{ \.\.\.(?:fileEnv, \.\.\.process\.env|process\.env, \.\.\.fileEnv) \}/g) ?? [];
    assert.equal(rawMerges.length, 2, 'inside `available` and inside loadQaAdmin(...)');
  });

  it('the process names used there are exactly the ones child-env.ts defines', () => {
    for (const child of CHILD_PROCESS_NAMES) assert.ok(source.includes(`childEnv('${child}')`), child);
  });
});
