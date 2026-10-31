import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';
import { prepareDevCluster, DevInitError, type DevClusterOptions } from './dev-init';
import { devInitializedMarker, devInitializingMarker, EnvironmentGuardError } from './env-guard';

/**
 * Opt-in (`pnpm test:embedded`): starts REAL embedded PostgreSQL servers, one at a time, in temporary directories on free ports it
 * picks itself (never a protected one, never the testing default). It cannot touch the development database: every directory,
 * port and credential here is created by this file. Not part of `pnpm test` because it needs the embedded binary and takes ~30 s.
 */

const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'pgv-dev-init-')));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
const password = randomBytes(12).toString('hex');
const PROTECTED = new Set([5432, 55432, 55433, 55440, 55450]);

async function freePort(): Promise<number> {
  for (let i = 0; i < 40; i += 1) {
    const port = 55460 + Math.floor(Math.random() * 40);
    if (PROTECTED.has(port)) continue;
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      s.listen(port, '127.0.0.1');
    });
    if (ok) return port;
  }
  throw new Error('no free port');
}

const NONE = { finishInit: false, adopt: false };
const dirOf = (name: string): string => path.join(root, name, 'pgdata');
async function options(name: string, flags = NONE): Promise<DevClusterOptions> {
  return { dataDir: dirOf(name), port: await freePort(), user: 'postgres', password, dbName: 'saas_inventory_dev', flags };
}
async function query<T>(o: DevClusterOptions, db: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(`postgresql://postgres:${password}@127.0.0.1:${String(o.port)}/${db}`, { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

describe('prepareDevCluster against a real embedded server', { concurrency: false }, () => {
  it('creates a fresh cluster, marks it complete, and keeps the data across stop/start without any flag', async () => {
    const o = await options('fresh');
    const first = await prepareDevCluster(o);
    assert.equal(first.created, true);
    assert.equal(first.action, 'initialize');
    assert.equal(existsSync(devInitializedMarker(o.dataDir)), true);
    assert.equal(existsSync(devInitializingMarker(o.dataDir)), false);
    await query(o, o.dbName, (sql) => sql`create table t(x int)`);
    await query(o, o.dbName, (sql) => sql`insert into t values (7)`);
    await first.pg.stop();
    assert.equal(existsSync(path.join(o.dataDir, 'PG_VERSION')), true, 'stop() must not delete the data directory');

    const o2 = { ...o, port: await freePort() };
    const second = await prepareDevCluster(o2);
    assert.equal(second.created, false);
    assert.equal(second.action, 'reuse');
    const rows = await query(o2, o2.dbName, (sql) => sql`select x from t`);
    assert.equal(rows[0]?.x, 7, 'the row written before the stop must survive the restart');
    await second.pg.stop();
  });

  it('a failure between initdb and the database leaves a PARTIAL directory that is refused, untouched, and then completed only with --finish-init', async () => {
    const o = await options('partial');
    // Simulate the crash: markers and initdb done, the database never created.
    mkdirSync(path.dirname(o.dataDir), { recursive: true });
    writeFileSync(devInitializingMarker(o.dataDir), '{}');
    const pg = new EmbeddedPostgres({ databaseDir: o.dataDir, port: o.port, user: o.user, password, persistent: true });
    await pg.initialise();
    const before = existsSync(path.join(o.dataDir, 'PG_VERSION'));
    assert.equal(before, true);

    await assert.rejects(prepareDevCluster(o), (e: unknown) => e instanceof DevInitError && /--finish-init/.test(e.message));
    assert.equal(existsSync(path.join(o.dataDir, 'PG_VERSION')), true, 'a refusal must not delete anything');
    assert.equal(existsSync(devInitializedMarker(o.dataDir)), false);

    await assert.rejects(prepareDevCluster({ ...o, flags: { finishInit: false, adopt: true } }), DevInitError);

    const done = await prepareDevCluster({ ...o, flags: { finishInit: true, adopt: false } });
    assert.equal(done.action, 'finish-init');
    assert.equal(done.created, false);
    assert.equal(existsSync(devInitializedMarker(o.dataDir)), true);
    const dbs = await query(o, 'postgres', (sql) => sql`select datname from pg_database where datname = ${o.dbName}`);
    assert.equal(dbs.length, 1);
    await done.pg.stop();
  });

  it('an unmarked cluster (older tool, or by hand) is refused untouched and adopted only with --adopt, after verifying its database', async () => {
    const o = await options('unmarked');
    const manual = new EmbeddedPostgres({ databaseDir: o.dataDir, port: o.port, user: o.user, password, persistent: true });
    await manual.initialise();
    await manual.start();
    await manual.createDatabase(o.dbName);
    await query(o, o.dbName, (sql) => sql`create table keep(x int)`);
    await manual.stop();

    await assert.rejects(prepareDevCluster(o), (e: unknown) => e instanceof DevInitError && /--adopt/.test(e.message));
    assert.equal(existsSync(devInitializedMarker(o.dataDir)), false);

    const adopted = await prepareDevCluster({ ...o, flags: { finishInit: false, adopt: true } });
    assert.equal(adopted.action, 'adopt');
    assert.equal(existsSync(devInitializedMarker(o.dataDir)), true);
    const kept = await query(o, o.dbName, (sql) => sql`select count(*)::int as n from information_schema.tables where table_name = 'keep'`);
    assert.equal(kept[0]?.n, 1, 'adopting must not change the data');
    await adopted.pg.stop();
  });

  it('--adopt refuses an unmarked cluster whose database does not exist, and leaves it untouched', async () => {
    const o = await options('nodb');
    const manual = new EmbeddedPostgres({ databaseDir: o.dataDir, port: o.port, user: o.user, password, persistent: true });
    await manual.initialise();
    await manual.start();
    await manual.stop();
    await assert.rejects(prepareDevCluster({ ...o, flags: { finishInit: false, adopt: true } }), (e: unknown) => e instanceof DevInitError && /does not exist/.test(e.message));
    assert.equal(existsSync(devInitializedMarker(o.dataDir)), false, 'no completion marker may be written for an unverified cluster');
    assert.equal(existsSync(path.join(o.dataDir, 'PG_VERSION')), true);
  });

  it('refuses a foreign directory and a port in use without creating or deleting anything', async () => {
    const foreign = await options('foreign');
    mkdirSync(foreign.dataDir, { recursive: true });
    writeFileSync(path.join(foreign.dataDir, 'notes.txt'), 'x');
    await assert.rejects(prepareDevCluster(foreign), DevInitError);
    assert.equal(existsSync(path.join(foreign.dataDir, 'notes.txt')), true);

    const busy = await options('busy');
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(busy.port, '127.0.0.1', resolve));
    await assert.rejects(prepareDevCluster(busy), EnvironmentGuardError);
    assert.equal(existsSync(busy.dataDir), false, 'nothing may be created when the port is taken');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects the testing directory name and the testing port as a development target', async () => {
    const bad = await options('x');
    await assert.rejects(prepareDevCluster({ ...bad, dataDir: path.join(root, 'y', '.verify-pgdata') }), EnvironmentGuardError);
    await assert.rejects(prepareDevCluster({ ...bad, port: 55450 }), EnvironmentGuardError);
  });
});
