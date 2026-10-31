import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

/**
 * D-8E.26-B4.11 — proves, against a REAL PostgreSQL, what migrations 0051 + 0052 (`app_qa_readonly`, its tenant-UUID scope) can and cannot do. Opt-in (`pnpm test:embedded`).
 *
 * Isolation: it starts its OWN embedded server, in a fresh directory under the OS temp folder, on a port it picks itself from a range nobody uses
 * (never 5432, 55432, 55433, 55440, 55450 or 55470), with a random password that exists only in this process, and it deletes that directory at the
 * end. It connects to nothing else: no development database, no restored copy, no `.dev-pgdata`, no `.env`, no API, no S3. All data is synthetic.
 * The real migration files (0000 … 0052) are applied in order, statement by statement, over one superuser connection — the same single-session
 * semantics the project's runner relies on (`SET ROLE app_migrator` carries through the batch). The embedded binary is PostgreSQL 18; the project's
 * reference is 16: privileges, RLS and security_barrier behave the same for everything asserted here.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(REPO, 'database', 'migrations');
const ROLE = 'app_qa_readonly';
const PROTECTED = new Set([5432, 55432, 55433, 55440, 55450, 55470]);
const PLAN = JSON.parse(readFileSync(new URL('./qa-readonly-plan.json', import.meta.url), 'utf8')) as Record<string, string[] | null>;

// A server somebody else started (CI / harness) needs no directory of ours: nothing is created here, so a killed run cannot leave one behind.
const root = (process.env['QA_RO_SERVER_URL'] ?? '') !== '' ? '' : realpathSync.native(mkdtempSync(path.join(tmpdir(), 'pgv-qa-ro-')));
let superPassword = randomBytes(12).toString('hex');
const rolePassword = randomBytes(12).toString('hex');
let port = 0;
let pg: EmbeddedPostgres | undefined;
let admin: postgres.Sql;

async function freePort(): Promise<number> {
  for (let i = 0; i < 60; i += 1) {
    const candidate = 56200 + Math.floor(Math.random() * 100);
    if (PROTECTED.has(candidate)) continue;
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      s.listen(candidate, '127.0.0.1');
    });
    if (ok) return candidate;
  }
  throw new Error('no free port');
}

const url = (user: string, password: string, database = DB): string => `postgresql://${user}:${password}@127.0.0.1:${String(port)}/${database}`;

/** Runs `fn` on ONE connection of the role under test, then closes it (the role has CONNECTION LIMIT 2). */
async function asRole<T>(fn: (sql: postgres.Sql, notices: string[]) => Promise<T>): Promise<T> {
  const notices: string[] = [];
  const sql = postgres(url(ROLE, rolePassword), { max: 1, onnotice: (n) => notices.push(String(n.message)) });
  try {
    return await fn(sql, notices);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function denied(work: Promise<unknown>, code = '42501'): Promise<void> {
  try {
    await work;
  } catch (error) {
    assert.equal((error as { code?: string }).code, code, `expected SQLSTATE ${code}, got ${String((error as Error).message)}`);
    return;
  }
  assert.fail(`expected SQLSTATE ${code}, but the statement succeeded`);
}

let scopeViewOidAfter0051 = '';
const ids = { a: '', b: '', c: '' };
const names = { a: 'tenant a', b: 'tenant b', c: 'tenant c' };

// ---- the server. Default: the embedded PostgreSQL 18 package. With QA_RO_PG16_BIN=<bin directory of an installed PostgreSQL 16.15> the test builds a NEW
// cluster of its own with THOSE binaries (initdb / pg_ctl, like apps/api/test/migration-harness/cluster.ts) — it never touches the installed service or its data.
const PG16_BIN = process.env['QA_RO_PG16_BIN'];
const EXE = process.platform === 'win32' ? '.exe' : '';
const binExe = (name: string): string => path.join(PG16_BIN ?? '', `${name}${EXE}`);
const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key, value]) => !key.startsWith('PG') && value !== undefined));
function runBin(name: string, args: string[], detached = false): { status: number | null; out: string } {
  // pg_ctl start leaves the server running with the pipes it inherited: with piped stdio spawnSync would wait for the server to exit.
  const r = spawnSync(binExe(name), args, { env: cleanEnv(), encoding: 'utf8', windowsHide: true, ...(detached ? { stdio: 'ignore' as const } : {}) });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const ownDataDir = path.join(root, 'data');

// ---- CI mode (B4.11.5). QA_RO_SERVER_URL = a superuser URL of a server somebody else started FOR THIS RUN (the CI job starts a postgres:16.15@sha256 container with a
// random password on 127.0.0.1). The test then creates its own database in it and drops it at the end; it never starts or stops the server. Because the migrations create
// ROLES (cluster-wide), the server is refused unless it is loopback, on an unprotected port, and FRESH (no database but the template ones and "postgres", no role but the
// connecting superuser and the built-in pg_*): a server that has ever held anything can never be a real one. QA_RO_EXPECTED_SERVER_VERSION_NUM (e.g. 160015) is checked on the server itself.
const EXTERNAL_URL = process.env['QA_RO_SERVER_URL'] ?? '';
const EXTERNAL = EXTERNAL_URL !== '';
// ---- Wrapper mode (B4.11.5.2). QA_RO_PREMIGRATED_DATABASE = a database that the project's MIGRATION WRAPPER (apps/api migrate.ts / run-migrations) has ALREADY migrated, inside the
// server of the migration harness (QA_RO_SERVER_URL). The test then applies no migration at all and runs the same assertions on what the wrapper produced. The server is not fresh
// (the harness has made other databases and roles in it), so the guard is different: the database name must be qa_ro_wrap_*, its COMMENT must equal a random token the harness
// generated for this run (QA_RO_HARNESS_TOKEN, so a database that merely has such a name is refused), it must hold no tenant and an empty qa_readonly_tenant_config, and the role must
// be NOLOGIN without a password at the start. QA_RO_SCOPE_VIEW_OID_AFTER_0051 (the harness captured it after 0051, before 0052) enables the "view REPLACED, not recreated" test.
// Tests that need the migration TEXT to run on a pristine database (pre-existing-role adoption scenarios) cannot run here and are skipped, explicitly.
const PREMIGRATED_DB = process.env['QA_RO_PREMIGRATED_DATABASE'] ?? '';
const PREMIGRATED = PREMIGRATED_DB !== '';
const SKIP_IN_WRAPPER_MODE = PREMIGRATED ? 'wrapper mode: needs the migration text applied to a pristine cluster (covered in direct mode)' : false;
const DB = PREMIGRATED ? PREMIGRATED_DB : 'qa_ro_test';
async function verifyPremigratedDatabase(): Promise<void> {
  const token = process.env['QA_RO_HARNESS_TOKEN'] ?? '';
  if (!/^qa_ro_wrap_[a-z0-9_]+$/.test(DB)) throw new Error('QA_RO_PREMIGRATED_DATABASE must be named qa_ro_wrap_*');
  if (token.length < 16) throw new Error('QA_RO_HARNESS_TOKEN is missing');
  const probe = postgres(url('postgres', superPassword, 'postgres'), { max: 1, onnotice: () => undefined });
  try {
    const [d] = await probe<Array<{ c: string | null }>>`SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = ${DB}`;
    assert.equal(d?.c, token, 'the database does not carry this run\'s harness token: it was not created for this run');
  } finally {
    await probe.end({ timeout: 5 });
  }
  const own = postgres(url('postgres', superPassword, DB), { max: 1, onnotice: () => undefined });
  try {
    const [c] = await own<Array<{ t: number; q: number }>>`SELECT (SELECT count(*) FROM tenants)::int AS t, (SELECT count(*) FROM qa_readonly_tenant_config)::int AS q`;
    assert.deepEqual(c, { t: 0, q: 0 }, 'the wrapper-migrated database must start empty');
    const [r] = await own<Array<{ login: boolean; no_password: boolean }>>`SELECT rolcanlogin AS login, rolpassword IS NULL AS no_password FROM pg_authid WHERE rolname = ${ROLE}`;
    assert.deepEqual(r, { login: false, no_password: true }, 'the role must start NOLOGIN and without a password');
  } finally {
    await own.end({ timeout: 5 });
  }
}
async function adoptExternalServer(): Promise<void> {
  if (PG16_BIN !== undefined && PG16_BIN !== '') throw new Error('set either QA_RO_PG16_BIN or QA_RO_SERVER_URL, not both');
  const u = new URL(EXTERNAL_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('QA_RO_SERVER_URL must point at the loopback interface');
  port = Number(u.port || '5432');
  if (PROTECTED.has(port)) throw new Error(`refusing protected port ${String(port)}`);
  if (decodeURIComponent(u.username) !== 'postgres' || u.password === '') throw new Error('QA_RO_SERVER_URL must be the "postgres" superuser with a password');
  superPassword = decodeURIComponent(u.password);
  if (PREMIGRATED) {
    await verifyPremigratedDatabase();
    return;
  }
  const probe = postgres(url('postgres', superPassword, 'postgres'), { max: 1, onnotice: () => undefined });
  try {
    const [su] = await probe<Array<{ s: string }>>`SELECT current_setting('is_superuser') AS s`;
    assert.equal(su?.s, 'on', 'the connecting role must be a superuser');
    const dbs = await probe<Array<{ datname: string }>>`SELECT datname FROM pg_database WHERE datname NOT IN ('postgres', 'template0', 'template1')`;
    const roles = await probe<Array<{ rolname: string }>>`SELECT rolname FROM pg_roles WHERE rolname <> 'postgres' AND rolname !~ '^pg_'`;
    assert.deepEqual([dbs.map((d) => d.datname), roles.map((r) => r.rolname)], [[], []], 'the server is not fresh: refusing to create roles in it');
    await probe.unsafe(`CREATE DATABASE ${DB}`);
  } finally {
    await probe.end({ timeout: 5 });
  }
}

async function startServer(): Promise<void> {
  if (EXTERNAL) return adoptExternalServer();
  port = await freePort();
  if (PG16_BIN === undefined || PG16_BIN === '') {
    pg = new EmbeddedPostgres({ databaseDir: path.join(root, 'pgdata'), port, user: 'postgres', password: superPassword, persistent: true });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('qa_ro_test');
    return;
  }
  // Pre-flight, before anything is created: the exact binary version, a directory that does not exist yet, a port nobody answers on.
  const version = runBin('postgres', ['--version']);
  if (!version.out.includes('(PostgreSQL) 16.15')) throw new Error(`QA_RO_PG16_BIN must hold PostgreSQL 16.15 exactly; "postgres --version" says: ${version.out.trim()}`);
  if (existsSync(ownDataDir)) throw new Error('the data directory already exists; refusing to reuse a cluster');
  const pwFile = path.join(root, 'su.pw');
  writeFileSync(pwFile, superPassword, { mode: 0o600 });
  try {
    const init = runBin('initdb', ['-D', ownDataDir, '-U', 'postgres', '-A', 'scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C', '--no-sync']);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.out.slice(-300)}`);
  } finally {
    rmSync(pwFile, { force: true });
  }
  const options = `-p ${String(port)} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=60`;
  const started = runBin('pg_ctl', ['-D', ownDataDir, '-o', options, '-l', path.join(root, 'server.log'), '-w', '-t', '60', 'start'], true);
  if (started.status !== 0) throw new Error('pg_ctl start failed (see server.log in the temporary directory)');
  const bootstrap = postgres(url('postgres', superPassword, 'postgres'), { max: 1, onnotice: () => undefined });
  try {
    await bootstrap.unsafe('CREATE DATABASE qa_ro_test');
  } finally {
    await bootstrap.end({ timeout: 5 });
  }
}

async function stopServer(): Promise<void> {
  if (PREMIGRATED) return; // the database and the server belong to the harness
  if (EXTERNAL) {
    // only the database this run created; the server and its (cluster-wide) roles belong to whoever started it, and are removed with it
    const probe = postgres(url('postgres', superPassword, 'postgres'), { max: 1, onnotice: () => undefined });
    try {
      await probe.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    } finally {
      await probe.end({ timeout: 5 });
    }
    return;
  }
  if (PG16_BIN === undefined || PG16_BIN === '') await pg?.stop().catch(() => undefined);
  else if (existsSync(ownDataDir)) runBin('pg_ctl', ['-D', ownDataDir, '-m', 'fast', '-w', '-t', '60', 'stop'], true);
}

/**
 * B4.11.5.1 — verifies the 27 policies of the role ONE BY ONE from the real catalogs (pg_policy, pg_class, pg_namespace, pg_roles, pg_depend, pg_get_expr) and returns a
 * list of problems (empty = all good). It looks at EVERY policy that could apply to the role (named for it, or for PUBLIC), so an extra permissive policy that widens the
 * access is a problem too, not just a weakened one of the 27. The mutation tests below prove that it really detects such changes.
 */
async function verifyQaPolicies(): Promise<string[]> {
  const problems: string[] = [];
  const rows = await admin<Array<{ pol: string; tbl: string; ns: string; cmd: string; permissive: boolean; roles: string[]; qual: string | null; chk: string | null; viewdep: boolean; rls: boolean; force: boolean }>>`
    SELECT p.polname::text AS pol, c.relname::text AS tbl, n.nspname::text AS ns, p.polcmd::text AS cmd, p.polpermissive AS permissive,
           ARRAY(SELECT CASE WHEN o = 0::oid THEN 'PUBLIC' ELSE (SELECT r.rolname::text FROM pg_roles r WHERE r.oid = o) END FROM unnest(p.polroles) AS o)::text[] AS roles,
           pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS chk,
           EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = p.oid AND d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.qa_readonly_scope'::regclass) AS viewdep,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS force
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE 0::oid = ANY (p.polroles) OR (SELECT r.oid FROM pg_roles r WHERE r.rolname = ${ROLE}) = ANY (p.polroles)
    ORDER BY c.relname, p.polname`;
  const expected = Object.keys(PLAN).sort();
  const seen = rows.map((r) => r.tbl).sort();
  if (JSON.stringify(seen) !== JSON.stringify(expected)) problems.push(`policies applying to the role are on [${seen.join(',')}], expected exactly [${expected.join(',')}] (one each)`);
  for (const r of rows) {
    const where = `${r.ns}.${r.tbl}/${r.pol}`;
    if (r.ns !== 'public') problems.push(`${where}: schema`);
    if (r.pol !== `${r.tbl}_qa_readonly_select`) problems.push(`${where}: name`);
    if (r.cmd !== 'r') problems.push(`${where}: command ${r.cmd} is not SELECT`);
    if (!r.permissive) problems.push(`${where}: not permissive`);
    if (JSON.stringify(r.roles) !== JSON.stringify([ROLE])) problems.push(`${where}: roles ${r.roles.join(',')}`);
    if (r.chk !== null) problems.push(`${where}: WITH CHECK present`);
    const qual = (r.qual ?? '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ');
    if (!/^\(?tenant_id = \(SELECT s\.tenant_id FROM qa_readonly_scope s\)\)?$/.test(qual)) problems.push(`${where}: USING is "${qual}"`);
    if (!r.viewdep) problems.push(`${where}: no dependency on qa_readonly_scope by OID`);
    if (!r.rls || !r.force) problems.push(`${where}: RLS ${String(r.rls)} / FORCE ${String(r.force)}`);
  }
  return problems;
}

/** What happened when 0051 met a role of the same name that already existed (roles are cluster-wide). Each scenario runs in a transaction that is rolled back. */
const adoption: Record<string, { message: string; role?: Record<string, unknown> | undefined }> = {};
async function runAdoptionScenarios(migrationText: string): Promise<void> {
  const scenarios: Array<[string, string[]]> = [
    ['superuser', [`CREATE ROLE ${ROLE} SUPERUSER`]],
    ['bypassrls', [`CREATE ROLE ${ROLE} BYPASSRLS`]],
    ['member-of-a-role', [`CREATE ROLE ${ROLE}`, `GRANT app_tenant TO ${ROLE}`]],
    ['has-members', [`CREATE ROLE ${ROLE}`, `GRANT ${ROLE} TO app_tenant`]],
    ['owns-a-table', [`CREATE ROLE ${ROLE}`, 'CREATE TABLE public.qa_ro_adopt_probe (id int)', `ALTER TABLE public.qa_ro_adopt_probe OWNER TO ${ROLE}`]],
    ['with-residual-password', [`CREATE ROLE ${ROLE} LOGIN PASSWORD 'synthetic-not-a-secret'`]],
    ['benign-but-loose', [`CREATE ROLE ${ROLE} LOGIN CREATEDB CREATEROLE REPLICATION CONNECTION LIMIT 50`]],
  ];
  for (const [label, setup] of scenarios) {
    await admin.unsafe('BEGIN');
    let message = '';
    let role: Record<string, unknown> | undefined;
    try {
      await admin.unsafe('RESET ROLE'); // the session is app_migrator after the earlier migrations; the pre-existing role is made by the superuser
      for (const statement of setup) await admin.unsafe(statement);
      for (const statement of migrationText.split('--> statement-breakpoint')) {
        if (statement.trim() !== '') await admin.unsafe(statement);
      }
      await admin.unsafe('RESET ROLE'); // the migration ends as app_migrator, which cannot read pg_authid
      [role] = await admin<Array<Record<string, unknown>>>`SELECT rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolconnlimit, (SELECT rolpassword IS NOT NULL FROM pg_authid WHERE rolname = ${ROLE}) AS has_password FROM pg_roles WHERE rolname = ${ROLE}`;
    } catch (error) {
      message = (error as Error).message;
    } finally {
      await admin.unsafe('ROLLBACK');
      await admin.unsafe('RESET ROLE');
    }
    adoption[label] = { message, role };
  }
  const left = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`;
  assert.equal(left.length, 0, 'the adoption scenarios left a role behind');
}

before(async () => {
  await startServer();
  admin = postgres(url('postgres', superPassword), { max: 1, onnotice: () => undefined });
  if (EXTERNAL || (PG16_BIN !== undefined && PG16_BIN !== '')) {
    const [v] = await admin<Array<{ n: string; v: string }>>`SELECT current_setting('server_version_num') AS n, current_setting('server_version') AS v`;
    assert.equal(v?.n, process.env['QA_RO_EXPECTED_SERVER_VERSION_NUM'] ?? '160015', `expected PostgreSQL 16.15, the server reports ${String(v?.v)}`);
  }
  const [reported] = await admin<Array<{ v: string }>>`SELECT version() AS v`;
  console.log(`# server under test: ${String(reported?.v)} (${PREMIGRATED ? 'WRAPPER MODE: database migrated by the project migration wrapper, in the harness server' : EXTERNAL ? 'disposable server started by the CI job' : PG16_BIN === undefined || PG16_BIN === '' ? 'embedded package' : 'own cluster built with the installed binaries'}), port ${String(port)}, temporary directory ${root}`);

  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  if (PREMIGRATED) scopeViewOidAfter0051 = process.env['QA_RO_SCOPE_VIEW_OID_AFTER_0051'] ?? '';
  if (!PREMIGRATED) {
  // The migrator creates Drizzle's bookkeeping schema before migration 0000 grants on it.
  await admin.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
  await admin.unsafe('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)');
  for (const { tag } of journal.entries) {
    const text = readFileSync(path.join(MIGRATIONS, `${tag}.sql`), 'utf8').replace(/\r\n/g, '\n');
    if (tag === '0051_qa_readonly_role') await runAdoptionScenarios(text);
    // Drizzle runs a migration's statements inside one transaction (a few migrations rely on it: temporary tables with ON COMMIT DROP).
    await admin.unsafe('BEGIN');
    try {
      for (const statement of text.split('--> statement-breakpoint')) {
        if (statement.trim() === '') continue;
        await admin.unsafe(statement);
      }
      await admin.unsafe('COMMIT');
    } catch (error) {
      await admin.unsafe('ROLLBACK').catch(() => undefined);
      throw new Error(`migration ${tag} failed: ${(error as Error).message}`);
    }
    // B4.11.3: the OID of the scope view as 0051 created it — 0052 must REPLACE it, not drop and recreate it (the 27 policies store it by OID).
    if (tag === '0051_qa_readonly_role') scopeViewOidAfter0051 = (await admin<Array<{ oid: string }>>`SELECT 'qa_readonly_scope'::regclass::oid::text AS oid`)[0]?.oid ?? '';
  }
  }
  {
    const [q] = await admin<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_policies WHERE ${ROLE} = ANY (roles)`;
    console.log(`# migrations applied: ${String(journal.entries.length)} ; app_qa_readonly policies: ${String(q?.n)}`);
  }
  // From here the session is whatever the last migration left it (app_migrator). Synthetic data is written as the superuser, which bypasses RLS.
  await admin.unsafe('RESET ROLE');

  const insertTenant = async (slug: string, status: string): Promise<string> => {
    const [row] = await admin<{ id: string }[]>`INSERT INTO tenants (id, name, slug, status) VALUES (gen_random_uuid(), ${'name of ' + slug}, ${slug}, ${status}) RETURNING id`;
    return row?.id as string;
  };
  ids.a = await insertTenant('qa-dev-tenant', 'active');
  ids.b = await insertTenant('muebleria-elegante', 'active');
  ids.c = await insertTenant('qa-dev-tenant-3d3920', 'suspended');
  for (const [key, id] of Object.entries(ids) as Array<['a' | 'b' | 'c', string]>) {
    const tag = names[key];
    await admin`INSERT INTO categories (id, tenant_id, name, code) VALUES (gen_random_uuid(), ${id}, ${'CATEGORY OF ' + tag}, ${'CODE-' + key})`;
    await admin`INSERT INTO warehouses (id, tenant_id, name, code) VALUES (gen_random_uuid(), ${id}, ${'WAREHOUSE OF ' + tag}, ${'WH-' + key})`;
    await admin`INSERT INTO users (id, tenant_id, email, password_hash, full_name, status) VALUES (gen_random_uuid(), ${id}, ${'user-' + key + '@example.test'}, ${'HASH-SECRET-' + key}, ${'Full ' + tag}, 'active')`;
    await admin`INSERT INTO customers (id, tenant_id, type, first_name, last_name, tax_id, email, phone, address) VALUES (gen_random_uuid(), ${id}, 'cedula', ${'First' + key}, ${'Last' + key}, ${'17100000' + (key === 'a' ? '01' : key === 'b' ? '02' : '03')}, ${key + '@example.test'}, '0999999999', 'Synthetic street 1')`;
    await admin`INSERT INTO qr_codes (id, tenant_id, code, target_type, target_id) VALUES (gen_random_uuid(), ${id}, ${'PUBLIC-TOKEN-' + key}, 'location', gen_random_uuid())`;
  }
});

after(async () => {
  // the role is cluster-wide and the tests give it a temporary login: put it back, whatever happened (a server of someone else's is left as clean as it was found)
  if (EXTERNAL) await admin?.unsafe(`ALTER ROLE ${ROLE} WITH NOLOGIN PASSWORD NULL`).catch(() => undefined);
  await admin?.end({ timeout: 5 }).catch(() => undefined);
  await stopServer();
  if (root !== '') rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
});

describe('app_qa_readonly - B4.11.3: EMPTY by default, then configured explicitly by a privileged operator', { concurrency: false }, () => {
  it('after every migration the configuration is empty, both views return no row, and the role is still NOLOGIN', async () => {
    assert.equal((await admin<Array<{ n: number }>>`SELECT count(*)::int AS n FROM qa_readonly_tenant_config`)[0]?.n, 0);
    assert.equal((await admin`SELECT 1 FROM qa_readonly_scope`).length, 0);
    assert.equal((await admin`SELECT 1 FROM qa_readonly_tenant`).length, 0);
    assert.equal((await admin<Array<{ l: boolean }>>`SELECT rolcanlogin AS l FROM pg_roles WHERE rolname = ${ROLE}`)[0]?.l, false);
    // 0052 inserted nothing and looked nothing up: tenants named like the old pin exist in this fixture, and none is selected
    assert.ok((await admin`SELECT 1 FROM tenants WHERE slug = 'qa-dev-tenant'`).length === 1);
  });
  it('has NO password and cannot log in: pg_authid.rolpassword IS NULL (the hash is never read into the test output), no expiry, no memberships, no privileged attribute', async () => {
    const [r] = await admin<Array<{ no_password: boolean; no_valid_until: boolean; login: boolean; priv: boolean; inherit: boolean }>>`
      SELECT rolpassword IS NULL AS no_password, rolvaliduntil IS NULL AS no_valid_until, rolcanlogin AS login,
             (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS priv, rolinherit AS inherit
      FROM pg_authid WHERE rolname = ${ROLE}`;
    assert.deepEqual(r, { no_password: true, no_valid_until: true, login: false, priv: false, inherit: false });
    assert.equal((await admin`SELECT 1 FROM pg_auth_members m JOIN pg_roles x ON x.oid = m.member OR x.oid = m.roleid WHERE x.rolname = ${ROLE}`).length, 0);
  });
  it('with no configuration the role (given a temporary login by the harness) reads nothing at all, from any table, by any shape', async () => {
    await admin.unsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${rolePassword}'`);
    try {
      await asRole(async (sql) => {
        for (const table of Object.keys(PLAN)) {
          const columns = PLAN[table] ?? (await admin<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`).map((r) => r.column_name);
          const rows = await sql.unsafe(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}"`);
          assert.equal(rows.length, 0, table);
        }
        assert.equal((await sql`SELECT 1 FROM qa_readonly_scope`).length, 0);
        assert.equal((await sql`SELECT 1 FROM qa_readonly_tenant`).length, 0);
        await sql.unsafe(`SET app.tenant_id = '${ids.a}'`);
        assert.equal((await sql`SELECT 1 FROM categories`).length, 0);
        assert.equal((await sql`SELECT 1 FROM categories WHERE tenant_id = ${ids.a}`).length, 0);
      });
    } finally {
      await admin.unsafe(`ALTER ROLE ${ROLE} WITH NOLOGIN PASSWORD NULL`);
    }
    assert.equal((await admin<Array<{ l: boolean }>>`SELECT rolcanlogin AS l FROM pg_roles WHERE rolname = ${ROLE}`)[0]?.l, false);
  });
  it('the PRIVILEGED procedure (run here as the superuser, with an explicit UUID, never by slug) is what turns the scope on', async () => {
    await admin.unsafe(CONFIG_INSERT(ids.a));
    assert.deepEqual((await admin<Array<{ tenant_id: string }>>`SELECT tenant_id FROM qa_readonly_scope`).map((r) => r.tenant_id), [ids.a]);
  });
});

describe('app_qa_readonly - B4.11.5.1: the 27 policies, one by one, from the catalogs', { concurrency: false }, () => {
  it('every one of the 27 is exactly: public.<table>_qa_readonly_select, PERMISSIVE, FOR SELECT, TO app_qa_readonly only, USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s)), no WITH CHECK, depending on the scope view by OID, on a table with RLS enabled and forced', async () => {
    const problems = await verifyQaPolicies();
    assert.deepEqual(problems, []);
    assert.equal(Object.keys(PLAN).length, 27);
    console.log(`# verifyQaPolicies: ${String(Object.keys(PLAN).length)} policies verified individually, ${String(problems.length)} problems`);
  });
  it('and each one is applied by the planner: EXPLAIN as the role shows the filter on tenant_id reading the configuration, for every one of the 27 tables', async () => {
    for (const table of Object.keys(PLAN)) {
      await admin.unsafe('BEGIN');
      try {
        await admin.unsafe(`SET LOCAL ROLE ${ROLE}`);
        const plan = (await admin.unsafe(`EXPLAIN (COSTS OFF) SELECT tenant_id FROM "${table}"`)).map((r) => String(Object.values(r)[0])).join('\n');
        assert.match(plan, /tenant_id = /, `${table}: no tenant filter in the plan:\n${plan}`);
        assert.match(plan, /qa_readonly_tenant_config/, `${table}: the filter does not come from the configuration:\n${plan}`);
      } finally {
        await admin.unsafe('ROLLBACK');
      }
    }
  });
  it('the checker is not vacuous: it detects a weakened policy, an extra permissive policy (for PUBLIC or for the role), a dropped policy, a policy turned into FOR ALL and lost FORCE — each applied in a transaction that is rolled back', async () => {
    const mutations: Array<[string, string, RegExp]> = [
      ['USING (true)', 'ALTER POLICY "categories_qa_readonly_select" ON categories USING (true)', /categories.*USING is/],
      ['extra policy TO PUBLIC', 'CREATE POLICY qa_ro_extra ON warehouses AS PERMISSIVE FOR SELECT TO PUBLIC USING (true)', /warehouses/],
      ['extra policy TO the role', 'CREATE POLICY qa_ro_extra ON users AS PERMISSIVE FOR SELECT TO app_qa_readonly USING (true)', /users/],
      ['dropped policy', 'DROP POLICY "orders_qa_readonly_select" ON orders', /orders/],
      ['no longer FORCEd', 'ALTER TABLE customers NO FORCE ROW LEVEL SECURITY', /customers.*FORCE/],
      ['recreated FOR ALL (a write policy)', 'DROP POLICY "locations_qa_readonly_select" ON locations; CREATE POLICY "locations_qa_readonly_select" ON locations AS PERMISSIVE FOR ALL TO app_qa_readonly USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s)) WITH CHECK (true)', /locations.*command/],
      ['pointed at another expression', `ALTER POLICY "products_qa_readonly_select" ON products USING (tenant_id = '${ids.b}'::uuid)`, /products.*USING is/],
    ];
    for (const [label, statement, expectation] of mutations) {
      await admin.unsafe('BEGIN');
      let found: string[] = [];
      try {
        await admin.unsafe(statement);
        found = await verifyQaPolicies();
      } finally {
        await admin.unsafe('ROLLBACK');
      }
      assert.ok(found.length > 0 && found.some((p) => expectation.test(p)), `${label}: not detected (${found.join(' | ')})`);
    }
    assert.deepEqual(await verifyQaPolicies(), [], 'the rollbacks left the policies as they were');
  });
});

describe('app_qa_readonly — role definition (checked from the catalog, as the superuser)', { concurrency: false }, () => {
  it('is created NOLOGIN, with no dangerous attribute, a connection limit, and its safety settings', async () => {
    const [r] = await admin<Array<Record<string, unknown>>>`SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolconnlimit, rolconfig FROM pg_roles WHERE rolname = ${ROLE}`;
    assert.deepEqual(
      { canlogin: r?.['rolcanlogin'], su: r?.['rolsuper'], db: r?.['rolcreatedb'], cr: r?.['rolcreaterole'], rep: r?.['rolreplication'], rls: r?.['rolbypassrls'], inh: r?.['rolinherit'], lim: r?.['rolconnlimit'] },
      { canlogin: false, su: false, db: false, cr: false, rep: false, rls: false, inh: false, lim: 2 },
    );
    const config = (r?.['rolconfig'] as string[]).sort();
    assert.deepEqual(config, ['default_transaction_read_only=on', 'idle_in_transaction_session_timeout=60s', 'statement_timeout=30s']);
  });
  it('is a member of no role and owns no object (table, view, schema, function, type, sequence)', async () => {
    const members = await admin`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = ${ROLE}`;
    assert.equal(members.length, 0);
    const owned = await admin`
      SELECT 'relation' AS k FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = ${ROLE}
      UNION ALL SELECT 'schema' FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = ${ROLE}
      UNION ALL SELECT 'function' FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = ${ROLE}
      UNION ALL SELECT 'type' FROM pg_type t JOIN pg_roles r ON r.oid = t.typowner WHERE r.rolname = ${ROLE}`;
    assert.deepEqual([...owned], []);
  });
  it('has exactly one SELECT-only policy per planned table, none of them reads a session variable, and no policy anywhere applies to PUBLIC', async () => {
    const mine = await admin<Array<{ tablename: string; cmd: string; roles: string[]; qual: string; with_check: string | null }>>`
      SELECT tablename, cmd, roles::text[] AS roles, qual, with_check FROM pg_policies WHERE ${ROLE} = ANY (roles)`;
    assert.deepEqual(mine.map((p) => p.tablename).sort(), Object.keys(PLAN).sort());
    for (const policy of mine) {
      assert.equal(policy.cmd, 'SELECT');
      assert.deepEqual(policy.roles, [ROLE]);
      assert.equal(policy.with_check, null);
      assert.match(policy.qual, /qa_readonly_scope/);
      assert.doesNotMatch(policy.qual, /current_setting|app\.tenant_id/);
    }
    const toPublic = await admin`SELECT tablename, policyname FROM pg_policies WHERE 'public' = ANY (roles::text[])`;
    assert.deepEqual([...toPublic], [], 'a policy for PUBLIC would also apply to the role and could be steered by a session variable');
  });
  it('every table it can read has RLS enabled AND forced', async () => {
    const rows = await admin<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY (${Object.keys(PLAN)}) AND relkind = 'r'`;
    assert.equal(rows.length, Object.keys(PLAN).length);
    const unprotected = rows.filter((r) => !(r.relrowsecurity && r.relforcerowsecurity)).map((r) => r.relname);
    assert.deepEqual(unprotected, [], 'a policy on a table without RLS does nothing: the role would read every tenant');
  });
  it('no SECURITY DEFINER function exists in the application schema, and the two views are security barriers', async () => {
    const definers = await admin`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef`;
    assert.deepEqual([...definers], []);
    const views = await admin<Array<{ relname: string; reloptions: string[] }>>`SELECT relname, reloptions FROM pg_class WHERE relname IN ('qa_readonly_scope', 'qa_readonly_tenant')`;
    assert.equal(views.length, 2);
    for (const v of views) assert.ok(v.reloptions?.includes('security_barrier=true'), v.relname);
  });
});

describe('app_qa_readonly — privilege matrix (has_*_privilege over every relation, schema and the database)', { concurrency: false }, () => {
  it('has no write-class privilege on any relation or column, and SELECT exactly where the reviewed plan says', async () => {
    const relations = await admin<Array<{ relname: string; relkind: string }>>`
      SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p', 'm', 'f')`;
    assert.ok(relations.length > 40);
    for (const { relname } of relations) {
      for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const [x] = await admin<Array<{ ok: boolean }>>`SELECT has_table_privilege(${ROLE}, ${'public.' + relname}, ${priv}) AS ok`;
        assert.equal(x?.ok, false, `${relname}: table ${priv}`);
      }
      for (const priv of ['INSERT', 'UPDATE', 'REFERENCES']) {
        const [x] = await admin<Array<{ ok: boolean }>>`SELECT has_any_column_privilege(${ROLE}, ${'public.' + relname}, ${priv}) AS ok`;
        assert.equal(x?.ok, false, `${relname}: column ${priv}`);
      }
    }
    for (const { relname } of relations) {
      const planned = relname in PLAN ? PLAN[relname] : undefined;
      const isView = relname === 'qa_readonly_scope' || relname === 'qa_readonly_tenant';
      const [t] = await admin<Array<{ ok: boolean }>>`SELECT has_table_privilege(${ROLE}, ${'public.' + relname}, 'SELECT') AS ok`;
      if (isView || planned === null) {
        assert.equal(t?.ok, true, `${relname}: expected table-level SELECT`);
        continue;
      }
      assert.equal(t?.ok, false, `${relname}: no table-level SELECT expected`);
      const columns = await admin<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${relname}`;
      for (const { column_name } of columns) {
        const [c] = await admin<Array<{ ok: boolean }>>`SELECT has_column_privilege(${ROLE}, ${'public.' + relname}, ${column_name}, 'SELECT') AS ok`;
        assert.equal(c?.ok, planned?.includes(column_name) ?? false, `${relname}.${column_name}`);
      }
    }
  });
  it('the deliberately excluded columns and tables are unreadable', async () => {
    const column = async (table: string, col: string): Promise<boolean> => (await admin<Array<{ ok: boolean }>>`SELECT has_column_privilege(${ROLE}, ${'public.' + table}, ${col}, 'SELECT') AS ok`)[0]?.ok === true;
    assert.equal(await column('users', 'password_hash'), false);
    assert.equal(await column('qr_codes', 'code'), false);
    assert.equal(await column('customers', 'email'), false);
    assert.equal(await column('customers', 'phone'), false);
    assert.equal(await column('customers', 'address'), false);
    assert.equal(await column('orders', 'customer_email_snapshot'), false);
    assert.equal(await column('order_items', 'unit_cost_snapshot'), false);
    assert.equal(await column('order_items', 'min_price_snapshot'), false);
    assert.equal(await column('product_variants', 'cost'), false, 'cost: no demonstrable need for the diagnostic');
    assert.equal(await column('product_variants', 'min_price'), false, 'minimum price: no demonstrable need for the diagnostic');
    assert.equal(await column('inventory_movements', 'unit_cost'), false, 'unit cost: no demonstrable need for the diagnostic');
    for (const table of ['qa_readonly_tenant_config', 'identities', 'platform_admins', 'platform_admin_refresh_tokens', 'auth_refresh_tokens', 'tenant_admin_invitations', 'audit_log', 'event_outbox', 'idempotency_keys', 'import_jobs', 'tenants', 'platform_support_sessions']) {
      const [x] = await admin<Array<{ ok: boolean }>>`SELECT has_table_privilege(${ROLE}, ${'public.' + table}, 'SELECT') OR has_any_column_privilege(${ROLE}, ${'public.' + table}, 'SELECT') AS ok`;
      assert.equal(x?.ok, false, table);
    }
  });
  it('cannot create anything: schema public, the database, the drizzle schema, sequences', async () => {
    const [s] = await admin<Array<Record<string, boolean>>>`
      SELECT has_schema_privilege(${ROLE}, 'public', 'CREATE') AS public_create,
             has_schema_privilege(${ROLE}, 'drizzle', 'USAGE') AS drizzle_usage,
             has_database_privilege(${ROLE}, current_database(), 'CREATE') AS db_create`;
    assert.deepEqual(s, { public_create: false, drizzle_usage: false, db_create: false });
    const sequences = await admin<Array<{ relname: string }>>`SELECT n.nspname || '.' || c.relname AS relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S' AND n.nspname NOT IN ('pg_catalog', 'information_schema')`;
    for (const { relname } of sequences) {
      const [q] = await admin<Array<{ ok: boolean }>>`SELECT has_sequence_privilege(${ROLE}, ${relname}, 'USAGE') OR has_sequence_privilege(${ROLE}, ${relname}, 'SELECT') AS ok`;
      assert.equal(q?.ok, false, relname);
    }
  });
});

describe('app_qa_readonly — behaviour as the role itself (real connections, real errors)', { concurrency: false }, () => {
  before(async () => {
    await admin.unsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${rolePassword}'`);
  });

  it('reads its tenant and only its tenant, through every planned shape', async () => {
    await asRole(async (sql) => {
      const cats = await sql<Array<{ code: string }>>`SELECT code FROM categories ORDER BY code`;
      assert.deepEqual(cats.map((c) => c.code), ['CODE-a']);
      const wh = await sql<Array<{ code: string }>>`SELECT code FROM warehouses`;
      assert.deepEqual(wh.map((c) => c.code), ['WH-a']);
      const users = await sql<Array<{ email: string }>>`SELECT email FROM users`;
      assert.deepEqual(users.map((u) => u.email), ['user-a@example.test']);
      const customers = await sql<Array<{ first_name: string; tax_id: string; display_name: string }>>`SELECT first_name, tax_id, display_name FROM customers`;
      assert.deepEqual(customers.map((c) => c.tax_id), ['1710000001']);
      const tenant = await sql<Array<{ slug: string; status: string }>>`SELECT slug, status FROM qa_readonly_tenant`;
      assert.deepEqual([...tenant], [{ slug: 'qa-dev-tenant', status: 'active' }]);
      const scope = await sql<Array<{ tenant_id: string }>>`SELECT tenant_id FROM qa_readonly_scope`;
      assert.deepEqual(scope.map((r) => r.tenant_id), [ids.a]);
    });
  });
  it('the other tenants — Mueblería-like and the suspended namesake — are invisible, by filter, by id, by join and by union', async () => {
    await asRole(async (sql) => {
      assert.equal((await sql`SELECT 1 FROM categories WHERE tenant_id = ${ids.b}`).length, 0);
      assert.equal((await sql`SELECT 1 FROM categories WHERE tenant_id = ${ids.c}`).length, 0);
      assert.equal((await sql`SELECT 1 FROM categories c JOIN warehouses w ON w.tenant_id = c.tenant_id WHERE c.code = 'CODE-b'`).length, 0);
      const union = await sql<Array<{ code: string }>>`SELECT code FROM categories UNION ALL SELECT code FROM warehouses`;
      assert.deepEqual(union.map((r) => r.code).sort(), ['CODE-a', 'WH-a']);
      assert.equal((await sql`SELECT 1 FROM qa_readonly_tenant WHERE slug <> 'qa-dev-tenant'`).length, 0);
    });
  });
  it('every write-class statement is refused with permission denied (42501) — even after the role switches its own read-only default OFF', async () => {
    await asRole(async (sql) => {
      await denied(sql`INSERT INTO categories (id, tenant_id, name, code) VALUES (gen_random_uuid(), ${ids.a}, 'X', 'X')`, '25006'); // the default stops it first
      await sql.unsafe('SET default_transaction_read_only = off'); // a role can override its own setting: the PRIVILEGES must be what stops it
      await denied(sql`INSERT INTO categories (id, tenant_id, name, code) VALUES (gen_random_uuid(), ${ids.a}, 'X', 'X')`);
      await denied(sql`UPDATE categories SET name = 'X'`);
      await denied(sql`DELETE FROM categories`);
      await denied(sql.unsafe('TRUNCATE categories'));
      await denied(sql.unsafe('CREATE TABLE public.qa_ro_probe (id int)'));
      await denied(sql.unsafe('CREATE ROLE qa_ro_probe_role'));
      await denied(sql.unsafe('CREATE SCHEMA qa_ro_probe_schema'));
      await denied(sql.unsafe(`CREATE VIEW public.qa_ro_probe_view AS SELECT 1`));
      await denied(sql.unsafe('ALTER TABLE categories DISABLE ROW LEVEL SECURITY'));
      await denied(sql.unsafe('ALTER TABLE categories NO FORCE ROW LEVEL SECURITY'));
      await denied(sql.unsafe('DROP POLICY "categories_qa_readonly_select" ON categories'));
      await denied(sql.unsafe(`CREATE POLICY qa_ro_probe ON categories USING (true)`));
      await denied(sql.unsafe(`ALTER VIEW qa_readonly_scope RENAME TO qa_readonly_scope_old`));
      await denied(sql.unsafe(`CREATE OR REPLACE VIEW qa_readonly_scope AS SELECT id AS tenant_id FROM tenants`));
      await denied(sql.unsafe(`UPDATE tenants SET slug = 'qa-dev-tenant-x'`));
      // GRANT without grant option does not fail in PostgreSQL (it warns "no privileges were granted"): what matters is that it changes nothing.
      await sql.unsafe('GRANT INSERT ON categories TO PUBLIC').catch(() => undefined);
      await sql.unsafe('GRANT SELECT ON users TO app_tenant').catch(() => undefined);
    });
    const acl = await admin<Array<{ relname: string; relacl: string[] | null }>>`SELECT relname, relacl::text[] AS relacl FROM pg_class WHERE relname IN ('categories', 'users')`;
    for (const row of acl) {
      assert.ok(!(row.relacl ?? []).some((entry) => entry.startsWith('=')), `${row.relname}: a PUBLIC entry appeared`);
    }
    // and the attempted grant to app_tenant on users did not add anything beyond what 0002 gave it (it already could read users)
    const [c] = await admin<Array<{ ins: boolean }>>`SELECT has_table_privilege('app_tenant', 'public.categories', 'INSERT') AS ins`;
    assert.equal(c?.ins, true, 'app_tenant keeps the INSERT it always had; the role changed none of it');
  });
  it('SELECT FOR UPDATE/SHARE (a lock is a write-class operation) is refused too', async () => {
    await asRole(async (sql) => {
      await sql.unsafe('SET default_transaction_read_only = off');
      await denied(sql`SELECT * FROM warehouses FOR UPDATE`);
      await denied(sql`SELECT code FROM categories FOR SHARE`);
    });
  });
  it('cannot assume another role or change identity', async () => {
    await asRole(async (sql) => {
      await denied(sql.unsafe('SET ROLE app_tenant'));
      await denied(sql.unsafe('SET ROLE app_platform'));
      await denied(sql.unsafe('SET ROLE app_migrator'));
      await denied(sql.unsafe('SET ROLE postgres'));
      await denied(sql.unsafe('SET SESSION AUTHORIZATION postgres'));
      await denied(sql.unsafe('SET SESSION AUTHORIZATION app_tenant'));
      const [me] = await sql<Array<{ session_user: string; current_user: string }>>`SELECT session_user, current_user`;
      assert.deepEqual(me, { session_user: ROLE, current_user: ROLE });
    });
  });
  it('sensitive columns and tables answer permission denied, even by name, by * or inside a subquery', async () => {
    await asRole(async (sql) => {
      await denied(sql`SELECT password_hash FROM users`);
      await denied(sql`SELECT * FROM users`);
      await denied(sql`SELECT cost FROM product_variants`);
      await denied(sql`SELECT min_price FROM product_variants`);
      await denied(sql`SELECT unit_cost FROM inventory_movements`);
      await denied(sql`SELECT * FROM tenant_memberships`);
      await denied(sql`SELECT code FROM qr_codes`);
      await denied(sql`SELECT * FROM qr_codes`);
      await denied(sql`SELECT email FROM customers`);
      await denied(sql`SELECT phone FROM customers WHERE phone IS NOT NULL`);
      await denied(sql`SELECT * FROM identities`);
      await denied(sql`SELECT * FROM platform_admins`);
      await denied(sql`SELECT * FROM auth_refresh_tokens`);
      await denied(sql`SELECT * FROM audit_log`);
      await denied(sql`SELECT * FROM tenants`);
      await denied(sql`SELECT * FROM drizzle.__drizzle_migrations`);
      await denied(sql`SELECT * FROM pg_authid`);
      await denied(sql`SELECT count(*) FROM (SELECT password_hash FROM users) s`);
      // and the safe projection of the same table works
      const ok = await sql<Array<{ id: string; status: string }>>`SELECT id, status FROM users`;
      assert.equal(ok.length, 1);
    });
  });
  it('server-side file, program and large-object escapes are refused', async () => {
    await asRole(async (sql) => {
      await denied(sql.unsafe(`COPY categories TO PROGRAM 'echo x'`));
      await denied(sql.unsafe(`COPY categories TO '/tmp/qa_ro_probe.csv'`));
      await denied(sql`SELECT pg_read_file('postgresql.conf')`);
      await denied(sql`SELECT pg_ls_dir('.')`);
      await denied(sql.unsafe(`SELECT lo_import('/etc/hosts')`));
      await denied(sql.unsafe(`ALTER SYSTEM SET work_mem = '1MB'`));
    });
  });
  it('trigger functions of the application cannot be invoked directly', async () => {
    await asRole(async (sql) => {
      await denied(sql`SELECT set_updated_at()`, '0A000');
      await denied(sql`SELECT prevent_tenant_id_change()`, '0A000');
    });
  });
  it('its configured safety settings are in force', async () => {
    await asRole(async (sql) => {
      const [s] = await sql<Array<{ ro: string; st: string; it: string }>>`SELECT current_setting('default_transaction_read_only') AS ro, current_setting('statement_timeout') AS st, current_setting('idle_in_transaction_session_timeout') AS it`;
      assert.deepEqual(s, { ro: 'on', st: '30s', it: '1min' });
    });
  });
  it('CONNECTION LIMIT 2: a third simultaneous connection is refused', async () => {
    const open: postgres.Sql[] = [];
    try {
      for (let i = 0; i < 2; i += 1) {
        const s = postgres(url(ROLE, rolePassword), { max: 1 });
        await s`SELECT 1`;
        open.push(s);
      }
      const third = postgres(url(ROLE, rolePassword), { max: 1 });
      await denied(third`SELECT 1`, '53300');
      await third.end({ timeout: 2 }).catch(() => undefined);
    } finally {
      await Promise.all(open.map((s) => s.end({ timeout: 5 })));
    }
  });
});

describe('app_qa_readonly — the tenant cannot be changed from the session', { concurrency: false }, () => {
  const onlyTenantA = async (sql: postgres.Sql): Promise<void> => {
    const cats = await sql<Array<{ code: string }>>`SELECT code FROM categories ORDER BY code`;
    assert.deepEqual(cats.map((c) => c.code), ['CODE-a']);
    assert.equal((await sql`SELECT 1 FROM categories WHERE tenant_id = ${ids.b}`).length, 0);
  };

  it('SET / SET LOCAL / set_config of app.tenant_id (the variable every other policy trusts) changes nothing, in or out of a transaction', async () => {
    await asRole(async (sql) => {
      await sql.unsafe(`SET app.tenant_id = '${ids.b}'`);
      await onlyTenantA(sql);
      await sql`SELECT set_config('app.tenant_id', ${ids.b}, false)`;
      await onlyTenantA(sql);
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${ids.c}, true)`;
        await tx.unsafe(`SET LOCAL app.tenant_id = '${ids.b}'`);
        await onlyTenantA(tx as unknown as postgres.Sql);
      });
      await onlyTenantA(sql); // after COMMIT
      await sql.unsafe('BEGIN');
      await sql.unsafe(`SET LOCAL app.tenant_id = '${ids.b}'`);
      await sql.unsafe('ROLLBACK');
      await onlyTenantA(sql); // after ROLLBACK
      await sql.unsafe('RESET ALL');
      await sql.unsafe('DISCARD ALL');
      await onlyTenantA(sql);
    });
  });
  it('turning row_security off does not bypass anything: the query fails instead of returning rows', async () => {
    await asRole(async (sql) => {
      await sql.unsafe('SET row_security = off');
      await denied(sql`SELECT code FROM categories`);
      await sql.unsafe('SET row_security = on');
      await onlyTenantA(sql);
    });
  });
  it('a session-created look-alike of the scope view, ahead on search_path, does not redirect the policies', async () => {
    await asRole(async (sql) => {
      await sql.unsafe('SET default_transaction_read_only = off');
      await sql.unsafe('CREATE TEMP TABLE qa_readonly_scope (tenant_id uuid)');
      await sql.unsafe(`INSERT INTO pg_temp.qa_readonly_scope VALUES ('${ids.b}')`);
      await sql.unsafe('SET search_path = pg_temp, public');
      await onlyTenantA(sql);
      await sql.unsafe('SET search_path = public');
    });
  });
  it('a leaky function in WHERE cannot read rows the policy or the security-barrier view hide (no other tenant\'s data reaches its notices)', async () => {
    await asRole(async (sql, notices) => {
      await sql.unsafe('SET default_transaction_read_only = off');
      await sql.unsafe(`CREATE FUNCTION pg_temp.leak(text) RETURNS boolean LANGUAGE plpgsql COST 0.0000001 AS $$ BEGIN RAISE NOTICE 'LEAK %', $1; RETURN true; END $$`);
      await sql.unsafe('SELECT code FROM categories WHERE pg_temp.leak(code)');
      await sql.unsafe('SELECT slug FROM qa_readonly_tenant WHERE pg_temp.leak(slug)');
      await sql.unsafe('SELECT tax_id FROM customers WHERE pg_temp.leak(tax_id)');
      const leaked = notices.filter((n) => n.startsWith('LEAK '));
      assert.ok(leaked.length >= 3);
      for (const message of leaked) assert.doesNotMatch(message, /muebleria|3d3920|CODE-b|CODE-c|1710000002|1710000003/, message);
    });
  });
  it('a fresh connection after all of that is still pinned (nothing leaked through connection reuse)', async () => {
    await asRole(onlyTenantA);
  });
  it('fails closed: the configured tenant suspended → the role reads nothing; reactivated → the same tenant again', async () => {
    try {
      await admin`UPDATE tenants SET status = 'suspended' WHERE id = ${ids.a}`;
      await asRole(async (sql) => {
        assert.equal((await sql`SELECT 1 FROM categories`).length, 0);
        assert.equal((await sql`SELECT 1 FROM users`).length, 0);
        assert.equal((await sql`SELECT 1 FROM qa_readonly_scope`).length, 0);
        assert.deepEqual([...(await sql`SELECT slug, status FROM qa_readonly_tenant`)], [{ slug: 'qa-dev-tenant', status: 'suspended' }]);
      });
      await admin`UPDATE tenants SET status = 'active' WHERE id = ${ids.a}`;
      await asRole(onlyTenantA);
    } finally {
      await admin`UPDATE tenants SET status = 'active', slug = 'qa-dev-tenant' WHERE id = ${ids.a}`;
    }
  });
});

const CONFIG_INSERT = (id: string): string => `INSERT INTO qa_readonly_tenant_config (authorized_tenant_id, reason) VALUES ('${id}', 'synthetic test fixture')`;
const catCodes = async (): Promise<string[]> => asRole(async (sql) => (await sql<Array<{ code: string }>>`SELECT code FROM categories ORDER BY code`).map((c) => c.code));
const CONFIG_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

describe('app_qa_readonly - B4.11.3: the scope is an immutable tenant UUID in a protected configuration, not a slug', { concurrency: false }, () => {
  it('a configuration is not redirected by renaming, re-slugging or swapping slugs: tenant b taking the old slug of tenant a changes nothing', async () => {
    try {
      await admin`UPDATE tenants SET slug = 'qa-dev-tenant-moved', name = 'renamed' WHERE id = ${ids.a}`;
      await admin`UPDATE tenants SET slug = 'qa-dev-tenant' WHERE id = ${ids.b}`;
      assert.deepEqual(await catCodes(), ['CODE-a']);
      await asRole(async (sql) => {
        assert.equal((await sql`SELECT 1 FROM categories WHERE tenant_id = ${ids.b}`).length, 0);
        assert.deepEqual([...(await sql`SELECT slug, name FROM qa_readonly_tenant`)], [{ slug: 'qa-dev-tenant-moved', name: 'renamed' }]);
      });
    } finally {
      await admin`UPDATE tenants SET slug = 'muebleria-elegante' WHERE id = ${ids.b}`;
      await admin`UPDATE tenants SET slug = 'qa-dev-tenant', name = ${'name of qa-dev-tenant'} WHERE id = ${ids.a}`;
    }
  });
  it('invalid configurations fail closed or cannot exist: unknown tenant, suspended tenant, archived tenant, duplicate, incomplete', async () => {
    const code = async (statement: string): Promise<string> => {
      try {
        await admin.unsafe(statement);
        return 'ok';
      } catch (error) {
        return (error as { code?: string }).code ?? 'error';
      }
    };
    // unknown UUID → the foreign key refuses it (so it can never be stored)
    assert.equal(await code(`UPDATE qa_readonly_tenant_config SET authorized_tenant_id = gen_random_uuid()`), '23503');
    // a second row is impossible (singleton primary key), and so is a row that is not THE row
    assert.equal(await code(CONFIG_INSERT(ids.b)), '23505');
    assert.equal(await code(`INSERT INTO qa_readonly_tenant_config (singleton, authorized_tenant_id, reason) VALUES (false, '${ids.b}', 'x')`), '23514');
    // incomplete rows
    assert.equal(await code(`INSERT INTO qa_readonly_tenant_config (reason) VALUES ('x')`), '23502');
    assert.equal(await code(`UPDATE qa_readonly_tenant_config SET authorized_tenant_id = NULL`), '23502');
    assert.equal(await code(`UPDATE qa_readonly_tenant_config SET reason = '   '`), '23514');
    assert.equal(await code(`UPDATE qa_readonly_tenant_config SET reason = NULL`), '23502');
    // a configured tenant cannot be deleted from under the configuration
    assert.ok(['23503', '23001'].includes(await code(`DELETE FROM tenants WHERE id = '${ids.a}'`)), 'foreign key violation (23503, or 23001 restrict_violation on some versions)');
    // valid row pointing at a suspended / archived tenant: stored, but the role reads nothing
    try {
      for (const [target, status] of [[ids.c, 'suspended'], [ids.b, 'archived']] as const) {
        await admin.unsafe(`UPDATE tenants SET status = '${status}' WHERE id = '${target}'`);
        assert.equal(await code(`UPDATE qa_readonly_tenant_config SET authorized_tenant_id = '${target}'`), 'ok');
        assert.deepEqual(await catCodes(), [], `${status} tenant`);
        await asRole(async (sql) => {
          assert.equal((await sql`SELECT 1 FROM qa_readonly_scope`).length, 0);
          assert.equal((await sql`SELECT 1 FROM users`).length, 0);
        });
      }
    } finally {
      await admin`UPDATE tenants SET status = 'active' WHERE id = ${ids.b}`;
      await admin`UPDATE qa_readonly_tenant_config SET authorized_tenant_id = ${ids.a}`;
    }
    assert.deepEqual(await catCodes(), ['CODE-a']);
  });
  it('the role cannot read, write, replace, drop or re-own the configuration, nor shadow it (temporary table, search_path), nor reach it through a view', async () => {
    await asRole(async (sql) => {
      await sql.unsafe('SET default_transaction_read_only = off');
      await denied(sql`SELECT * FROM qa_readonly_tenant_config`);
      await denied(sql`SELECT authorized_tenant_id FROM qa_readonly_tenant_config`);
      await denied(sql.unsafe(`INSERT INTO qa_readonly_tenant_config (authorized_tenant_id, reason) VALUES ('${ids.b}', 'x')`));
      await denied(sql.unsafe(`UPDATE qa_readonly_tenant_config SET authorized_tenant_id = '${ids.b}'`));
      await denied(sql.unsafe(`UPDATE qa_readonly_tenant_config SET reason = 'x'`));
      await denied(sql.unsafe('DELETE FROM qa_readonly_tenant_config'));
      await denied(sql.unsafe('TRUNCATE qa_readonly_tenant_config'));
      await denied(sql.unsafe('DROP TABLE qa_readonly_tenant_config'));
      await denied(sql.unsafe('ALTER TABLE qa_readonly_tenant_config OWNER TO app_qa_readonly'));
      await denied(sql.unsafe('ALTER TABLE qa_readonly_tenant_config DROP CONSTRAINT qa_readonly_tenant_config_tenant_fk'));
      await denied(sql.unsafe('ALTER TABLE qa_readonly_tenant_config ENABLE ROW LEVEL SECURITY'));
      await sql.unsafe('GRANT ALL ON qa_readonly_tenant_config TO app_qa_readonly').catch(() => undefined); // refused or a no-op; the ACL assertion below proves nothing was added
      await denied(sql.unsafe(`CREATE OR REPLACE VIEW qa_readonly_scope AS SELECT '${ids.b}'::uuid AS tenant_id`));
      await denied(sql.unsafe('DROP VIEW qa_readonly_scope'));
      await denied(sql.unsafe('ALTER POLICY "categories_qa_readonly_select" ON categories USING (true)'));
      await denied(sql.unsafe('SET ROLE app_migrator'));
      await denied(sql.unsafe('SET ROLE postgres'));
      await sql.unsafe(`SET app.tenant_id = '${ids.b}'`);
      await sql`SELECT set_config('app.tenant_id', ${ids.b}, false)`;
      // a look-alike of the CONFIG, in pg_temp and first on the search_path: the views are bound by OID, so it redirects nothing
      await sql.unsafe('CREATE TEMP TABLE qa_readonly_tenant_config (singleton boolean, authorized_tenant_id uuid, configured_by text, configured_at timestamptz, reason text)');
      await sql.unsafe(`INSERT INTO pg_temp.qa_readonly_tenant_config VALUES (true, '${ids.b}', 'x', now(), 'x')`);
      await sql.unsafe('SET search_path = pg_temp, public');
      assert.deepEqual((await sql<Array<{ tenant_id: string }>>`SELECT tenant_id FROM qa_readonly_scope`).map((r) => r.tenant_id), [ids.a]);
      assert.deepEqual((await sql<Array<{ code: string }>>`SELECT code FROM categories`).map((r) => r.code), ['CODE-a']);
      await sql.unsafe('SET search_path = public');
    });
    assert.deepEqual(await catCodes(), ['CODE-a']);
  });
  it('no other application role — nor PUBLIC — has any privilege on the configuration; app_migrator can read it and ALSO cannot write it', async () => {
    const roles = await admin<Array<{ rolname: string }>>`SELECT rolname FROM pg_roles WHERE rolname ~ '^app_'`;
    assert.ok(roles.length >= 7, 'app_tenant, app_platform, app_event_processor, app_public_resolver, app_import_worker, app_qa_readonly (+ app_migrator)');
    for (const { rolname } of roles) {
      for (const priv of CONFIG_PRIVS) {
        const [t] = await admin<Array<{ ok: boolean; c: boolean }>>`SELECT has_table_privilege(${rolname}, 'public.qa_readonly_tenant_config', ${priv}) AS ok, has_any_column_privilege(${rolname}, 'public.qa_readonly_tenant_config', ${priv === 'SELECT' || priv === 'INSERT' || priv === 'UPDATE' || priv === 'REFERENCES' ? priv : 'SELECT'}) AS c`;
        const expected = rolname === 'app_migrator' && ['SELECT', 'REFERENCES', 'TRIGGER'].includes(priv); // the owner keeps what a view and a foreign key need
        assert.equal(t?.ok, expected, `${rolname} ${priv}`);
        if (rolname !== 'app_migrator') assert.equal(t?.c, false, `${rolname} column ${priv}`);
      }
    }
    const acl = await admin<Array<{ entry: string }>>`SELECT unnest(relacl)::text AS entry FROM pg_class WHERE relname = 'qa_readonly_tenant_config'`;
    // one ACL entry: the owner without INSERT/UPDATE/DELETE/TRUNCATE (a/w/d/D), and nothing for PUBLIC. PostgreSQL 17+ also lists MAINTAIN (m) for an owner.
    assert.equal(acl.length, 1);
    assert.match(acl[0]?.entry ?? '', /^app_migrator=r[xtm]*\/app_migrator$/);
    // really attempted as each role (SET ROLE from the superuser), not only read from the catalog
    for (const role of ['app_tenant', 'app_platform', 'app_import_worker', 'app_event_processor', 'app_public_resolver', 'app_migrator']) {
      await admin.unsafe(`SET ROLE ${role}`);
      try {
        await denied(admin.unsafe(CONFIG_INSERT(ids.b)));
        await denied(admin.unsafe(`UPDATE qa_readonly_tenant_config SET authorized_tenant_id = '${ids.b}'`));
        await denied(admin.unsafe('DELETE FROM qa_readonly_tenant_config'));
        if (role !== 'app_migrator') await denied(admin.unsafe('SELECT * FROM qa_readonly_tenant_config'));
      } finally {
        await admin.unsafe('RESET ROLE');
      }
    }
    assert.deepEqual(await catCodes(), ['CODE-a']);
  });
  it('it is configuration, not tenant data: no tenant_id column, no RLS, owned by app_migrator, empty-default structure (singleton, FK to tenants, audit columns)', async () => {
    const [t] = await admin<Array<{ owner: string; rls: boolean; force: boolean; kind: string }>>`
      SELECT r.rolname AS owner, c.relrowsecurity AS rls, c.relforcerowsecurity AS force, c.relkind AS kind FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.relname = 'qa_readonly_tenant_config'`;
    assert.deepEqual(t, { owner: 'app_migrator', rls: false, force: false, kind: 'r' });
    const cols = await admin<Array<{ column_name: string; is_nullable: string; column_default: string | null }>>`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'qa_readonly_tenant_config' ORDER BY ordinal_position`;
    assert.deepEqual(cols.map((c) => c.column_name), ['singleton', 'authorized_tenant_id', 'configured_by', 'configured_at', 'reason']);
    assert.ok(cols.every((c) => c.is_nullable === 'NO'));
    assert.equal(cols.find((c) => c.column_name === 'authorized_tenant_id')?.column_default, null, 'no default tenant');
    const [row] = await admin<Array<{ by: string; n: number }>>`SELECT configured_by AS by, (SELECT count(*) FROM qa_readonly_tenant_config)::int AS n FROM qa_readonly_tenant_config`;
    assert.equal(row?.n, 1);
    assert.equal(row?.by, 'postgres', 'configured_by defaults to the session user that ran the procedure');
  });
  it('0052 REPLACED the scope view (same OID, same owner, still a security barrier) and the 27 policies still depend on it', { skip: PREMIGRATED && process.env['QA_RO_SCOPE_VIEW_OID_AFTER_0051'] === undefined ? 'wrapper mode: needs the OID captured between 0051 and 0052 (incremental scenario)' : false }, async () => {
    const [v] = await admin<Array<{ oid: string; owner: string; opts: string[] }>>`SELECT c.oid::text AS oid, r.rolname AS owner, c.reloptions AS opts FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.relname = 'qa_readonly_scope'`;
    assert.ok(scopeViewOidAfter0051 !== '');
    assert.equal(v?.oid, scopeViewOidAfter0051);
    assert.equal(v?.owner, 'app_migrator');
    assert.ok(v?.opts?.includes('security_barrier=true'));
    const [deps] = await admin<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_depend d JOIN pg_policy p ON p.oid = d.objid AND d.classid = 'pg_policy'::regclass WHERE d.refobjid = ${v?.oid ?? ''}::oid`;
    assert.equal(deps?.n, 27);
    assert.equal((await admin`SELECT 1 FROM pg_policies WHERE ${ROLE} = ANY (roles)`).length, 27);
  });
});

describe('app_qa_readonly — future objects stay closed', { concurrency: false }, () => {
  it('a table created after the migration (with or without RLS), and a new view, are not readable until a migration grants them', async () => {
    await admin.unsafe('SET ROLE app_migrator');
    try {
      await admin.unsafe('CREATE TABLE public.qa_ro_future_a (tenant_id uuid NOT NULL, secret text)');
      await admin.unsafe('CREATE TABLE public.qa_ro_future_b (tenant_id uuid NOT NULL, secret text)');
      await admin.unsafe('ALTER TABLE public.qa_ro_future_b ENABLE ROW LEVEL SECURITY');
      await admin.unsafe('ALTER TABLE public.qa_ro_future_b FORCE ROW LEVEL SECURITY');
      await admin.unsafe('CREATE VIEW public.qa_ro_future_v AS SELECT tenant_id FROM public.qa_ro_future_a');
    } finally {
      await admin.unsafe('RESET ROLE');
    }
    await admin`INSERT INTO qa_ro_future_a VALUES (${ids.a}, 's'), (${ids.b}, 't')`;
    await asRole(async (sql) => {
      await denied(sql`SELECT * FROM qa_ro_future_a`);
      await denied(sql`SELECT * FROM qa_ro_future_b`);
      await denied(sql`SELECT * FROM qa_ro_future_v`);
    });
    await admin.unsafe('DROP VIEW public.qa_ro_future_v; DROP TABLE public.qa_ro_future_a; DROP TABLE public.qa_ro_future_b');
  });
});

describe('app_qa_readonly — what the diagnostic needs is actually reachable', { concurrency: false }, () => {
  it('a representative query set over the planned tables runs (empty tables return zero rows, not errors)', async () => {
    await asRole(async (sql) => {
      for (const table of Object.keys(PLAN)) {
        const columns = PLAN[table] ?? (await admin<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`).map((r) => r.column_name);
        const list = columns.map((c) => `"${c}"`).join(', ');
        const rows = await sql.unsafe(`SELECT ${list} FROM "${table}" LIMIT 5`);
        assert.ok(Array.isArray(rows), table);
      }
    });
  });
});

describe('app_qa_readonly - effective privileges, from the catalogs (not from the migration text)', { concurrency: false }, () => {
  it('information_schema agrees: the only privilege type granted to it, at table or column level, is SELECT; nothing is granted to PUBLIC on application objects', async () => {
    const table = await admin<Array<{ privilege_type: string }>>`SELECT DISTINCT privilege_type FROM information_schema.table_privileges WHERE grantee = ${ROLE}`;
    assert.deepEqual(table.map((r) => r.privilege_type), ['SELECT']);
    const column = await admin<Array<{ privilege_type: string }>>`SELECT DISTINCT privilege_type FROM information_schema.column_privileges WHERE grantee = ${ROLE}`;
    assert.deepEqual(column.map((r) => r.privilege_type), ['SELECT']);
    const roleGrants = await admin<Array<{ privilege_type: string }>>`SELECT DISTINCT privilege_type FROM information_schema.role_table_grants WHERE grantee = ${ROLE}`;
    assert.deepEqual(roleGrants.map((r) => r.privilege_type), ['SELECT']);
    const publicOnApp = await admin`SELECT table_name, privilege_type FROM information_schema.table_privileges WHERE grantee = 'PUBLIC' AND table_schema = 'public'`;
    assert.deepEqual([...publicOnApp], [], 'PUBLIC holds nothing on an application table or view');
  });
  it('no default privileges exist anywhere, nobody is a member of the role, and its only per-role settings are the three documented', async () => {
    assert.deepEqual([...(await admin`SELECT 1 FROM pg_default_acl`)], []);
    assert.deepEqual([...(await admin`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = ${ROLE}`)], [], 'no role can inherit from it, no role is granted through it');
    const [setting] = await admin<Array<{ cfg: string[] }>>`SELECT setconfig AS cfg FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = ${ROLE} AND s.setdatabase = 0`;
    assert.deepEqual([...(setting?.cfg ?? [])].sort(), ['default_transaction_read_only=on', 'idle_in_transaction_session_timeout=60s', 'statement_timeout=30s']);
  });
  it('can USE only schema public and pg_catalog / information_schema; no other schema (drizzle included); no CREATE on any schema or on the database', async () => {
    const schemas = await admin<Array<{ nspname: string; u: boolean; c: boolean }>>`
      SELECT nspname, has_schema_privilege(${ROLE}, nspname, 'USAGE') AS u, has_schema_privilege(${ROLE}, nspname, 'CREATE') AS c
      FROM pg_namespace WHERE nspname !~ '^pg_toast' AND nspname !~ '^pg_temp'`;
    assert.ok(schemas.length >= 4);
    for (const s of schemas) {
      assert.equal(s.c, false, `CREATE on ${s.nspname}`);
      if (!['public', 'pg_catalog', 'information_schema'].includes(s.nspname)) assert.equal(s.u, false, `USAGE on ${s.nspname}`);
    }
    const [db] = await admin<Array<{ c: boolean }>>`SELECT has_database_privilege(${ROLE}, current_database(), 'CREATE') AS c`;
    assert.equal(db?.c, false);
  });
  it('EXECUTE: only PostgreSQL PUBLIC defaults reach it — the application functions are two trigger functions, none is SECURITY DEFINER', async () => {
    const own = await admin<Array<{ proname: string; prosecdef: boolean; ok: boolean }>>`
      SELECT p.proname, p.prosecdef, has_function_privilege(${ROLE}, p.oid, 'EXECUTE') AS ok
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`;
    assert.deepEqual(own.map((p) => p.proname).sort(), ['prevent_tenant_id_change', 'set_updated_at']);
    assert.ok(own.every((p) => !p.prosecdef));
    const ext = await admin<Array<{ extname: string }>>`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'`;
    assert.deepEqual(ext.map((e) => e.extname), ['pgcrypto'], 'pgcrypto installs its (side-effect-free) functions into public with PUBLIC EXECUTE');
  });
  it('the two scope views are owned by app_migrator, are security barriers, and every policy of the role depends on the scope view (by object id, not by name)', async () => {
    const views = await admin<Array<{ relname: string; owner: string; reloptions: string[] }>>`
      SELECT c.relname, r.rolname AS owner, c.reloptions FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.relname IN ('qa_readonly_scope', 'qa_readonly_tenant')`;
    assert.deepEqual(views.map((v) => [v.relname, v.owner]).sort(), [['qa_readonly_scope', 'app_migrator'], ['qa_readonly_tenant', 'app_migrator']]);
    const [deps] = await admin<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_depend d
      JOIN pg_policy p ON p.oid = d.objid AND d.classid = 'pg_policy'::regclass
      JOIN pg_class v ON v.oid = d.refobjid AND v.relname = 'qa_readonly_scope'`;
    assert.equal(deps?.n, Object.keys(PLAN).length);
    const [def] = await admin<Array<{ d: string }>>`SELECT pg_get_viewdef('qa_readonly_scope'::regclass) AS d`;
    // B4.11.3: the scope comes from the protected configuration (an immutable UUID), never from a slug or a name. The text of a view definition differs
    // between server versions (a cast shows up in one and not in the other), so only identifiers and the active-status test are matched.
    assert.match(def?.d ?? '', /qa_readonly_tenant_config/);
    assert.match(def?.d ?? '', /status(\)::text)? = 'active'::text/);
    assert.doesNotMatch(def?.d ?? '', /slug|qa-dev-tenant|\bname\b/);
    const [tdef] = await admin<Array<{ d: string }>>`SELECT pg_get_viewdef('qa_readonly_tenant'::regclass) AS d`;
    assert.match(tdef?.d ?? '', /qa_readonly_tenant_config/);
    assert.doesNotMatch(tdef?.d ?? '', /qa-dev-tenant/);
  });
  it('the views are not tables: the structural "base table" list the repository checks is unchanged, and the five roles it counts are still five', async () => {
    const base = await admin<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    assert.deepEqual(base.filter((r) => r.table_name.startsWith('qa_readonly')).map((r) => r.table_name), ['qa_readonly_tenant_config'], 'B4.11.3: the one new base table is the protected configuration; the two scope views are not tables');
    const roles = await admin`SELECT rolname FROM pg_roles WHERE rolname IN ('app_migrator', 'app_tenant', 'app_platform', 'app_event_processor', 'app_public_resolver')`;
    assert.equal(roles.length, 5);
  });
});

describe('app_qa_readonly - what is NOT blocked (documented, so the documentation matches reality)', { concurrency: false }, () => {
  it('as the role, after switching its own read-only default off: it CAN create a temporary table, a large object, send a NOTIFY and take an advisory lock — none of which touches application data', async () => {
    const before = await admin<Array<{ n: number }>>`SELECT (SELECT count(*) FROM categories)::int + (SELECT count(*) FROM users)::int AS n`;
    await asRole(async (sql) => {
      await sql.unsafe('SET default_transaction_read_only = off');
      await sql.unsafe('CREATE TEMP TABLE qa_ro_scratch (x int)');
      await sql.unsafe('SELECT lo_creat(-1)');
      await sql.unsafe("SELECT pg_notify('qa_ro_probe', 'x')");
      await sql.unsafe('SELECT pg_advisory_lock(424242)');
      await sql.unsafe('SELECT pg_advisory_unlock_all()');
    });
    const after = await admin<Array<{ n: number }>>`SELECT (SELECT count(*) FROM categories)::int + (SELECT count(*) FROM users)::int AS n`;
    assert.equal(after[0]?.n, before[0]?.n);
    // the stray large object the probe created is removed by the superuser: the test leaves nothing behind
    await admin.unsafe('SELECT lo_unlink(oid) FROM pg_largeobject_metadata');
  });
});

describe('app_qa_readonly - a role of the same name that already exists (roles are cluster-wide)', { concurrency: false }, () => {
  it('a privileged or entangled pre-existing role is refused, and the refusal leaves nothing behind', { skip: SKIP_IN_WRAPPER_MODE }, () => {
    assert.match(adoption['superuser']?.message ?? '', /SUPERUSER or BYPASSRLS; refusing to adopt it/);
    assert.match(adoption['bypassrls']?.message ?? '', /SUPERUSER or BYPASSRLS; refusing to adopt it/);
    assert.match(adoption['member-of-a-role']?.message ?? '', /role memberships; refusing to adopt it/);
    assert.match(adoption['has-members']?.message ?? '', /role memberships; refusing to adopt it/);
    assert.match(adoption['owns-a-table']?.message ?? '', /owns objects in this database; refusing to adopt it/);
  });
  it('an unprivileged pre-existing role (a second database of the same cluster) is accepted and put back to the safe attributes — LOGIN, enabled on purpose elsewhere, is left alone', { skip: SKIP_IN_WRAPPER_MODE }, () => {
    const scenario = adoption['benign-but-loose'];
    assert.equal(scenario?.message, '');
    assert.deepEqual(scenario?.role, { rolcanlogin: true, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolconnlimit: 2, has_password: false });
  });
  it('KNOWN RESIDUAL (documented, 0051 not changed): a pre-existing role of that name that already had LOGIN and a password KEEPS both — the migration normalises attributes, never credentials. The role this migration CREATES has none', { skip: SKIP_IN_WRAPPER_MODE }, () => {
    const scenario = adoption['with-residual-password'];
    assert.equal(scenario?.message, '');
    assert.equal(scenario?.role?.['rolcanlogin'], true);
    assert.equal(scenario?.role?.['has_password'], true);
  });
  it('applying 0051 a second time to the same database fails (its views already exist) and changes nothing', async () => {
    const text = readFileSync(path.join(MIGRATIONS, '0051_qa_readonly_role.sql'), 'utf8').replace(/\r\n/g, '\n');
    const [before] = await admin<Array<{ rolcanlogin: boolean; rolconnlimit: number }>>`SELECT rolcanlogin, rolconnlimit FROM pg_roles WHERE rolname = ${ROLE}`;
    let message = '';
    await admin.unsafe('BEGIN');
    try {
      for (const statement of text.split('--> statement-breakpoint')) {
        if (statement.trim() !== '') await admin.unsafe(statement);
      }
    } catch (error) {
      message = (error as Error).message;
    } finally {
      await admin.unsafe('ROLLBACK');
      await admin.unsafe('RESET ROLE');
    }
    assert.match(message, /already exists/);
    const [after] = await admin<Array<{ rolcanlogin: boolean; rolconnlimit: number }>>`SELECT rolcanlogin, rolconnlimit FROM pg_roles WHERE rolname = ${ROLE}`;
    assert.deepEqual(after, before);
  });
});

describe('app_qa_readonly - the scope view cannot be altered by the role', { concurrency: false }, () => {
  it('DROP / OWNER TO / SET (security_barrier = false) / CREATE OR REPLACE on the views, and DML through them, are refused', async () => {
    await asRole(async (sql) => {
      await sql.unsafe('SET default_transaction_read_only = off');
      await denied(sql.unsafe('DROP VIEW qa_readonly_scope'));
      await denied(sql.unsafe('ALTER VIEW qa_readonly_scope OWNER TO app_qa_readonly'));
      await denied(sql.unsafe('ALTER VIEW qa_readonly_scope SET (security_barrier = false)'));
      await denied(sql.unsafe('CREATE OR REPLACE VIEW qa_readonly_tenant AS SELECT id, name, slug, status FROM tenants'));
      await denied(sql.unsafe("UPDATE qa_readonly_tenant SET slug = 'x'"), '55000'); // B4.11.3: a join view is not updatable at all (before: refused for lack of privilege)
      await denied(sql.unsafe('DELETE FROM qa_readonly_scope'), '55000'); // join view: not updatable
      await denied(sql.unsafe('DROP POLICY "categories_qa_readonly_select" ON categories'));
    });
  });
});
