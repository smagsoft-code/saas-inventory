import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';
import {
  assertDevTarget,
  assertPortFree,
  assertServerDataDirectory,
  classifyDataDir,
  devInitializedMarker,
  devInitializingMarker,
} from './env-guard';

/**
 * Recoverable initialisation of the DEVELOPMENT data directory (D-8E.25).
 *
 * `PG_VERSION` only proves that `initdb` started, not that the cluster is usable (a failure between `initdb` and the creation of the
 * database leaves exactly that). Two marker files NEXT TO the data directory (never inside it: `initdb` needs it empty and the server
 * must not see foreign files) record the real progress:
 *
 *   `<dir>.initializing`  written before `initdb`, kept until the cluster has been verified;
 *   `<dir>.initialized`   written only after the server answered and the database exists.
 *
 * State of a directory                         what `dev` does
 * ------------------------------------------   -------------------------------------------------------------------------------
 * missing / empty                              initialise it (markers, initdb, start, create the database, verify, mark complete)
 * PostgreSQL + `.initialized`                  start it as it is and verify it (server answers, database exists, owns this directory)
 * PostgreSQL + `.initializing` only (partial)  REFUSE. `dev --finish-init` starts it, creates the database if missing, verifies, marks it
 * PostgreSQL, no marker (e.g. created by the   REFUSE. `dev --adopt` starts it, verifies the database exists, and only then marks it
 *   older tools, or by hand)
 * anything else (not empty, no PG_VERSION)     REFUSE, untouched
 *
 * Nothing here ever deletes a data directory. Recovery is explicit (`--finish-init`, `--adopt`) or manual (you delete it yourself).
 */

export type InitState = 'fresh' | 'complete' | 'partial' | 'unmarked' | 'foreign';
export type StartAction = 'initialize' | 'reuse' | 'finish-init' | 'adopt';
export interface StartFlags {
  readonly finishInit: boolean;
  readonly adopt: boolean;
}

export class DevInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevInitError';
  }
}

export function inspectDevDir(dir: string): InitState {
  const kind = classifyDataDir(dir);
  if (kind === 'unknown') return 'foreign';
  if (kind === 'missing' || kind === 'empty') return 'fresh';
  if (existsSync(devInitializedMarker(dir))) return 'complete';
  if (existsSync(devInitializingMarker(dir))) return 'partial';
  return 'unmarked';
}

/** What to do with a directory in `state`, or a `DevInitError` that explains the explicit way forward. Pure. */
export function decideStart(state: InitState, flags: StartFlags, dir: string): StartAction {
  const where = `(${dir})`;
  switch (state) {
    case 'foreign':
      throw new DevInitError(`The directory ${where} is not empty and is not a PostgreSQL data directory; refusing to use or touch it.`);
    case 'fresh':
      if (flags.finishInit || flags.adopt) throw new DevInitError(`Nothing to ${flags.adopt ? 'adopt' : 'finish'}: the directory ${where} is missing or empty. Run dev without flags to create it.`);
      return 'initialize';
    case 'complete':
      return 'reuse';
    case 'partial':
      if (flags.finishInit) return 'finish-init';
      throw new DevInitError(
        `The initialisation of ${where} did not finish (marker .initializing without .initialized). Nothing was changed. ` +
          'Run dev --finish-init to verify it and complete it (it never deletes anything), or delete the directory yourself if you do not need its data.',
      );
    case 'unmarked':
      if (flags.adopt) return 'adopt';
      if (flags.finishInit) throw new DevInitError(`The directory ${where} has no initialisation marker at all; use dev --adopt (it verifies the database before marking it).`);
      throw new DevInitError(
        `The directory ${where} is a PostgreSQL data directory without an initialisation marker (created by an older tool or by hand). Nothing was changed. ` +
          'If it is your development data, run dev --adopt: it starts it, checks that the database exists and only then writes the marker.',
      );
  }
}

export function parseStartFlags(argv: readonly string[]): StartFlags {
  const unknown = argv.filter((arg) => arg !== '--finish-init' && arg !== '--adopt');
  if (unknown.length > 0) throw new DevInitError(`Unknown option: ${unknown[0] ?? ''}. Supported: --finish-init, --adopt.`);
  const flags = { finishInit: argv.includes('--finish-init'), adopt: argv.includes('--adopt') };
  if (flags.finishInit && flags.adopt) throw new DevInitError('Use either --finish-init or --adopt, not both.');
  return flags;
}

export interface DevClusterOptions {
  readonly dataDir: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly dbName: string;
  readonly flags: StartFlags;
}

export interface DevCluster {
  readonly pg: EmbeddedPostgres;
  /** True only when this call created a brand-new cluster (the one moment the QA admin must be registered). */
  readonly created: boolean;
  readonly action: StartAction;
}

const adminUrl = (o: DevClusterOptions): string => `postgresql://${encodeURIComponent(o.user)}:${encodeURIComponent(o.password)}@127.0.0.1:${String(o.port)}/postgres`;

async function databaseExists(o: DevClusterOptions): Promise<boolean> {
  const sql = postgres(adminUrl(o), { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from pg_database where datname = ${o.dbName}`;
    return (rows[0]?.n ?? 0) > 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The real state of the cluster: the server answers, it owns THIS data directory, and the database exists. */
async function assertClusterReady(o: DevClusterOptions): Promise<void> {
  const sql = postgres(adminUrl(o), { max: 1, onnotice: () => undefined });
  try {
    const dir = await sql<{ d: string }[]>`select current_setting('data_directory') as d`;
    assertServerDataDirectory(dir[0]?.d ?? '', o.dataDir);
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from pg_database where datname = ${o.dbName}`;
    if ((rows[0]?.n ?? 0) === 0) throw new DevInitError(`The cluster is up but the database "${o.dbName}" does not exist. Nothing was deleted; use dev --finish-init.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Prepares (and starts) the development cluster according to the state machine above. On any failure after the server started it is
 * stopped again; the directory and its markers are left exactly as they are. Never deletes anything.
 */
export async function prepareDevCluster(o: DevClusterOptions): Promise<DevCluster> {
  assertDevTarget(o.dataDir, o.port);
  const action = decideStart(inspectDevDir(o.dataDir), o.flags, o.dataDir);
  await assertPortFree(o.port);
  const pg = new EmbeddedPostgres({ databaseDir: o.dataDir, port: o.port, user: o.user, password: o.password, persistent: true });
  let started = false;
  try {
    if (action === 'initialize') {
      mkdirSync(path.dirname(o.dataDir), { recursive: true });
      // Our own bookkeeping files, not the data directory: a stale completion marker of a deleted directory is replaced.
      rmSync(devInitializedMarker(o.dataDir), { force: true });
      writeFileSync(devInitializingMarker(o.dataDir), JSON.stringify({ startedAt: new Date().toISOString() }));
      await pg.initialise();
      await pg.start();
      started = true;
      await pg.createDatabase(o.dbName);
    } else {
      await pg.start();
      started = true;
      if (action === 'finish-init' && !(await databaseExists(o))) await pg.createDatabase(o.dbName);
    }
    await assertClusterReady(o);
    if (action !== 'reuse') {
      writeFileSync(devInitializedMarker(o.dataDir), JSON.stringify({ completedAt: new Date().toISOString(), action, database: o.dbName }));
      rmSync(devInitializingMarker(o.dataDir), { force: true });
    }
    return { pg, created: action === 'initialize', action };
  } catch (error) {
    if (started) await pg.stop().catch(() => undefined);
    throw error;
  }
}
