import { existsSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

/**
 * Guards that keep the two local environments apart (D-8E.24):
 *
 * - DEVELOPMENT: a persistent embedded PostgreSQL (`scratchpad/.dev-pgdata` unless `DEV_PGDATA_DIR`). Nothing in this
 *   package deletes it; it is created only when the directory is missing or empty.
 * - TESTING: a disposable embedded PostgreSQL (`tools/pg-verify/.verify-pgdata`, database `saas_inventory_verify`), rebuilt
 *   by every `verify` run or explicitly by `test:db:reset`.
 *
 * Every destructive operation of the testing side goes through `assertTestingTarget` / `removeDisposableDir`, which refuse
 * anything that is not provably the disposable testing target. A name or a port alone is never accepted as proof.
 */

/** Ports that belong to other work (the live development database, the protected verification instances, the installed service). */
export const PROTECTED_PORTS: readonly number[] = [5432, 55432, 55433, 55440];
/** The only directory names the testing side may ever delete. */
export const DISPOSABLE_DIR_NAMES: readonly string[] = ['.verify-pgdata'];
/** A file whose presence in a directory makes every guard refuse to delete it. */
export const PERSISTENT_MARKER = '.persistent';
/** Sibling files (outside PGDATA, so initdb and the server never see them) that record the initialisation of a development data directory. */
export const devInitializingMarker = (dataDir: string): string => `${dataDir}.initializing`;
export const devInitializedMarker = (dataDir: string): string => `${dataDir}.initialized`;
/** Database names the testing side may create or drop. */
export const TESTING_DB_NAME = /^saas_inventory_(verify|test)[a-z0-9_]*$/;
/** Default port of the disposable testing server (override with PG_VERIFY_PORT). Not protected, not in the harness range. */
export const DEFAULT_TESTING_PORT = 55450;

export class EnvironmentGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentGuardError';
  }
}

const norm = (p: string): string => {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** True when `child` is `parent` or lies inside it. */
export function isSameOrInside(parent: string, child: string): boolean {
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Where the persistent development data lives: `DEV_PGDATA_DIR`, or the directory that already holds it. */
export function resolveDevDataDir(repoRoot: string, env: Readonly<Record<string, string | undefined>>): string {
  const configured = env['DEV_PGDATA_DIR'];
  return configured !== undefined && configured !== '' ? path.resolve(configured) : path.join(repoRoot, 'scratchpad', '.dev-pgdata');
}

export type DataDirKind = 'missing' | 'empty' | 'postgres' | 'unknown';

/** What is at `dir`: nothing, an empty directory, a PostgreSQL data directory (has `PG_VERSION`), or something else. */
export function classifyDataDir(dir: string): DataDirKind {
  if (!existsSync(dir)) return 'missing';
  if (existsSync(path.join(dir, 'PG_VERSION'))) return 'postgres';
  return readdirSync(dir).length === 0 ? 'empty' : 'unknown';
}

/** Throws unless the development target cannot be mistaken for the testing environment. */
export function assertDevTarget(dataDir: string, port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new EnvironmentGuardError('The development port is not a valid unprivileged port.');
  if (port === DEFAULT_TESTING_PORT) throw new EnvironmentGuardError(`Port ${String(DEFAULT_TESTING_PORT)} is the default testing port; the development database must not use it.`);
  if (DISPOSABLE_DIR_NAMES.includes(path.basename(dataDir))) {
    throw new EnvironmentGuardError(`The development data directory cannot be named ${path.basename(dataDir)}: that name is reserved for the disposable testing data.`);
  }
}

/** Compares the data directory the SERVER reports (`SHOW data_directory`) with the one we mean to use; a different server on that port is refused. */
export function assertServerDataDirectory(actual: string, expected: string): void {
  const clean = (p: string): string => norm(path.resolve(p.replaceAll('\\', '/')));
  if (clean(actual) !== clean(expected)) {
    throw new EnvironmentGuardError('The server that answered is not the one that owns the expected data directory; refusing to continue.');
  }
}

export interface TestingTarget {
  readonly port: number;
  readonly dataDir: string;
  readonly dbName: string;
}

/** Throws unless `target` is provably the disposable testing environment and cannot be the development one. */
export function assertTestingTarget(target: TestingTarget, devDataDir: string): void {
  if (!Number.isInteger(target.port) || target.port < 1024 || target.port > 65535) {
    throw new EnvironmentGuardError('The testing port is not a valid unprivileged port.');
  }
  if (PROTECTED_PORTS.includes(target.port)) {
    throw new EnvironmentGuardError(`Port ${String(target.port)} is protected (development or other work); the testing environment never uses it.`);
  }
  if (!TESTING_DB_NAME.test(target.dbName)) {
    throw new EnvironmentGuardError('The testing database name must match saas_inventory_verify* or saas_inventory_test*.');
  }
  if (!DISPOSABLE_DIR_NAMES.includes(path.basename(target.dataDir))) {
    throw new EnvironmentGuardError(`The testing data directory must be named ${DISPOSABLE_DIR_NAMES.join(' or ')}.`);
  }
  if (isSameOrInside(devDataDir, target.dataDir) || isSameOrInside(target.dataDir, devDataDir)) {
    throw new EnvironmentGuardError('The testing data directory overlaps the development data directory; refusing.');
  }
  if (existsSync(path.join(target.dataDir, PERSISTENT_MARKER))) {
    throw new EnvironmentGuardError(`The directory is marked ${PERSISTENT_MARKER}; refusing to treat it as disposable.`);
  }
  if (existsSync(devInitializedMarker(target.dataDir)) || existsSync(devInitializingMarker(target.dataDir))) {
    throw new EnvironmentGuardError('A development initialisation marker points to this directory; refusing to treat it as disposable.');
  }
}

/** Deletes `dir` only if it is a disposable testing directory (same rules as `assertTestingTarget`). Returns whether it removed anything. */
export function removeDisposableDir(dir: string, devDataDir: string): boolean {
  if (!DISPOSABLE_DIR_NAMES.includes(path.basename(dir))) {
    throw new EnvironmentGuardError(`Refusing to delete ${path.basename(dir)}: only ${DISPOSABLE_DIR_NAMES.join(' or ')} can be deleted.`);
  }
  if (isSameOrInside(devDataDir, dir) || isSameOrInside(dir, devDataDir)) {
    throw new EnvironmentGuardError('Refusing to delete a directory that overlaps the development data directory.');
  }
  if (existsSync(path.join(dir, PERSISTENT_MARKER))) {
    throw new EnvironmentGuardError(`Refusing to delete a directory marked ${PERSISTENT_MARKER}.`);
  }
  if (existsSync(devInitializedMarker(dir)) || existsSync(devInitializingMarker(dir))) {
    throw new EnvironmentGuardError('Refusing to delete a directory that a development initialisation marker points to.');
  }
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Throws if something already listens on 127.0.0.1:`port` (a bind attempt only; no server is contacted). */
export function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new EnvironmentGuardError(`Port ${String(port)} is already in use: a server is running there. Nothing was started or deleted.`)));
    server.once('listening', () => server.close(() => resolve()));
    server.listen(port, '127.0.0.1');
  });
}
