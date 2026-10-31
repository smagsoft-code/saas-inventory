import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MigratorEnv } from '../../src/database/migration-integrity/config';
import { canonicalMigrationHash, hashMigrationSql } from '../../src/database/migration-integrity/hash';
import { readMigrationsFolder } from '../../src/database/migration-integrity/migration-files';
import { runMigrations, type RunOptions, type RunResult } from '../../src/database/migration-runner/run-migrations';
import { MIGRATION_LOCK_CLASS, MIGRATION_LOCK_OBJECT, MIGRATION_LOCK_OBJSUBID } from '../../src/database/migration-runner/lock';
import { RlsWindowError, runWithRlsWindow } from '../../src/database/migration-runner/rls-window';
import { Pg16Cluster, PROTECTED_PORTS, harnessEnabled } from './cluster';

/**
 * Harness of the migration wrapper against a DISPOSABLE PostgreSQL cluster (ADR-0041, D-7.2).
 * Nothing here connects to a server this file did not start. Skipped unless
 * MIGRATION_HARNESS_PG_BIN is set (see vitest.migration-harness.config.ts).
 *
 * Every fixture database is made either by the wrapper itself or by Drizzle's own `migrate` (the
 * "legacy" flow every database used until now), on a folder of REAL migration copies. No historical
 * file is edited: tampering is done on copies in temp folders.
 */

const API_DIR = join(__dirname, '..', '..');
const REAL_FULL = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
/**
 * The historical scenarios below count migrations ("all 51", "the 11 remaining after 40", "the 32 after 19") and run the INCREMENTAL login over whatever remains,
 * which is only possible while every remaining migration is ordinary. 0051 is the first privileged migration after 0019, so those scenarios run on a frozen copy
 * of the first FROZEN_COUNT migrations of the real folder (byte-identical files, journal and manifests cut at that point) — exactly what they always meant.
 * Migrations after the frozen prefix are covered by their own scenario (section 12) on the full real folder.
 */
const FROZEN_COUNT = 51;
const INC_LOGIN = 'migrator_inc';
const INC_PASSWORD = randomBytes(18).toString('base64url');
const BOOT_LOGIN = 'postgres';
const scratch: string[] = [];
const allLines: string[] = [];

function frozenPrefix(source: string, count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'saas-mig-frozen-'));
  scratch.push(dir);
  cpSync(source, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const dropped = journal.entries.slice(count).map((e) => e.tag);
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}
`);
  for (const tag of dropped) {
    rmSync(join(dir, `${tag}.sql`), { force: true });
    rmSync(join(dir, 'meta', `${tag.slice(0, 4)}_snapshot.json`), { force: true });
  }
  for (const name of ['history-manifest.json', 'privileged-manifest.json']) {
    const path = join(dir, name);
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { entries: { tag: string }[] };
    manifest.entries = manifest.entries.filter((e) => !dropped.includes(e.tag));
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}
`);
  }
  return dir;
}
const REAL = harnessEnabled ? frozenPrefix(REAL_FULL, FROZEN_COUNT) : REAL_FULL;
let cluster: Pg16Cluster;
let bootPassword = '';

function capture() {
  const lines: string[] = [];
  return {
    lines,
    log: (line: string) => lines.push(line),
    err: (line: string) => lines.push(line),
  };
}

type Wrapped = RunResult & { text: string };
async function wrap(env: MigratorEnv, options: Partial<RunOptions> = {}): Promise<Wrapped> {
  const c = capture();
  const result = await runMigrations({ env, migrationsDir: REAL, log: c.log, logError: c.err, ...options });
  allLines.push(...c.lines);
  return { ...result, text: c.lines.join('\n') };
}
const codes = (r: RunResult) => r.diagnostics.map((d) => d.code);

function bootstrapEnv(db: string, extra: MigratorEnv = {}): MigratorEnv {
  return {
    MIGRATOR_BOOTSTRAP_DATABASE_URL: cluster.superuserUrl(db),
    MIGRATOR_EXPECTED_DATABASE: db,
    MIGRATOR_INCREMENTAL_LOGIN: INC_LOGIN,
    MIGRATOR_INCREMENTAL_PASSWORD: INC_PASSWORD,
    ...extra,
  };
}
function incrementalEnv(db: string, login = INC_LOGIN, extra: MigratorEnv = {}): MigratorEnv {
  return {
    MIGRATOR_INCREMENTAL_DATABASE_URL: cluster.url(login, INC_PASSWORD, db),
    MIGRATOR_INCREMENTAL_LOGIN: login,
    MIGRATOR_EXPECTED_DATABASE: db,
    ...extra,
  };
}

async function q<T extends Record<string, unknown>>(db: string, text: string): Promise<T[]> {
  const sql = cluster.admin(db);
  try {
    return [...(await sql.unsafe<T[]>(text))];
  } finally {
    await sql.end({ timeout: 5 });
  }
}
const scalar = async (db: string, text: string): Promise<unknown> => Object.values((await q(db, text))[0] ?? {})[0];
const registryCount = async (db: string) => Number(await scalar(db, 'SELECT count(*) FROM drizzle.__drizzle_migrations'));
const publicTables = async (db: string) => Number(await scalar(db, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`));

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `saas-mig-${label}-`));
  scratch.push(dir);
  return dir;
}

/** Drizzle's own `migrate` over the first `count` real migrations: the legacy flow, as the superuser. */
async function legacyMigrate(db: string, count: number): Promise<void> {
  const dir = tempDir('legacy');
  mkdirSync(join(dir, 'meta'));
  const journal = JSON.parse(readFileSync(join(REAL, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const entries = journal.entries.slice(0, count);
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const e of entries) cpSync(join(REAL, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  const sql = postgres(cluster.superuserUrl(db), { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: dir });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** A writable copy of the real migrations folder (manifests included). */
function copyOfReal(): string {
  const dir = tempDir('copy');
  cpSync(REAL, dir, { recursive: true });
  return dir;
}
interface ManifestShape {
  entries: Record<string, unknown>[];
}
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

/** Adds a migration to a COPY of the folder: file, journal entry and a v2 history entry. */
function addMigration(dir: string, tag: string, sqlText: string, opts: { classification?: 'ordinary' | 'privileged'; declarePrivileged?: boolean } = {}): void {
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = readJson<{ entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] }>(journalPath);
  const last = journal.entries[journal.entries.length - 1];
  if (last === undefined) throw new Error('empty journal');
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag, breakpoints: true });
  writeJson(journalPath, journal);
  writeFileSync(join(dir, `${tag}.sql`), sqlText);
  const historyPath = join(dir, 'history-manifest.json');
  const history = readJson<ManifestShape>(historyPath);
  history.entries.push({
    idx: last.idx + 1,
    tag,
    when: last.when + 1000,
    sha256: canonicalMigrationHash(sqlText),
    classification: opts.classification ?? 'ordinary',
    reviewedIn: 'review:harness:2026-10-28',
  });
  writeJson(historyPath, history);
  if (opts.declarePrivileged === true) {
    const privPath = join(dir, 'privileged-manifest.json');
    const priv = readJson<ManifestShape>(privPath);
    priv.entries.push({ tag, sha256: canonicalMigrationHash(sqlText), reason: 'harness' });
    writeJson(privPath, priv);
  }
}
function editHistory(dir: string, edit: (entries: Record<string, unknown>[]) => void): void {
  const path = join(dir, 'history-manifest.json');
  const history = readJson<ManifestShape>(path);
  edit(history.entries);
  writeJson(path, history);
}

/** Rows in pg_locks for the migration lock of a database (see lock.ts). */
async function lockRowCount(db: string): Promise<number> {
  return Number(
    await scalar(
      db,
      `SELECT count(*) FROM pg_locks l WHERE l.locktype = 'advisory' AND l.granted AND l.classid = ${MIGRATION_LOCK_CLASS} AND l.objid = ${MIGRATION_LOCK_OBJECT}
         AND l.database = (SELECT oid FROM pg_database WHERE datname = '${db}')`,
    ),
  );
}

async function untouched(db: string): Promise<void> {
  expect(await scalar(db, `SELECT count(*) FROM pg_namespace WHERE nspname = 'drizzle'`)).toBe('0');
  expect(await publicTables(db)).toBe(0);
}

const SKIP = !harnessEnabled;
describe.skipIf(SKIP)('migration wrapper on a disposable PostgreSQL cluster', () => {
  let bootstrapResult: Wrapped;
  let first = { hashes: [] as string[] };

  beforeAll(async () => {
    cluster = await Pg16Cluster.start();
    bootPassword = 'unused';
    // The very first database of the cluster: the wrapper must create app_migrator & co. from nothing.
    await cluster.createDatabase('golden');
    bootstrapResult = await wrap(bootstrapEnv('golden'));
    // Legacy fixtures (Drizzle's own migrate as the superuser), made AFTER the first bootstrap.
    await cluster.createDatabase('tpl_legacy_18');
    await legacyMigrate('tpl_legacy_18', 19);
    await cluster.createDatabase('tpl_legacy_40');
    await legacyMigrate('tpl_legacy_40', 40);
    await cluster.createDatabase('tpl_legacy_full');
    await legacyMigrate('tpl_legacy_full', 51);
    const folder = readMigrationsFolder(REAL);
    first = { hashes: folder.journal.map((e) => hashMigrationSql(folder.sqlByTag[e.tag] ?? '')) };
  });

  afterAll(async () => {
    try {
      await cluster?.stop();
    } finally {
      for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
    }
  });

  // A database copied with TEMPLATE keeps its objects and their ACLs but NOT the database-level privileges
  // (they live in pg_database), so a copy of a provisioned database must adopt the login again — exactly
  // what an existing database does. The wrapper refused the copies without it (IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE).
  const fromTemplate = async (name: string, template: string) => {
    await cluster.createDatabase(name, template);
    if (template === 'golden') {
      const adopt = await wrap(bootstrapEnv(name), { provisionOnly: true });
      expect(adopt.exitCode, adopt.text).toBe(0);
    }
  };

  describe('the cluster itself', () => {
    it('is PostgreSQL 16.x, on a port that is not protected', async () => {
      expect(await cluster.serverVersion()).toMatch(/^16\./);
      expect(PROTECTED_PORTS).not.toContain(cluster.port);
      if (cluster.external) expect(cluster.root).toBe('');
      else expect(cluster.root.startsWith(tmpdir())).toBe(true);
    });

    // D-8E: CI sets MIGRATION_HARNESS_EXPECTED_SERVER_VERSION_NUM=160015; the number comes from the server itself, not from the image name.
    it.runIf(process.env['MIGRATION_HARNESS_EXPECTED_SERVER_VERSION_NUM'] !== undefined)('is exactly the pinned PostgreSQL version, as reported by the server', async () => {
      expect(await cluster.serverVersionNum()).toBe(Number(process.env['MIGRATION_HARNESS_EXPECTED_SERVER_VERSION_NUM']));
    });
  });

  describe('1. bootstrap from an empty database', () => {
    it('applies all 51 migrations and exits 0', () => {
      expect(bootstrapResult.exitCode).toBe(0);
      expect(bootstrapResult.stage).toBe('done');
      expect(bootstrapResult.applied).toHaveLength(51);
      expect(bootstrapResult.text).toContain('session_user=postgres');
    });

    it('the registry equals the journal, in order, with the hashes Drizzle computes from the files', async () => {
      const rows = await q<{ hash: string }>('golden', 'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id');
      expect(rows.map((r) => r.hash)).toEqual(first.hashes);
    });

    it('0019 created app_import_worker (the cluster had no such role before)', async () => {
      expect(await scalar('golden', `SELECT count(*) FROM pg_roles WHERE rolname = 'app_import_worker'`)).toBe('1');
    });

    it('every public table is owned by app_migrator and every RLS table has FORCE restored', async () => {
      expect(await publicTables('golden')).toBe(54);
      expect(await scalar('golden', `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'app_migrator'`)).toBe('0');
      expect(
        await scalar(
          'golden',
          `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity`,
        ),
      ).toBe('0');
    });
  });

  describe('16/17. ownership, effective privileges and the Drizzle registry', () => {
    it('the incremental login is limited: LOGIN only, no inheritance, SET membership in app_migrator', async () => {
      const [role] = await q<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean; rolreplication: boolean }>(
        'golden',
        `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin, rolinherit, rolreplication FROM pg_roles WHERE rolname = '${INC_LOGIN}'`,
      );
      expect(role).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolcanlogin: true, rolinherit: false, rolreplication: false });
      const [member] = await q<{ set_option: boolean; inherit_option: boolean; n: string }>(
        'golden',
        `SELECT m.set_option, m.inherit_option, count(*) OVER () AS n FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
          WHERE u.rolname = '${INC_LOGIN}'`,
      );
      expect(member).toMatchObject({ set_option: true, inherit_option: false, n: '1' });
    });

    it('app_migrator has CREATE on the database, and on Drizzle objects exactly USAGE+CREATE / SELECT+INSERT / USAGE', async () => {
      const privilege = async (expr: string) => (await scalar('golden', `SELECT ${expr}`)) as boolean;
      expect(await privilege(`has_database_privilege('app_migrator', 'golden', 'CREATE')`)).toBe(true);
      expect(await privilege(`has_schema_privilege('app_migrator', 'drizzle', 'USAGE')`)).toBe(true);
      expect(await privilege(`has_schema_privilege('app_migrator', 'drizzle', 'CREATE')`)).toBe(true);
      const t = 'drizzle.__drizzle_migrations';
      for (const p of ['SELECT', 'INSERT']) expect(await privilege(`has_table_privilege('app_migrator', '${t}', '${p}')`)).toBe(true);
      for (const p of ['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        expect(await privilege(`has_table_privilege('app_migrator', '${t}', '${p}')`)).toBe(false);
      }
      expect(await privilege(`has_sequence_privilege('app_migrator', 'drizzle.__drizzle_migrations_id_seq', 'USAGE')`)).toBe(true);
      expect(await privilege(`has_sequence_privilege('app_migrator', 'drizzle.__drizzle_migrations_id_seq', 'UPDATE')`)).toBe(false);
      expect(await scalar('golden', `SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = '${t}'::regclass`)).toBe(BOOT_LOGIN);
    });

    it('as the login, with and without SET ROLE: what it can and cannot do to the registry', async () => {
      await fromTemplate('priv', 'golden');
      const sql: Sql = postgres(cluster.url(INC_LOGIN, INC_PASSWORD, 'priv'), { max: 1, onnotice: () => undefined });
      const attempt = async (statement: string): Promise<string> => {
        try {
          await sql.unsafe(statement);
          return 'ok';
        } catch (error) {
          return (error as { code?: string }).code ?? 'error';
        }
      };
      try {
        // the login alone holds nothing
        expect(await attempt('SELECT 1 FROM public.tenants LIMIT 1')).toBe('42501');
        expect(await attempt('SET ROLE postgres')).toBe('42501');
        expect(await attempt('SET ROLE app_platform')).toBe('42501');
        // as app_migrator it can work, but not rewrite history...
        expect(await attempt('SET ROLE app_migrator')).toBe('ok');
        expect(await attempt('SELECT 1 FROM public.tenants LIMIT 1')).toBe('ok');
        expect(await attempt(`UPDATE drizzle.__drizzle_migrations SET hash = 'x'`)).toBe('42501');
        expect(await attempt('DELETE FROM drizzle.__drizzle_migrations')).toBe('42501');
        expect(await attempt('TRUNCATE drizzle.__drizzle_migrations')).toBe('42501');
        expect(await attempt('DROP TABLE drizzle.__drizzle_migrations')).toBe('42501');
        expect(await attempt('ALTER TABLE drizzle.__drizzle_migrations ADD COLUMN x int')).toBe('42501');
        expect(await attempt(`CREATE ROLE harness_evil`)).toBe('42501');
        // RESET ROLE returns to the login, which holds nothing
        expect(await attempt('RESET ROLE')).toBe('ok');
        expect(await attempt('SELECT 1 FROM public.tenants LIMIT 1')).toBe('42501');
        // ...but it CAN insert a row: privileges cannot stop a forged created_at (the wrapper's job, see 12)
        expect(await attempt('SET ROLE app_migrator')).toBe('ok');
        expect(await attempt(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('forged', 9999999999999)`)).toBe('ok');
        // KNOWN residual: CREATE on schema drizzle lets it add its own objects there (needed so that
        // Drizzle's "CREATE TABLE IF NOT EXISTS" passes its privilege check).
        expect(await attempt('CREATE TABLE drizzle.harness_extra (id int)')).toBe('ok');
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });

  describe('2/3/4. incremental from a consistent state, idempotent, with the right identity', () => {
    it('a second run is a no-op in both modes and changes neither the registry nor any ACL', async () => {
      const fingerprint = async () =>
        scalar(
          'golden',
          `SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || coalesce(c.relacl::text, ''), ',' ORDER BY n.nspname, c.relname))
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle')`,
        );
      const before = { registry: await registryCount('golden'), acl: await fingerprint() };
      const again = await wrap(bootstrapEnv('golden'));
      const incremental = await wrap(incrementalEnv('golden'));
      expect([again.exitCode, again.applied.length]).toEqual([0, 0]);
      expect([incremental.exitCode, incremental.applied.length]).toEqual([0, 0]);
      expect(incremental.text).toContain(`session_user=${INC_LOGIN}`);
      expect(incremental.text).toContain('current_user=app_migrator');
      expect({ registry: await registryCount('golden'), acl: await fingerprint() }).toEqual(before);
    });

    it('a database migrated by the legacy flow adopts the login with --provision-only, then migrates incrementally as the login', async () => {
      await fromTemplate('adopt40', 'tpl_legacy_40');
      expect(await registryCount('adopt40')).toBe(40);

      // Incremental cannot start before the login exists...
      const premature = await wrap(incrementalEnv('adopt40'));
      expect(premature.exitCode).toBe(1);
      expect(await registryCount('adopt40')).toBe(40);

      // ...bootstrap refuses ordinary-only work...
      const refused = await wrap(bootstrapEnv('adopt40'));
      expect(refused.exitCode).toBe(1);
      expect(codes(refused)).toContain('MODE_BOOTSTRAP_NOT_REQUIRED');
      expect(await registryCount('adopt40')).toBe(40);

      // ...so the database adopts the login without applying anything
      const adopt = await wrap(bootstrapEnv('adopt40'), { provisionOnly: true });
      expect(adopt.exitCode).toBe(0);
      expect(adopt.applied).toEqual([]);
      expect(await registryCount('adopt40')).toBe(40);

      const run = await wrap(incrementalEnv('adopt40'));
      expect(run.exitCode).toBe(0);
      expect(run.applied).toHaveLength(11);
      expect(run.text).toContain(`session_user=${INC_LOGIN}`);
      expect(await registryCount('adopt40')).toBe(51);
      expect(await scalar('adopt40', `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'app_migrator'`)).toBe('0');
      expect(
        await scalar('adopt40', `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity`),
      ).toBe('0');
    });

    it('--provision-only refuses a database with no app_migrator history and a non-bootstrap configuration', async () => {
      await cluster.createDatabase('prov_empty');
      const emptyAdopt = await wrap(bootstrapEnv('prov_empty'), { provisionOnly: true });
      expect(emptyAdopt.exitCode).toBe(1);
      expect(await publicTables('prov_empty')).toBe(0);
      const wrongMode = await wrap(incrementalEnv('golden'), { provisionOnly: true });
      expect(codes(wrongMode)).toEqual(['CONFIG_VARIABLE_CONFLICT']);
    });
  });

  describe('5/6/7/8. identity and configuration are refused, and nothing is executed', () => {
    it.each([
      ['a superuser', `LOGIN SUPERUSER`, 'IDENTITY_SESSION_SUPERUSER'],
      ['a BYPASSRLS login', `LOGIN BYPASSRLS`, 'IDENTITY_SESSION_BYPASSRLS'],
      ['a CREATEROLE login', `LOGIN CREATEROLE`, 'IDENTITY_SESSION_CREATEROLE'],
    ])('incremental mode refuses %s', async (_name, attributes, code) => {
      const login = `inc_${code.toLowerCase().replace('identity_session_', '')}`;
      const admin = cluster.admin();
      try {
        await admin.unsafe(`CREATE ROLE ${login} ${attributes} PASSWORD '${INC_PASSWORD}'`);
        await admin.unsafe(`GRANT app_migrator TO ${login} WITH INHERIT FALSE, SET TRUE`);
      } finally {
        await admin.end({ timeout: 5 });
      }
      const before = await registryCount('golden');
      const r = await wrap(incrementalEnv('golden', login));
      expect(r.exitCode).toBe(1);
      expect(r.applied).toEqual([]);
      expect(codes(r)).toContain(code);
      expect(await registryCount('golden')).toBe(before);
    });

    it('refuses a login that cannot SET ROLE, and an app_migrator without CREATE on the database', async () => {
      const admin = cluster.admin();
      try {
        await admin.unsafe(`CREATE ROLE inc_nomember LOGIN PASSWORD '${INC_PASSWORD}'`);
      } finally {
        await admin.end({ timeout: 5 });
      }
      const noMember = await wrap(incrementalEnv('golden', 'inc_nomember'));
      expect(noMember.exitCode).toBe(1);
      expect(codes(noMember)).toEqual(expect.arrayContaining(['IDENTITY_NO_SET_MEMBERSHIP']));

      await fromTemplate('nocreate', 'golden');
      await q('nocreate', 'REVOKE CREATE ON DATABASE nocreate FROM app_migrator');
      const noCreate = await wrap(incrementalEnv('nocreate'));
      expect(noCreate.exitCode).toBe(1);
      expect(codes(noCreate)).toContain('IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE');
    });

    it('refuses wrong database, unexpected login, equal logins and bad passwords before connecting to anything', async () => {
      const wrongDb = await wrap({ ...incrementalEnv('golden'), MIGRATOR_EXPECTED_DATABASE: 'not_golden' });
      expect(wrongDb.stage).toBe('config');
      expect(codes(wrongDb)).toContain('CONFIG_DATABASE_URL_MISMATCH');

      const wrongLogin = await wrap({ ...incrementalEnv('golden'), MIGRATOR_INCREMENTAL_LOGIN: 'someone_else' });
      expect(codes(wrongLogin)).toContain('CONFIG_LOGIN_URL_MISMATCH');

      const sameLogin = await wrap(bootstrapEnv('golden', { MIGRATOR_BOOTSTRAP_DATABASE_URL: cluster.url(INC_LOGIN, bootPassword, 'golden') }));
      expect(codes(sameLogin)).toContain('CONFIG_LOGINS_NOT_SEPARATED');

      const shortPassword = await wrap(bootstrapEnv('golden', { MIGRATOR_INCREMENTAL_PASSWORD: 'short' }));
      expect(codes(shortPassword)).toContain('CONFIG_PASSWORD_INVALID');

      const noFallback = await wrap({ MIGRATOR_BOOTSTRAP_DATABASE_URL: cluster.superuserUrl('golden'), MIGRATOR_EXPECTED_DATABASE: 'golden' }, { requestedMode: 'incremental' });
      expect(codes(noFallback)).toContain('CONFIG_VARIABLE_MISSING');
      for (const r of [wrongDb, wrongLogin, sameLogin, shortPassword, noFallback]) expect(r.exitCode).toBe(1);
    });
  });

  describe('9/10/13/14/20. broken references are refused before Drizzle runs (the empty database is left untouched)', () => {
    const refusedOnEmpty = async (name: string, dir: string, expected: string[], env: (db: string) => MigratorEnv = bootstrapEnv) => {
      await cluster.createDatabase(name);
      const r = await wrap(env(name), { migrationsDir: dir });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('files');
      expect(r.applied).toEqual([]);
      for (const code of expected) expect(codes(r)).toContain(code);
      await untouched(name);
    };

    it('a journal with a gap', async () => {
      const dir = copyOfReal();
      const path = join(dir, 'meta', '_journal.json');
      const journal = readJson<{ entries: { idx: number }[] }>(path);
      journal.entries.splice(10, 1);
      writeJson(path, journal);
      await refusedOnEmpty('j_gap', dir, ['JOURNAL_IDX_NOT_CONTIGUOUS']);
    });

    it('a journal with a duplicate entry', async () => {
      const dir = copyOfReal();
      const path = join(dir, 'meta', '_journal.json');
      const journal = readJson<{ entries: Record<string, unknown>[] }>(path);
      journal.entries[11] = { ...(journal.entries[10] ?? {}) };
      writeJson(path, journal);
      await refusedOnEmpty('j_dup', dir, ['JOURNAL_IDX_DUPLICATE']);
    });

    it('missing, incomplete and divergent manifests', async () => {
      const missingPrivileged = copyOfReal();
      rmSync(join(missingPrivileged, 'privileged-manifest.json'));
      await refusedOnEmpty('m_nopriv', missingPrivileged, ['PRIVILEGED_MANIFEST_MALFORMED']);

      const missingHistory = copyOfReal();
      rmSync(join(missingHistory, 'history-manifest.json'));
      await refusedOnEmpty('m_nohist', missingHistory, ['MANIFEST_MALFORMED']);

      const incomplete = copyOfReal();
      editHistory(incomplete, (entries) => entries.splice(20, 1));
      await refusedOnEmpty('m_incomplete', incomplete, ['MANIFEST_ENTRY_MISSING']);

      const noRequired = copyOfReal();
      const privPath = join(noRequired, 'privileged-manifest.json');
      const priv = readJson<ManifestShape>(privPath);
      priv.entries = priv.entries.filter((e) => e['tag'] !== '0019_import_worker_role');
      writeJson(privPath, priv);
      await refusedOnEmpty('m_norequired', noRequired, ['PRIVILEGED_MANIFEST_REQUIRED_MISSING', 'CLASSIFICATION_MISMATCH']);

      const divergent = copyOfReal();
      writeFileSync(join(divergent, '0032_core_roles_manage_permission.sql'), `${readFileSync(join(divergent, '0032_core_roles_manage_permission.sql'), 'utf8')}\n-- tampered\n`);
      await refusedOnEmpty('m_divergent', divergent, ['MANIFEST_HASH_MISMATCH']);
    });

    it('an unclassified migration, a classification without review evidence, and a mismatched classification', async () => {
      const noClass = copyOfReal();
      editHistory(noClass, (entries) => delete entries[5]?.['classification']);
      await refusedOnEmpty('c_missing', noClass, ['CLASSIFICATION_MISSING']);

      const noReview = copyOfReal();
      editHistory(noReview, (entries) => delete entries[6]?.['reviewedIn']);
      await refusedOnEmpty('c_noreview', noReview, ['REVIEW_EVIDENCE_MISSING']);

      const badReview = copyOfReal();
      editHistory(badReview, (entries) => {
        if (entries[7] !== undefined) entries[7]['reviewedIn'] = 'approved by me';
      });
      await refusedOnEmpty('c_badreview', badReview, ['REVIEW_EVIDENCE_INVALID']);

      const mismatch = copyOfReal();
      editHistory(mismatch, (entries) => {
        if (entries[8] !== undefined) entries[8]['classification'] = 'privileged';
      });
      await refusedOnEmpty('c_mismatch', mismatch, ['CLASSIFICATION_MISMATCH']);
    });

    it('a privileged file nobody declared (even if recorded as ordinary), without touching the manifests', async () => {
      const dir = copyOfReal();
      addMigration(dir, '0051_creates_role', 'CREATE ROLE harness_undeclared;', { classification: 'ordinary' });
      const before = readFileSync(join(dir, 'history-manifest.json'), 'utf8');
      await refusedOnEmpty('p_undeclared', dir, ['PRIVILEGED_STATEMENT_UNDECLARED']);
      expect(readFileSync(join(dir, 'history-manifest.json'), 'utf8')).toBe(before);
    });
  });

  describe('11. a pending privileged migration (0019) and the identity around RESET ROLE', () => {
    it('incremental refuses to continue past 0018; bootstrap applies 0019… and leaves app_migrator as the effective role', async () => {
      await fromTemplate('at18', 'tpl_legacy_18');
      expect((await wrap(bootstrapEnv('at18'), { provisionOnly: true })).exitCode).toBe(0);
      expect(await registryCount('at18')).toBe(19);

      const refused = await wrap(incrementalEnv('at18'));
      expect(refused.exitCode).toBe(1);
      expect(codes(refused)).toContain('PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE');
      expect(await registryCount('at18')).toBe(19);
      expect(await scalar('at18', `SELECT count(*) FROM information_schema.columns WHERE table_name = 'import_jobs' AND column_name = 'claimed_at'`)).toBe('0');

      const bootstrap = await wrap(bootstrapEnv('at18'));
      expect(bootstrap.exitCode).toBe(0);
      expect(bootstrap.applied).toHaveLength(32);
      expect(bootstrap.text).toContain('session_user=postgres');
      expect(bootstrap.text).toContain('current_user=app_migrator');
      expect(await registryCount('at18')).toBe(51);
      expect(await scalar('at18', `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'app_migrator'`)).toBe('0');
    });
  });

  describe('12. an inconsistent Drizzle history is refused and left intact', () => {
    const refusedHistory = async (name: string, tamper: string, expected: string[]) => {
      await fromTemplate(name, 'golden');
      await q(name, tamper);
      const tablesBefore = await publicTables(name);
      const rowsBefore = await registryCount(name).catch(() => -1);
      const r = await wrap(incrementalEnv(name));
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('assess');
      expect(r.applied).toEqual([]);
      expect(codes(r)).toEqual(expect.arrayContaining(expected));
      expect(await publicTables(name)).toBe(tablesBefore);
      expect(await registryCount(name).catch(() => -1)).toBe(rowsBefore);
    };

    it('a registry row that is missing', () =>
      refusedHistory('h_missing_row', `DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT id FROM drizzle.__drizzle_migrations ORDER BY id OFFSET 20 LIMIT 1)`, ['HISTORY_MISSING_APPLIED_MIGRATION']));

    it('a registry hash that no longer matches its file', () =>
      refusedHistory('h_hash', `UPDATE drizzle.__drizzle_migrations SET hash = repeat('0', 64) WHERE id = (SELECT id FROM drizzle.__drizzle_migrations ORDER BY id OFFSET 31 LIMIT 1)`, ['HISTORY_HASH_MISMATCH']));

    it('an extra registry row without a journal entry', () =>
      refusedHistory('h_extra', `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('extra', 9999999999999)`, ['REGISTRY_ROW_WITHOUT_JOURNAL_ENTRY']));

    it('a registry that is gone, or empty, while the tables exist', async () => {
      await refusedHistory('h_absent', 'DROP SCHEMA drizzle CASCADE', ['REGISTRY_MISSING_WITH_TABLES']);
      await refusedHistory('h_empty', 'DELETE FROM drizzle.__drizzle_migrations', ['REGISTRY_EMPTY_WITH_TABLES']);
    });

    it('a forged future row inserted by the incremental login itself: Drizzle alone skips the pending migrations silently, the wrapper refuses', async () => {
      // Two copies of a database with 40 migrations applied and the login adopted.
      for (const name of ['forge_wrapper', 'forge_drizzle']) {
        await fromTemplate(name, 'tpl_legacy_40');
        expect((await wrap(bootstrapEnv(name), { provisionOnly: true })).exitCode).toBe(0);
        const sql = postgres(cluster.url(INC_LOGIN, INC_PASSWORD, name), { max: 1, onnotice: () => undefined });
        try {
          await sql.unsafe('SET ROLE app_migrator');
          // privileges allow it: this is the hazard
          await sql.unsafe(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('forged', 9999999999999)`);
        } finally {
          await sql.end({ timeout: 5 });
        }
      }
      // (a) Drizzle on its own: exit without error, and nothing pending is applied.
      const direct = postgres(cluster.superuserUrl('forge_drizzle'), { max: 1, onnotice: () => undefined });
      try {
        await migrate(drizzle(direct), { migrationsFolder: REAL });
      } finally {
        await direct.end({ timeout: 5 });
      }
      expect(await registryCount('forge_drizzle')).toBe(41);
      expect(await scalar('forge_drizzle', `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant_logos'`)).toBe('0');

      // (b) the wrapper refuses
      const r = await wrap(incrementalEnv('forge_wrapper'));
      expect(r.exitCode).toBe(1);
      expect(codes(r)).toEqual(expect.arrayContaining(['HISTORY_NOT_PREFIX']));
      expect(await registryCount('forge_wrapper')).toBe(41);
      expect(await scalar('forge_wrapper', `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant_logos'`)).toBe('0');
    });
  });

  describe('15. a failing migration rolls the whole batch back', () => {
    it('two new migrations, the second fails: neither table exists, the registry is unchanged, a retry fails the same way', async () => {
      await fromTemplate('failing', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_harness_ok', 'CREATE TABLE harness_ok (id int);');
      addMigration(dir, '0052_harness_fails', 'CREATE TABLE harness_bad (id int);--> statement-breakpoint\nSELECT 1/0;');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const r = await wrap(incrementalEnv('failing'), { migrationsDir: dir });
        expect(r.exitCode).toBe(1);
        expect(r.stage, r.text).toBe('migrate');
        expect(r.text).toContain('registry unchanged: true');
        expect(await registryCount('failing')).toBe(51);
        expect(await scalar('failing', `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('harness_ok', 'harness_bad')`)).toBe('0');
      }
    });
  });

  describe('12 (residual risk, narrowed by D-8B and D-8D). an explicit classification is not a semantic validation', () => {
    it('what was a KNOWN LIMIT in D-7.2: GRANT ALL … TO app_tenant is now refused by the SQL linter, before Drizzle', async () => {
      await fromTemplate('residual', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_grant_all', 'GRANT ALL ON ALL TABLES IN SCHEMA public TO app_tenant;');
      const r = await wrap(incrementalEnv('residual'), { migrationsDir: dir });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('lint');
      expect(codes(r)).toEqual(['SQL_LINT_ERROR']);
      expect(r.text).toContain('PRIV-GRANT-BROAD');
      expect(await registryCount('residual')).toBe(51);
    });

    it('DISABLE ROW LEVEL SECURITY is refused by the linter first; with the linter off, the D-8B invariants still refuse it BEFORE the commit', async () => {
      await fromTemplate('residual_rls', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_disable_rls', 'ALTER TABLE public.warehouses DISABLE ROW LEVEL SECURITY;');
      const byLint = await wrap(incrementalEnv('residual_rls'), { migrationsDir: dir });
      expect([byLint.exitCode, byLint.stage]).toEqual([1, 'lint']);
      expect(byLint.text).toContain('RLS-DISABLE');

      const byInvariants = await wrap(incrementalEnv('residual_rls'), { migrationsDir: dir, disableSqlLintForTests: true });
      expect(byInvariants.stage).toBe('migrate');
      expect(codes(byInvariants)).toEqual(['INVARIANT_RLS_DISABLED']);
      expect(await scalar('residual_rls', `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.warehouses'::regclass`)).toBe(true);
      expect(await registryCount('residual_rls')).toBe(51);
    });

    it('REMAINING LIMIT: a narrow GRANT to a project role passes with a WARNING (the linter does not decide whether the privilege is right)', async () => {
      await fromTemplate('residual_grant', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_narrow_grant', 'GRANT SELECT ON public.warehouses TO app_event_processor;');
      const r = await wrap(incrementalEnv('residual_grant'), { migrationsDir: dir });
      expect([r.exitCode, r.applied.length], r.text).toEqual([0, 1]);
      expect(r.text).toContain('warning PRIV-GRANT × 1');
    });
  });

  describe('18. controlled RLS windows', () => {
    const setup = async (db: string) => {
      await fromTemplate(db, 'golden');
      const admin = cluster.admin(db);
      try {
        await admin.unsafe('SET ROLE app_migrator');
        await admin.unsafe('CREATE TABLE public.rls_probe (tenant_id uuid NOT NULL, v int NOT NULL)');
        await admin.unsafe('ALTER TABLE public.rls_probe ENABLE ROW LEVEL SECURITY');
        await admin.unsafe('ALTER TABLE public.rls_probe FORCE ROW LEVEL SECURITY');
        await admin.unsafe(`CREATE POLICY probe_tenant ON public.rls_probe FOR ALL TO app_tenant USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`);
        await admin.unsafe('RESET ROLE'); // the superuser bypasses RLS to seed rows
        await admin.unsafe(`INSERT INTO public.rls_probe VALUES (gen_random_uuid(), 1), (gen_random_uuid(), 1)`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    };
    const asMigrator = async (db: string): Promise<Sql> => {
      const sql = postgres(cluster.superuserUrl(db), { max: 1, onnotice: () => undefined });
      await sql.unsafe('SET ROLE app_migrator');
      return sql;
    };
    const state = (db: string) =>
      q<{ force: boolean; enabled: boolean }>(db, `SELECT relforcerowsecurity AS force, relrowsecurity AS enabled FROM pg_class WHERE oid = 'public.rls_probe'::regclass`);
    const values = async (db: string) => (await q<{ v: number }>(db, 'SELECT v FROM public.rls_probe ORDER BY v')).map((r) => r.v);

    it('without a window the UPDATE succeeds with ZERO effect; with the window it changes every row and FORCE is restored', async () => {
      await setup('rls_ok');
      const sql = await asMigrator('rls_ok');
      try {
        const trap = await sql.unsafe(`UPDATE public.rls_probe SET v = 2`);
        expect(trap.count).toBe(0);
        expect(await values('rls_ok')).toEqual([1, 1]);

        let activeInside: unknown;
        await runWithRlsWindow(sql, {
          tables: ['rls_probe'],
          run: async (tx) => {
            activeInside = (await tx.unsafe(`SELECT row_security_active('public.rls_probe'::regclass) AS a`))[0]?.['a'];
            await tx.unsafe(`UPDATE public.rls_probe SET v = 2`);
          },
          postcondition: async (tx) => (await tx.unsafe(`SELECT count(*) FILTER (WHERE v <> 2) AS bad FROM public.rls_probe`))[0]?.['bad'] === '0',
        });
        expect(activeInside).toBe(false);
        expect(await values('rls_ok')).toEqual([2, 2]);
        expect(await state('rls_ok')).toEqual([{ force: true, enabled: true }]);
        expect((await sql.unsafe(`SELECT row_security_active('public.rls_probe'::regclass) AS a`))[0]?.['a']).toBe(true);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it.each([
      ['the postcondition fails', 'postcondition'],
      ['the DML throws', 'run'],
    ])('when %s everything rolls back, data and FORCE included', async (_name, failing) => {
      const db = `rls_${failing}`;
      await setup(db);
      const sql = await asMigrator(db);
      try {
        await expect(
          runWithRlsWindow(sql, {
            tables: ['rls_probe'],
            run: async (tx) => {
              await tx.unsafe(`UPDATE public.rls_probe SET v = 3`);
              if (failing === 'run') throw new Error('boom');
            },
            postcondition: async () => false,
          }),
        ).rejects.toThrow();
        expect(await values(db)).toEqual([1, 1]);
        expect(await state(db)).toEqual([{ force: true, enabled: true }]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it('refuses the wrong identity, a table that does not start FORCEd, and bad arguments', async () => {
      await setup('rls_refuse');
      const superuser = postgres(cluster.superuserUrl('rls_refuse'), { max: 1, onnotice: () => undefined });
      try {
        await expect(runWithRlsWindow(superuser, { tables: ['rls_probe'], run: async () => undefined, postcondition: async () => true })).rejects.toMatchObject({ step: 'identity' });
      } finally {
        await superuser.end({ timeout: 5 });
      }
      await q('rls_refuse', 'ALTER TABLE public.rls_probe NO FORCE ROW LEVEL SECURITY');
      const sql = await asMigrator('rls_refuse');
      try {
        await expect(runWithRlsWindow(sql, { tables: ['rls_probe'], run: async () => undefined, postcondition: async () => true })).rejects.toMatchObject({ step: 'initial-state' });
        await expect(runWithRlsWindow(sql, { tables: [], run: async () => undefined, postcondition: async () => true })).rejects.toBeInstanceOf(RlsWindowError);
        await expect(runWithRlsWindow(sql, { tables: ['public.x; drop'], run: async () => undefined, postcondition: async () => true })).rejects.toMatchObject({ step: 'arguments' });
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });

  describe('exit codes and output of the real process (pnpm db:migrate)', () => {
    const cleanEnv = (): NodeJS.ProcessEnv => {
      const env: NodeJS.ProcessEnv = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('PG') && !k.startsWith('MIGRATOR_')) env[k] = v;
      return env;
    };
    const cli = (vars: Record<string, string>, args: string[] = []) => {
      const r = spawnSync('pnpm', ['exec', 'tsx', 'src/database/migrate.ts', ...args], { cwd: API_DIR, env: { ...cleanEnv(), ...vars }, encoding: 'utf8', shell: true });
      const text = `${r.stdout}${r.stderr}`;
      allLines.push(text);
      return { status: r.status, text };
    };

    it('exits 0 on success and 1 on refusal; the deprecated alias works with a warning that does not echo the URL', async () => {
      await fromTemplate('cli_ok', 'golden');
      // 'golden' holds the frozen first 51 migrations; the real process reads the REAL folder, which has more (0051 is privileged: bootstrap mode applies it).
      const catchUp = cli({ MIGRATOR_BOOTSTRAP_DATABASE_URL: cluster.superuserUrl('cli_ok'), MIGRATOR_EXPECTED_DATABASE: 'cli_ok' });
      expect(catchUp.status, catchUp.text).toBe(0);
      expect(catchUp.text).toContain('Migrations applied successfully');
      const ok = cli({ MIGRATOR_BOOTSTRAP_DATABASE_URL: cluster.superuserUrl('cli_ok'), MIGRATOR_EXPECTED_DATABASE: 'cli_ok' });
      expect(ok.status).toBe(0);
      expect(ok.text).toContain('Nothing to apply');

      const legacy = cli({ MIGRATOR_DATABASE_URL: cluster.superuserUrl('cli_ok'), MIGRATOR_EXPECTED_DATABASE: 'cli_ok' });
      expect(legacy.status).toBe(0);
      expect(legacy.text).toMatch(/deprecated/i);
      expect(legacy.text).not.toContain('127.0.0.1');

      const refused = cli({ MIGRATOR_BOOTSTRAP_DATABASE_URL: cluster.superuserUrl('cli_ok'), MIGRATOR_EXPECTED_DATABASE: 'another_db' });
      expect(refused.status).toBe(1);
      expect(refused.text).toContain('CONFIG_DATABASE_URL_MISMATCH');

      const noMode = cli({ MIGRATOR_EXPECTED_DATABASE: 'cli_ok' });
      expect(noMode.status).toBe(1);
    });

    it('the manifest generator refuses a new privileged migration and leaves the manifest byte-identical', () => {
      const dir = copyOfReal();
      writeFileSync(join(dir, '0051_new.sql'), 'CREATE ROLE harness_new;');
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = readJson<{ entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] }>(journalPath);
      const last = journal.entries[journal.entries.length - 1];
      if (last === undefined) throw new Error('empty journal');
      journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag: '0051_new', breakpoints: true });
      writeJson(journalPath, journal);
      const before = readFileSync(join(dir, 'history-manifest.json'), 'utf8');
      const run = (extra: string[]) =>
        spawnSync('pnpm', ['exec', 'tsx', 'src/database/migration-integrity/history-manifest.cli.ts', '--write', '--dir', dir, ...extra], { cwd: API_DIR, env: cleanEnv(), encoding: 'utf8', shell: true });
      const noDecision = run([]);
      const asOrdinary = run(['--classify', '0051_new=ordinary', '--reviewed-in', 'pr:1']);
      const asPrivilegedUndeclared = run(['--classify', '0051_new=privileged', '--reviewed-in', 'pr:1']);
      expect([noDecision.status, asOrdinary.status, asPrivilegedUndeclared.status]).toEqual([1, 1, 1]);
      expect(`${noDecision.stderr}`).toContain('CLASSIFICATION_MISSING');
      expect(`${asOrdinary.stderr}`).toContain('PRIVILEGED_STATEMENT_UNDECLARED');
      expect(readFileSync(join(dir, 'history-manifest.json'), 'utf8')).toBe(before);
    });
  });

  describe('D-8D: the SQL/RLS linter runs before Drizzle, on the validated texts, and an ERROR applies nothing', () => {
    const tableCount = (db: string) => publicTables(db);
    const lintLines = (text: string) => text.split(/\r?\n/).filter((l) => l.includes('SQL lint') || /^\s+warning /.test(l));

    it('a fresh database: the ERROR refuses the whole batch and Drizzle never started (not even its "drizzle" schema exists)', async () => {
      await cluster.createDatabase('lint_fresh');
      const dir = copyOfReal();
      addMigration(dir, '0051_bad', 'GRANT SELECT ON public.tenants TO PUBLIC;');
      const r = await wrap(bootstrapEnv('lint_fresh'), { migrationsDir: dir });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('lint');
      expect(r.applied).toEqual([]);
      expect(codes(r)).toEqual(['SQL_LINT_ERROR']);
      expect(r.diagnostics[0]?.migration).toBe('0051_bad');
      expect(r.diagnostics[0]?.message).toMatch(/\[PRIV-GRANT-PUBLIC\] 0051_bad\.sql:1 — /);
      await untouched('lint_fresh'); // no drizzle schema, no table: Drizzle did not run, the 51 historical migrations were not applied either
      expect(r.lock.released).toBe(true); // the lock taken for the run was released
      expect(await lockRowCount('lint_fresh')).toBe(0);
    });

    it('an existing database: a clean migration and an ERROR in the same pending batch → NEITHER is applied', async () => {
      await fromTemplate('lint_batch', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_clean', 'CREATE TABLE lint_clean_t (id int);');
      addMigration(dir, '0052_bad', 'ALTER TABLE public.warehouses DISABLE ROW LEVEL SECURITY;');
      const r = await wrap(incrementalEnv('lint_batch'), { migrationsDir: dir });
      expect([r.exitCode, r.stage, r.applied.length]).toEqual([1, 'lint', 0]);
      expect(await scalar('lint_batch', `SELECT count(*) FROM pg_tables WHERE tablename = 'lint_clean_t'`)).toBe('0');
      expect(await registryCount('lint_batch')).toBe(51);
      expect(r.lock.released).toBe(true);
    });

    it('the files are linted exactly as validated: a pending migration whose hash does not match the manifest never reaches the linter', async () => {
      await fromTemplate('lint_hash', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_x', 'CREATE TABLE lint_hash_t (id int);');
      writeFileSync(join(dir, '0051_x.sql'), 'GRANT SELECT ON public.tenants TO PUBLIC;'); // changed after being recorded
      const r = await wrap(incrementalEnv('lint_hash'), { migrationsDir: dir });
      expect(r.stage).toBe('files'); // refused by the manifest check, before connecting and before linting
      expect(codes(r)).toEqual(['MANIFEST_HASH_MISMATCH']);
    });

    it('PL/pgSQL in an ordinary migration is refused (cannot be analysed); in a migration declared privileged it passes with a warning', async () => {
      const body = "DO $$ BEGIN EXECUTE format('CREATE TABLE %I (id int)', 'lint_dyn_t'); END $$;";
      await fromTemplate('lint_do', 'golden');
      const ordinary = copyOfReal();
      addMigration(ordinary, '0051_do', body);
      const refused = await wrap(incrementalEnv('lint_do'), { migrationsDir: ordinary });
      expect([refused.exitCode, refused.stage]).toEqual([1, 'lint']);
      expect(refused.text).toContain('PLPGSQL-UNANALYZED');
      expect(refused.text).toContain('NOT checked');
      expect(await scalar('lint_do', `SELECT count(*) FROM pg_tables WHERE tablename = 'lint_dyn_t'`)).toBe('0');

      const privileged = copyOfReal();
      addMigration(privileged, '0051_do', body, { classification: 'privileged', declarePrivileged: true });
      const accepted = await wrap(bootstrapEnv('lint_do'), { migrationsDir: privileged });
      expect([accepted.exitCode, accepted.applied.length], accepted.text).toEqual([0, 1]);
      expect(accepted.text).toContain('warning PLPGSQL-UNANALYZED × 1');
    });

    it('a statement the parser cannot parse is an ERROR that applies nothing', async () => {
      await fromTemplate('lint_parse', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_typo', 'CREATE TABEL lint_parse_t (id int);');
      const r = await wrap(incrementalEnv('lint_parse'), { migrationsDir: dir });
      expect([r.exitCode, r.stage]).toEqual([1, 'lint']);
      expect(r.text).toContain('LINT-PARSE-ERROR');
      expect(await registryCount('lint_parse')).toBe(51);
    });

    it('warnings are summarised, never called safe; INFO is silent; the run proceeds', async () => {
      await fromTemplate('lint_warn', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_warn', 'CREATE TABLE lint_warn_t (id int);--> statement-breakpoint\nGRANT SELECT ON public.lint_warn_t TO app_tenant;');
      const r = await wrap(incrementalEnv('lint_warn'), { migrationsDir: dir });
      expect([r.exitCode, r.applied.length]).toEqual([0, 1]);
      const lines = lintLines(r.text).join('\n');
      expect(lines).toContain('SQL lint (PostgreSQL 16 grammar, libpg-query@16.8.1): 1 pending migration(s), 0 error(s), 1 warning(s)');
      expect(lines).toContain('needs a human look", never "safe"');
      expect(lines).toContain('warning PRIV-GRANT × 1');
    });

    it('a fresh bootstrap lints all 51 real migrations: no error, warnings reported (the privileged ones are not blocked, nor excused)', async () => {
      // golden was bootstrapped in beforeAll through the same path
      expect(bootstrapResult.exitCode).toBe(0);
      expect(bootstrapResult.text).toContain('SQL lint (PostgreSQL 16 grammar, libpg-query@16.8.1): 51 pending migration(s), 0 error(s)');
      expect(bootstrapResult.text).toContain('warning PLPGSQL-UNANALYZED × 9');
      expect(bootstrapResult.text).toContain('warning RLS-WINDOW × 21');
    });

    it('only PENDING migrations are linted: nothing pending → no lint line; an applied migration is never re-linted', async () => {
      await fromTemplate('lint_pending', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_old_error', 'ALTER TABLE public.warehouses DISABLE ROW LEVEL SECURITY;');
      // apply the offending migration with the linter off (as it could have been applied before the linter existed)…
      await wrap(incrementalEnv('lint_pending'), { migrationsDir: dir, disableSqlLintForTests: true, disablePreCommitGuardForTests: true });
      expect(await registryCount('lint_pending')).toBe(52);
      // …then a normal run: nothing is pending, so nothing is linted and nothing is refused
      const again = await wrap(incrementalEnv('lint_pending'), { migrationsDir: dir });
      expect([again.exitCode, again.applied.length]).toEqual([0, 0]);
      expect(again.text).not.toContain('SQL lint');
    });

    it('--provision-only applies no migration, so it lints none', async () => {
      await fromTemplate('lint_prov', 'tpl_legacy_40');
      const dir = copyOfReal();
      addMigration(dir, '0051_bad', 'GRANT SELECT ON public.tenants TO PUBLIC;');
      // history of this database is the first 40 migrations; the folder adds pending ones, one of them an ERROR
      const r = await wrap(bootstrapEnv('lint_prov'), { migrationsDir: dir, provisionOnly: true });
      expect([r.exitCode, r.applied.length], r.text).toEqual([0, 0]);
      expect(r.text).not.toContain('SQL lint');
      expect(await registryCount('lint_prov')).toBe(40);
    });

    it('the lint step does not disturb the lock or the pre-commit guard: after a lint refusal the next run takes the lock at once and the guard still rolls back', async () => {
      await fromTemplate('lint_next', 'golden');
      const bad = copyOfReal();
      addMigration(bad, '0051_bad', 'GRANT SELECT ON public.tenants TO PUBLIC;');
      expect((await wrap(incrementalEnv('lint_next'), { migrationsDir: bad })).stage).toBe('lint');
      expect(await lockRowCount('lint_next')).toBe(0);

      const unforced = copyOfReal();
      addMigration(unforced, '0051_unforced', 'CREATE TABLE lint_next_t (id int);--> statement-breakpoint\nALTER TABLE lint_next_t ENABLE ROW LEVEL SECURITY;');
      const viaLint = await wrap(incrementalEnv('lint_next'), { migrationsDir: unforced });
      expect([viaLint.stage, codes(viaLint)]).toEqual(['lint', ['SQL_LINT_ERROR']]);
      expect(viaLint.text).toContain('RLS-ENABLE-WITHOUT-FORCE');
      const viaGuard = await wrap(incrementalEnv('lint_next'), { migrationsDir: unforced, disableSqlLintForTests: true });
      expect([viaGuard.stage, codes(viaGuard)]).toEqual(['migrate', ['INVARIANT_RLS_NOT_FORCED']]);

      const good = copyOfReal();
      addMigration(good, '0051_good', 'CREATE TABLE lint_next_ok (id int);');
      const next = await wrap(incrementalEnv('lint_next'), { migrationsDir: good });
      expect([next.exitCode, next.applied.length]).toEqual([0, 1]);
      expect(next.lock.waitedMs ?? 99_999).toBeLessThan(250);
      expect(await tableCount('lint_next')).toBeGreaterThan(54);
    });
  });

  describe('D-8D.1-A: a parser that is unavailable refuses the run before Drizzle, and nothing is read as clean', () => {
    const failingLoader = async () => {
      throw new Error('simulated WebAssembly initialisation failure with private detail');
    };
    const crashingParser = { parse: () => { throw new Error('simulated parser crash'); } };
    const allUnparseable = { parse: () => ({ ok: false as const, message: 'simulated: nothing can be parsed', cursor: undefined }) };

    it('the loader fails on a FRESH database: exit 1, SQL_LINT_PARSER_UNAVAILABLE, and Drizzle never started (no "drizzle" schema, no table)', async () => {
      await cluster.createDatabase('parser_fresh');
      const r = await wrap(bootstrapEnv('parser_fresh'), { sqlParserLoader: failingLoader });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('lint');
      expect(r.applied).toEqual([]);
      expect(codes(r)).toEqual(['SQL_LINT_PARSER_UNAVAILABLE']);
      expect(r.text).toContain('libpg-query@16.8.1');
      expect(r.text).toContain('so none is applied');
      expect(r.text).not.toContain('private detail'); // the underlying error is not echoed
      await untouched('parser_fresh');
      // the advisory lock taken for the run was released
      expect(r.lock.acquiredAt).toBeDefined();
      expect(r.lock.released).toBe(true);
      expect(await lockRowCount('parser_fresh')).toBe(0);

      // the cause is gone: the very next run takes the lock at once and goes on to apply everything
      const next = await wrap(bootstrapEnv('parser_fresh'));
      expect([next.exitCode, next.applied.length], next.text).toEqual([0, 51]);
      expect(next.lock.waitedMs ?? 99_999).toBeLessThan(250);
    });

    it('an existing database: a parser that crashes while linting refuses the whole pending batch; the registry and the tables are untouched', async () => {
      await fromTemplate('parser_crash', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_clean', 'CREATE TABLE parser_crash_t (id int);');
      const r = await wrap(incrementalEnv('parser_crash'), { migrationsDir: dir, sqlParserLoader: async () => crashingParser });
      expect([r.exitCode, r.stage]).toEqual([1, 'lint']);
      expect(codes(r)).toEqual(['SQL_LINT_PARSER_UNAVAILABLE']);
      expect(await registryCount('parser_crash')).toBe(51);
      expect(await scalar('parser_crash', `SELECT count(*) FROM pg_tables WHERE tablename = 'parser_crash_t'`)).toBe('0');
      expect(r.lock.released).toBe(true);
      expect(await lockRowCount('parser_crash')).toBe(0);

      const next = await wrap(incrementalEnv('parser_crash'), { migrationsDir: dir });
      expect([next.exitCode, next.applied.length]).toEqual([0, 1]);
    });

    it('a parser that cannot parse anything does not make SQL "clean": every chunk is an ERROR and nothing is applied', async () => {
      await fromTemplate('parser_blind', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_clean', 'CREATE TABLE parser_blind_t (id int);');
      const r = await wrap(incrementalEnv('parser_blind'), { migrationsDir: dir, sqlParserLoader: async () => allUnparseable });
      expect([r.exitCode, r.stage]).toEqual([1, 'lint']);
      expect(codes(r).every((c) => c === 'SQL_LINT_ERROR')).toBe(true);
      expect(r.text).toContain('LINT-PARSE-ERROR');
      expect(await registryCount('parser_blind')).toBe(51);
    });

    it('when nothing is pending the parser is not needed, and --provision-only never loads it', async () => {
      await fromTemplate('parser_idle', 'golden');
      const idle = await wrap(incrementalEnv('parser_idle'), { sqlParserLoader: failingLoader });
      expect([idle.exitCode, idle.applied.length]).toEqual([0, 0]);
      await fromTemplate('parser_prov', 'tpl_legacy_40');
      const prov = await wrap(bootstrapEnv('parser_prov'), { provisionOnly: true, sqlParserLoader: failingLoader });
      expect(prov.exitCode).toBe(0);
    });
  });

  describe('D-8D.1-B: the exceptions file is loaded by the wrapper, validated strictly, and an accepted finding stays visible', () => {
    const GRANT = 'GRANT SELECT ON public.warehouses TO PUBLIC;';
    const exceptionFor = (tag: string, sql: string, over: Record<string, unknown> = {}) => ({
      ruleId: 'PRIV-GRANT-PUBLIC',
      tag,
      sha256: canonicalMigrationHash(sql),
      line: 1,
      reason: 'Reviewed in the harness: this grant is the subject of the test and is intended.',
      reviewedIn: 'review:harness:2026-10-29',
      ...over,
    });
    let badCase = 0;
    let shapeCase = 0;
    const writeExceptions = (dir: string, exceptions: unknown[]) => writeJson(join(dir, 'sql-lint-exceptions.json'), { schemaVersion: 1, exceptions });

    it('without an exception the finding blocks; with an exact one it is accepted, applied, and still listed as ACCEPTED', async () => {
      await fromTemplate('exc_ok', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_exc', GRANT);
      const blocked = await wrap(incrementalEnv('exc_ok'), { migrationsDir: dir });
      expect([blocked.exitCode, blocked.stage, codes(blocked)]).toEqual([1, 'lint', ['SQL_LINT_ERROR']]);
      expect(await registryCount('exc_ok')).toBe(51);

      writeExceptions(dir, [exceptionFor('0051_exc', GRANT)]);
      const r = await wrap(incrementalEnv('exc_ok'), { migrationsDir: dir });
      expect([r.exitCode, r.applied.length], r.text).toEqual([0, 1]);
      expect(r.text).toContain('1 accepted by exception');
      expect(r.text).toMatch(/ACCEPTED ERROR PRIV-GRANT-PUBLIC 0051_exc\.sql:1 by review:harness:2026-10-29 — Reviewed in the harness/);
      expect(await registryCount('exc_ok')).toBe(52);
    });

    it('an exception covers exactly one statement: a second, unexcepted ERROR in the same migration still refuses the whole batch', async () => {
      await fromTemplate('exc_one', 'golden');
      const dir = copyOfReal();
      const sql = `${GRANT}--> statement-breakpoint\nGRANT SELECT ON public.tenants TO PUBLIC;`;
      addMigration(dir, '0051_two', sql);
      writeExceptions(dir, [exceptionFor('0051_two', sql, { line: 1 })]);
      const r = await wrap(incrementalEnv('exc_one'), { migrationsDir: dir });
      expect([r.exitCode, r.stage, r.applied.length]).toEqual([1, 'lint', 0]);
      expect(r.text).toContain('0051_two.sql:2');
      expect(r.text).not.toContain('0051_two.sql:1 —'); // the excepted statement is not reported as an error
      expect(await registryCount('exc_one')).toBe(51);
    });

    it.each<[string, (sql: string) => Record<string, unknown>, RegExp]>([
      ['a wrong hash (the file is not what was reviewed)', () => ({ sha256: 'f'.repeat(64) }), /stale/],
      ['a wrong line', () => ({ line: 7 }), /matches no finding/],
      ['a wrong rule', () => ({ ruleId: 'PRIV-REVOKE' }), /matches no finding/],
      ['a wrong migration (one that exists but has no such finding)', () => ({ tag: '0050_price_approval_number' }), /matches no finding|stale/],
      ['a migration that is not in the journal', () => ({ tag: '0098_ghost' }), /not in the journal/],
      ['a rule that cannot be excepted', () => ({ ruleId: 'TXN-CONTROL' }), /cannot be excepted/],
      ['a rule that cannot be excepted (parse errors)', () => ({ ruleId: 'LINT-PARSE-ERROR' }), /cannot be excepted/],
      ['an exception that no longer corresponds to any finding', () => ({ ruleId: 'RLS-DISABLE' }), /matches no finding/],
    ])('%s → refused before Drizzle, nothing applied', async (_name, patch, expected) => {
      const db = `exc_bad_${(badCase += 1)}`;
      await fromTemplate(db, 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_exc', GRANT);
      writeExceptions(dir, [exceptionFor('0051_exc', GRANT, patch(GRANT))]);
      const r = await wrap(incrementalEnv(db), { migrationsDir: dir });
      expect([r.exitCode, r.stage, r.applied.length]).toEqual([1, 'lint', 0]);
      expect(codes(r)).toEqual(['LINT_EXCEPTION_INVALID']);
      expect(r.text).toMatch(expected);
      expect(await registryCount(db)).toBe(51);
    });

    it('an invalid file stops the run at the FILES step, before it connects: a fresh database is left without even the "drizzle" schema', async () => {
      await cluster.createDatabase('exc_file');
      const dir = copyOfReal();
      writeFileSync(join(dir, 'sql-lint-exceptions.json'), '{ "schemaVersion": 1, "exceptions": [ ');
      const r = await wrap(bootstrapEnv('exc_file'), { migrationsDir: dir });
      expect([r.exitCode, r.stage]).toEqual([1, 'files']);
      expect(codes(r)).toEqual(['LINT_EXCEPTION_INVALID']);
      expect(r.lock.acquiredAt).toBeUndefined();
      await untouched('exc_file');
    });

    it.each([
      ['a wildcard', [{ ruleId: '*', tag: '0000_extensions_and_roles', sha256: 'a'.repeat(64), line: 1, reason: 'x'.repeat(40), reviewedIn: 'pr:1' }]],
      ['an unknown field', [{ ...exceptionFor('0001_platform_tables', 'x'), severity: 'WARNING' }]],
      ['a duplicate', [exceptionFor('0001_platform_tables', 'x'), exceptionFor('0001_platform_tables', 'x')]],
      ['a short reason', [exceptionFor('0001_platform_tables', 'x', { reason: 'ok' })]],
      ['a bad review reference', [exceptionFor('0001_platform_tables', 'x', { reviewedIn: 'trust me' })]],
    ])('a present file with %s is refused at the files step even when nothing is pending', async (_name, entries) => {
      const db = `exc_shape_${(shapeCase += 1)}`;
      await fromTemplate(db, 'golden');
      const dir = copyOfReal();
      writeExceptions(dir, entries);
      const r = await wrap(incrementalEnv(db), { migrationsDir: dir });
      expect([r.exitCode, r.stage, codes(r)]).toEqual([1, 'files', expect.arrayContaining(['LINT_EXCEPTION_INVALID'])]);
    });

    it('an ABSENT file means no exceptions, defined and safe: the run proceeds exactly as with an empty one', async () => {
      await fromTemplate('exc_absent', 'golden');
      const dir = copyOfReal();
      rmSync(join(dir, 'sql-lint-exceptions.json'));
      addMigration(dir, '0051_clean', 'CREATE TABLE exc_absent_t (id int);');
      const r = await wrap(incrementalEnv('exc_absent'), { migrationsDir: dir });
      expect([r.exitCode, r.applied.length]).toEqual([0, 1]);
      // and it does NOT excuse anything: the same ERROR blocks without a file
      addMigration(dir, '0052_bad', GRANT);
      expect((await wrap(incrementalEnv('exc_absent'), { migrationsDir: dir })).stage).toBe('lint');
    });

    it('an exception about an already-applied migration stays valid and does not disturb later runs', async () => {
      await fromTemplate('exc_later', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_exc', GRANT);
      writeExceptions(dir, [exceptionFor('0051_exc', GRANT)]);
      expect((await wrap(incrementalEnv('exc_later'), { migrationsDir: dir })).exitCode).toBe(0);
      const idle = await wrap(incrementalEnv('exc_later'), { migrationsDir: dir });
      expect([idle.exitCode, idle.applied.length]).toEqual([0, 0]);
      addMigration(dir, '0052_clean', 'CREATE TABLE exc_later_t (id int);');
      writeExceptions(dir, [exceptionFor('0051_exc', GRANT)]); // unchanged
      const next = await wrap(incrementalEnv('exc_later'), { migrationsDir: dir });
      expect([next.exitCode, next.applied.length], next.text).toEqual([0, 1]);
    });
  });

  describe('D-8E: an obsolete exception is never ignored just because nothing is pending', () => {
    const GRANT = 'GRANT SELECT ON public.warehouses TO PUBLIC;';
    const failingLoader = async () => {
      throw new Error('simulated parser failure');
    };
    const exceptionFor = (tag: string, sql: string, over: Record<string, unknown> = {}) => ({
      ruleId: 'PRIV-GRANT-PUBLIC',
      tag,
      sha256: canonicalMigrationHash(sql),
      line: 1,
      reason: 'Reviewed in the harness: this grant is the subject of the test and is intended.',
      reviewedIn: 'review:harness:2026-10-29',
      ...over,
    });
    const writeExceptions = (dir: string, exceptions: unknown[]) => writeJson(join(dir, 'sql-lint-exceptions.json'), { schemaVersion: 1, exceptions });
    /** A folder whose accepted migration is already APPLIED in the database, so that nothing is pending afterwards. */
    async function appliedWithAcceptedException(db: string): Promise<string> {
      await fromTemplate(db, 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_exc', GRANT);
      writeExceptions(dir, [exceptionFor('0051_exc', GRANT)]);
      const first = await wrap(incrementalEnv(db), { migrationsDir: dir });
      expect([first.exitCode, first.applied.length], first.text).toEqual([0, 1]);
      return dir;
    }

    it('1. zero pending and an EMPTY file: exit 0, nothing linted, the parser is not even needed', async () => {
      await fromTemplate('stale_empty', 'golden');
      const r = await wrap(incrementalEnv('stale_empty'), { sqlParserLoader: failingLoader });
      expect([r.exitCode, r.applied.length]).toEqual([0, 0]);
      expect(r.text).not.toContain('SQL lint');
    });

    it('2. zero pending and an exception that is well-formed but matches NO finding → refused, with Drizzle never involved', async () => {
      await fromTemplate('stale_unmatched', 'golden');
      const dir = copyOfReal();
      writeExceptions(dir, [exceptionFor('0050_price_approval_number', 'irrelevant', { sha256: readMigrationsFolder(dir).fileHashes['0050_price_approval_number'] ?? 'a'.repeat(64) })]);
      const r = await wrap(incrementalEnv('stale_unmatched'), { migrationsDir: dir });
      expect([r.exitCode, r.stage, r.applied.length]).toEqual([1, 'lint', 0]);
      expect(codes(r)).toEqual(['LINT_EXCEPTION_INVALID']);
      expect(r.text).toMatch(/matches no finding/);
      expect(r.lock.released).toBe(true);
      expect(await registryCount('stale_unmatched')).toBe(51);
    });

    it('3. zero pending and a STALE hash → refused', async () => {
      const dir = await appliedWithAcceptedException('stale_hash');
      writeExceptions(dir, [exceptionFor('0051_exc', GRANT, { sha256: 'c'.repeat(64) })]);
      const r = await wrap(incrementalEnv('stale_hash'), { migrationsDir: dir });
      expect([r.exitCode, r.stage, codes(r)]).toEqual([1, 'lint', ['LINT_EXCEPTION_INVALID']]);
      expect(r.text).toMatch(/stale/);
    });

    it('4. zero pending and a wrong line / a rule that cannot be excepted → refused', async () => {
      const dir = await appliedWithAcceptedException('stale_line');
      for (const patch of [{ line: 5 }, { ruleId: 'TXN-CONTROL' }]) {
        writeExceptions(dir, [exceptionFor('0051_exc', GRANT, patch)]);
        const r = await wrap(incrementalEnv('stale_line'), { migrationsDir: dir });
        expect([r.exitCode, r.stage, codes(r)]).toEqual([1, 'lint', ['LINT_EXCEPTION_INVALID']]);
      }
    });

    it('5. zero pending and a VALID exception that still matches its finding: exit 0, and the run says it validated it', async () => {
      const dir = await appliedWithAcceptedException('stale_valid');
      const r = await wrap(incrementalEnv('stale_valid'), { migrationsDir: dir });
      expect([r.exitCode, r.applied.length]).toEqual([0, 0]);
      expect(r.text).toContain('1 exception(s) validated');
    });

    it('6. --provision-only does not skip the check either (it changes privileges, so a stale exception file must not pass it)', async () => {
      const dir = await appliedWithAcceptedException('stale_prov');
      writeExceptions(dir, [exceptionFor('0051_exc', GRANT, { line: 9 })]);
      const r = await wrap(bootstrapEnv('stale_prov'), { migrationsDir: dir, provisionOnly: true });
      expect([r.exitCode, r.stage, codes(r)]).toEqual([1, 'lint', ['LINT_EXCEPTION_INVALID']]);
    });

    it('7. the check needs the parser: with exceptions present and the parser unavailable the run is refused even with nothing pending', async () => {
      const dir = await appliedWithAcceptedException('stale_parser');
      const r = await wrap(incrementalEnv('stale_parser'), { migrationsDir: dir, sqlParserLoader: failingLoader });
      expect([r.exitCode, r.stage, codes(r)]).toEqual([1, 'lint', ['SQL_LINT_PARSER_UNAVAILABLE']]);
    });

    it('8. structurally invalid file with zero pending → refused at the files step (before connecting)', async () => {
      await fromTemplate('stale_shape', 'golden');
      const dir = copyOfReal();
      writeFileSync(join(dir, 'sql-lint-exceptions.json'), '{ "schemaVersion": 1, "exceptions": [ ');
      const r = await wrap(incrementalEnv('stale_shape'), { migrationsDir: dir });
      expect([r.exitCode, r.stage, r.lock.acquiredAt]).toEqual([1, 'files', undefined]);
    });
  });

  describe('D-8C: mutual exclusion — two independent OS processes running the real wrapper', () => {
    const CHILD = join(API_DIR, 'test', 'migration-harness', 'wrapper-child.ts');

    interface Child {
      readonly process: ChildProcess;
      readonly output: () => string;
      readonly exit: Promise<number | null>;
      readonly result: () => { exitCode: number; stage: string; applied: number; codes: string[]; lock: { acquiredAt?: number; releasedAt?: number; released?: boolean; waitedMs?: number } };
    }
    function startChild(dir: string, env: MigratorEnv, flags: string[] = []): Child {
      const clean: NodeJS.ProcessEnv = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('PG') && !k.startsWith('MIGRATOR_')) clean[k] = v;
      for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
      const child = spawn(process.execPath, ['--import', 'tsx', CHILD, dir, ...flags], { cwd: API_DIR, env: clean, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
      const emitter = child as unknown as { on(event: 'close', listener: (code: number | null) => void): void };
      const exit = new Promise<number | null>((resolve) => emitter.on('close', (code) => resolve(code)));
      void exit.then(() => allLines.push(out));
      return {
        process: child,
        output: () => out,
        exit,
        result: () => {
          const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT:'));
          if (line === undefined) throw new Error('child produced no RESULT line: ' + out.slice(-300));
          return JSON.parse(line.slice('RESULT:'.length));
        },
      };
    }
    async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<number> {
      const t0 = Date.now();
      for (;;) {
        if (await condition()) return Date.now() - t0;
        if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for: ' + label);
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    const lockRows = (db: string) =>
      q<{ database: string; classid: string; objid: string; objsubid: number }>(
        db,
        `SELECT l.database::text, l.classid::text, l.objid::text, l.objsubid FROM pg_locks l
          WHERE l.locktype = 'advisory' AND l.granted AND l.classid = ${MIGRATION_LOCK_CLASS} AND l.objid = ${MIGRATION_LOCK_OBJECT}
            AND l.database = (SELECT oid FROM pg_database WHERE datname = '${db}')`,
      );
    const lockHeld = async (db: string) => (await lockRows(db)).length > 0;
    const sleeping = async (db: string) => Number(await scalar(db, `SELECT count(*) FROM pg_stat_activity WHERE datname = '${db}' AND query LIKE '%pg_sleep%' AND pid <> pg_backend_pid()`)) > 0;
    const slowFolder = (seconds: number) => {
      const dir = copyOfReal();
      addMigration(dir, '0051_slow', `CREATE TABLE lock_slow_t (id int);--> statement-breakpoint\nSELECT pg_sleep(${seconds});`);
      return dir;
    };

    it('the second process waits, then evaluates the state AFTER the first: no stale baseline, no double execution', async () => {
      await fromTemplate('lock_main', 'golden');
      const dir = slowFolder(6);
      const p1 = startChild(dir, incrementalEnv('lock_main'));
      await waitFor(() => lockHeld('lock_main'), 60_000, 'the first process to hold the lock');
      expect(await registryCount('lock_main')).toBe(51); // the first is mid-batch, nothing committed yet

      const p2 = startChild(dir, incrementalEnv('lock_main'));
      await waitFor(() => p2.output().includes('Waiting for the migration lock'), 60_000, 'the second process to report waiting');
      expect(await lockHeld('lock_main')).toBe(true); // still the first's
      expect(await registryCount('lock_main')).toBe(51);

      const [code1, code2] = await Promise.all([p1.exit, p2.exit]);
      expect([code1, code2]).toEqual([0, 0]);
      const r1 = p1.result();
      const r2 = p2.result();
      expect(r1.applied).toBe(1);
      expect(r2.applied).toBe(0); // it saw the first's committed batch
      expect(p2.output()).toContain('pending=0'); // evaluated after, not before
      expect(p2.output()).toContain('Migration lock acquired after waiting');
      expect(p1.output()).not.toContain('Waiting for the migration lock');
      // the critical sections do not overlap, in real time
      expect(r1.lock.released).toBe(true);
      expect(r2.lock.acquiredAt ?? 0).toBeGreaterThanOrEqual(r1.lock.releasedAt ?? Number.MAX_SAFE_INTEGER);
      expect(r2.lock.waitedMs ?? 0).toBeGreaterThan(1000);
      // applied exactly once
      expect(await registryCount('lock_main')).toBe(52);
      expect(await scalar('lock_main', 'SELECT count(*) = count(DISTINCT hash) FROM drizzle.__drizzle_migrations')).toBe(true);
      expect(await lockHeld('lock_main')).toBe(false);
    });

    it('the lock is identified by this database and this scope, and does not block another database', async () => {
      await fromTemplate('lock_scope_a', 'golden');
      await fromTemplate('lock_scope_b', 'golden');
      const p1 = startChild(slowFolder(6), incrementalEnv('lock_scope_a'));
      await waitFor(() => lockHeld('lock_scope_a'), 60_000, 'the first process to hold the lock on A');

      const rows = await lockRows('lock_scope_a');
      const dbOid = await scalar('lock_scope_a', `SELECT oid FROM pg_database WHERE datname = 'lock_scope_a'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ database: String(dbOid), classid: String(MIGRATION_LOCK_CLASS), objid: String(MIGRATION_LOCK_OBJECT), objsubid: MIGRATION_LOCK_OBJSUBID });
      expect(await lockHeld('lock_scope_b')).toBe(false);

      // a run on B, while A is held, neither waits nor is delayed
      const t0 = Date.now();
      const onB = await wrap(incrementalEnv('lock_scope_b'));
      expect([onB.exitCode, onB.applied.length]).toEqual([0, 0]);
      expect(onB.text).not.toContain('Waiting for the migration lock');
      expect(onB.lock.waitedMs ?? 99_999).toBeLessThan(250);
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(await lockHeld('lock_scope_a')).toBe(true); // A is still held while B has already finished
      expect(await lockHeld('lock_scope_b')).toBe(false);

      expect(await p1.exit).toBe(0);
      expect(await lockHeld('lock_scope_a')).toBe(false);
    });

    it('a timeout is a controlled refusal: nothing evaluated, nothing changed, and the holder is not disturbed', async () => {
      await fromTemplate('lock_timeout', 'golden');
      const p1 = startChild(slowFolder(6), incrementalEnv('lock_timeout'));
      await waitFor(() => lockHeld('lock_timeout'), 60_000, 'the first process to hold the lock');

      const waited = Date.now();
      const refused = await wrap(incrementalEnv('lock_timeout', INC_LOGIN, { MIGRATOR_LOCK_TIMEOUT_SECONDS: '2' }));
      const elapsed = Date.now() - waited;
      expect(refused.exitCode).toBe(1);
      expect(refused.stage).toBe('lock');
      expect(codes(refused)).toEqual(['LOCK_NOT_ACQUIRED']);
      expect(refused.text).toContain('Nothing was evaluated, changed or repaired');
      expect(refused.text).toContain('backend pid');
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(elapsed).toBeLessThan(6000);
      expect(refused.applied).toEqual([]);
      expect(refused.lock.acquiredAt).toBeUndefined();

      expect(await p1.exit).toBe(0); // the holder finished normally
      expect(p1.result().applied).toBe(1);
      expect(await registryCount('lock_timeout')).toBe(52);
    });

    it('zero means fail at once', async () => {
      await fromTemplate('lock_zero', 'golden');
      const p1 = startChild(slowFolder(5), incrementalEnv('lock_zero'));
      await waitFor(() => lockHeld('lock_zero'), 60_000, 'the first process to hold the lock');
      const t0 = Date.now();
      const refused = await wrap(incrementalEnv('lock_zero', INC_LOGIN, { MIGRATOR_LOCK_TIMEOUT_SECONDS: '0' }));
      expect(codes(refused)).toEqual(['LOCK_NOT_ACQUIRED']);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(await p1.exit).toBe(0);
    });

    it('--provision-only takes the same lock: it waits for an incremental run instead of racing it', async () => {
      await fromTemplate('lock_prov', 'golden');
      const dir = slowFolder(6);
      const p1 = startChild(dir, incrementalEnv('lock_prov'));
      await waitFor(() => lockHeld('lock_prov'), 60_000, 'the incremental run to hold the lock');
      const p2 = startChild(dir, bootstrapEnv('lock_prov'), ['--provision-only']);
      await waitFor(() => p2.output().includes('Waiting for the migration lock'), 60_000, 'provision-only to report waiting');
      const [c1, c2] = await Promise.all([p1.exit, p2.exit]);
      expect([c1, c2]).toEqual([0, 0]);
      expect(p2.result().lock.acquiredAt ?? 0).toBeGreaterThanOrEqual(p1.result().lock.releasedAt ?? Number.MAX_SAFE_INTEGER);
      // the provisioning ran after the batch, against its final state: the registry is the extended one
      expect(p2.output()).toContain('applied=52');
    });

    it('the lock is released after success and after every kind of failure, and the next run works normally', async () => {
      await fromTemplate('lock_rel', 'golden');
      const success = await wrap(incrementalEnv('lock_rel'));
      expect([success.exitCode, success.lock.released]).toEqual([0, true]);
      expect(await lockHeld('lock_rel')).toBe(false);

      const failing = copyOfReal();
      addMigration(failing, '0051_fails', 'CREATE TABLE lock_rel_t (id int);--> statement-breakpoint\nSELECT 1/0;');
      const failed = await wrap(incrementalEnv('lock_rel'), { migrationsDir: failing });
      expect([failed.exitCode, failed.stage, failed.lock.released]).toEqual([1, 'migrate', true]);
      expect(await lockHeld('lock_rel')).toBe(false);

      const violating = copyOfReal();
      addMigration(violating, '0051_unforced', 'CREATE TABLE lock_rel_u (id int);--> statement-breakpoint\nALTER TABLE lock_rel_u ENABLE ROW LEVEL SECURITY;');
      const refused = await wrap(incrementalEnv('lock_rel'), { migrationsDir: violating, disableSqlLintForTests: true });
      expect([refused.exitCode, codes(refused), refused.lock.released]).toEqual([1, ['INVARIANT_RLS_NOT_FORCED'], true]);
      expect(await lockHeld('lock_rel')).toBe(false);

      // an early refusal never takes the lock at all
      const early = await wrap({ ...incrementalEnv('lock_rel'), MIGRATOR_EXPECTED_DATABASE: 'someone_elses_db' });
      expect(early.lock.acquiredAt).toBeUndefined();

      const good = copyOfReal();
      addMigration(good, '0051_good', 'CREATE TABLE lock_rel_ok (id int);');
      const next = await wrap(incrementalEnv('lock_rel'), { migrationsDir: good });
      expect([next.exitCode, next.applied.length]).toEqual([0, 1]);
      expect(next.lock.waitedMs ?? 99_999).toBeLessThan(250); // no wait: below one polling interval
    });

    it('if the lock holder is killed mid-batch, the session ends, the lock goes away (not permanent), nothing was committed, and the next run works', async () => {
      await fromTemplate('lock_kill', 'golden');
      const dir = slowFolder(6);
      const p1 = startChild(dir, incrementalEnv('lock_kill'));
      await waitFor(() => lockHeld('lock_kill'), 60_000, 'the holder to take the lock');
      await waitFor(() => sleeping('lock_kill'), 60_000, 'the holder to be inside the batch');
      const killedAt = Date.now();
      p1.process.kill('SIGKILL'); // no chance to release anything
      await p1.exit;

      // PostgreSQL notices the closed socket when the running statement ends (here: pg_sleep, <= 6 s) and releases the session's lock
      const afterMs = await waitFor(async () => !(await lockHeld('lock_kill')), 60_000, 'the lock to be released by the server');
      expect(Date.now() - killedAt).toBeLessThan(30_000);
      expect(afterMs).toBeGreaterThanOrEqual(0);
      expect(await registryCount('lock_kill')).toBe(51); // the interrupted batch was rolled back, not committed
      expect(await scalar('lock_kill', `SELECT count(*) FROM pg_tables WHERE tablename = 'lock_slow_t'`)).toBe('0');

      const next = await wrap(incrementalEnv('lock_kill'), { migrationsDir: dir });
      expect([next.exitCode, next.applied.length]).toEqual([0, 1]);
      expect(next.lock.waitedMs ?? 99_999).toBeLessThan(250);
      expect(await registryCount('lock_kill')).toBe(52);
    });
  });

  describe('D-8B: owner and RLS invariants — before the commit (rollback) and after it (no rollback)', () => {
    const tableExists = async (db: string, name: string) => Number(await scalar(db, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = '${name}'`)) === 1;
    const properTable = (name: string) =>
      [
        `CREATE TABLE ${name} (tenant_id uuid NOT NULL, v int NOT NULL);`,
        `ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE ${name} FORCE ROW LEVEL SECURITY;`,
        `CREATE POLICY ${name}_tenant ON ${name} FOR ALL TO app_tenant USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);`,
      ].join('--> statement-breakpoint\n');
    const drizzleObjects = (db: string) => q<{ n: string }>(db, `SELECT n.nspname || '.' || c.relname AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'drizzle' ORDER BY 1`);

    it('a correct state passes: a table owned by app_migrator, RLS enabled and FORCEd', async () => {
      await fromTemplate('inv_ok', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_inv_ok', properTable('inv_ok_t'));
      const r = await wrap(incrementalEnv('inv_ok'), { migrationsDir: dir });
      expect([r.exitCode, r.applied.length], r.text).toEqual([0, 1]);
      expect(await tableExists('inv_ok', 'inv_ok_t')).toBe(true);
      expect(await registryCount('inv_ok')).toBe(52);
    });

    it('RLS enabled without FORCE is refused BEFORE the commit and the whole batch is rolled back', async () => {
      await fromTemplate('inv_unforced', 'golden');
      const drizzleBefore = await drizzleObjects('inv_unforced');
      const dir = copyOfReal();
      addMigration(dir, '0051_fine', properTable('inv_fine_t'));
      addMigration(dir, '0052_unforced', 'CREATE TABLE inv_unforced_t (id int);--> statement-breakpoint\nALTER TABLE inv_unforced_t ENABLE ROW LEVEL SECURITY;');
      const r = await wrap(incrementalEnv('inv_unforced'), { migrationsDir: dir, disableSqlLintForTests: true });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('migrate');
      expect(r.applied).toEqual([]);
      expect(codes(r)).toEqual(['INVARIANT_RLS_NOT_FORCED']);
      expect(r.text).toContain('inv_unforced_t');
      expect(r.text).toContain('Rolled back BEFORE commit');
      // atomic: the good migration of the same batch is gone too, and so is its registry row
      expect(await tableExists('inv_unforced', 'inv_fine_t')).toBe(false);
      expect(await tableExists('inv_unforced', 'inv_unforced_t')).toBe(false);
      expect(await registryCount('inv_unforced')).toBe(51);
      expect(await drizzleObjects('inv_unforced')).toEqual(drizzleBefore);
    });

    it('a wrong owner is refused BEFORE the commit', async () => {
      const admin = cluster.admin();
      try {
        await admin.unsafe(`CREATE ROLE inv_other NOLOGIN`);
        await admin.unsafe(`GRANT inv_other TO app_migrator`); // lets app_migrator hand objects to it
      } finally {
        await admin.end({ timeout: 5 });
      }
      await fromTemplate('inv_owner', 'golden');
      await q('inv_owner', 'GRANT CREATE ON SCHEMA public TO inv_other'); // the new owner needs CREATE on the schema (per-database)
      const dir = copyOfReal();
      addMigration(dir, '0051_wrong_owner', 'CREATE TABLE inv_owner_t (id int);--> statement-breakpoint\nALTER TABLE inv_owner_t OWNER TO inv_other;');
      const r = await wrap(incrementalEnv('inv_owner'), { migrationsDir: dir, disableSqlLintForTests: true });
      expect(r.exitCode).toBe(1);
      expect(codes(r)).toEqual(['INVARIANT_OWNER_MISMATCH']);
      expect(r.text).toContain('table inv_owner_t (owner inv_other)');
      expect(await tableExists('inv_owner', 'inv_owner_t')).toBe(false);
      expect(await registryCount('inv_owner')).toBe(51);
    });

    it('a privileged migration that RESETs ROLE and never returns leaves the superuser as owner and effective role: refused BEFORE the commit', async () => {
      await fromTemplate('inv_reset', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_reset_role', 'RESET ROLE;--> statement-breakpoint\nCREATE TABLE inv_reset_t (id int);', { classification: 'privileged', declarePrivileged: true });
      const r = await wrap(bootstrapEnv('inv_reset'), { migrationsDir: dir });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('migrate');
      expect(codes(r).sort()).toEqual(['INVARIANT_IDENTITY_UNEXPECTED', 'INVARIANT_OWNER_MISMATCH']);
      expect(r.text).toContain('owner postgres');
      expect(await tableExists('inv_reset', 'inv_reset_t')).toBe(false);
      expect(await registryCount('inv_reset')).toBe(51);
    });

    it('a brand-new database: the violation rolls everything back; only what Drizzle creates before its transaction remains', async () => {
      await cluster.createDatabase('inv_new');
      const dir = copyOfReal();
      addMigration(dir, '0051_unforced', 'CREATE TABLE inv_new_t (id int);--> statement-breakpoint\nALTER TABLE inv_new_t ENABLE ROW LEVEL SECURITY;');
      const r = await wrap(bootstrapEnv('inv_new'), { migrationsDir: dir, disableSqlLintForTests: true });
      expect(r.exitCode).toBe(1);
      expect(codes(r)).toEqual(['INVARIANT_RLS_NOT_FORCED']);
      expect(r.text).toContain('the schema "drizzle" and its empty registry table');
      expect(await publicTables('inv_new')).toBe(0); // all 52 migrations rolled back
      expect(await scalar('inv_new', `SELECT count(*) FROM pg_namespace WHERE nspname = 'drizzle'`)).toBe('1'); // committed regardless
      expect(await registryCount('inv_new')).toBe(0);
      const roleLeak = await scalar('inv_new', `SELECT count(*) FROM pg_stat_activity WHERE datname = 'inv_new' AND pid <> pg_backend_pid()`);
      expect(Number(roleLeak)).toBe(0); // the wrapper released its connection
    });

    it('AFTER the commit nothing is rolled back: with the guard off the same violation stays committed, is reported as such, and then counts as pre-existing', async () => {
      await fromTemplate('inv_post', 'golden');
      const dir = copyOfReal();
      addMigration(dir, '0051_unforced', 'CREATE TABLE inv_post_t (id int);--> statement-breakpoint\nALTER TABLE inv_post_t ENABLE ROW LEVEL SECURITY;');
      const r = await wrap(incrementalEnv('inv_post'), { migrationsDir: dir, disablePreCommitGuardForTests: true, disableSqlLintForTests: true });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('postcheck');
      expect(r.applied).toHaveLength(1);
      expect(codes(r)).toEqual(['INVARIANT_RLS_NOT_FORCED']);
      expect(r.text).toContain('ALREADY COMMITTED');
      // what stays committed: the table, its RLS-without-FORCE state and the registry row
      expect(await tableExists('inv_post', 'inv_post_t')).toBe(true);
      expect(await scalar('inv_post', `SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.inv_post_t'::regclass`)).toBe(false);
      expect(await registryCount('inv_post')).toBe(52);

      // a later run does NOT repair it and no longer refuses it: it is now a pre-existing deviation, reported as a warning
      const again = await wrap(incrementalEnv('inv_post'), { migrationsDir: dir });
      expect([again.exitCode, again.applied.length]).toEqual([0, 0]);
      expect(again.text).toMatch(/WARNING: pre-existing deviations, not blocking.*1 table\(s\) with RLS enabled but not FORCEd/s);
      expect(await scalar('inv_post', `SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.inv_post_t'::regclass`)).toBe(false);
    });

    it('a pre-existing deviation does not lock the database out; a NEW violation on top of it is still refused', async () => {
      await fromTemplate('inv_legacy', 'golden');
      await q('inv_legacy', 'ALTER TABLE public.warehouses NO FORCE ROW LEVEL SECURITY'); // legacy deviation, outside any run
      const clean = copyOfReal();
      addMigration(clean, '0051_clean', properTable('inv_legacy_ok'));
      const ok = await wrap(incrementalEnv('inv_legacy'), { migrationsDir: clean });
      expect([ok.exitCode, ok.applied.length], ok.text).toEqual([0, 1]);
      expect(ok.text).toMatch(/WARNING: pre-existing deviations, not blocking/);

      const bad = copyOfReal();
      addMigration(bad, '0051_clean', properTable('inv_legacy_ok'));
      addMigration(bad, '0052_bad', 'CREATE TABLE inv_legacy_bad (id int);--> statement-breakpoint\nALTER TABLE inv_legacy_bad ENABLE ROW LEVEL SECURITY;');
      await fromTemplate('inv_legacy2', 'golden');
      await q('inv_legacy2', 'ALTER TABLE public.warehouses NO FORCE ROW LEVEL SECURITY');
      const refused = await wrap(incrementalEnv('inv_legacy2'), { migrationsDir: bad, disableSqlLintForTests: true });
      expect(refused.exitCode).toBe(1);
      expect(codes(refused)).toEqual(['INVARIANT_RLS_NOT_FORCED']);
      expect(refused.text).toContain('inv_legacy_bad');
      expect(refused.text).not.toMatch(/\bwarehouses\b.*not FORCEd:/);
      expect(await registryCount('inv_legacy2')).toBe(51);
    });

    it('a failure of the provisioning step also happens AFTER the commit: the migrations stay applied and the run says so', async () => {
      const admin = cluster.admin();
      try {
        await admin.unsafe(`CREATE ROLE inv_su_login LOGIN SUPERUSER PASSWORD '${INC_PASSWORD}'`);
      } finally {
        await admin.end({ timeout: 5 });
      }
      await cluster.createDatabase('inv_prov');
      const r = await wrap(bootstrapEnv('inv_prov', { MIGRATOR_INCREMENTAL_LOGIN: 'inv_su_login' }));
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('provision');
      expect(r.applied).toHaveLength(51);
      expect(r.text).toContain('The migrations were applied');
      expect(await registryCount('inv_prov')).toBe(51);
      expect(await publicTables('inv_prov')).toBe(54);
    });

    it('the pre-commit guard was actually in the path of every earlier successful batch (it is not silently skipped)', async () => {
      // golden was bootstrapped with the guard on: its 51 migrations committed only after the in-transaction check.
      expect(bootstrapResult.exitCode).toBe(0);
      expect(bootstrapResult.stage).toBe('done');
      expect(bootstrapResult.text).not.toContain('INVARIANT_GUARD_NOT_INVOKED');
    });
  });

  describe('D-8A: --provision-only preconditions, TEMPLATE adoption, and the exact scope of the deprecated alias', () => {
    const dbCreate = async (db: string) =>
      (await scalar(db, `SELECT has_database_privilege('app_migrator', '${db}', 'CREATE')`)) as boolean;
    const aliasEnv = (db: string): MigratorEnv => ({
      MIGRATOR_DATABASE_URL: cluster.superuserUrl(db),
      MIGRATOR_EXPECTED_DATABASE: db,
    });

    it('--provision-only on a NEW database names the unmet precondition and grants nothing', async () => {
      await cluster.createDatabase('prov_new');
      const before = await dbCreate('prov_new');
      const r = await wrap(bootstrapEnv('prov_new'), { provisionOnly: true });
      expect(r.exitCode).toBe(1);
      expect(r.stage).toBe('assess');
      expect(codes(r)).toEqual(['PROVISION_PRECONDITION_FAILED']);
      expect(r.text).toContain('no applied migrations (state NEW)');
      expect(await dbCreate('prov_new')).toBe(before);
      expect(await publicTables('prov_new')).toBe(0);
    });

    it('--provision-only on an inconsistent history is refused by the history checks and grants nothing', async () => {
      await cluster.createDatabase('prov_bad', 'tpl_legacy_full');
      await q('prov_bad', `DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT id FROM drizzle.__drizzle_migrations ORDER BY id OFFSET 12 LIMIT 1)`);
      const r = await wrap(bootstrapEnv('prov_bad'), { provisionOnly: true });
      expect(r.exitCode).toBe(1);
      expect(codes(r)).toEqual(expect.arrayContaining(['HISTORY_MISSING_APPLIED_MIGRATION']));
      expect(await dbCreate('prov_bad')).toBe(false);
    });

    it('a database created with TEMPLATE is refused with the remedy, then adopted by --provision-only and migrates incrementally', async () => {
      await cluster.createDatabase('tmpl_copy', 'tpl_legacy_40');
      expect(await dbCreate('tmpl_copy')).toBe(false);

      const refused = await wrap(incrementalEnv('tmpl_copy'));
      expect(refused.exitCode).toBe(1);
      expect(codes(refused)).toContain('IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE');
      expect(refused.text).toContain('CREATE DATABASE … TEMPLATE');
      expect(refused.text).toContain('--mode bootstrap --provision-only');
      expect(refused.text).toContain('Incremental mode never grants it by itself');
      // the refusal changed nothing: no grant, history untouched
      expect(await dbCreate('tmpl_copy')).toBe(false);
      expect(await registryCount('tmpl_copy')).toBe(40);

      const adopt = await wrap(bootstrapEnv('tmpl_copy'), { provisionOnly: true });
      expect([adopt.exitCode, adopt.applied.length]).toEqual([0, 0]);
      expect(await dbCreate('tmpl_copy')).toBe(true);

      const migrated = await wrap(incrementalEnv('tmpl_copy'));
      expect([migrated.exitCode, migrated.applied.length]).toEqual([0, 11]);
    });

    it('the deprecated alias alone: refuses ordinary migrations on an existing database and says exactly what to do', async () => {
      await cluster.createDatabase('alias40', 'tpl_legacy_40');
      const r = await wrap(aliasEnv('alias40'));
      expect(r.exitCode).toBe(1);
      expect(codes(r)).toContain('MODE_BOOTSTRAP_NOT_REQUIRED');
      expect(r.text).toMatch(/WARNING: MIGRATOR_DATABASE_URL is deprecated.*bootstrap mode only/s);
      expect(r.text).toContain('--mode bootstrap --provision-only');
      expect(r.text).toContain('bootstrap-only alias and cannot run these migrations');
      expect(await registryCount('alias40')).toBe(40);
    });

    it('the deprecated alias alone: a NEW database and "nothing to do" work; a privileged migration on an existing database needs it adopted first', async () => {
      await cluster.createDatabase('alias_new');
      const fresh = await wrap(aliasEnv('alias_new'));
      expect([fresh.exitCode, fresh.applied.length]).toEqual([0, 51]);
      const nothing = await wrap(aliasEnv('alias_new'));
      expect([nothing.exitCode, nothing.applied.length]).toEqual([0, 0]);

      // An existing database that was never provisioned: refused up front (it used to fail inside Drizzle, rolled back but opaque).
      await cluster.createDatabase('alias18', 'tpl_legacy_18');
      const refused = await wrap(aliasEnv('alias18'));
      expect(refused.exitCode).toBe(1);
      expect(refused.stage).toBe('assess');
      expect(codes(refused)).toEqual(['IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE']);
      expect(refused.text).toContain('--mode bootstrap --provision-only');
      expect(await registryCount('alias18')).toBe(19);

      // Adopted once (the alias URL may do that, together with the incremental login variables), it applies 0019 and the rest.
      const adopt = await wrap({ ...aliasEnv('alias18'), MIGRATOR_INCREMENTAL_LOGIN: INC_LOGIN, MIGRATOR_INCREMENTAL_PASSWORD: INC_PASSWORD }, { provisionOnly: true });
      expect([adopt.exitCode, adopt.applied.length]).toEqual([0, 0]);
      const privileged = await wrap(aliasEnv('alias18'));
      expect([privileged.exitCode, privileged.applied.length], privileged.text).toEqual([0, 32]);
    });

    it('both names at once is refused before connecting, and no output carries a URL', async () => {
      const r = await wrap({ ...bootstrapEnv('golden'), MIGRATOR_DATABASE_URL: cluster.superuserUrl('golden') });
      expect(r.stage).toBe('config');
      expect(codes(r)).toContain('CONFIG_VARIABLE_CONFLICT');
    });
  });

  describe('12. 0051 (the read-only QA role) on the FULL real folder — the first privileged migration after 0019', () => {
    const FULL_COUNT = (JSON.parse(readFileSync(join(REAL_FULL, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;

    it('a fresh bootstrap applies every migration including 0051; the role exists NOLOGIN with SELECT only, 27 pinned policies, views owned by app_migrator, every RLS table still FORCEd', async () => {
      expect(FULL_COUNT).toBeGreaterThan(FROZEN_COUNT);
      await cluster.createDatabase('full0051');
      const run = await wrap(bootstrapEnv('full0051'), { migrationsDir: REAL_FULL });
      expect([run.exitCode, run.applied.length], run.text).toEqual([0, FULL_COUNT]);
      expect(await scalar('full0051', `SELECT rolcanlogin::text || rolsuper::text || rolbypassrls::text || rolcreaterole::text FROM pg_roles WHERE rolname = 'app_qa_readonly'`)).toBe('falsefalsefalsefalse');
      expect(await scalar('full0051', `SELECT count(*) FROM pg_policies WHERE 'app_qa_readonly' = ANY (roles)`)).toBe('27');
      expect(await scalar('full0051', `SELECT count(*) FROM information_schema.table_privileges WHERE grantee = 'app_qa_readonly' AND privilege_type <> 'SELECT'`)).toBe('0');
      expect(await scalar('full0051', `SELECT count(*) FROM pg_views WHERE viewname LIKE 'qa_readonly_%' AND viewowner = 'app_migrator'`)).toBe('2');
      expect(await scalar('full0051', `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'app_migrator'`)).toBe('0');
      expect(
        await scalar('full0051', `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity`),
      ).toBe('0');
      const again = await wrap(bootstrapEnv('full0051'), { migrationsDir: REAL_FULL });
      expect([again.exitCode, again.applied.length]).toEqual([0, 0]);
    });

    // D-8E.26-B4.11.3 — 0052 (ordinary): the scope is an immutable tenant UUID in a protected configuration that is EMPTY after the migrations.
    const ROLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const assertEmptyProtectedConfig = async (db: string): Promise<void> => {
      expect(await scalar(db, `SELECT count(*) FROM qa_readonly_tenant_config`)).toBe('0'); // empty by default: 0052 inserts nothing and looks nothing up
      expect(await scalar(db, `SELECT count(*) FROM qa_readonly_scope`)).toBe('0'); // fail closed
      expect(await scalar(db, `SELECT count(*) FROM qa_readonly_tenant`)).toBe('0');
      expect(await scalar(db, `SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE relname = 'qa_readonly_tenant_config'`)).toBe('app_migrator');
      expect(await scalar(db, `SELECT relrowsecurity::text FROM pg_class WHERE relname = 'qa_readonly_tenant_config'`)).toBe('false');
      expect(await scalar(db, `SELECT count(*) FROM pg_policies WHERE 'app_qa_readonly' = ANY (roles)`)).toBe('27'); // the 27 policies are untouched
      expect(await scalar(db, `SELECT count(*) FROM pg_views WHERE viewname LIKE 'qa_readonly_%' AND viewowner = 'app_migrator'`)).toBe('2');
      for (const role of ['app_tenant', 'app_platform', 'app_event_processor', 'app_public_resolver', 'app_import_worker', 'app_qa_readonly']) {
        for (const privilege of ROLE_PRIVILEGES) {
          expect(await scalar(db, `SELECT has_table_privilege('${role}', 'public.qa_readonly_tenant_config', '${privilege}')::text`), `${role} ${privilege}`).toBe('false');
        }
      }
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(await scalar(db, `SELECT has_table_privilege('app_migrator', 'public.qa_readonly_tenant_config', '${privilege}')::text`), `app_migrator ${privilege}`).toBe('false');
      }
      expect(await scalar(db, `SELECT rolcanlogin::text FROM pg_roles WHERE rolname = 'app_qa_readonly'`)).toBe('false'); // still NOLOGIN, still no password
      expect(await scalar(db, `SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'app_qa_readonly'`)).toBe(true);
    };

    it('the FULL real folder leaves the protected configuration empty: both scope views return no row, nobody but the owner can read it, and nobody can write it', async () => {
      await assertEmptyProtectedConfig('full0051');
    });

    it('0052 is ORDINARY: the limited incremental login applies it on top of a database that already has 0051', async () => {
      const upTo0051 = frozenPrefix(REAL_FULL, FROZEN_COUNT + 1);
      await cluster.createDatabase('inc0052');
      const first = await wrap(bootstrapEnv('inc0052'), { migrationsDir: upTo0051 });
      expect([first.exitCode, first.applied.length], first.text).toEqual([0, FROZEN_COUNT + 1]);
      const oidBefore = await scalar('inc0052', `SELECT 'qa_readonly_scope'::regclass::oid::text`);

      const inc = await wrap(incrementalEnv('inc0052'), { migrationsDir: REAL_FULL });
      expect([inc.exitCode, inc.applied.length], inc.text).toEqual([0, FULL_COUNT - FROZEN_COUNT - 1]);
      expect(await registryCount('inc0052')).toBe(FULL_COUNT);
      expect(await scalar('inc0052', `SELECT 'qa_readonly_scope'::regclass::oid::text`)).toBe(oidBefore); // REPLACED, not recreated: the policies keep depending on it
      await assertEmptyProtectedConfig('inc0052');
      const nothing = await wrap(incrementalEnv('inc0052'), { migrationsDir: REAL_FULL });
      expect([nothing.exitCode, nothing.applied.length]).toEqual([0, 0]);
    });

    it('a pending privileged migration is refused for the incremental login before anything is applied; the bootstrap run then applies it', async () => {
      await cluster.createDatabase('pend0051', 'tpl_legacy_full');
      const adopt = await wrap(bootstrapEnv('pend0051'), { provisionOnly: true, migrationsDir: REAL_FULL });
      expect([adopt.exitCode, adopt.applied.length]).toEqual([0, 0]);
      expect(await registryCount('pend0051')).toBe(FROZEN_COUNT);

      const refused = await wrap(incrementalEnv('pend0051'), { migrationsDir: REAL_FULL });
      expect(refused.exitCode, refused.text).toBe(1);
      expect(refused.applied).toEqual([]);
      expect(await registryCount('pend0051')).toBe(FROZEN_COUNT);
      expect(await scalar('pend0051', `SELECT count(*) FROM pg_policies WHERE 'app_qa_readonly' = ANY (roles)`)).toBe('0'); // the role itself is cluster-wide, its policies are per database

      const done = await wrap(bootstrapEnv('pend0051'), { migrationsDir: REAL_FULL });
      expect([done.exitCode, done.applied.length], done.text).toEqual([0, FULL_COUNT - FROZEN_COUNT]);
      expect(await registryCount('pend0051')).toBe(FULL_COUNT);
      expect(await scalar('pend0051', `SELECT count(*) FROM pg_policies WHERE 'app_qa_readonly' = ANY (roles)`)).toBe('27');
    });
  });

  // D-8E.26-B4.11.5.2 — the isolation suite of app_qa_readonly (tools/pg-verify/qa-readonly-role.embedded.test.ts, 51 tests) run against databases that THIS FILE's wrapper
  // produced, not against SQL applied by hand. The suite itself is not copied: it is started as a child process in "wrapper mode" (QA_RO_PREMIGRATED_DATABASE), where it applies no
  // migration and runs the same assertions — including verifyQaPolicies() (the 27 policies, one by one, from the catalogs) — on the database it is given. The database must carry
  // a random per-run token as its COMMENT, so the suite refuses to touch anything this file did not create. Tests that need the migration TEXT applied to a pristine cluster
  // (the three pre-existing-role adoption scenarios) cannot run on a finished database: they stay in the direct-mode run (qa-readonly-isolation job) and are reported as skipped here.
  // Cluster-wide note: by now the cluster already holds app_qa_readonly (section 12 created it), so these two databases meet an existing, NOLOGIN, password-less role; the creation path
  // is asserted by section 12 and by the direct-mode suite.
  describe('13. app_qa_readonly: the isolation suite against databases migrated BY THE WRAPPER (bootstrap, and incremental 0051 -> 0052)', () => {
    const PGV_DIR = join(__dirname, '..', '..', '..', '..', 'tools', 'pg-verify');
    const FULL_TOTAL = (JSON.parse(readFileSync(join(REAL_FULL, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;
    const token = randomBytes(18).toString('hex');
    const secrets = (): string[] => [token, INC_PASSWORD];
    /** The caller's environment without anything that could steer the child to another server (PG*, MIGRATOR_*, MIGRATION_HARNESS_*, QA_RO_*). */
    const cleanEnv = (): NodeJS.ProcessEnv => {
      const env: NodeJS.ProcessEnv = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && !/^(PG|MIGRATOR_|MIGRATION_HARNESS_|QA_RO_)/.test(k)) env[k] = v;
      }
      return env;
    };

    async function markAsThisRun(db: string): Promise<void> {
      const sql = cluster.admin();
      try {
        await sql.unsafe(`COMMENT ON DATABASE ${db} IS '${token}'`);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    function isolationSuite(db: string, extra: Record<string, string> = {}) {
      const started = Date.now();
      // `pnpm exec node --import tsx …` only adds node_modules/.bin to PATH; `node --import tsx` resolves tsx from the cwd (tools/pg-verify, where it is a declared devDependency),
      // so the SAME node binary that runs this file is started directly: no shell and no pnpm wrapper between the harness and the child, which means a timeout kills the child
      // itself (not just a shell) and a failure carries the child's own exit code. The spec reporter is explicit: Node 20 would use TAP when stdout is not a TTY.
      const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', 'qa-readonly-role.embedded.test.ts'], {
        cwd: PGV_DIR,
        encoding: 'utf8',
        timeout: 400_000,
        killSignal: 'SIGKILL',
        env: {
          ...cleanEnv(),
          QA_RO_PG16_BIN: '',
          QA_RO_SERVER_URL: cluster.superuserUrl('postgres'),
          QA_RO_PREMIGRATED_DATABASE: db,
          QA_RO_HARNESS_TOKEN: token,
          QA_RO_EXPECTED_SERVER_VERSION_NUM: String(process.env['MIGRATION_HARNESS_EXPECTED_SERVER_VERSION_NUM'] ?? '160015'),
          ...extra,
        },
      });
      const out = `${r.stdout}${r.stderr}${r.error !== undefined ? `\n[spawn error: ${r.error.message}] signal=${String(r.signal)}` : ''}`;
      // the spec reporter prints "ℹ tests 51"; the TAP reporter "# tests 51" — both are understood
      const n = (label: string): number => Number(new RegExp(`^(?:ℹ|#) ${label} (\\d+)`, 'm').exec(out)?.[1] ?? Number.NaN);
      for (const secret of secrets()) expect(out).not.toContain(secret);
      expect(out).not.toMatch(/postgres(ql)?:\/\//i);
      const failing = out.split('\n').filter((l) => l.includes('✖') || l.startsWith('not ok')).slice(0, 12).join('\n');
      return { status: r.status, out, tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), seconds: Math.round((Date.now() - started) / 1000), failing };
    }

    // whatever happens (a failure, a timeout that killed the child before its own cleanup), the cluster-wide role is put back: no login, no password
    afterAll(async () => {
      const sql = cluster.admin();
      try {
        await sql.unsafe('ALTER ROLE app_qa_readonly WITH NOLOGIN PASSWORD NULL');
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    const roleState = async (): Promise<string> =>
      String(await scalar('postgres', `SELECT rolcanlogin::text || '/' || (rolpassword IS NULL)::text || '/' || (rolvaliduntil IS NULL)::text || '/' || rolsuper::text || rolcreatedb::text || rolcreaterole::text || rolreplication::text || rolbypassrls::text FROM pg_authid WHERE rolname = 'app_qa_readonly'`));

    it('A. bootstrap of the full folder by the wrapper (53 migrations) -> the 51-test suite, incl. verifyQaPolicies, on the database the wrapper made', async () => {
      expect(FULL_TOTAL).toBe(53);
      await cluster.createDatabase('qa_ro_wrap_full');
      await markAsThisRun('qa_ro_wrap_full');
      const run = await wrap(bootstrapEnv('qa_ro_wrap_full'), { migrationsDir: REAL_FULL });
      expect([run.exitCode, run.stage, run.applied.length], run.text).toEqual([0, 'done', FULL_TOTAL]);
      expect(await registryCount('qa_ro_wrap_full')).toBe(FULL_TOTAL);
      expect(await scalar('qa_ro_wrap_full', `SELECT count(*) FROM qa_readonly_tenant_config`)).toBe('0');
      expect(await roleState()).toBe('false/true/true/falsefalsefalsefalsefalse');

      const result = isolationSuite('qa_ro_wrap_full');
      console.info(`[B4.11.5.2 A] PostgreSQL ${await cluster.serverVersion()} (${await cluster.serverVersionNum()}), wrapper bootstrap, ${run.applied.length} migrations, isolation suite: tests=${result.tests} pass=${result.pass} fail=${result.fail} skipped=${result.skipped}, ${result.seconds}s, exit=${result.status}`);
      expect(result.failing, result.out.slice(-1500)).toBe('');
      expect([result.status, result.tests, result.fail, result.pass + result.skipped], result.out.slice(-2500)).toEqual([0, 51, 0, 51]);
      expect(result.skipped).toBe(4); // 3 pre-existing-role adoption scenarios + the "view REPLACED" OID test (incremental scenario B covers it)
      expect(result.out).toContain('WRAPPER MODE');
      expect(result.out).toContain('# verifyQaPolicies: 27 policies verified individually, 0 problems');
      expect(await roleState()).toBe('false/true/true/falsefalsefalsefalsefalse'); // the suite put the role back: no login, no password
    });

    it('B. wrapper bootstrap up to 0051, OIDs captured, wrapper INCREMENTAL login applies 0052, OIDs unchanged, then the 51-test suite on the result', async () => {
      const upTo0051 = frozenPrefix(REAL_FULL, FROZEN_COUNT + 1);
      await cluster.createDatabase('qa_ro_wrap_inc');
      await markAsThisRun('qa_ro_wrap_inc');
      const first = await wrap(bootstrapEnv('qa_ro_wrap_inc'), { migrationsDir: upTo0051 });
      expect([first.exitCode, first.applied.length], first.text).toEqual([0, FROZEN_COUNT + 1]);
      const snapshot = async (): Promise<{ scope: string; tenant: string; policies: string }> => ({
        scope: String(await scalar('qa_ro_wrap_inc', `SELECT 'qa_readonly_scope'::regclass::oid::text`)),
        tenant: String(await scalar('qa_ro_wrap_inc', `SELECT 'qa_readonly_tenant'::regclass::oid::text`)),
        policies: String(await scalar('qa_ro_wrap_inc', `SELECT string_agg(p.oid::text, ',' ORDER BY p.polname) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = ANY (SELECT tablename FROM pg_policies WHERE 'app_qa_readonly' = ANY (roles))`)),
      });
      expect(await scalar('qa_ro_wrap_inc', `SELECT to_regclass('public.qa_readonly_tenant_config') IS NULL`)).toBe(true); // 0052 not applied yet
      const before = await snapshot();

      const inc = await wrap(incrementalEnv('qa_ro_wrap_inc'), { migrationsDir: REAL_FULL });
      expect([inc.exitCode, inc.stage, inc.applied.length], inc.text).toEqual([0, 'done', 1]);
      expect(await registryCount('qa_ro_wrap_inc')).toBe(FULL_TOTAL);
      const after = await snapshot();
      expect(after).toEqual(before); // both views were REPLACED (same OID) and the policies (same OIDs) were not touched
      expect(await scalar('qa_ro_wrap_inc', `SELECT count(*) FROM qa_readonly_tenant_config`)).toBe('0');
      expect(await roleState()).toBe('false/true/true/falsefalsefalsefalsefalse');

      const result = isolationSuite('qa_ro_wrap_inc', { QA_RO_SCOPE_VIEW_OID_AFTER_0051: before.scope });
      console.info(`[B4.11.5.2 B] PostgreSQL ${await cluster.serverVersion()} (${await cluster.serverVersionNum()}), wrapper bootstrap to 0051 then incremental 0052; OIDs scope=${before.scope} tenant-view=${before.tenant} (unchanged), ${before.policies.split(',').length} policy OIDs unchanged; isolation suite: tests=${result.tests} pass=${result.pass} fail=${result.fail} skipped=${result.skipped}, ${result.seconds}s, exit=${result.status}`);
      expect(result.failing, result.out.slice(-1500)).toBe('');
      expect([result.status, result.tests, result.fail, result.pass + result.skipped], result.out.slice(-2500)).toEqual([0, 51, 0, 51]);
      expect(result.skipped).toBe(3); // the 3 pre-existing-role adoption scenarios only
      expect(result.out).toContain('# verifyQaPolicies: 27 policies verified individually, 0 problems');
      expect(await roleState()).toBe('false/true/true/falsefalsefalsefalsefalse');
    });
  });

  describe('output hygiene and teardown', () => {
    it('no captured output contains a password or a connection string', () => {
      const text = allLines.join('\n');
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain(INC_PASSWORD);
      expect(text).not.toMatch(/postgres(ql)?:\/\//i);
      expect(text).not.toContain('127.0.0.1');
    });

    it('stops and deletes the cluster this file created, and nothing else (an external server is left to whoever created it)', async () => {
      const dir = cluster.root;
      const result = await cluster.stop();
      if (cluster.external) {
        expect(result).toEqual({ stopped: false, removed: false });
        return;
      }
      expect(result).toEqual({ stopped: true, removed: true });
      expect(existsSync(dir)).toBe(false);
    });
  });
});
